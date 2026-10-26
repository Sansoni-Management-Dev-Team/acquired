import {expect,it} from 'vitest';
import {Client} from 'pg';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {mandateResearchStatusQuery} from './mandate-research-status';
import {mandateResearchStatus} from '@/domain/mandate-research-status';

it.skipIf(process.env.RUN_MANDATE_STATUS_SQL_TESTS!=='true')('summarises only the latest run and its own children using SELECT-only fixtures',async()=>{
  const client=new Client({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
  await client.connect();
  try{
    await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='5s'");
    const identity=(await client.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
    expect(identity).toEqual({database:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
    const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
    const mandates=[1,2,3,4].map(n=>({id:id(n),organization_id:'org'}));
    const job=(n:number,m:number,status:string,config:Record<string,unknown>={},organization_id='org',date='2026-10-26')=>({id:id(n),mandate_id:id(m),organization_id,status,config,created_at:`${date}T00:00:00Z`});
    const jobs=[
      job(11,1,'complete'),job(12,1,'queued',{parentJobId:id(11),researchTask:'company'}),
      job(21,2,'complete'),job(22,2,'complete',{researchRunId:id(21),researchTask:'company'}),
      job(23,2,'failed',{},'org','2026-10-25'),job(24,2,'failed',{parentJobId:id(23),researchTask:'company'}),
      job(25,2,'failed',{parentJobId:id(21),researchTask:'company'},'other'),
      job(41,4,'complete'),job(42,4,'partial',{companyBackgroundResearch:{sourceRootId:id(41)},purpose:'firmographics'}),
    ];
    const fixtures=sql`WITH mandates AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(mandates)}::jsonb) AS m(id uuid,organization_id text)),
      research_jobs AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(jobs)}::jsonb) AS j(id uuid,mandate_id uuid,organization_id text,status text,config jsonb,created_at timestamptz))
      ${mandateResearchStatusQuery('org',mandates.map(m=>m.id))}`;
    const query=new PgDialect().sqlToQuery(fixtures);
    const rows=(await client.query(query.sql,query.params)).rows;
    expect(Object.fromEntries(rows.map(row=>[row.id,mandateResearchStatus(row)]))).toEqual({[id(1)]:'running',[id(2)]:'complete',[id(3)]:'not_started',[id(4)]:'partial'});
  }finally{await client.query('ROLLBACK');await client.end();}
});
