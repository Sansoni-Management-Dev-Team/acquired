import {beforeEach,expect,it,vi} from 'vitest';
import {getTableName} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
const m=vi.hoisted(()=>({enabled:true,background:vi.fn(),recoverBackground:vi.fn(),people:vi.fn(),schedule:vi.fn(),worker:vi.fn(),recover:vi.fn(),list:vi.fn(),latest:vi.fn(),firmable:vi.fn(),execute:vi.fn(),scopeRows:[]as {organizationId:string;mandateId:string}[],members:[]as {id:string}[],tables:[]as string[],db:null as unknown}));
vi.mock('./company-background-dispatch',()=>({dispatchCompanyBackground:m.background,recoverCompanyBackground:m.recoverBackground}));
vi.mock('./company-people-research',()=>({tickCompanyPeople:m.people}));
vi.mock('./research-scheduler',()=>({scheduleResearchRun:m.schedule}));
vi.mock('./research-service',()=>({researchEnabled:()=>m.enabled,researchWorker:m.worker}));
vi.mock('@/db/client',()=>({requireDb:()=>m.db}));
vi.mock('@/db/research-repository',()=>({ResearchRepository:class{listReview=m.list;recoverStopped=m.recover;}}));
vi.mock('@/db/firmable-history-repository',()=>({FirmableHistoryRepository:class{latestRuns=m.latest;}}));
vi.mock('./firmable-run-recovery',()=>({recoverFirmableRefreshes:m.firmable}));
import {maintainScheduledResearch,recoverMandateResearch} from './research-maintenance';
beforeEach(()=>{
 vi.resetAllMocks();m.enabled=true;m.scopeRows=[];m.members=[];m.tables=[];
 m.list.mockResolvedValue([]);m.latest.mockResolvedValue([]);m.schedule.mockResolvedValue(false);
 m.execute.mockImplementation(async()=>({rows:m.scopeRows}));
 m.db={execute:m.execute,select:()=>({from:(table:Parameters<typeof getTableName>[0])=>{m.tables.push(getTableName(table));return{where:async()=>m.members};}})};
 vi.spyOn(console,'info').mockImplementation(()=>{});
});
it('performs no database/provider work when research is disabled',async()=>{
 m.enabled=false;expect(await maintainScheduledResearch()).toBe(0);expect(await recoverMandateResearch('org','mandate')).toBe(false);
 expect(m.execute).not.toHaveBeenCalled();expect(m.background).not.toHaveBeenCalled();expect(m.recoverBackground).not.toHaveBeenCalled();expect(m.list).not.toHaveBeenCalled();
});
it('uses current mandate membership for reused company refreshes instead of original canonical ownership',async()=>{
 m.members=[{id:'shared-company'}];m.latest.mockResolvedValue([{id:'original-run',status:'running'}]);
 await recoverMandateResearch('current-org','current-mandate',12345);
 expect(m.tables).toEqual(['mandate_targets']);expect(m.latest).toHaveBeenCalledExactlyOnceWith('current-org',['shared-company']);
 expect(m.firmable).toHaveBeenCalledExactlyOnceWith(expect.anything(),[{id:'original-run',status:'running'}],'current-mandate',12345);
});
it('recovers persisted ordinary root/People work without any browser read and retains one original stopped receipt',async()=>{
 const now=Date.now();m.scopeRows=[{organizationId:'org',mandateId:'mandate'}];
 const root={id:'root',status:'complete',revision:3,pages:2,updatedAt:new Date(now),config:{mode:'automatic',includeCompanyPeople:true,companyPeopleProgress:{settled:false}}};
 const child={id:'child',status:'discovering',revision:9,pages:1,updatedAt:new Date(now-120000),config:{mode:'automatic',researchRunId:'root'}};
 m.list.mockResolvedValue([root,child]);m.worker.mockResolvedValue({status:'complete'});
 expect(await maintainScheduledResearch(now)).toBe(1);expect(m.recoverBackground).toHaveBeenCalledOnce();
 expect(m.people).toHaveBeenCalledExactlyOnceWith(root);expect(m.recover).toHaveBeenCalledExactlyOnceWith('child',9,1);
 expect(m.schedule).not.toHaveBeenCalled();expect(m.list).toHaveBeenCalledWith('mandate');
});
it('limits the scope scan and includes orphaned manual refreshes through tenant-qualified current membership',async()=>{
 await maintainScheduledResearch(987654321);
 const query=new PgDialect().sqlToQuery(m.execute.mock.calls[0][0]);
 expect(query.sql).toContain('LIMIT 50');expect(query.sql).toContain('"firmable_sync_runs" INNER JOIN "mandate_targets"');
 expect(query.sql).toContain('"mandate_targets"."organization_id" = "firmable_sync_runs"."organization_id"');
 expect(query.sql).toContain('GROUP BY organization_id, mandate_id');expect(query.params).toContain(987654321);
});
it('isolates one failing mandate without starving another, and never logs the private failure',async()=>{
 m.scopeRows=[{organizationId:'org',mandateId:'first'},{organizationId:'org',mandateId:'second'}];
 m.list.mockRejectedValueOnce(Error('PRIVATE response credential')).mockResolvedValueOnce([]);
 expect(await maintainScheduledResearch(1000)).toBe(1);expect(m.list.mock.calls.map(call=>call[0])).toEqual(['first','second']);
 expect(m.firmable).toHaveBeenCalledOnce();const logged=JSON.stringify(vi.mocked(console.info).mock.calls);
 expect(logged).toContain('mandate_recovery_deferred');expect(logged).not.toContain('PRIVATE');
});
it('leaves later scopes untouched when the existing pass budget expires, without failing their jobs',async()=>{
 let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 m.scopeRows=[{organizationId:'org',mandateId:'first'},{organizationId:'org',mandateId:'second'}];
 m.list.mockImplementationOnce(async()=>{elapsed=10001;return[];});
 expect(await maintainScheduledResearch(1000)).toBe(0);expect(m.list.mock.calls.map(call=>call[0])).toEqual(['first']);
 expect(m.recover).not.toHaveBeenCalled();expect(m.worker).not.toHaveBeenCalled();expect(m.firmable).not.toHaveBeenCalled();
 vi.mocked(performance.now).mockRestore();
});
it('does not start another scope after public-field maintenance consumed the pass budget',async()=>{
 let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 m.recoverBackground.mockImplementationOnce(async()=>{elapsed=10001;});
 expect(await maintainScheduledResearch(1000)).toBe(0);expect(m.execute).not.toHaveBeenCalled();expect(m.list).not.toHaveBeenCalled();
 vi.mocked(performance.now).mockRestore();
});
it.runIf(process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true')('rotates real PostgreSQL scope selection after an unavailable scope consumes the prior minute’s budget',async()=>{
 const {Client}=await import('pg');
 const client=new Client({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',options:'-c statement_timeout=3000 -c lock_timeout=1000'});
 let elapsed=0;vi.spyOn(performance,'now').mockImplementation(()=>elapsed);
 try{
  await client.connect();await client.query('BEGIN READ ONLY');
  expect((await client.query("SELECT current_database() name,shobj_description(oid,'pg_database') marker,(SELECT system_identifier::text FROM pg_control_system()) system FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only',system:'7697400069962248225'});
  // Read-only CTEs shadow the real tables: two persistent unavailable scopes,
  // no fixture inserts, provider dispatch, lifecycle writes or browser request.
  const fixtures=`research_jobs AS (SELECT * FROM (VALUES
   ('00000000-0000-4000-8000-000000000001'::uuid,'org','mandate-a',to_timestamp(1),'discovering','{}'::jsonb),
   ('00000000-0000-4000-8000-000000000002'::uuid,'org','mandate-b',to_timestamp(2),'discovering','{}'::jsonb)
  ) j(id,organization_id,mandate_id,updated_at,status,config)),
  firmable_sync_runs AS (SELECT NULL::text organization_id,NULL::uuid target_id,NULL::timestamptz updated_at,NULL::text status WHERE false),
  mandate_targets AS (SELECT NULL::text organization_id,NULL::uuid target_id,NULL::text mandate_id WHERE false)`;
  m.execute.mockImplementation(async sql=>{
   const query=new PgDialect().sqlToQuery(sql);
   const text=/^\s*WITH\b/i.test(query.sql)?query.sql.replace(/^\s*WITH\b/i,`WITH ${fixtures},`):`WITH ${fixtures} ${query.sql}`;
   return client.query(text,query.params);
  });
  m.list.mockImplementation(async()=>{elapsed=10001;return[];});
  expect(await maintainScheduledResearch(120000)).toBe(0);
  elapsed=0;expect(await maintainScheduledResearch(180000)).toBe(0);
  expect(m.list.mock.calls.map(call=>call[0])).toEqual(['mandate-a','mandate-b']);
  expect(m.worker).not.toHaveBeenCalled();expect(m.recover).not.toHaveBeenCalled();expect(m.firmable).not.toHaveBeenCalled();
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();vi.mocked(performance.now).mockRestore();}
});
