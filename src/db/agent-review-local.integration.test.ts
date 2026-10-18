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
describe.runIf(enabled)('durable reviews and authority grants',()=>{
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
  for(const table of ['agent_review_batches','agent_authority_grants','agent_runs','agent_events','agent_operations','agent_messages','agent_threads','mandates','member'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
 });

 async function proposal(text='Original',name='email.reply'){
  const op=await store.proposeOperation(thread,randomUUID(),name,{contextRevision:'history-1',body:text});
  return {operationId:op.id,revision:op.revision,digest:op.input_digest,contextRevision:'history-1'};
 }
 it('creates one exact batch across retries and persists one decision, event and audit message',async()=>{
  const item=await proposal(),request=randomUUID();
  const batch=await store.createReviewBatch(thread,request,[item]);
  expect((await store.createReviewBatch(thread,request,[item])).id).toBe(batch.id);
  const decisions=await Promise.all([store.decideReviewBatch(thread,batch.id,1,[item],'approved'),store.decideReviewBatch(thread,batch.id,1,[item],'approved')]);
  expect(decisions.map(d=>d.state)).toEqual(['approved','approved']);
  expect((await pool.query("SELECT state FROM agent_operations WHERE id=$1",[item.operationId])).rows[0].state).toBe('approved');
  expect((await pool.query("SELECT count(*)::int n FROM agent_events WHERE event_key=$1",['review:'+batch.id+':approved'])).rows[0].n).toBe(1);
  expect((await store.messages(thread)).filter(m=>m.content.reviewBatchId===batch.id)).toHaveLength(1);
  await expect(store.decideReviewBatch(thread,batch.id,1,[item],'rejected')).rejects.toThrow('already');
 });
 it('rejects omitted, added, duplicated or edited displayed items without partial approvals',async()=>{
  const a=await proposal(),b=await proposal(),batch=await store.createReviewBatch(thread,randomUUID(),[a,b]);
  for(const items of [[a],[a,b,a],[{...a,revision:2},b]])await expect(store.decideReviewBatch(thread,batch.id,1,items,'approved')).rejects.toThrow();
  expect((await pool.query('SELECT state FROM agent_operations WHERE id=ANY($1::uuid[])',[[a.operationId,b.operationId]])).rows.map(r=>r.state)).toEqual(['proposed','proposed']);
 });
 it('invalidates old reviews after an edit and preserves the newer message',async()=>{
  const item=await proposal(),batch=await store.createReviewBatch(thread,randomUUID(),[item]);
  const edited=await store.editProposedOperation(thread,item.operationId,item.revision,{contextRevision:'history-2',body:'Human edit'});
  expect(edited.revision).toBe(2);
  await expect(store.decideReviewBatch(thread,batch.id,1,[item],'approved')).rejects.toThrow('changed');
  await expect(store.editProposedOperation(thread,item.operationId,item.revision,{contextRevision:'history-1',body:'Stale'})).rejects.toThrow('changed');
  expect((await pool.query('SELECT input FROM agent_operations WHERE id=$1',[item.operationId])).rows[0].input.body).toBe('Human edit');
 });
 it('rejects unsupported operation kinds and mixed-thread manifests',async()=>{
  const turn=await proposal('Question','conversation.answer');
  await expect(store.createReviewBatch(thread,randomUUID(),[turn])).rejects.toThrow('reviewable');
  await expect(store.createReviewBatch(thread,randomUUID(),[{...turn,operationId:randomUUID()}])).rejects.toThrow();
 });
 it('rolls back all approved operations when an atomic notification insert fails',async()=>{
  const item=await proposal(),batch=await store.createReviewBatch(thread,randomUUID(),[item]);
  const failingStore=new AgentStore(agentOutboxFailurePool(pool),actor);
  {
   await expect(failingStore.decideReviewBatch(thread,batch.id,1,[item],'approved')).rejects.toThrow('Injected agent outbox failure');
   expect((await pool.query('SELECT state FROM agent_operations WHERE id=$1',[item.operationId])).rows[0].state).toBe('proposed');
   expect((await pool.query('SELECT state FROM agent_review_batches WHERE id=$1',[batch.id])).rows[0].state).toBe('pending');
  }
 });
 it('atomically edits an email review, invalidates the old batch and replays the same edit',async()=>{
  const item=await proposal(),batch=await store.createReviewBatch(thread,randomUUID(),[item]);
  const edited=await store.editEmailReview(thread,batch.id,item.operationId,item.revision,'Edited email');
  expect(edited.manifest[0].revision).toBe(2);
  expect((await store.editEmailReview(thread,batch.id,item.operationId,item.revision,'Edited email')).id).toBe(edited.id);
  await expect(store.editEmailReview(thread,batch.id,item.operationId,item.revision,'Other edit')).rejects.toThrow();
  await expect(store.decideReviewBatch(thread,batch.id,1,[item],'approved')).rejects.toThrow();
  expect((await store.decideReviewBatch(thread,edited.id,1,edited.manifest,'approved')).state).toBe('approved');
 });
 const grantInput=()=>({id:randomUUID(),actions:['reply_email'],recipientKeys:['email:owner@example.invalid'],bindingDigest:'b'.repeat(64),maxSends:2,expiresAt:new Date(Date.now()+3600000).toISOString()});
 it('persists an explicit bounded grant, replays creation and revokes without reactivation',async()=>{
  const input=grantInput(),grant=await store.createAuthorityGrant(thread,input);
  expect(grant.approved_by).toBe(user);expect(grant.used_sends).toBe(0);
  expect((await store.createAuthorityGrant(thread,input)).id).toBe(grant.id);
  await expect(store.createAuthorityGrant(thread,{...input,maxSends:3})).rejects.toThrow('different');
  const revoked=await store.revokeAuthorityGrant(thread,grant.id,1);expect(revoked.revision).toBe(2);expect(revoked.revoked_at).toBeTruthy();
  expect((await store.createAuthorityGrant(thread,input)).revoked_at).toBeTruthy();
  expect((await store.revokeAuthorityGrant(thread,grant.id,1)).revision).toBe(2);
 });
 it('denies forged approver fields, wildcard recipients, excessive duration and unsupported authority',async()=>{
  for(const change of [{approvedBy:'forged'},{recipientKeys:['*']},{actions:['booking_link']},{expiresAt:new Date(Date.now()+8*86400000).toISOString()}])await expect(store.createAuthorityGrant(thread,{...grantInput(),...change})).rejects.toThrow();
 });
 it('denies review and grant access to another actor even inside the same organisation',async()=>{
  const other=randomUUID();const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[other,other+'@example.invalid']);await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'member')",[randomUUID(),org,other]);await c.query('COMMIT');}finally{c.release();}
  try{
   const foreign=new AgentStore(pool,{organizationId:org,userId:other});
   await expect(foreign.listReviewBatches(thread)).rejects.toThrow('not found');
   await expect(foreign.createAuthorityGrant(thread,grantInput())).rejects.toThrow('not found');
  }finally{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('DELETE FROM member WHERE user_id=$1',[other]);await c.query('DELETE FROM "user" WHERE id=$1',[other]);await c.query('COMMIT');}finally{c.release();}}
 });
});
