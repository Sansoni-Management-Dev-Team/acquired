import {beforeAll,beforeEach,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentStore} from './agent-store';
import {AgentExecutionStore,type AgentExecutionFence} from './agent-execution-store';
class BoundedStore extends AgentExecutionStore{
 step(threadId:string,key:string,authority:AgentExecutionFence){return this.command(threadId,key,'test.bounded_step',{},async(_c,_t,id)=>({id,revision:1,status:'complete'}),authority);}
}
const enabled=process.env.RUN_AGENT_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('persisted native run limits',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_runs','agent_events','agent_operations','agent_messages','agent_threads','mandates','member'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
 });

 beforeEach(async()=>{await pool.query("UPDATE agent_runs SET state='complete' WHERE organization_id=$1 AND state='running'",[org]);await pool.query("UPDATE agent_events SET state='done' WHERE organization_id=$1",[org]);});
 it('bounds logical tools across fresh stores and replays without consuming a second step',async()=>{
  const worker=randomUUID();await store.enqueueEvent(thread,randomUUID(),'test.bounded',{});const event=(await store.claimEvent(worker,60000))!,run=await store.beginEventRun(event);if(run.kind!=='started')throw new Error('Run unavailable');
  const authority={runId:run.runId,eventId:event.id,leaseOwner:worker,fence:event.fence},first=new BoundedStore(pool,actor),second=new BoundedStore(pool,actor),key=randomUUID();
  const result=await first.step(thread,key,authority);expect(await second.step(thread,key,authority)).toEqual(result);
  for(let i=1;i<31;i++)await (i%2?first:second).step(thread,randomUUID(),authority);
  const competing=await Promise.allSettled([first.step(thread,randomUUID(),authority),second.step(thread,randomUUID(),authority)]);
  expect(competing.filter(item=>item.status==='fulfilled')).toHaveLength(1);
  expect(competing.filter(item=>item.status==='rejected').map(item=>String(item.reason))).toEqual([expect.stringMatching(/step limit/i)]);
  expect(await second.step(thread,key,authority)).toEqual(result);
  expect((await pool.query('SELECT usage FROM agent_runs WHERE id=$1',[run.runId])).rows[0].usage.nativeSteps).toHaveLength(32);
  await store.finishEventRun(run.runId,event,{kind:'complete'});
 });
 it('refuses a new tool beyond the persisted run duration even if leases are extended',async()=>{
  const worker=randomUUID();await store.enqueueEvent(thread,randomUUID(),'test.bounded',{});const event=(await store.claimEvent(worker,60000))!,run=await store.beginEventRun(event);if(run.kind!=='started')throw new Error('Run unavailable');
  await pool.query("UPDATE agent_runs SET created_at=clock_timestamp()-interval '46 seconds' WHERE id=$1",[run.runId]);
  await expect(new BoundedStore(pool,actor).step(thread,randomUUID(),{runId:run.runId,eventId:event.id,leaseOwner:worker,fence:event.fence})).rejects.toThrow(/duration/i);
  await store.finishEventRun(run.runId,event,{kind:'complete'});
 });
});
