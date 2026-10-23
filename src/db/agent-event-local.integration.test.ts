import {agentOutboxFailurePool} from '@/test/agent-pg-fault';
import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentStore} from './agent-store';
const enabled=process.env.RUN_AGENT_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('native due-event runs and recovery',()=>{
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

 async function claim(){return (await store.claimEvent(randomUUID(),60000))!;}
 it('deduplicates durable events and keeps future reassessments asleep',async()=>{
  const request=randomUUID(),wakeAt=new Date(Date.now()+3600000).toISOString();
  const event=await store.enqueueEvent(thread,request,'conversation.reassess',{reason:'Next week'},wakeAt);
  expect((await store.enqueueEvent(thread,request,'conversation.reassess',{reason:'Next week'},wakeAt)).id).toBe(event.id);
  await expect(store.enqueueEvent(thread,request,'conversation.reassess',{reason:'Different'},wakeAt)).rejects.toThrow('different');expect(await store.claimEvent(randomUUID())).toBeUndefined();
 });
 it('saves one fenced run and prevents a concurrent chat model turn',async()=>{
  await store.enqueueEvent(thread,randomUUID(),'conversation.reassess',{});const event=await claim(),run=await store.beginEventRun(event);expect(run.kind).toBe('started');if(run.kind!=='started')throw Error();
  expect((await store.beginConversationTurn(thread,randomUUID(),'Chat during background work')).kind).toBe('busy');
  expect(await store.eventRunCurrent(run.runId,event)).toBe(true);expect(await store.finishEventRun(run.runId,event,{kind:'complete'})).toBe(true);expect(await store.eventRunCurrent(run.runId,event)).toBe(false);
 });
 it('recovers expired leases while fencing the old worker and retaining its interrupted run',async()=>{
  await store.enqueueEvent(thread,randomUUID(),'conversation.reassess',{});const old=await claim(),run=await store.beginEventRun(old);if(run.kind!=='started')throw Error();
  await pool.query("UPDATE agent_events SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[old.id]);await pool.query("UPDATE agent_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[run.runId]);
  const event=await claim(),fresh=await store.beginEventRun(event);if(fresh.kind!=='started')throw Error();expect(BigInt(event.fence)).toBeGreaterThan(BigInt(old.fence));
  expect(await store.finishEventRun(run.runId,old,{kind:'complete'})).toBe(false);expect(await store.finishEventRun(fresh.runId,event,{kind:'complete'})).toBe(true);
  expect((await pool.query('SELECT state FROM agent_runs WHERE id=$1',[run.runId])).rows[0].state).toBe('uncertain');
 });
 it('checks the current fence without waiting for an unrelated send gate holder',async()=>{
  await store.enqueueEvent(thread,randomUUID(),'conversation.reassess',{});const event=await claim(),run=await store.beginEventRun(event);if(run.kind!=='started')throw Error();
  const lock=await pool.connect(),readerPool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',statement_timeout:200}),reader=new AgentStore(readerPool,actor);
  try{await lock.query('BEGIN');await lock.query('SELECT public.communications_lock_send_gate($1)',[org]);expect(await reader.eventRunCurrent(run.runId,event)).toBe(true);expect(await reader.eventRunCurrent(run.runId,{...event,fence:String(BigInt(event.fence)+BigInt(1))})).toBe(false);await expect(new AgentStore(readerPool,{...actor,userId:randomUUID()}).eventRunCurrent(run.runId,event)).rejects.toThrow();}
  finally{await lock.query('ROLLBACK');lock.release();await readerPool.end();await store.finishEventRun(run.runId,event,{kind:'complete'});}
 });
 it('preserves a valid short retry when saving waits beyond its due instant',async()=>{
  await store.enqueueEvent(thread,randomUUID(),'conversation.reassess',{});const event=await claim(),run=await store.beginEventRun(event);if(run.kind!=='started')throw Error();
  await expect(store.finishEventRun(run.runId,event,{kind:'defer',wakeAt:new Date(Date.now()-1000).toISOString(),reason:'Expired before receipt'})).rejects.toThrow('outside the allowed horizon');
  const lock=await pool.connect();await lock.query('BEGIN');await lock.query('SELECT id FROM agent_threads WHERE id=$1 FOR UPDATE',[thread]);
  const wakeAt=new Date(Date.now()+100).toISOString(),finished=store.finishEventRun(run.runId,event,{kind:'defer',wakeAt,reason:'Continue saved checkpoint'});
  try{await new Promise(resolve=>setTimeout(resolve,250));await lock.query('COMMIT');expect(await finished).toBe(true);}finally{await lock.query('ROLLBACK');lock.release();}
  const next=await claim();expect(next.id).toBe(event.id);const resumed=await store.beginEventRun(next);if(resumed.kind!=='started')throw Error();expect(await store.finishEventRun(resumed.runId,next,{kind:'complete'})).toBe(true);
 });
 it('commits a human notification atomically and never repeats it on a late completion',async()=>{
  await store.enqueueEvent(thread,randomUUID(),'conversation.reassess',{});const event=await claim(),run=await store.beginEventRun(event);if(run.kind!=='started')throw Error();
  const failingStore=new AgentStore(agentOutboxFailurePool(pool),actor);
  await expect(failingStore.finishEventRun(run.runId,event,{kind:'review',message:'A saved operation needs reconciliation.'})).rejects.toThrow('Injected agent outbox failure');expect(await store.eventRunCurrent(run.runId,event)).toBe(true);
  expect(await store.finishEventRun(run.runId,event,{kind:'review',message:'A saved operation needs reconciliation.'})).toBe(true);expect(await store.finishEventRun(run.runId,event,{kind:'review',message:'Duplicate'})).toBe(false);
  expect((await store.messages(thread)).filter(m=>m.content.triggerEventId===event.id)).toHaveLength(1);
  const notice=await claim(),noticeRun=await store.beginEventRun(notice);if(noticeRun.kind!=='started')throw Error();await store.finishEventRun(noticeRun.runId,notice,{kind:'complete'});
 });
 it('persists a wait for fresh reassessment and records the waiting run',async()=>{
  await store.enqueueEvent(thread,randomUUID(),'conversation.reassess',{});const event=await claim(),run=await store.beginEventRun(event);if(run.kind!=='started')throw Error();
  const wakeAt=new Date(Date.now()+60000).toISOString();expect(await store.finishEventRun(run.runId,event,{kind:'defer',wakeAt,reason:'Review fresh history when due'})).toBe(true);
  expect((await pool.query('SELECT state FROM agent_runs WHERE id=$1',[run.runId])).rows[0].state).toBe('waiting');expect(await store.claimEvent(randomUUID())).toBeUndefined();
 });
});
