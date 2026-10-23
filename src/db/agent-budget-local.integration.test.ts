import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentBudgetStore} from './agent-budget-store';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentBudgetStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('native shared budgets (migration0006 required)',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentBudgetStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_runs','agent_events','agent_operations','agent_messages','agent_threads','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
 });

 const window=()=>{const start=new Date();start.setUTCHours(0,0,0,0);return {windowStart:start.toISOString(),windowEnd:new Date(start.getTime()+86400000).toISOString()};};
 async function approvedOperation(){
  const op=await store.proposeOperation(thread,randomUUID(),'research.start',{contextRevision:'budget-test'});
  const item={operationId:op.id,revision:op.revision,digest:op.input_digest,contextRevision:'budget-test'};
  const batch=await store.createReviewBatch(thread,randomUUID(),[item]);await store.decideReviewBatch(thread,batch.id,1,[item],'approved');return op.id as string;
 }
 it('admits one competing manual/agent reservation across a shared account',async()=>{
  const account=await store.configureBudget({scopeKey:randomUUID(),unit:'usd_micro',...window(),cap:'100',expectedRevision:0});
  const operations=[await approvedOperation(),await approvedOperation()];
  const results=await Promise.allSettled(operations.map(id=>store.reserveBudget(id,[{accountId:account.id,amount:'70'}])));
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await store.listBudgetAccounts()).find(a=>a.id===account.id).reserved).toBe('70');
 });
 it('replays reservations and settlements once while retaining uncertain cost',async()=>{
  const account=await store.configureBudget({scopeKey:randomUUID(),unit:'usd_micro',...window(),cap:'100',expectedRevision:0}),operation=await approvedOperation();
  const requests=[{accountId:account.id,amount:'90'}],first=await store.reserveBudget(operation,requests);
  expect(await store.reserveBudget(operation,requests)).toEqual(first);
  await store.settleBudget(operation,[{accountId:account.id,actual:null}]);expect((await store.listBudgetAccounts()).find(a=>a.id===account.id).reserved).toBe('90');
  await store.settleBudget(operation,[{accountId:account.id,actual:'25'}]);await store.settleBudget(operation,[{accountId:account.id,actual:'25'}]);
  expect((await store.listBudgetAccounts()).find(a=>a.id===account.id)).toMatchObject({reserved:'0',spent:'25'});
  await expect(store.settleBudget(operation,[{accountId:account.id,actual:'10'}])).rejects.toThrow();
 });
 it('rolls a multi-account reservation back when any cap is exhausted',async()=>{
  const a=await store.configureBudget({scopeKey:randomUUID(),unit:'calls',...window(),cap:'2',expectedRevision:0});
  const b=await store.configureBudget({scopeKey:randomUUID(),unit:'calls',...window(),cap:'0',expectedRevision:0});
  await expect(store.reserveBudget(await approvedOperation(),[{accountId:a.id,amount:'1'},{accountId:b.id,amount:'1'}])).rejects.toThrow();
  expect((await store.listBudgetAccounts()).find(x=>x.id===a.id).reserved).toBe('0');
 });
 it('does not let a stale administrator overwrite a newer limit',async()=>{
  const input={scopeKey:randomUUID(),unit:'calls',...window(),cap:'2',expectedRevision:0};const account=await store.configureBudget(input);
  await store.configureBudget({...input,cap:'3',expectedRevision:account.revision});
  await expect(store.configureBudget({...input,cap:'100',expectedRevision:account.revision})).rejects.toThrow('changed');
 });
});
