import {expect,it,vi} from 'vitest';
vi.mock('./client',()=>({requireDb:vi.fn()}));
import {PgDialect} from 'drizzle-orm/pg-core';
import {drizzle} from 'drizzle-orm/node-postgres';
import {eq} from 'drizzle-orm';
import {researchJobs} from './schema';
import {researchExecutionProgressAt} from './research-repository';
import {researchExecutionUpdatedAt} from '@/domain/research-liveness';
const rootId='00000000-0000-4000-8000-000000000001';
const now=Date.parse('2026-10-26T02:05:00Z');
const root={id:rootId,organizationId:'org',mandateId:rootId,createdBy:'owner',updatedAt:new Date(now-14*60000),config:{}};
const child=(change:Record<string,unknown>={})=>({...root,id:crypto.randomUUID(),updatedAt:new Date(now-30000),config:{parentJobId:rootId,researchTask:'company'},...change});
it('derives liveness from root and only its owned company callbacks',()=>{
 expect(researchExecutionUpdatedAt(root,[root])).toBe(root.updatedAt.getTime());
 expect(researchExecutionUpdatedAt(root,[child()])).toBe(now-30000);
 for(const unrelated of [child({organizationId:'other'}),child({mandateId:crypto.randomUUID()}),child({createdBy:'other'}),child({config:{parentJobId:rootId,researchTask:'field'}}),child({config:{parentJobId:'other',researchTask:'company'}})])expect(researchExecutionUpdatedAt(root,[unrelated])).toBe(root.updatedAt.getTime());
});
it('keeps the fresh-control query tenant, mandate, owner, source and task scoped',()=>{
 const {sql}=new PgDialect().sqlToQuery(researchExecutionProgressAt);
 expect(sql).toContain('company_progress.organization_id = "research_jobs"."organization_id"');
 expect(sql).toContain('company_progress.mandate_id = "research_jobs"."mandate_id"');
 expect(sql).toContain('company_progress.created_by = "research_jobs"."created_by"');
 expect(sql).toContain("company_progress.config->>'parentJobId' = \"research_jobs\".\"id\"::text");
 expect(sql).toContain("company_progress.config->>'researchTask' = 'company'");
 expect(sql).not.toContain('firmable_sync_runs');
});
it('preserves outer-table correlation inside the actual single-table SELECT',()=>{
 const query=drizzle.mock().select({progress:researchExecutionProgressAt.as('progress')}).from(researchJobs).where(eq(researchJobs.id,rootId)).limit(1).toSQL();
 for(const column of ['organization_id','mandate_id','created_by'])expect(query.sql).toContain(`company_progress.${column} = "research_jobs"."${column}"`);
 expect(query.sql).toContain("company_progress.config->>'parentJobId' = \"research_jobs\".\"id\"::text");
});
it.runIf(process.env.RUN_RESEARCH_CONTROL_INTEGRATION==='true')('evaluates the generated SELECT against read-only fixtures in the verified mirror',async()=>{
 const url=new URL(process.env.RESEARCH_CONTROL_DATABASE_URL||'');
 expect(url.hostname).toBe('127.0.0.1');expect(url.port).toBe('5442');expect(url.pathname).toBe('/acquire_agent_mode');
 const {Client}=await import('pg');const client=new Client({connectionString:url.href,options:'-c statement_timeout=3000'});
 try{
  await client.connect();await client.query('BEGIN READ ONLY');
  expect((await client.query("SELECT current_database() name,(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='postgres') marker,(SELECT system_identifier::text FROM pg_control_system()) system")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-research-app-local-only',system:'7701165885598298145'});
  const query=drizzle.mock().select({progress:researchExecutionProgressAt.as('progress')}).from(researchJobs).where(eq(researchJobs.id,rootId)).limit(1).toSQL();
  for(const children of [[],[child()],[child({organizationId:'other'})],[child({mandateId:crypto.randomUUID()})],[child({createdBy:'other'})],[child({config:{parentJobId:rootId,researchTask:'field'}})],[child({config:{parentJobId:'other',researchTask:'company'}})]]){
   const jobs=[root,...children],params:unknown[]=[...query.params];
   const rows=jobs.map(job=>{const start=params.length;params.push(job.id,job.organizationId,job.mandateId,job.createdBy,job.updatedAt,JSON.stringify(job.config));return `($${start+1}::uuid,$${start+2}::text,$${start+3}::uuid,$${start+4}::text,$${start+5}::timestamptz,$${start+6}::jsonb)`;});
   const result=await client.query(`WITH research_jobs(id,organization_id,mandate_id,created_by,updated_at,config) AS (VALUES ${rows.join(',')}) ${query.sql}`,params);
   expect(new Date(result.rows[0].progress).getTime()).toBe(researchExecutionUpdatedAt(root,jobs));
  }
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
});
it.runIf(process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true')('evaluates the real PostgreSQL progress expression on disposable read-only CTEs',async()=>{
 const {Client}=await import('pg');const client=new Client({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',options:'-c statement_timeout=3000 -c lock_timeout=1000'});
 try{
  await client.connect();await client.query('BEGIN READ ONLY');
  expect((await client.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker,(SELECT system_identifier::text FROM pg_control_system()) system FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only',system:'7697400069962248225'});
  const expression=new PgDialect().sqlToQuery(researchExecutionProgressAt);
  for(const children of [[],[child()],[child({organizationId:'other'})],[child({mandateId:crypto.randomUUID()})],[child({createdBy:'other'})],[child({config:{parentJobId:rootId,researchTask:'field'}})],[child({config:{parentJobId:'other',researchTask:'company'}})]]){
   const jobs=[root,...children],params:unknown[]=[];
   const rows=jobs.map(job=>{const start=params.length;params.push(job.id,job.organizationId,job.mandateId,job.createdBy,job.updatedAt,JSON.stringify(job.config));return `($${start+1}::uuid,$${start+2}::text,$${start+3}::uuid,$${start+4}::text,$${start+5}::timestamptz,$${start+6}::jsonb)`;});
   const result=await client.query(`WITH research_jobs(id,organization_id,mandate_id,created_by,updated_at,config) AS (VALUES ${rows.join(',')}) SELECT ${expression.sql} AS progress FROM research_jobs WHERE id=$1`,params);
   expect(new Date(result.rows[0].progress).getTime()).toBe(researchExecutionUpdatedAt(root,jobs));
  }
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();}
});
