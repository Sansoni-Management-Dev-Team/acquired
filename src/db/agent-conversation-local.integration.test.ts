import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentStore} from './agent-store';
const enabled=process.env.RUN_AGENT_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('persistent conversation turns',()=>{
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
 it('persists an answer, resumes history and replays one run without another model turn',async()=>{
  const request=randomUUID();const first=await store.beginConversationTurn(thread,request,'How is research going?');
  expect(first.kind).toBe('started');
  expect((await store.beginConversationTurn(thread,request,'How is research going?')).kind).toBe('busy');
  await store.finishConversationTurn(first.operationId,'Research is queued.');
  const replay=await new AgentStore(pool,actor).beginConversationTurn(thread,request,'How is research going?');
  expect(replay).toMatchObject({kind:'complete',text:'Research is queued.'});
  expect((await store.messages(thread)).filter(m=>m.id===replay.messageId)).toHaveLength(1);
  await expect(store.beginConversationTurn(thread,request,'Different input')).rejects.toThrow('different');
 });
 it('recognises an expired replay as interrupted instead of reporting busy forever',async()=>{
  const request=randomUUID();const turn=await store.beginConversationTurn(thread,request,'An interrupted question');
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT communications_lock_send_gate($1)',[org]);
   await c.query("UPDATE agent_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[turn.operationId]);
   await c.query("UPDATE agent_runs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[turn.operationId]);await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  expect((await store.beginConversationTurn(thread,request,'An interrupted question')).kind).toBe('failed');
  await expect(store.finishConversationTurn(turn.operationId,'Late answer')).rejects.toThrow('active');
 });
 it('cancels by canonical thread and run key, fences late output and reports completed turns honestly',async()=>{
  const request=randomUUID(),turn=await store.beginConversationTurn(thread,request,'Please stop');
  expect(await store.cancelConversationTurn(thread,request)).toBe('cancelled');
  expect(await store.cancelConversationTurn(thread,request)).toBe('cancelled');
  await expect(store.finishConversationTurn(turn.operationId,'Late answer')).rejects.toThrow('active');
  expect(await store.cancelConversationTurn(thread,'unknown')).toBe('missing');
  const done=randomUUID(),active=await store.beginConversationTurn(thread,done,'Already complete');
  await store.finishConversationTurn(active.operationId,'Saved result');
  expect(await store.cancelConversationTurn(thread,done)).toBe('complete');
 });
 it('serialises cancellation against completion without erasing a committed result',async()=>{
  for(let n=0;n<5;n++){
   const request=randomUUID(),turn=await store.beginConversationTurn(thread,request,'Race finish and stop');
   const [finish,stop]=await Promise.allSettled([store.finishConversationTurn(turn.operationId,'Committed answer'),store.cancelConversationTurn(thread,request)]);
   expect(stop.status).toBe('fulfilled');
   if(finish.status==='fulfilled')expect(stop).toMatchObject({value:'complete'});
   else expect(stop).toMatchObject({value:'cancelled'});
   const rows=(await pool.query('SELECT state FROM agent_operations WHERE id=$1',[turn.operationId])).rows;
   expect(rows[0].state).toBe(finish.status==='fulfilled'?'complete':'rejected');
  }
 });
 it('failed or cancelled turns cannot later commit a model answer',async()=>{
  const turn=await store.beginConversationTurn(thread,randomUUID(),'Cancel this question');
  await store.failConversationTurn(turn.operationId,'cancelled');
  await expect(store.finishConversationTurn(turn.operationId,'Too late')).rejects.toThrow('active');
 });
});
