import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {AgentOwnershipStore} from './agent-ownership-store';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentOwnershipStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('native ownership and unresolved legacy sends',()=>{
 beforeAll(async()=>{
  const identity=(await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];
  expect(identity).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[user,user+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,user]);
  await c.query("INSERT INTO mandates(id,organization_id,natural_language,filters,provenance,created_by) VALUES($1,$2,'Synthetic conversation test','{}','{}',$3)",[mandate,org,user]);
  await c.query('COMMIT');}finally{c.release();}
  store=new AgentOwnershipStore(pool,actor);thread=(await store.openThread(mandate)).id;
 });
 afterAll(async()=>{
  // Delete only this suite's synthetic tenant; never use a pilot user's thread.
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
  for(const table of ['agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','campaign_channel_bindings','communication_bindings','campaign_send_attempts','campaign_enrolments','campaign_sequence_versions','campaign_sequences','contacts','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
  await c.query('DELETE FROM organization WHERE id=$1',[org]);
  await c.query('DELETE FROM "user" WHERE id=$1',[user]);
  await c.query('COMMIT');}finally{c.release();}
  expect((await pool.query('SELECT (SELECT count(*)::int FROM organization WHERE id=$1) AS organizations,(SELECT count(*)::int FROM agent_operations WHERE organization_id=$1) AS operations,(SELECT count(*)::int FROM agent_budget_reservations WHERE organization_id=$1) AS reservations,(SELECT count(*)::int FROM communication_bindings WHERE organization_id=$1) AS bindings',[org])).rows[0]).toEqual({organizations:0,operations:0,reservations:0,bindings:0});
  await pool.end();
 });

 async function start(){const state=await store.executionState(thread);return store.controlResponsibility(thread,randomUUID(),{action:'start',expectedRevision:state.responsibility?.revision??0,mandateRevision:state.mandateRevision});}
 async function contact(email='owner@example.invalid'){
  const id=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO contacts(id,organization_id,mandate_id,display_name,personal_data,provenance,fictionalised) VALUES($1,$2,$3,'Synthetic owner',$4,'{}',false)",[id,org,mandate,JSON.stringify({email})]);await c.query('COMMIT');}finally{c.release();}return id;
 }

 it('does not take ownership while a stopped sequence still has a send with an unknown outcome',async()=>{
  await start();const contactId=await contact(),sequence=randomUUID(),version=randomUUID(),enrolment=randomUUID(),attempt=randomUUID(),c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   await c.query("INSERT INTO campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft) VALUES($1,$2,$3,$4,'Fixture prior sequence','{}')",[sequence,org,user,mandate]);
   await c.query("INSERT INTO campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id,version,definition) VALUES($1,$2,$3,$4,1,'{}')",[version,org,user,sequence]);
   await c.query("INSERT INTO campaign_enrolments(id,organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,recipient_email,state,runtime) VALUES($1,$2,$3,$4,$5,$6,$7,'owner@example.invalid','stopped','n8n')",[enrolment,org,user,sequence,version,mandate,contactId]);
   await c.query("INSERT INTO campaign_send_attempts(id,organization_id,owner_user_id,enrolment_id,step_index,state,rfc_message_id) VALUES($1,$2,$3,$4,0,'unknown',$5)",[attempt,org,user,enrolment,attempt+'@example.invalid']);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  await expect(store.openConversation(thread,randomUUID(),{contactId,deliveryMode:'local_sink'})).rejects.toThrow(/reconcil|unresolved/);
  expect((await store.executionState(thread)).conversations).toHaveLength(0);
 });
 it('fences agent work before an explicit human handover and commits one new owner with durable audit',async()=>{
  const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'});
  const current=await store.conversation(thread,opened.id),request=randomUUID();
  const visible=(await store.executionState(thread)).conversations.find(row=>row.id===opened.id);
  expect(visible).toMatchObject({context_revision:current.context_revision,epoch:String(current.epoch),revision:current.revision,responsibility_id:current.responsibility_id,pending_driver:null});
  const input={conversationId:current.id,revision:current.revision,contextRevision:current.context_revision,epoch:Number(current.epoch),target:{kind:'human',userId:user},reason:'I will handle this conversation personally'};
  const pending=await store.beginConversationHandover(thread,request,input);expect(pending.status).toBe('quiescing');expect(await store.beginConversationHandover(thread,request,input)).toEqual(pending);
  expect(await store.conversation(thread,current.id)).toMatchObject({phase:'quiescing',pending_driver:{kind:'human',userId:user}});
  const held=await store.conversation(thread,current.id),commitInput={conversationId:current.id,revision:held.revision,contextRevision:held.context_revision,epoch:Number(held.epoch)};
  const committed=await store.commitConversationHandover(thread,randomUUID(),commitInput);expect(committed.status).toBe('active');
  expect(await store.conversation(thread,current.id)).toMatchObject({phase:'active',driver_kind:'human',human_user_id:user,pending_driver:null});
  await expect(store.proposeNativeEmail(thread,randomUUID(),{conversationId:current.id,revision:current.revision,contextRevision:current.context_revision,draft:{kind:'initial_email',intent:'initial',subject:'Hello',body:'Old agent action',rationale:'Stale test',sourceIds:[]}})).rejects.toThrow();
 });

 it('adopts the original n8n account/version, fences it before stopping, and rejects late callbacks after agent handover',async()=>{
  await start();const contactId=await contact(randomUUID()+'@example.invalid'),sequence=randomUUID(),version=randomUUID(),enrolment=randomUUID(),binding=randomUUID(),c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   await c.query("INSERT INTO campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft) VALUES($1,$2,$3,$4,'Fixture original n8n','{}')",[sequence,org,user,mandate]);
   await c.query("INSERT INTO campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id,version,definition) VALUES($1,$2,$3,$4,7,'{}')",[version,org,user,sequence]);
   const email=(await c.query("SELECT personal_data->>'email' AS email FROM contacts WHERE id=$1",[contactId])).rows[0].email;
   await c.query("INSERT INTO campaign_enrolments(id,organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,recipient_email,state,runtime) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active','n8n')",[enrolment,org,user,sequence,version,mandate,contactId,email]);
   await c.query("INSERT INTO communication_bindings(id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,1,'email','gmail','unipile','service')",[binding,org,user,'fixture-connection:'+binding,'fixture-account:'+binding]);
   await c.query("INSERT INTO campaign_channel_bindings(enrolment_id,organization_id,owner_user_id,channel,binding_id) VALUES($1,$2,$3,'email',$4)",[enrolment,org,user,binding]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  const adopted=await store.adoptSequenceConversation(thread,randomUUID(),{enrolmentId:enrolment,expectedVersionId:version});
  const original=await store.conversation(thread,adopted.id);expect(original).toMatchObject({driver_kind:'sequence',sequence_enrolment_id:enrolment,sequence_runtime:'n8n',driver_generation:7,binding_id:binding});
  const begun=await store.beginConversationHandover(thread,randomUUID(),{conversationId:original.id,revision:original.revision,contextRevision:original.context_revision,epoch:Number(original.epoch),target:{kind:'agent',responsibilityId:original.responsibility_id},reason:'Move this lead to the goal-driven acquisition agent'});
  const held=await store.conversation(thread,begun.id),commit={conversationId:held.id,revision:held.revision,contextRevision:held.context_revision,epoch:Number(held.epoch)};
  await expect(store.commitConversationHandover(thread,randomUUID(),commit)).rejects.toThrow(/sequence|quiesce/i);
  // The original sequence service's stop command is separately characterised;
  // this controlled fixture supplies its persisted stopped state, never a send.
  const stop=await pool.connect();try{await stop.query('BEGIN');await stop.query('SELECT communications_lock_send_gate($1)',[org]);await stop.query("UPDATE campaign_enrolments SET state='stopped' WHERE id=$1",[enrolment]);await stop.query('COMMIT');}finally{stop.release();}
  await store.commitConversationHandover(thread,randomUUID(),commit);
  const active=await store.conversation(thread,held.id);expect(active).toMatchObject({driver_kind:'agent',retired_enrolments:[enrolment],binding_id:binding});
  const proof=await pool.connect();try{await proof.query('BEGIN');await proof.query('SET LOCAL ROLE acquire_campaign_user');await proof.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await proof.query('SELECT communications_lock_send_gate($1)',[org]);expect((await proof.query('SELECT agent_driver_allows($1,$2,$3::uuid,NULL,$4,$5::uuid,NULL) AS allowed',[org,user,contactId,'campaign',enrolment])).rows[0].allowed).toBe(false);await proof.query('ROLLBACK');}finally{proof.release();}
  await expect(store.beginConversationHandover(thread,randomUUID(),{conversationId:active.id,revision:active.revision,contextRevision:active.context_revision,epoch:Number(active.epoch),target:{kind:'sequence',enrolmentId:enrolment,runtime:'n8n',generation:7},reason:'Reusing a retired callback must never be allowed'})).rejects.toThrow();
  expect((await pool.query('SELECT version_id,runtime FROM campaign_enrolments WHERE id=$1',[enrolment])).rows[0]).toEqual({version_id:version,runtime:'n8n'});
 });

 it('retires an unused approved email through owner handover without replaying it or granting a replacement send',async()=>{
  await start();const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'});
  await store.ingestHistory(thread,opened.id,{source:'local_fixture',observedAt:new Date().toISOString(),complete:true,messages:[]});
  const current=await store.conversation(thread,opened.id),proposal=await store.proposeNativeEmail(thread,randomUUID(),{conversationId:current.id,revision:current.revision,contextRevision:current.context_revision,draft:{kind:'initial_email',intent:'initial',subject:'Synthetic reviewed introduction',body:'Would you consider an introductory conversation?',rationale:'Unverified fit; introductory question only.',sourceIds:['mandate:'+mandate]}});
  const batch=(await store.listReviewBatches(thread,{pendingOnly:true})).find(b=>b.id===proposal.reviewBatchId)!;
  await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');
  expect((await pool.query('SELECT count(*)::int n FROM agent_budget_reservations WHERE operation_id=$1',[proposal.id])).rows[0].n).toBe(0);
  const owner=await store.conversation(thread,current.id);
  await store.beginConversationHandover(thread,randomUUID(),{conversationId:owner.id,revision:owner.revision,epoch:Number(owner.epoch),contextRevision:owner.context_revision,target:{kind:'human',userId:user},reason:'Retire this unused approval before a separately reviewed fresh proposal.'});
  expect((await pool.query('SELECT state,result FROM agent_operations WHERE id=$1',[proposal.id])).rows[0]).toEqual({state:'failed',result:{reason:'context_changed'}});
  expect((await pool.query('SELECT state,manifest FROM agent_review_batches WHERE id=$1',[batch.id])).rows[0]).toEqual({state:'approved',manifest:batch.manifest});
  let row=await store.conversation(thread,current.id);await store.commitConversationHandover(thread,randomUUID(),{conversationId:row.id,revision:row.revision,epoch:Number(row.epoch),contextRevision:row.context_revision});
  row=await store.conversation(thread,current.id);expect(row.driver_kind).toBe('human');
  await store.beginConversationHandover(thread,randomUUID(),{conversationId:row.id,revision:row.revision,epoch:Number(row.epoch),contextRevision:row.context_revision,target:{kind:'agent',responsibilityId:row.responsibility_id},reason:'Return ownership for fresh assessment; no old approval may be sent.'});
  row=await store.conversation(thread,current.id);await store.commitConversationHandover(thread,randomUUID(),{conversationId:row.id,revision:row.revision,epoch:Number(row.epoch),contextRevision:row.context_revision});
  const active=await store.conversation(thread,current.id);expect(active).toMatchObject({driver_kind:'agent',phase:'active'});expect(Number(active.epoch)).toBeGreaterThan(Number(owner.epoch));
  await expect(store.deliverApprovedLocalEmail(thread,proposal.id)).rejects.toThrow(/changed|approval/);
  expect((await pool.query('SELECT count(*)::int n FROM agent_sink_messages WHERE conversation_id=$1',[current.id])).rows[0].n).toBe(0);
  expect((await pool.query("SELECT count(*)::int n FROM agent_events WHERE thread_id=$1 AND kind='conversation.reassess' AND payload->>'conversationId'=$2",[thread,current.id])).rows[0].n).toBeGreaterThan(0);
  const fresh=await store.proposeNativeEmail(thread,randomUUID(),{conversationId:active.id,revision:active.revision,contextRevision:active.context_revision,draft:{kind:'initial_email',intent:'initial',subject:'Fresh synthetic introduction',body:'A new separately reviewed draft.',rationale:'New context requires human review.',sourceIds:['mandate:'+mandate]}});
  expect(fresh.id).not.toBe(proposal.id);expect((await store.listReviewBatches(thread,{pendingOnly:true})).find(b=>b.id===fresh.reviewBatchId)?.state).toBe('pending');
 });

 it('rejects same-agent handover instead of bypassing explicit held-resume checks',async()=>{
  await start();const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'}),row=await store.conversation(thread,opened.id);await expect(store.beginConversationHandover(thread,randomUUID(),{conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,epoch:Number(row.epoch),target:{kind:'agent',responsibilityId:row.responsibility_id},reason:'Attempt to bypass held resume'})).rejects.toThrow('already owns');
 });

 it('does not treat a running row with a NULL lease as authority for any native send',async()=>{
  await start();const event=randomUUID(),run=randomUUID(),owner=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO agent_events(id,thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest,state,lease_owner,lease_until,fence) VALUES($1::uuid,$2,$3,$4,$5,$1::text,'email.dispatch','{}',$6,'leased',$7,clock_timestamp()+interval '30 seconds',1)",[event,thread,org,mandate,user,'e'.repeat(64),owner]);await c.query("INSERT INTO agent_runs(id,thread_id,organization_id,mandate_id,owner_user_id,trigger_event_id,state,lease_owner,lease_until,fence) VALUES($1,$2,$3,$4,$5,$6,'running',$7,NULL,1)",[run,thread,org,mandate,user,event,owner]);await c.query('COMMIT');}finally{c.release();}
  expect(await store.eventRunCurrent(run,{id:event,thread_id:thread,kind:'email.dispatch',payload:{},lease_owner:owner,fence:'1',attempts:1})).toBe(false);await expect(store.beginNativeCommunicationsEmail(thread,randomUUID(),{runId:run,eventId:event,leaseOwner:owner,fence:'1'})).rejects.toThrow('expired or changed');
 });

});
