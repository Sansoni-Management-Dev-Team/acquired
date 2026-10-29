import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { Pool,type PoolClient } from 'pg';
import { drizzle,type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and,eq,sql } from 'drizzle-orm';
vi.mock('@/db/client',()=>({requireDb:vi.fn()}));
vi.mock('@/lib/research-service',()=>({researchWorker:vi.fn().mockResolvedValue({status:'starting'})}));
import { requireDb } from './client';
import { researchWorker } from '@/lib/research-service';
import { dispatchCompanyBackground } from '@/lib/company-background-dispatch';
import { queueCompanyBackgroundResearch } from '@/lib/company-background-research';
import { mapFirmableProfile } from '@/adapters/firmable-company-mapper';
import * as schema from './schema';
const filters={states:['VIC'],sectors:['Industrial cleaning'],revenue:{min:0,max:null},ebitda:{min:0,max:null}};
describe.skipIf(process.env.RUN_FIRMABLE_DB_INTEGRATION!=='true')('Concurrent background dispatch PostgreSQL boundary',()=>{
 let pool:Pool,database:NodePgDatabase<typeof schema>,root:typeof schema.researchJobs.$inferSelect,mandateId:string;
 const organizationId=`background-concurrency-${crypto.randomUUID()}`,actorId=`background-concurrency-${crypto.randomUUID()}`;
 beforeAll(async()=>{
  const url=process.env.FIRMABLE_INTEGRATION_DATABASE_URL;if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Explicit local PostgreSQL URL required');
  pool=new Pool({connectionString:url,max:4});database=drizzle({client:pool,schema});vi.mocked(requireDb).mockReturnValue(database as never);
  await database.insert(schema.organization).values({id:organizationId,name:'Synthetic concurrent dispatcher',slug:organizationId});await database.insert(schema.user).values({id:actorId,name:'Synthetic dispatcher',email:`${actorId}@example.test`});
  const [mandate]=await database.insert(schema.mandates).values({organizationId,createdBy:actorId,naturalLanguage:'Synthetic concurrent slots',filters,provenance:{source:'Synthetic test fixture'}}).returning();mandateId=mandate.id;
  [root]=await database.insert(schema.researchJobs).values({id:crypto.randomUUID(),organizationId,mandateId,createdBy:actorId,status:'complete',config:{workflow:'business',mode:'automatic',geography:'VIC',searchTerms:['Industrial cleaning'],researchScope:'services',seeds:[],budget:{maxPages:1,maxDomains:1,maxModelCalls:0,maxMinutes:1},automaticDeadline:Date.now()-10000},message:'Synthetic profiles settled'}).returning();
  for(let n=0;n<3;n++){
   const candidate=mapFirmableProfile({id:`synthetic-${n}`,name:`Synthetic dispatcher company ${n}`,website:`https://operator${n}.example.com`,region:{AU:{employee_count:25}}},filters,organizationId);
   const [saved]=await database.insert(schema.targets).values({organizationId,mandateId,companyName:candidate.companyName,domain:candidate.domain,firmographics:{firmable:candidate.sourceData?.firmable}}).returning();
   await queueCompanyBackgroundResearch(root,{...candidate,id:saved.id});
  }
  const jobs=await database.select().from(schema.researchJobs).where(and(eq(schema.researchJobs.organizationId,organizationId),eq(schema.researchJobs.status,'queued')));
  for(const job of jobs)await database.update(schema.researchJobs).set({config:{...job.config as object,automaticDeadline:Date.now()-10000}}).where(eq(schema.researchJobs.id,job.id));
 });
 afterAll(async()=>{
  if(!pool)return;
  try{
   // Exact synthetic organization only: these commits are necessary for two independent connections to see the same fixtures.
   await database.transaction(async tx=>{await tx.execute(sql`SET LOCAL session_replication_role='replica'`);await tx.delete(schema.researchFindings).where(eq(schema.researchFindings.organizationId,organizationId));await tx.delete(schema.researchJobs).where(eq(schema.researchJobs.organizationId,organizationId));await tx.delete(schema.contacts).where(eq(schema.contacts.organizationId,organizationId));await tx.delete(schema.targets).where(eq(schema.targets.organizationId,organizationId));await tx.delete(schema.mandates).where(eq(schema.mandates.organizationId,organizationId));await tx.execute(sql`DELETE FROM communication_send_gates WHERE organization_id=${organizationId}`);await tx.delete(schema.organization).where(eq(schema.organization.id,organizationId));await tx.delete(schema.user).where(eq(schema.user.id,actorId));});
   expect(await database.select().from(schema.organization).where(eq(schema.organization.id,organizationId))).toHaveLength(0);
  }finally{await pool.end();}
 });
 it('two concurrent independently transacted dispatchers share two organization slots and refresh an expired queued deadline at claim',async()=>{
  const started=Date.now();const claimed=await Promise.all([dispatchCompanyBackground(organizationId,mandateId),dispatchCompanyBackground(organizationId,mandateId)]);expect(claimed.reduce((a,b)=>a+b,0)).toBe(2);expect(researchWorker).toHaveBeenCalledTimes(2);
  const rows=await database.select().from(schema.researchJobs).where(eq(schema.researchJobs.organizationId,organizationId));const running=rows.filter(j=>j.status==='discovering');expect(running).toHaveLength(2);expect(rows.filter(j=>j.status==='queued')).toHaveLength(1);
  for(const job of running){const config=job.config as {automaticDeadline:number;companyBackgroundDispatch:{attempts:number;startedAt:number}};expect(config.automaticDeadline).toBeGreaterThan(started+100000);expect(config.companyBackgroundDispatch).toMatchObject({attempts:1});}
  await database.update(schema.researchJobs).set({status:'complete'}).where(eq(schema.researchJobs.id,running[0].id));expect(await dispatchCompanyBackground(organizationId,mandateId)).toBe(1);expect(researchWorker).toHaveBeenCalledTimes(3);
  const [parent]=await database.select().from(schema.researchJobs).where(eq(schema.researchJobs.id,root.id));expect(parent.status).toBe('complete');
 });
 it('organization advisory lock is exclusive across actual PostgreSQL connections',async()=>{
  let a:PoolClient|undefined,b:PoolClient|undefined;
  try{a=await pool.connect();b=await pool.connect();await a.query('BEGIN');await b.query('BEGIN');await a.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`company-background:${organizationId}`]);expect((await b.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired',[`company-background:${organizationId}`])).rows[0].acquired).toBe(false);}
  finally{if(a){await a.query('ROLLBACK');a.release();}if(b){await b.query('ROLLBACK');b.release();}}
 });
 it('a cancelled root cancels queued work without destroying retained company evidence or dispatching again',async()=>{
  await database.update(schema.researchJobs).set({status:'complete'}).where(and(eq(schema.researchJobs.organizationId,organizationId),sql`${schema.researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`));
  const [child]=await database.select().from(schema.researchJobs).where(and(eq(schema.researchJobs.organizationId,organizationId),sql`${schema.researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`)).limit(1);
  await database.update(schema.researchJobs).set({status:'queued',config:{...child.config as object,companyBackgroundResult:{written:1,retained:true}}}).where(eq(schema.researchJobs.id,child.id));await database.update(schema.researchJobs).set({status:'cancelled'}).where(eq(schema.researchJobs.id,root.id));
  const before=vi.mocked(researchWorker).mock.calls.length;expect(await dispatchCompanyBackground(organizationId,mandateId)).toBe(0);expect(researchWorker).toHaveBeenCalledTimes(before);
  const [cancelled]=await database.select().from(schema.researchJobs).where(eq(schema.researchJobs.id,child.id));expect(cancelled.status).toBe('cancelled');expect(cancelled.config).toMatchObject({companyBackgroundResult:{written:1,retained:true}});
 });
});
