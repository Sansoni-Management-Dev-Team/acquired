import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentOutreachStore} from './agent-outreach-store';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentOutreachStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('native email proposals and approved local sink',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentOutreachStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','contacts','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  await pool.end();
 });

 async function start(){const state=await store.executionState(thread);return store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:state.responsibility?.revision??0,mandateRevision:state.mandateRevision});}
 async function contact(email='owner@example.invalid'){
  const id=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO contacts(id,organization_id,mandate_id,display_name,personal_data,provenance,fictionalised) VALUES($1,$2,$3,'Synthetic owner',$4,'{}',false)",[id,org,mandate,JSON.stringify({email})]);await c.query('COMMIT');}finally{c.release();}return id;
 }

 async function prepared(){
  await start();const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'});
  await store.ingestHistory(thread,opened.id,{source:'local_fixture',observedAt:new Date().toISOString(),complete:true,messages:[]});
  return store.conversation(thread,opened.id);
 }
 async function propose(row:Awaited<ReturnType<typeof prepared>>,key=randomUUID()){
  return store.proposeNativeEmail(thread,key,{conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,draft:{kind:'initial_email',intent:'initial',subject:'A confidential acquisition enquiry',body:'Would you be open to an introductory conversation about your business?',rationale:'Explore an acquisition discussion aligned with the reviewed mandate.',sourceIds:['mandate:'+mandate]}});
 }
 async function approve(op:Awaited<ReturnType<typeof propose>>){const batches=await store.listReviewBatches(thread),batch=batches.find(b=>b.id===op.reviewBatchId);await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');}
 async function budgets(){
  const start=new Date();start.setUTCHours(0,0,0,0);
  for(const scopeKey of ['organization:sends','user:'+user+':sends','mandate:'+mandate+':sends'])await store.configureBudget({scopeKey,unit:'sends',windowStart:start.toISOString(),windowEnd:new Date(start.getTime()+86400000).toISOString(),cap:'10',expectedRevision:0});
 }
 it('persists a reviewed native proposal and replacement-safe context without exposing transport authority',async()=>{
  const row=await prepared(),key=randomUUID(),op=await propose(row,key);
  expect(await propose(row,key)).toEqual(op);expect(op.status).toBe('proposed');
  const batch=(await store.listReviewBatches(thread)).find(b=>b.id===op.reviewBatchId);expect(batch.state).toBe('pending');expect(batch.operations).toHaveLength(1);
  expect(batch.operations[0].input.recipientKey).toBe('email:'+row.recipient_email);
  await expect(store.deliverApprovedLocalEmail(thread,op.id)).rejects.toThrow();
 });
 it('simulates one approved email and charges all three send limits once across replay',async()=>{
  await budgets();const row=await prepared(),op=await propose(row);await approve(op);
  const first=await store.deliverApprovedLocalEmail(thread,op.id);expect(first.status).toBe('simulated');
  expect(await store.deliverApprovedLocalEmail(thread,op.id)).toEqual(first);
  expect((await store.listBudgetAccounts()).filter(a=>a.unit==='sends').every(a=>a.spent==='1'&&a.reserved==='0')).toBe(true);
  expect((await store.conversation(thread,row.id)).history).toEqual([expect.objectContaining({direction:'outbound',text:expect.stringContaining('introductory')})]);
  expect((await pool.query('SELECT count(*)::int AS count FROM communication_dispatch_intents WHERE organization_id=$1',[org])).rows[0].count).toBe(0);
 });
 it('rejects an approved stale draft after a reply and creates no simulated send or extra charge',async()=>{
  const row=await prepared(),op=await propose(row);await approve(op);
  const instant=new Date().toISOString();await store.ingestHistory(thread,row.id,{source:'local_fixture',observedAt:instant,complete:true,messages:[{id:'new-question',direction:'inbound',text:'Who is buying?',at:instant}]});
  await expect(store.deliverApprovedLocalEmail(thread,op.id)).rejects.toThrow(/changed/);
  expect((await pool.query('SELECT count(*)::int AS count FROM agent_sink_messages WHERE operation_id=$1',[op.id])).rows[0].count).toBe(0);
  expect((await store.listBudgetAccounts()).filter(a=>a.unit==='sends').every(a=>a.spent==='1'&&a.reserved==='0')).toBe(true);
 });
 it('cannot simulate a saved proposal after supervision is paused',async()=>{
  const row=await prepared(),op=await propose(row);await approve(op);
  const state=await store.executionState(thread);await store.controlResponsibility(thread,randomUUID(),{action:'pause',expectedRevision:state.responsibility.revision,mandateRevision:state.mandateRevision});
  await expect(store.deliverApprovedLocalEmail(thread,op.id)).rejects.toThrow();
 });
 it('loads only approved public buyer fields for the model and rejects cross-owner context reads',async()=>{
  await start();const row=await prepared(),c=await pool.connect();
  try{await c.query('BEGIN');await c.query('SELECT communications_lock_send_gate($1)',[org]);await c.query('UPDATE organization SET metadata=$2 WHERE id=$1',[org,JSON.stringify({buyerProfile:{senderName:'Test Buyer',about:'An Australian private investment group.',signature:'Test Buyer',publicProfileApproved:true,capitalAvailable:'PRIVATE CAPITAL',fundingForm:'PRIVATE FUNDING'}})]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const context=await store.nativeDecisionContext(thread,row.id);
  expect(context.sources.find(s=>s.id==='buyer-profile')?.text).toContain('Australian private investment group');
  expect(JSON.stringify(context)).not.toContain('PRIVATE');
  await expect(new AgentOutreachStore(pool,{organizationId:org,userId:'someone-else'}).nativeDecisionContext(thread,row.id)).rejects.toThrow();
 });

 it('fences expired background authority and persists a model-decided stop without an outbound effect',async()=>{
  const row=await prepared();
  await expect(store.proposeNativeEmail(thread,randomUUID(),{conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,draft:{kind:'initial_email',intent:'initial',subject:'Hello',body:'A synthetic enquiry',rationale:'Synthetic test',sourceIds:[]}},{runId:randomUUID(),eventId:randomUUID(),leaseOwner:randomUUID(),fence:'1'})).rejects.toThrow(/authority/);
  const stopped=await store.stopNativeConversation(thread,randomUUID(),{conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,reason:'The lead is not interested'});expect(stopped.status).toBe('stopped');
  expect(await store.conversation(thread,row.id)).toMatchObject({phase:'complete',engagement:'stopped',next_wakeup_at:null});
 });

 it('removes stale review actions when a new lead reply changes an unapproved draft',async()=>{
  const row=await prepared(),op=await propose(row),instant=new Date().toISOString();
  await store.ingestHistory(thread,row.id,{source:'local_fixture',observedAt:instant,complete:true,messages:[{id:'changed-before-review',direction:'inbound',text:'Please tell me who is buying',at:instant}]});
  const batch=(await store.listReviewBatches(thread)).find(b=>b.id===op.reviewBatchId);expect(batch.state).toBe('invalidated');
 });

 it('consumes a scoped delegated grant once and refuses another recipient after its cap',async()=>{
  const first=await prepared(),second=await prepared(),a=await propose(first),b=await propose(second),grantId=randomUUID();
  await store.createAuthorityGrant(thread,{id:grantId,actions:['initial_email'],recipientKeys:[first,second].map(row=>'email:'+row.recipient_email),bindingDigest:first.binding_digest,maxSends:1,expiresAt:new Date(Date.now()+3600000).toISOString()});
  const result=await store.deliverDelegatedLocalEmail(thread,a.id,{id:grantId,revision:1});expect(result.status).toBe('simulated');
  expect(await store.deliverDelegatedLocalEmail(thread,a.id,{id:grantId,revision:1})).toEqual(result);
  await expect(store.deliverDelegatedLocalEmail(thread,b.id,{id:grantId,revision:1})).rejects.toThrow(/grant|delegat|authority|cap/i);
  expect((await store.listAuthorityGrants(thread)).find(row=>row.id===grantId)?.used_sends).toBe(1);
  expect((await pool.query('SELECT count(*)::int AS count FROM agent_sink_messages WHERE operation_id=ANY($1::uuid[])',[[a.id,b.id]])).rows[0].count).toBe(1);
 });
 it('refuses revoked delegation without charging it or creating a receipt',async()=>{
  const row=await prepared(),op=await propose(row),id=randomUUID();
  await store.createAuthorityGrant(thread,{id,actions:['initial_email'],recipientKeys:['email:'+row.recipient_email],bindingDigest:row.binding_digest,maxSends:1,expiresAt:new Date(Date.now()+3600000).toISOString()});
  await store.revokeAuthorityGrant(thread,id,1);
  await expect(store.deliverDelegatedLocalEmail(thread,op.id,{id,revision:1})).rejects.toThrow();
  expect((await store.listAuthorityGrants(thread)).find(grant=>grant.id===id)?.used_sends).toBe(0);
  expect((await pool.query('SELECT count(*)::int AS count FROM agent_sink_messages WHERE operation_id=$1',[op.id])).rows[0].count).toBe(0);
 });
 it('denies a follow-up immediately after an outbound even with human approval',async()=>{
  const row=await prepared(),now=Date.now();await store.ingestHistory(thread,row.id,{source:'local_fixture',observedAt:new Date().toISOString(),complete:true,messages:[{id:'recent-outbound',direction:'outbound',text:'Synthetic earlier email',at:new Date(now-60000).toISOString()}]});
  const current=await store.conversation(thread,row.id);
  const op=await store.proposeNativeEmail(thread,randomUUID(),{conversationId:row.id,revision:current.revision,contextRevision:current.context_revision,draft:{kind:'follow_up_email',intent:'no_reply',subject:'Following up',body:'A synthetic follow-up',rationale:'Cadence guard fixture',sourceIds:[]}});
  await approve(op);await expect(store.deliverApprovedLocalEmail(thread,op.id)).rejects.toThrow();
 });
 it('derives bounded delegation from owned conversations and replays creation and revocation once',async()=>{
  const row=await prepared(),key=randomUUID(),state=await store.executionState(thread);
  const input={mandateRevision:state.mandateRevision,conversationIds:[row.id],actions:['reply_email'],maxSends:2,expiresAt:new Date(Date.now()+3600000).toISOString()};
  const grant=await store.createConversationGrant(thread,key,input);
  expect(await store.createConversationGrant(thread,key,input)).toEqual(grant);
  const saved=(await store.listAuthorityGrants(thread)).find(item=>item.id===grant.id);
  expect(saved).toMatchObject({recipient_keys:['email:'+row.recipient_email],binding_digest:row.binding_digest,max_sends:2,used_sends:0,actions:['reply_email']});
  await expect(store.createConversationGrant(thread,randomUUID(),{...input,mandateRevision:'0'})).rejects.toThrow(/mandate/i);
  await expect(store.createConversationGrant(thread,randomUUID(),{...input,conversationIds:[randomUUID()]})).rejects.toThrow();
  await expect(store.createConversationGrant(thread,randomUUID(),{...input,bindingDigest:'f'.repeat(64)})).rejects.toThrow();
  const revokeKey=randomUUID(),revoke={grantId:grant.id,revision:grant.revision};
  const revoked=await store.revokeConversationGrant(thread,revokeKey,revoke);
  expect(await store.revokeConversationGrant(thread,revokeKey,revoke)).toEqual(revoked);
  await expect(store.revokeConversationGrant(thread,randomUUID(),revoke)).rejects.toThrow(/changed/i);
 });
 it('configures only server-derived budget scopes with CAS and atomically replays its notice',async()=>{
  const start=new Date();start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()+2);
  const key=randomUUID(),input={scope:'mandate',unit:'calls',windowStart:start.toISOString(),windowEnd:new Date(start.getTime()+86400000).toISOString(),cap:'7',expectedRevision:0};
  const configured=await store.configureExecutionBudget(thread,key,input);
  expect(await store.configureExecutionBudget(thread,key,input)).toEqual(configured);
  expect((await store.budgetSettings(mandate)).accounts.find(item=>item.id===configured.id)).toMatchObject({scope_key:'mandate:'+mandate+':calls',cap:'7'});
  await expect(store.configureExecutionBudget(thread,randomUUID(),input)).rejects.toThrow(/changed/i);
  await expect(store.configureExecutionBudget(thread,randomUUID(),{...input,scopeKey:'user:someone-else:calls'})).rejects.toThrow();
 });

 it('rejects a member budget escalation without recording configuration or success notice',async()=>{
  const client=await pool.connect();
  async function role(value:string){await client.query('BEGIN');try{await client.query('SELECT communications_lock_send_gate($1)',[org]);await client.query('UPDATE member SET role=$3 WHERE organization_id=$1 AND user_id=$2',[org,user,value]);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}}
  try{
   await role('member');expect((await store.budgetSettings(mandate)).canConfigure).toBe(false);
   const before=(await store.messages(thread)).length,start=new Date();start.setUTCHours(0,0,0,0);start.setUTCDate(start.getUTCDate()+3);
   await expect(store.configureExecutionBudget(thread,randomUUID(),{scope:'organization',unit:'calls',windowStart:start.toISOString(),windowEnd:new Date(start.getTime()+86400000).toISOString(),cap:'999',expectedRevision:0})).rejects.toThrow();
   expect((await store.messages(thread)).length).toBe(before);
   expect((await store.budgetSettings(mandate)).accounts.some(item=>item.window_start.toISOString()===start.toISOString())).toBe(false);
  }finally{await role('owner');client.release();}
 });

});
