import {expect,it} from 'vitest';
import {Client} from 'pg';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import {compactResearchTimingQuery} from './research-timing-summary';
import {summariseResearchTimings,summariseCompactResearchTimings,type CompactResearchTimingRun} from '@/domain/research-timing';
const makeSpan=(n:number,elapsedMs:number)=>({id:`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,step:`extract-${n}`,segment:'extraction',startedAt:'2026-09-30T00:00:00.000Z',finishedAt:'2026-09-30T00:00:01.000Z',elapsedMs,outcome:n%2?'succeeded':'failed'});
it.skipIf(process.env.RUN_RESEARCH_SCHEDULER_SQL_TESTS!=='true')('matches raw summaries exactly across validation, UUID winners, ordered decimals, cap and percentiles using SELECT-only PostgreSQL',async()=>{
 const client=new Client({connectionString:'postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire'});await client.connect();
 const spans=Object.fromEntries(Array.from({length:2048},(_,n)=>[makeSpan(n,n).id,makeSpan(n,n+.1)]));
 const input=[
 {id:'new',created_at:'2026-09-30T00:00:00Z',job_order:1,config:{researchRunId:'run',pipelineTiming:spans,researchMilestones:{firstCompanyAt:'2026-09-30T00:00:03Z'}}},
 {id:'old',created_at:'2026-09-29T23:59:59Z',job_order:2,config:{researchRunId:'run',pipelineTiming:{ '2':makeSpan(1,.2), '1':makeSpan(2,.3), other:makeSpan(2049,.1), bad:{...makeSpan(2050,1),elapsedMs:-1}, unicode:{...makeSpan(2051,10),step:'😀'.repeat(81)}, offset:{...makeSpan(2052,10),startedAt:'2026-09-30T00:00:00+00:00'}, tiny:{...makeSpan(2055,Number.MIN_VALUE)}, high:{...makeSpan(2056,86400000)}, tooHigh:{...makeSpan(2057,86400001)}, upperUUID:{...makeSpan(2058,1),id:makeSpan(2058,1).id.toUpperCase()}, wrongType:{...makeSpan(2059,1),elapsedMs:'1'}, reverse:{...makeSpan(2060,1),finishedAt:'2026-09-29T00:00:00Z'}, partial:{...makeSpan(2053,1),startedAt:'2026-09-30T00:00Z'}, precision:{...makeSpan(2054,1),startedAt:'0000-02-29T00:00:00.999999999Z'}}}},
 {id:'empty',created_at:'2026-09-29T00:00:00Z',job_order:3,config:{researchRunId:'empty',pipelineTiming:{bad:{},badDate:{...makeSpan(3000,1),startedAt:'2026-02-30T00:00:00Z'}}}},
 ];
 try {
 const relation=sql`SELECT * FROM jsonb_to_recordset(${JSON.stringify(input)}::jsonb) AS fixture(id text,created_at timestamptz,job_order bigint,config jsonb)`;
 const query=new PgDialect().sqlToQuery(compactResearchTimingQuery(relation));
 const compact=(await client.query(query.sql,query.params)).rows as CompactResearchTimingRun[];
 const canonical=(await client.query('SELECT $1::jsonb AS value',[JSON.stringify(input)])).rows[0].value as typeof input;
 for(const run of compact) {
  const jobs=canonical.filter(job=>job.config.researchRunId===run.runId).map(job=>({id:job.id,createdAt:job.created_at,config:job.config as never}));
  expect(summariseCompactResearchTimings(jobs,run)).toEqual(summariseResearchTimings(jobs));
 }
 expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(input).length/10);
 } finally {await client.end();}
}, 20_000);
