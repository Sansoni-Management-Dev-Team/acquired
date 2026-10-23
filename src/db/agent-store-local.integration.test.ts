import {agentOutboxFailurePool} from '@/test/agent-pg-fault';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { AgentStore } from './agent-store';
const enabled=process.env.RUN_AGENT_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:5});
const org=randomUUID(), user=randomUUID(), other=randomUUID(), mandate=randomUUID(), foreignOrg=randomUUID(), foreignMandate=randomUUID();
const actor={organizationId:org,userId:user};const store=new AgentStore(pool,actor);
let thread:string;
describe.runIf(enabled)('agent persistence with real PostgreSQL',()=>{
 beforeAll(async()=>{
  const c=await pool.connect();try{
   const identity=(await c.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
   expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
   await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   for(const id of [user,other])await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[id,id+'@example.invalid']);
   for(const id of [org,foreignOrg])await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[id]);
   for(const id of [user,other])await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,id]);
   for(const [id,organization] of [[mandate,org],[foreignMandate,foreignOrg]])await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic agent test','{}','{}',$3)",[id,organization,user]);
   await c.query('COMMIT');
  }finally{c.release();}
  thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   await c.query('DELETE FROM agent_events WHERE organization_id=$1',[org]);await c.query('DELETE FROM agent_operations WHERE organization_id=$1',[org]);await c.query('DELETE FROM agent_messages WHERE organization_id=$1',[org]);await c.query('DELETE FROM agent_threads WHERE organization_id=$1',[org]);
   await c.query('DELETE FROM mandates WHERE id=ANY($1::uuid[])',[[mandate,foreignMandate]]);await c.query('DELETE FROM member WHERE organization_id=$1',[org]);
   await c.query('DELETE FROM organization WHERE id=ANY($1::text[])',[[org,foreignOrg]]);await c.query('DELETE FROM "user" WHERE id=ANY($1::text[])',[[user,other]]);await c.query('COMMIT');
  }finally{c.release();await pool.end();}
 });
 it('opens the same owner/mandate thread concurrently',async()=>{const rows=await Promise.all([store.openThread(mandate),store.openThread(mandate)]);expect(rows.map(r=>r.id)).toEqual([thread,thread]);});
 it('rejects foreign mandates, different owners and membership revocation',async()=>{
  await expect(store.openThread(foreignMandate)).rejects.toThrow('Mandate not found');
  await expect(new AgentStore(pool,{...actor,userId:other}).messages(thread)).rejects.toThrow('not found');
  await expect(new AgentStore(pool,{...actor,userId:'revoked'}).messages(thread)).rejects.toThrow(/member|Authenticated agent scope required/);
 });
 it('normalises idempotency keys consistently on write and replay',async()=>{
  const a=await store.appendMessage(thread,' padded ','user',{text:'normalised'});
  const b=await store.appendMessage(thread,'padded','user',{text:'normalised'});expect(a.id).toBe(b.id);
 });
 it('stores ordered history across new repository instances and rejects key collisions',async()=>{
  const [a,b]=await Promise.all([store.appendMessage(thread,'same','user',{text:'hello'}),store.appendMessage(thread,'same','user',{text:'hello'})]);expect(a.id).toBe(b.id);
  await expect(store.appendMessage(thread,'same','assistant',{text:'hello'})).rejects.toThrow('different message');
  await store.appendMessage(thread,'answer','assistant',{text:'saved'});
  const messages=await new AgentStore(pool,actor).messages(thread);expect(messages.slice(-2).map(m=>m.role)).toEqual(['user','assistant']);
 });
 it('atomically persists one operation/outbox event and rolls back conflicting content',async()=>{
  const [a,b]=await Promise.all([store.proposeOperation(thread,'proposal','research.start',{query:'maintenance'}),store.proposeOperation(thread,'proposal','research.start',{query:'maintenance'})]);expect(a.id).toBe(b.id);
  await expect(store.proposeOperation(thread,'proposal','email.send',{})).rejects.toThrow('different operation');
  expect((await pool.query('SELECT count(*)::int n FROM agent_events WHERE thread_id=$1',[thread])).rows[0].n).toBe(1);
 });
 it('claims once across competing workers and fences expired ownership after reconnect',async()=>{
  const firstWorker=randomUUID(),secondWorker=randomUUID();
  const claims=await Promise.all([store.claimEvent(firstWorker,30_000),store.claimEvent(secondWorker,30_000)]);const first=claims.find(Boolean)!;expect(claims.filter(Boolean)).toHaveLength(1);
  await pool.query("UPDATE agent_events SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[first.id]);
  expect(await store.completeEvent(first.id,first.lease_owner,first.fence)).toBe(false);
  const recovered=await new AgentStore(pool,actor).claimEvent(randomUUID());expect(recovered?.id).toBe(first.id);expect(BigInt(recovered!.fence)).toBeGreaterThan(BigInt(first.fence));
  expect(await store.completeEvent(first.id,first.lease_owner,first.fence)).toBe(false);
  expect(await store.completeEvent(recovered!.id,recovered!.lease_owner,recovered!.fence)).toBe(true);
  expect(await store.claimEvent(randomUUID())).toBeUndefined();
 });

 it('rolls an operation back if its outbox insertion fails',async()=>{
  const failingStore=new AgentStore(agentOutboxFailurePool(pool),actor);
  {
   await expect(failingStore.proposeOperation(thread,'atomic-failure','research.start',{})).rejects.toThrow('Injected agent outbox failure');
   expect((await pool.query("SELECT count(*)::int n FROM agent_operations WHERE thread_id=$1 AND request_key='atomic-failure'",[thread])).rows[0].n).toBe(0);
  }
 });
 it('rejects the same previously authorised actor after membership is actually revoked',async()=>{
  const c=await pool.connect();let membership;
  try {await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");membership=(await c.query('DELETE FROM member WHERE organization_id=$1 AND user_id=$2 RETURNING *',[org,user])).rows[0];await c.query('COMMIT');}
  finally{c.release();}
  try {await expect(new AgentStore(pool,actor).messages(thread)).rejects.toThrow(/member|Authenticated agent scope required/);}
  finally{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('INSERT INTO member SELECT * FROM jsonb_populate_record(NULL::member,$1::jsonb)',[JSON.stringify(membership)]);await c.query('COMMIT');}finally{c.release();}}
 });
 it('rejects a run linked to another owners trigger event',async()=>{
  const otherStore=new AgentStore(pool,{...actor,userId:other});const otherThread=await otherStore.openThread(mandate);
  await otherStore.proposeOperation(otherThread.id,'other-trigger','research.start',{});
  const event=(await pool.query('SELECT id FROM agent_events WHERE thread_id=$1',[otherThread.id])).rows[0];
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);
   await expect(c.query("INSERT INTO agent_runs(thread_id,organization_id,mandate_id,owner_user_id,trigger_event_id,state) VALUES($1,$2,$3,$4,$5,'queued')",[thread,org,mandate,user,event.id])).rejects.toThrow(/foreign key/);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('does not let the application role erase a thread and cascade its history',async()=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);
   await expect(c.query('DELETE FROM agent_threads WHERE id=$1',[thread])).rejects.toThrow(/permission denied/);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('prevents cross-tenant inserts at the database boundary',async()=>{
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);
   await expect(c.query('INSERT INTO agent_threads(organization_id,mandate_id,owner_user_id) VALUES($1,$2,$3)',[foreignOrg,foreignMandate,user])).rejects.toThrow(/row-level security/);
  }finally{await c.query('ROLLBACK');c.release();}
 });
});
