import {beforeAll,beforeEach,afterEach,afterAll,describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {Pool,type PoolClient} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {persistResearchedCompany,companyIdentityDrizzleClient} from './company-identity-store';
import {appendFirmableSyncCompanyObservation,type FirmableSyncCompanyObservationInput} from './company-sync-observation-store';
import {responseHash} from '../domain/firmable-history';
vi.mock('./client',()=>({requireDb:()=>{throw Error('Unexpected implicit database');}}));
import {FirmableHistoryRepository} from './firmable-history-repository';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true',pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:1});
let c:PoolClient,org:string,user:string,mandate:string,job:string,target:string,run:string,fid:string,domain:string;
function input():FirmableSyncCompanyObservationInput{return{runId:run,mandateId:mandate,targetId:target,expectedGeneration:1,source:{companyName:'Canonical fixture',domain,firmableId:fid},sourceFacts:{firmographics:{description:'Fresh source company fact'},identifiers:{firmableId:fid},firmableCompanyId:fid}};}
describe.runIf(enabled)('AG26 genuine sync origin accepted-company refresh, rollback-only no provider',()=>{
 beforeAll(async()=>{expect((await pool.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});expect((await pool.query('SELECT system_identifier::text id FROM pg_control_system()')).rows[0].id).toBe('7697400069962248225');});
 beforeEach(async()=>{c=await pool.connect();await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='3s'");await c.query("SET LOCAL lock_timeout='1s'");org=randomUUID();user=randomUUID();mandate=randomUUID();job=randomUUID();run=randomUUID();fid='f'+BigInt('0x'+randomUUID().replaceAll('-',''));domain=job+'.example.invalid';
 await c.query('INSERT INTO public."user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);await c.query("INSERT INTO mandates(id,organization_id,created_by,natural_language,filters,provenance) VALUES($1,$2,$3,'Synthetic refresh observation fixture','{}','{}')",[mandate,org,user]);await c.query("INSERT INTO research_jobs(id,organization_id,mandate_id,created_by,status,config) VALUES($1,$2,$3,$4,'complete','{}')",[job,org,mandate,user]);await c.query("INSERT INTO firmable_companies(id,name,domain,people_generation) VALUES($1,'Synthetic Company',$2,1)",[fid,domain]);
 const initial=await persistResearchedCompany(c,{organizationId:org,userId:user},{requestKey:job,jobId:job,companyName:'Canonical fixture',domain,firmableId:fid,observedAt:'2026-10-17T00:00:00.000Z',sourceUrl:'https://'+domain,sourceFacts:{firmographics:{description:'Original source fact'},identifiers:{firmableId:fid},firmableCompanyId:fid}});if(initial.status!=='persisted')throw Error('Fixture canonical persistence failed');target=initial.targetId;
 await c.query("INSERT INTO firmable_sync_runs(id,organization_id,actor_id,target_id,firmable_company_id,request_key,status,generation) VALUES($1,$2,$3,$4,$5,$6,'running',1)",[run,org,user,target,fid,run]);const raw={id:fid,fqdn:domain,name:'Canonical fixture',description:'Fresh source company fact'};
 await c.query("INSERT INTO firmable_company_responses(id,run_id,firmable_company_id,logical_call_id,attempt,response,http_status,successful,response_hash,requested_at,fetched_at) VALUES($1,$2,$3,'synthetic-company',1,$4,200,true,$5,'2026-10-18T00:00:00Z','2026-10-18T00:00:01Z')",[randomUUID(),run,fid,raw,responseHash(raw)]);
 });afterEach(async()=>{await c.query('ROLLBACK');c.release();});afterAll(async()=>{await pool.end();});
 it('uses a genuine sync origin and same Drizzle transaction, preserves canonical row, and replays without another observation',async()=>{
 const before=(await c.query('SELECT xmin::text revision,* FROM targets WHERE id=$1',[target])).rows[0];const port=companyIdentityDrizzleClient(drizzle(c)),actor={organizationId:org,userId:user};const result=await appendFirmableSyncCompanyObservation(port,actor,input());expect(result).toMatchObject({handled:true,targetId:target,replayed:false});
 expect((await c.query('SELECT xmin::text revision,* FROM targets WHERE id=$1',[target])).rows[0]).toEqual(before);
 const saved=(await c.query('SELECT job_id,source_kind,firmable_sync_run_id,source_provenance FROM company_identity_accepted_observations WHERE organization_id=$1 AND request_key=$2',[org,run])).rows[0];expect(saved).toMatchObject({job_id:null,source_kind:'firmable_sync',firmable_sync_run_id:run,source_provenance:{runId:run,generation:1}});
 expect(await appendFirmableSyncCompanyObservation(port,actor,input())).toMatchObject({handled:true,targetId:target,replayed:true});expect((await c.query('SELECT count(*)::int n FROM company_identity_observations WHERE organization_id=$1',[org])).rows[0].n).toBe(2);expect((await c.query('SELECT observation_id FROM company_membership_projections WHERE organization_id=$1',[org])).rows[0].observation_id).toBe(result.handled?result.observationId:'');
 });
 it.each(['cancelled','generation','domain','actor'] as const)('denies changed %s without appending or rewriting company facts',async changed=>{
 if(changed==='cancelled')await c.query("UPDATE firmable_sync_runs SET status='cancelled' WHERE id=$1",[run]);if(changed==='generation')await c.query('UPDATE firmable_companies SET people_generation=2 WHERE id=$1',[fid]);const raw=input();if(changed==='domain')raw.source.domain='other.example.invalid';const actor={organizationId:org,userId:changed==='actor'?randomUUID():user};await c.query('SAVEPOINT denied_refresh');await expect(appendFirmableSyncCompanyObservation(companyIdentityDrizzleClient(drizzle(c)),actor,raw)).rejects.toThrow();await c.query('ROLLBACK TO SAVEPOINT denied_refresh');expect((await c.query('SELECT count(*)::int n FROM company_identity_observations WHERE organization_id=$1',[org])).rows[0].n).toBe(1);
 });
 it('records an inconsistent refresh run without rewriting an accepted canonical target identity',async()=>{
 const other='f'+BigInt('0x'+randomUUID().replaceAll('-',''));await c.query("INSERT INTO firmable_companies(id,name) VALUES($1,'Other provider company')",[other]);
 const before=(await c.query('SELECT xmin::text revision,firmable_company_id FROM targets WHERE id=$1',[target])).rows[0];
 await new FirmableHistoryRepository(drizzle(c) as never).linkRunCompany(run,other,'complete');
 expect((await c.query('SELECT xmin::text revision,firmable_company_id FROM targets WHERE id=$1',[target])).rows[0]).toEqual(before);
 expect((await c.query('SELECT firmable_company_id FROM firmable_sync_runs WHERE id=$1',[run])).rows[0].firmable_company_id).toBe(other);
 await expect(appendFirmableSyncCompanyObservation(companyIdentityDrizzleClient(drizzle(c)),{organizationId:org,userId:user},input())).rejects.toThrow('identity requires review');
 });

});
