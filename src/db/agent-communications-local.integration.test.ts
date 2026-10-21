import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {createHash,randomUUID} from 'node:crypto';
import {AgentOwnershipStore} from './agent-ownership-store';
import {queueAgentCommunicationChange,queueAgentEmailBounce} from '@/lib/agent-communications-events';
import {readAgentCommunicationsSource} from '@/lib/agent-communications-source';
import {createNativeAgentHandlers} from '@/lib/agent-native-handlers';
const enabled=process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
let store:AgentOwnershipStore,thread:string;
const org=randomUUID(),user=randomUUID(),mandate=randomUUID();
const actor={organizationId:org,userId:user};
describe.runIf(enabled)('native communications source admission',()=>{
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
  await c.query('DELETE FROM communication_dispatch_permits WHERE intent_id IN(SELECT id FROM communication_dispatch_intents WHERE organization_id=$1)',[org]);
  await c.query('DELETE FROM communication_intent_resolutions WHERE intent_id IN(SELECT id FROM communication_dispatch_intents WHERE organization_id=$1)',[org]);
  for(const table of ['communication_dispatch_intents','communication_event_receipts','suppressions','agent_sink_messages','agent_authority_uses','agent_handoffs','agent_person_claims','agent_budget_reservations','agent_budget_accounts','agent_review_batches','agent_authority_grants','agent_operations','agent_conversations','agent_responsibilities','agent_runs','agent_events','agent_messages','agent_threads','campaign_channel_bindings','campaign_enrolments','campaign_sequence_versions','campaign_sequences','communication_bindings','contacts','mandates','member','audit_events','communication_send_gates'])await c.query(`DELETE FROM ${table} WHERE organization_id=$1`,[org]);
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

 async function limits(){
  const start=new Date();start.setUTCHours(0,0,0,0);
  for(const unit of ['sends'])for(const scope of ['organization','user:'+user,'mandate:'+mandate])await store.configureBudget({scopeKey:scope+':'+unit,unit,windowStart:start.toISOString(),windowEnd:new Date(start.getTime()+86400000).toISOString(),cap:'30',expectedRevision:0});
 }

 async function prepared(){
  await start();const binding=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO communication_bindings(id,organization_id,owner_user_id,application_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,'acquire',$4,$5,1,'email','gmail','unipile','service')",[binding,org,user,randomUUID(),randomUUID()]);await c.query('COMMIT');}finally{c.release();}
  const opened=await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'communications',bindingId:binding});
  await store.ingestHistory(thread,opened.id,{source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[]});
  const row=await store.conversation(thread,opened.id),proposal=await store.proposeNativeEmail(thread,randomUUID(),{conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,draft:{kind:'initial_email',intent:'initial',subject:'A synthetic acquisition enquiry',body:'Would you be open to an introductory conversation?',rationale:'Synthetic fixture',sourceIds:[]}});
  const batch=(await store.listReviewBatches(thread)).find(b=>b.id===proposal.reviewBatchId);await store.decideReviewBatch(thread,batch.id,batch.revision,batch.manifest,'approved');
  const accounts=await store.listBudgetAccounts();await store.reserveBudget(proposal.id,accounts.map(a=>({accountId:a.id,amount:'1'})));
  const client=await pool.connect();try{await client.query('BEGIN');await client.query("SET LOCAL ROLE acquire_agent_user");await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await client.query('SELECT agent_lock_send_gate()');
   const op=(await client.query("UPDATE agent_operations SET state='running',fence=fence+1,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=$1 RETURNING *",[proposal.id])).rows[0];
   await client.query("INSERT INTO agent_authority_uses(operation_id,conversation_id,organization_id,mandate_id,owner_user_id,thread_id,review_batch_id,operation_revision,operation_fence,operation_digest,context_revision,binding_digest,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'reserved')",[op.id,row.id,org,mandate,user,thread,batch.id,op.revision,op.fence,op.input_digest,row.context_revision,row.binding_digest]);await client.query('COMMIT');return {row,op,binding};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async function admission<T>(work:(c:PoolClient)=>Promise<T>){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_campaign_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await c.query('SELECT communications_lock_send_gate($1)',[org]);return await work(c);}finally{await c.query('ROLLBACK');c.release();}}
 it('requires installed native source guard rather than campaign/draft substitution',async()=>{
  expect((await pool.query("SELECT to_regprocedure('public.agent_communications_source(uuid,uuid,bigint,bigint,uuid)') IS NOT NULL AS installed")).rows[0].installed).toBe(true);
 });
 it('does not disclose native source metadata without the authenticated held organisation scope',async()=>{
  await expect(pool.query('SELECT agent_communications_source($1::uuid,$2::uuid,1,1,$3::uuid)',[randomUUID(),randomUUID(),randomUUID()])).rejects.toThrow(/Held current application authority/);
 });
 it('uses current native authority and rejects stale account, epoch, fence and unknown operation',async()=>{
  await limits();const {row,op,binding}=await prepared(),source={kind:'agent',operationId:op.id,conversationId:row.id,epoch:Number(row.epoch),fence:String(op.fence)};
  await admission(async c=>{
   const allowed=(await c.query('SELECT agent_operation_authorised($1) AS allowed',[op.id])).rows[0].allowed;
   if(allowed)expect(await readAgentCommunicationsSource(c,source,binding)).toMatchObject({contactId:row.contact_id,recipient:row.recipient_email,subject:op.input.subject,body:op.input.body});
   else await expect(readAgentCommunicationsSource(c,source,binding)).rejects.toThrow(); // Real current sending window remains enforced.
   await expect(readAgentCommunicationsSource(c,{...source,epoch:source.epoch+1},binding)).rejects.toThrow();
   await expect(readAgentCommunicationsSource(c,{...source,fence:String(Number(op.fence)+1)},binding)).rejects.toThrow();
   await expect(readAgentCommunicationsSource(c,source,randomUUID())).rejects.toThrow();
   await expect(readAgentCommunicationsSource(c,{...source,operationId:randomUUID()},binding)).rejects.toThrow();
  });
 });
 it('does not claim another retired account/channel is covered by current email history',async()=>{
  const {row,op,binding}=await prepared();
  await admission(async c=>expect((await c.query('SELECT agent_history_accounts_clear($1) AS clear',[op.id])).rows[0].clear).toBe(true));
  const alias=await contact(row.recipient_email),sequence=randomUUID(),version=randomUUID(),enrolment=randomUUID(),otherBinding=randomUUID(),c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   await c.query("INSERT INTO communication_bindings(id,organization_id,owner_user_id,application_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,'acquire',$4,$5,1,'whatsapp','whatsapp','unipile','service')",[otherBinding,org,user,randomUUID(),randomUUID()]);
   await c.query("INSERT INTO campaign_sequences(id,organization_id,owner_user_id,mandate_id,name,draft) VALUES($1,$2,$3,$4,'Historical synthetic sequence','{}')",[sequence,org,user,mandate]);
   await c.query("INSERT INTO campaign_sequence_versions(id,organization_id,owner_user_id,sequence_id,version,definition) VALUES($1,$2,$3,$4,1,'{}')",[version,org,user,sequence]);
   await c.query("INSERT INTO campaign_enrolments(id,organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,recipient_email,state,runtime) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'stopped','n8n')",[enrolment,org,user,sequence,version,mandate,alias,row.recipient_email]);
   await c.query("INSERT INTO campaign_channel_bindings(enrolment_id,organization_id,owner_user_id,channel,binding_id) VALUES($1,$2,$3,'whatsapp',$4)",[enrolment,org,user,otherBinding]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  await admission(async c=>expect((await c.query('SELECT agent_history_accounts_clear($1) AS clear',[op.id])).rows[0].clear).toBe(false));
  // Claimed coverage JSON cannot establish another channel's provider history.
  const forged=await pool.connect();try{await forged.query('BEGIN');await forged.query("SET LOCAL session_replication_role='replica'");await forged.query('UPDATE agent_conversations SET coverage_bindings=$2,revision=revision+1 WHERE id=$1',[row.id,JSON.stringify([{channel:'email',bindingId:binding,since:'1970-01-01T00:00:00.000Z'},{channel:'whatsapp',bindingId:otherBinding,since:'1970-01-01T00:00:00.000Z',complete:true}])]);await forged.query('COMMIT');}finally{forged.release();}
  await admission(async c=>expect((await c.query('SELECT agent_history_accounts_clear($1) AS clear',[op.id])).rows[0].clear).toBe(false));
 });

 it('derives an exact inbound-first reply parent with the same content digest as service/provider verification',async()=>{
  const history=[{id:'newer-own-send',direction:'outbound',at:'2026-10-17T02:00:00.000Z',subject:'Prior reply',text:'An answer'},{id:'verified-inbound',direction:'inbound',at:'2026-10-17T01:00:00.000Z',subject:'Business question',text:'Who is buying?'}];
  expect((await pool.query('SELECT agent_email_reply_parent($1::jsonb) AS parent',[JSON.stringify(history)])).rows[0].parent).toEqual({id:'verified-inbound',contentDigest:createHash('sha256').update('Business question\nWho is buying?').digest('hex')});
  expect((await pool.query("SELECT agent_email_reply_parent('[]'::jsonb) AS parent")).rows[0].parent).toBeNull();
 });

 // Synthetic receipt ledger fixtures below attest persistence/replay, not an
 // actual admission or provider send outside the real business-hours policy.
 async function recordedIntent(op:Awaited<ReturnType<typeof prepared>>['op'],row:Awaited<ReturnType<typeof prepared>>['row'],bindingId:string,permit=true){
  const intent=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   await c.query("INSERT INTO communication_dispatch_intents(id,organization_id,owner_user_id,binding_id,source_kind,source_id,epoch,contact_id,operation_key,operation,payload_digest,intent_digest,encrypted_intent,intent_key_version,source_digest,required_since,coverage_scopes) VALUES($1,$2,$3,$4,'agent',$5,1,$6,$7,'message',$8,$8,'synthetic-receipt-ledger-only','fixture',$8,'1970-01-01','[{}]')",[intent,org,user,bindingId,op.id,row.contact_id,'acquire:agent:'+op.id+':1','a'.repeat(64)]);
   if(permit)await c.query("INSERT INTO communication_dispatch_permits(id,intent_id,service_admission_id,service_journal_id,encrypted_receipt,receipt_key_version,receipt_digest) VALUES($1,$2,$3,$4,'synthetic-ledger-only','fixture',$5)",[randomUUID(),intent,randomUUID(),randomUUID(),'b'.repeat(64)]);await c.query('COMMIT');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}return intent;
 }
 async function positiveReceipt(bindingId:string,recipient:string){const b=(await pool.query('SELECT * FROM communication_bindings WHERE id=$1',[bindingId])).rows[0];return {status:'submitted' as const,receipt:{message:{id:'synthetic-provider-'+randomUUID(),binding:{applicationId:b.application_id,tenantId:b.organization_id,ownerId:b.owner_user_id,connectionId:b.service_connection_id,accountId:b.service_account_id,generation:b.generation,channel:b.channel,platform:b.platform,backend:b.backend}},recipient:{kind:'email' as const,value:recipient},submittedAt:new Date(Date.now()-1000).toISOString()}};}
 it('materialises one original submitted receipt, settles all scopes once and waits for provider history reflection',async()=>{
  const {row,op,binding}=await prepared(),intentId=await recordedIntent(op,row,binding),outcome=await positiveReceipt(binding,row.recipient_email),before=await store.listBudgetAccounts();
  expect(await store.markNativeCommunicationsOutcome(thread,op.id,outcome)).toMatchObject({status:'submitted',providerMessageId:outcome.receipt.message.id,intentId});
  const after=await store.listBudgetAccounts();for(const account of after){const old=before.find(a=>a.id===account.id);expect(account.spent).toBe(String(Number(old.spent)+1));expect(account.reserved).toBe(String(Number(old.reserved)-1));}
  await store.markNativeCommunicationsOutcome(thread,op.id,outcome);expect(await store.listBudgetAccounts()).toEqual(after);
  expect(await store.conversation(thread,row.id)).toMatchObject({history_complete:false,pause_reason:'provider_receipt_pending_history',history:[]});
  await expect(store.markNativeCommunicationsOutcome(thread,op.id,{...outcome,receipt:{...outcome.receipt,message:{...outcome.receipt.message,id:'different-provider-message'}}})).rejects.toThrow('Different original delivery receipt');
  await store.ingestHistory(thread,row.id,{source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[]});expect((await store.conversation(thread,row.id)).history_complete).toBe(false);
  await store.ingestHistory(thread,row.id,{source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[{id:outcome.receipt.message.id,direction:'outbound',text:op.input.body,subject:op.input.subject,at:outcome.receipt.submittedAt}]});expect((await store.conversation(thread,row.id)).history_complete).toBe(true);
 });
 it('keeps unknown provider reservations and human hold until a matching original admitted receipt is reconciled',async()=>{
  const {row,op,binding}=await prepared();await recordedIntent(op,row,binding);const before=await store.listBudgetAccounts();
  expect(await store.markNativeCommunicationsOutcome(thread,op.id,{status:'unknown'})).toEqual({status:'unknown'});
  expect((await store.listBudgetAccounts()).map(a=>({id:a.id,reserved:a.reserved,spent:a.spent}))).toEqual(before.map(a=>({id:a.id,reserved:a.reserved,spent:a.spent})));
  expect(await store.conversation(thread,row.id)).toMatchObject({phase:'held',history_complete:false,pause_reason:'provider_outcome_unknown'});
  await store.markNativeCommunicationsOutcome(thread,op.id,{status:'unknown'});
  expect((await pool.query("SELECT count(*)::int AS count FROM agent_events WHERE thread_id=$1 AND kind='email.reconcile' AND payload->>'operationId'=$2",[thread,op.id])).rows[0].count).toBe(1);
  const outcome=await positiveReceipt(binding,row.recipient_email);await store.markNativeCommunicationsOutcome(thread,op.id,outcome);expect((await store.conversation(thread,row.id)).phase).toBe('held');
  const history={source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[{id:outcome.receipt.message.id,direction:'outbound',text:op.input.body,subject:op.input.subject,at:outcome.receipt.submittedAt}]};
  await store.ingestHistory(thread,row.id,history);
  const resumed=await store.conversation(thread,row.id);expect(resumed).toMatchObject({phase:'active',pause_reason:null,history_complete:true});
  const held=await store.holdNativeConversation(thread,randomUUID(),{conversationId:resumed.id,revision:resumed.revision,contextRevision:resumed.context_revision,reason:'A human must verify the buyer funding before replying'});
  expect(held.status).toBe('held');
  expect((await pool.query("SELECT count(*)::int n FROM agent_messages WHERE thread_id=$1 AND content->'details'->>'conversationId'=$2 AND content->'details'->>'reason'=$3",[thread,row.id,'A human must verify the buyer funding before replying'])).rows[0].n).toBe(1);
  await store.ingestHistory(thread,row.id,{...history,observedAt:new Date().toISOString()});expect(await store.conversation(thread,row.id)).toMatchObject({phase:'held',pause_reason:'human_review_required'});
 });
 it('cannot materialise a submitted email without an original service-admitted intent',async()=>{
  const {row,op,binding}=await prepared();await recordedIntent(op,row,binding,false);
  await expect(store.markNativeCommunicationsOutcome(thread,op.id,await positiveReceipt(binding,row.recipient_email))).rejects.toThrow('Original admitted communications intent required');
  expect((await store.conversation(thread,row.id)).history_complete).toBe(true);
 });

 async function incoming(row:Awaited<ReturnType<typeof prepared>>['row'],bindingId:string,eventId=randomUUID(),review=false){return {bindingId,serviceEventId:eventId,receiptFingerprint:'d'.repeat(64),changeFingerprint:'d'.repeat(64),sender:row.recipient_email,providerMessageId:'incoming-'+eventId,occurredAt:new Date(Date.now()-1000).toISOString(),reviewRequired:review};}
 async function consumeIncoming(input:Awaited<ReturnType<typeof incoming>>){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_campaign_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await c.query('SELECT communications_lock_send_gate($1)',[org]);await c.query("INSERT INTO communication_event_receipts(binding_id,service_event_id,organization_id,owner_user_id,event_type,occurred_at,result,payload_fingerprint,fingerprint_version) VALUES($1,$2,$3,$4,'message',$5,$6,$7,'acquire.reply.delivery.v1') ON CONFLICT DO NOTHING",[input.bindingId,input.serviceEventId,org,user,input.occurredAt,input.reviewRequired?'review':'processed',input.receiptFingerprint]);const queued=await queueAgentCommunicationChange(c,input);await c.query('COMMIT');return queued;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 it('queues one incoming email wake and invalidates old review actions before the same receipt commits',async()=>{
  const {row,binding}=await prepared(),proposal=await store.proposeNativeEmail(thread,randomUUID(),{conversationId:row.id,revision:row.revision,contextRevision:row.context_revision,draft:{kind:'initial_email',intent:'initial',subject:'Synthetic pending proposal',body:'An enquiry awaiting review',rationale:'Synthetic fixture',sourceIds:[]}}),event=await incoming(row,binding);
  expect(await consumeIncoming(event)).toBe(1);const changed=await store.conversation(thread,row.id);expect(changed).toMatchObject({history_complete:false,history:[],phase:'active',pause_reason:'provider_history_changed',next_wakeup_at:null});expect(changed.revision).toBe(row.revision+1);
  expect((await store.listReviewBatches(thread)).find(b=>b.id===proposal.reviewBatchId).state).toBe('invalidated');
  expect((await pool.query("SELECT payload FROM agent_events WHERE thread_id=$1 AND kind='conversation.history_changed' AND event_key LIKE 'incoming-email:%' AND payload->>'conversationId'=$2",[thread,row.id])).rows).toEqual([{payload:{conversationId:row.id}}]);
  const notices=(await pool.query("SELECT content FROM agent_messages WHERE thread_id=$1 AND request_key LIKE 'incoming-email:%' AND content->'details'->>'conversationId'=$2",[thread,row.id])).rows;expect(notices).toHaveLength(1);expect(notices[0].content.details.providerMessageId).toBe(event.providerMessageId);
  expect(await consumeIncoming(event)).toBe(0);expect((await store.conversation(thread,row.id)).revision).toBe(changed.revision);
 });
 it('rolls back receipt, review invalidation and wake together when the notice insert fails, then replays once',async()=>{
  const {row,binding}=await prepared(),event=await incoming(row,binding),key=(await pool.query("SELECT 'incoming-email:'||encode(sha256(convert_to(jsonb_build_array($1::uuid,$2::text,$3::text)::text,'UTF8')),'hex')||':'||$4::text AS key",[binding,event.serviceEventId,event.changeFingerprint,row.id])).rows[0].key;
  await store.appendMessage(thread,key,'assistant',{text:'Synthetic fault fixture'});
  await expect(consumeIncoming(event)).rejects.toThrow(/duplicate key/);
  expect((await store.conversation(thread,row.id)).revision).toBe(row.revision);
  expect((await pool.query('SELECT count(*)::int AS n FROM communication_event_receipts WHERE binding_id=$1 AND service_event_id=$2',[binding,event.serviceEventId])).rows[0].n).toBe(0);
  expect((await pool.query('SELECT count(*)::int AS n FROM agent_events WHERE thread_id=$1 AND event_key=$2',[thread,key])).rows[0].n).toBe(0);
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query('DELETE FROM agent_messages WHERE thread_id=$1 AND request_key=$2',[thread,key]);await c.query('COMMIT');}finally{c.release();}
  expect(await consumeIncoming(event)).toBe(1);expect(await consumeIncoming(event)).toBe(0);
 });
 it('notifies a human-owned booking handoff on a new email while preserving paused ownership and source evidence',async()=>{
  const {row,binding}=await prepared(),at=new Date(Date.now()-2000).toISOString();await store.ingestHistory(thread,row.id,{source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[{id:'original-interest',direction:'inbound',text:'Can we arrange a call?',subject:'A call',at}]});
  const ready=await store.conversation(thread,row.id),task=await store.handoffConversation(thread,randomUUID(),{conversationId:row.id,revision:ready.revision,contextRevision:ready.context_revision,reason:'Lead asked for a call',summary:'Human to review and send a booking link'}),before=(await store.listHandoffs(thread)).find(h=>h.id===task.id);
  expect(await consumeIncoming(await incoming(ready,binding))).toBe(1);expect(await store.conversation(thread,row.id)).toMatchObject({driver_kind:'human',phase:'paused',engagement:'handoff',pause_reason:'meeting_handoff',history_complete:false});
  const after=(await store.listHandoffs(thread)).find(h=>h.id===task.id);expect(after.revision).toBe(before.revision+1);expect(after.context).toEqual(before.context);expect(after.source_history_revision).toBe(before.source_history_revision);expect(after.human_evidence).toEqual(before.human_evidence);
 });
 it('holds ambiguous incoming email for human review and never queues a different original account',async()=>{
  const {row,binding}=await prepared(),event=await incoming(row,binding,randomUUID(),true);expect(await consumeIncoming(event)).toBe(1);expect(await store.conversation(thread,row.id)).toMatchObject({phase:'held',pause_reason:'incoming_email_review_required',history_complete:false});
  const unchanged=await store.conversation(thread,row.id),other=(await pool.query('SELECT id FROM communication_bindings WHERE organization_id=$1 AND id<>$2 LIMIT 1',[org,binding])).rows[0].id;
  expect(await consumeIncoming({...event,bindingId:other,serviceEventId:randomUUID()})).toBe(0);expect((await store.conversation(thread,row.id)).revision).toBe(unchanged.revision);
 });

 it('does not let an older stopped conversation consume the active conversation wake in the same thread',async()=>{
  const {row,binding}=await prepared(),historicId='00000000-0000-4000-8000-'+randomUUID().replaceAll('-','').slice(-12),c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO agent_conversations SELECT (jsonb_populate_record(NULL::agent_conversations,to_jsonb(c)||jsonb_build_object('id',$2::uuid,'driver_kind','human','human_user_id',$3::text,'phase','complete','engagement','stopped'))).* FROM agent_conversations c WHERE c.id=$1",[row.id,historicId,user]);await c.query('COMMIT');}finally{c.release();}
  const event=await incoming(row,binding);expect(await consumeIncoming(event)).toBe(2);
  expect((await store.conversation(thread,row.id)).revision).toBe(row.revision+1);
  expect(await store.conversation(thread,historicId)).toMatchObject({phase:'complete',driver_kind:'human',engagement:'stopped',history_complete:false});
  expect(await consumeIncoming(event)).toBe(0);
  const oldEvent=await incoming(row,binding),oldKey=(await pool.query("SELECT 'incoming-email:'||encode(sha256(convert_to(jsonb_build_array($1::uuid,$2::text,$3::text)::text,'UTF8')),'hex') AS key",[binding,oldEvent.serviceEventId,oldEvent.changeFingerprint])).rows[0].key;
  await store.enqueueEvent(thread,oldKey,'conversation.history_changed',{conversationId:row.id});const beforeLegacyReplay=await store.conversation(thread,row.id);
  expect(await consumeIncoming(oldEvent)).toBe(1); // Only the other historic row is new work.
  expect((await store.conversation(thread,row.id)).revision).toBe(beforeLegacyReplay.revision);
 });

 // These ledger cases require specifically approved migration0028. They do
 // not authenticate provider ciphertext; admission unit tests cover that port.
 it.runIf(process.env.RUN_AGENT_NO_SUBMISSION_LOCAL_INTEGRATION==='true')('closes an original authenticated no-submission disposition once and keeps human review held',async()=>{
  const {row,op,binding}=await prepared(),intent=await recordedIntent(op,row,binding,false),proof='c'.repeat(64);await admission(async c=>{await c.query("INSERT INTO communication_intent_resolutions(intent_id,encrypted_proof,proof_key_version,proof_digest) VALUES($1,'synthetic-verified-ledger-fixture','fixture',$2)",[intent,proof]);await c.query('COMMIT');});
  expect((await store.nativeEmailDispatchRecord(thread,op.id)).notSubmitted).toBe(false);const before=await store.listBudgetAccounts();const close=()=>admission(async c=>{const result=(await c.query('SELECT agent_communications_no_submission($1,$2,$3) AS outcome',[op.id,intent,proof])).rows[0].outcome;await c.query('COMMIT');return result;});expect(await close()).toMatchObject({status:'not_submitted',intentId:intent,proofDigest:proof});const after=await store.listBudgetAccounts();for(const account of after){const old=before.find(a=>a.id===account.id)!;expect(account.spent).toBe(old.spent);expect(Number(account.reserved)).toBe(Number(old.reserved)-1);}expect(await close()).toMatchObject({status:'not_submitted'});expect(await store.listBudgetAccounts()).toEqual(after);expect(await store.conversation(thread,row.id)).toMatchObject({phase:'held',history_complete:false,pause_reason:'provider_no_submission_confirmed'});expect((await store.nativeEmailDispatchRecord(thread,op.id)).notSubmitted).toBe(true);expect((await pool.query('SELECT state FROM agent_authority_uses WHERE operation_id=$1',[op.id])).rows[0].state).toBe('released');await expect(store.markNativeCommunicationsOutcome(thread,op.id,{status:'unknown'})).rejects.toThrow('No admitted');const held=await store.conversation(thread,row.id),tokens={conversationId:held.id,revision:held.revision,epoch:Number(held.epoch),contextRevision:held.context_revision};await expect(store.resumeHeldConversation(thread,randomUUID(),{...tokens,reason:'Reviewed reconciled original email'})).rejects.toThrow('Refresh verified');await store.requestHeldHistoryRefresh(thread,randomUUID(),tokens);expect((await pool.query("SELECT count(*)::int AS n FROM agent_events WHERE thread_id=$1 AND event_key LIKE 'held-history:%' AND payload->>'conversationId'=$2",[thread,row.id])).rows[0].n).toBe(1);await store.ingestHistory(thread,row.id,{source:'communications',observedAt:(await pool.query('SELECT clock_timestamp() AS instant')).rows[0].instant.toISOString(),complete:true,messages:[]});const fresh=await store.conversation(thread,row.id);expect(await store.resumeHeldConversation(thread,randomUUID(),{conversationId:fresh.id,revision:fresh.revision,epoch:Number(fresh.epoch),contextRevision:fresh.context_revision,reason:'Reviewed fresh complete history after no submission'})).toMatchObject({status:'active'});
 });
 it.runIf(process.env.RUN_AGENT_NO_SUBMISSION_LOCAL_INTEGRATION==='true')('denies an absent or wrong original disposition without releasing any budget',async()=>{
  const {row,op,binding}=await prepared(),intent=await recordedIntent(op,row,binding,false),before=await store.listBudgetAccounts();await expect(admission(c=>c.query('SELECT agent_communications_no_submission($1,$2,$3)',[op.id,intent,'d'.repeat(64)]))).rejects.toThrow('Recorded original disposition');expect(await store.listBudgetAccounts()).toEqual(before);await expect(pool.query('SELECT agent_communications_no_submission($1,$2,$3)',[op.id,intent,'d'.repeat(64)])).rejects.toThrow('Held current application');
 });
 it.runIf(process.env.RUN_AGENT_NO_SUBMISSION_LOCAL_INTEGRATION==='true')('closes only an expired unprepared operation and rejects live or committed original intents',async()=>{
  const {op,row}=await prepared();const native=async(work:(c:PoolClient)=>Promise<unknown>)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await c.query('SELECT agent_lock_send_gate()');const result=await work(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}};
  await expect(native(c=>c.query('SELECT agent_communications_no_submission($1,NULL,NULL)',[op.id]))).rejects.toThrow('Expired unprepared');await native(c=>c.query("UPDATE agent_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[op.id]));await native(c=>c.query('SELECT agent_communications_no_submission($1,NULL,NULL)',[op.id]));expect((await store.conversation(thread,row.id)).phase).toBe('held');await native(c=>c.query('SELECT agent_communications_no_submission($1,NULL,NULL)',[op.id]));
  const next=await prepared();await recordedIntent(next.op,next.row,next.binding,false);await native(c=>c.query("UPDATE agent_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[next.op.id]));await expect(native(c=>c.query('SELECT agent_communications_no_submission($1,NULL,NULL)',[next.op.id]))).rejects.toThrow('Expired unprepared');
 });

 it.runIf(process.env.RUN_AGENT_NO_SUBMISSION_LOCAL_INTEGRATION==='true')('permits only the exact current lookup-only reconciliation run while other live runs block unprepared closure',async()=>{
  const {op}=await prepared(),run=randomUUID(),event=randomUUID(),owner=randomUUID(),c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("UPDATE agent_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[op.id]);await c.query("INSERT INTO agent_events(id,thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest,state,lease_owner,lease_until,fence) VALUES($1::uuid,$2,$3,$4,$5,$1::text,'email.reconcile',$6,$7,'leased',$8,clock_timestamp()+interval '30 seconds',1)",[event,thread,org,mandate,user,JSON.stringify({operationId:op.id}),'f'.repeat(64),owner]);await c.query("INSERT INTO agent_runs(id,thread_id,organization_id,mandate_id,owner_user_id,trigger_event_id,state,lease_owner,lease_until,fence) VALUES($1,$2,$3,$4,$5,$6,'running',$7,clock_timestamp()+interval '30 seconds',1)",[run,thread,org,mandate,user,event,owner]);await c.query('COMMIT');}finally{c.release();}
  const close=async(fence?:number)=>{const client=await pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE acquire_agent_user');await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await client.query('SELECT agent_lock_send_gate()');const args=fence===undefined?[op.id,null,null,null,null,null,null]:[op.id,null,null,run,event,owner,fence];const result=await client.query('SELECT agent_communications_no_submission($1,$2,$3,$4,$5,$6,$7) AS outcome',args);await client.query('COMMIT');return result.rows[0].outcome;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}};
  await expect(close()).rejects.toThrow('Expired unprepared');await expect(close(2)).rejects.toThrow('reconcile fence');const fixtureClient=await pool.connect();try{await fixtureClient.query('BEGIN');await fixtureClient.query("SET LOCAL session_replication_role='replica'");await fixtureClient.query("UPDATE agent_events SET kind='email.dispatch' WHERE id=$1",[event]);await fixtureClient.query('COMMIT');}finally{fixtureClient.release();}await expect(close(1)).rejects.toThrow('reconcile fence');const restore=await pool.connect();try{await restore.query('BEGIN');await restore.query("SET LOCAL session_replication_role='replica'");await restore.query("UPDATE agent_events SET kind='email.reconcile' WHERE id=$1",[event]);await restore.query('COMMIT');}finally{restore.release();}expect(await close(1)).toMatchObject({status:'not_submitted',reason:'expired_without_application_intent'});expect((await store.nativeEmailDispatchRecord(thread,op.id)).notSubmitted).toBe(true);expect(await store.finishEventRun(run,{id:event,thread_id:thread,kind:'email.reconcile',payload:{operationId:op.id},lease_owner:owner,fence:'1',attempts:1},{kind:'complete'})).toBe(true);
 });

 it('clears only the reconciled receipt transport hold after exact full history, preserving stale-human CAS and scoped grant limits',async()=>{
  const {row,op,binding}=await prepared();const state=await store.executionState(thread),grant=await store.createConversationGrant(thread,randomUUID(),{mandateRevision:state.mandateRevision,conversationIds:[row.id],actions:['reply_email'],maxSends:1,expiresAt:new Date(Date.now()+3600000).toISOString()});await recordedIntent(op,row,binding);await store.markNativeCommunicationsOutcome(thread,op.id,{status:'unknown'});const receipt=await positiveReceipt(binding,row.recipient_email);await store.markNativeCommunicationsOutcome(thread,op.id,receipt);const held=await store.conversation(thread,row.id);
  const stale={conversationId:held.id,revision:held.revision,epoch:Number(held.epoch),contextRevision:held.context_revision,reason:'I reviewed the original receipt and current full history.'};
  await expect(store.resumeHeldConversation(thread,randomUUID(),stale)).rejects.toThrow('Refresh verified');
  const history={source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[{id:receipt.receipt.message.id,direction:'outbound',subject:op.input.subject,text:op.input.body,at:receipt.receipt.submittedAt}]};await store.ingestHistory(thread,row.id,history);
  expect(await store.conversation(thread,row.id)).toMatchObject({phase:'active',pause_reason:null});await expect(store.resumeHeldConversation(thread,randomUUID(),stale)).rejects.toThrow('changed');
  const before=(await pool.query('SELECT revision,max_sends,used_sends,revoked_at FROM agent_authority_grants WHERE id=$1',[grant.id])).rows[0];expect(before).toMatchObject({revision:1,max_sends:1,used_sends:0,revoked_at:null});
  await store.ingestHistory(thread,row.id,{...history,observedAt:new Date().toISOString()});expect((await pool.query('SELECT revision,max_sends,used_sends,revoked_at FROM agent_authority_grants WHERE id=$1',[grant.id])).rows[0]).toEqual(before);
  expect((await pool.query("SELECT count(*)::int n FROM agent_messages WHERE thread_id=$1 AND request_key LIKE $2",[thread,'provider-history-resumed:'+row.id+':%'])).rows[0].n).toBe(1);
 });

 it('cannot resume unknown provider outcomes or clear a live suppression with a human click',async()=>{
  const {row,op,binding}=await prepared();await recordedIntent(op,row,binding);await store.markNativeCommunicationsOutcome(thread,op.id,{status:'unknown'});let current=await store.conversation(thread,row.id);const tokens=()=>({conversationId:current.id,revision:current.revision,epoch:Number(current.epoch),contextRevision:current.context_revision,reason:'Explicit human review cannot override a sending hold'});await expect(store.resumeHeldConversation(thread,randomUUID(),tokens())).rejects.toThrow('reconciled held');
  const receipt=await positiveReceipt(binding,row.recipient_email);await store.markNativeCommunicationsOutcome(thread,op.id,receipt);
  const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await c.query("INSERT INTO suppressions(organization_id,address,reason) VALUES($1,$2,'synthetic held resume suppression')",[org,row.recipient_email]);await c.query('COMMIT');}finally{c.release();}await store.ingestHistory(thread,row.id,{source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[{id:receipt.receipt.message.id,direction:'outbound',subject:op.input.subject,text:op.input.body,at:receipt.receipt.submittedAt}]});current=await store.conversation(thread,row.id);await expect(store.resumeHeldConversation(thread,randomUUID(),tokens())).rejects.toThrow('suppression');expect((await store.conversation(thread,row.id)).phase).toBe('held');
 });

 it('permanently fences native outreach on a trusted full-history bounce and notifies the human once without altering original submission accounting',async()=>{
  const {row,op}=await prepared(),before=await store.listBudgetAccounts(),observedAt=new Date().toISOString(),history={source:'communications',observedAt,complete:false,messages:[],deliveryFailures:[{id:'synthetic-dsn',at:observedAt}]};
  expect(await store.ingestHistory(thread,row.id,history)).toMatchObject({status:'held'});const held=await store.conversation(thread,row.id);expect(held).toMatchObject({phase:'held',engagement:'stopped',pause_reason:'delivery_failure',history_complete:false,next_wakeup_at:null});expect(await store.listBudgetAccounts()).toEqual(before);expect((await pool.query('SELECT state FROM agent_operations WHERE id=$1',[op.id])).rows[0].state).toBe('running');
  await store.ingestHistory(thread,row.id,history);expect((await pool.query("SELECT count(*)::int AS n FROM agent_messages WHERE thread_id=$1 AND request_key=$2",[thread,'delivery-failure:'+row.id])).rows[0].n).toBe(1);
  await store.ingestHistory(thread,row.id,{source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[]});expect(await store.conversation(thread,row.id)).toMatchObject({phase:'held',engagement:'stopped',pause_reason:'delivery_failure'});await expect(store.beginNativeCommunicationsEmail(thread,op.id)).rejects.toThrow();
 });

 it.runIf(process.env.RUN_AGENT_BOUNCE_EVENTS_LOCAL_INTEGRATION==='true')('atomically records a qualified bounce hold and human wake once, preserving original send reservations and receipts',async()=>{
  if(!(await store.listBudgetAccounts()).length)await limits();const {row,binding,op}=await prepared(),eventId=randomUUID(),input={bindingId:binding,serviceEventId:eventId,receiptFingerprint:'e'.repeat(64),changeFingerprint:'e'.repeat(64),recipient:row.recipient_email,providerMessageId:'dsn-'+eventId,occurredAt:new Date(Date.now()-1000).toISOString(),receiptPreimage:''},before=await store.listBudgetAccounts();
  const recorded=(await pool.query('SELECT * FROM communication_bindings WHERE id=$1',[binding])).rows[0],scope=[recorded.application_id,recorded.organization_id,recorded.owner_user_id,recorded.service_connection_id,recorded.service_account_id,recorded.generation,recorded.channel,recorded.platform,recorded.backend];input.receiptPreimage=JSON.stringify(['acquire.reply.delivery.v1',scope,binding,eventId,'a'.repeat(64),'b'.repeat(64),new Date().toISOString(),['bounce',input.providerMessageId,'email',input.recipient,input.occurredAt]]);input.receiptFingerprint=createHash('sha256').update(input.receiptPreimage).digest('hex');input.changeFingerprint=input.receiptFingerprint;
  const consume=async(commit=true)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_campaign_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await c.query('SELECT communications_lock_send_gate($1)',[org]);await c.query("INSERT INTO communication_event_receipts(binding_id,service_event_id,organization_id,owner_user_id,event_type,occurred_at,result,payload_fingerprint,fingerprint_version) VALUES($1,$2,$3,$4,'email_change',$5,'ignored',$6,'acquire.reply.delivery.v1') ON CONFLICT DO NOTHING",[binding,input.serviceEventId,org,user,input.occurredAt,input.receiptFingerprint]);const n=await queueAgentEmailBounce(c,input);await c.query(commit?'COMMIT':'ROLLBACK');return n;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}};
  await expect(admission(c=>queueAgentEmailBounce(c,input))).rejects.toThrow('Original delivery-failure receipt');await expect(admission(c=>queueAgentEmailBounce(c,{...input,bindingId:randomUUID()}))).rejects.toThrow('Original owned email account');
  expect(await consume(false)).toBe(1);expect((await store.conversation(thread,row.id)).phase).toBe('active');expect((await pool.query('SELECT count(*)::int AS n FROM communication_event_receipts WHERE binding_id=$1 AND service_event_id=$2',[binding,eventId])).rows[0].n).toBe(0);
  expect(await consume()).toBe(1);expect(await consume()).toBe(0);await expect(admission(c=>queueAgentEmailBounce(c,{...input,recipient:'different@example.invalid'}))).rejects.toThrow('metadata differs');await expect(admission(c=>queueAgentEmailBounce(c,{...input,providerMessageId:'different-message'}))).rejects.toThrow('metadata differs');await expect(admission(c=>queueAgentEmailBounce(c,{...input,occurredAt:new Date(Date.parse(input.occurredAt)-1).toISOString()}))).rejects.toThrow('metadata differs');await expect(admission(c=>queueAgentEmailBounce(c,{...input,receiptPreimage:input.receiptPreimage+' '}))).rejects.toThrow('receipt preimage');expect(await store.conversation(thread,row.id)).toMatchObject({phase:'held',engagement:'stopped',pause_reason:'delivery_failure',history_complete:false});expect(await store.listBudgetAccounts()).toEqual(before);expect((await pool.query('SELECT state FROM agent_operations WHERE id=$1',[op.id])).rows[0].state).toBe('running');
  expect((await pool.query("SELECT count(*)::int AS n FROM agent_events WHERE thread_id=$1 AND event_key LIKE 'email-bounce:%' AND payload->>'conversationId'=$2",[thread,row.id])).rows[0].n).toBe(1);expect((await pool.query("SELECT count(*)::int AS n FROM agent_messages WHERE thread_id=$1 AND content->'details'->>'serviceEventId'=$2",[thread,eventId])).rows[0].n).toBe(1);
  // Synthetic historical owner fixtures: explicitly reset only this suite's
  // row to each active original driver to exercise its existing admission gate.
  for(const driver of ['human','sequence']){const enrolment=randomUUID(),fixture=await pool.connect();try{await fixture.query('BEGIN');await fixture.query("SET LOCAL session_replication_role='replica'");await fixture.query("UPDATE agent_conversations SET driver_kind=$2,human_user_id=$3,sequence_enrolment_id=$4,sequence_runtime=$5,phase='active',engagement='cold',pause_reason=NULL WHERE id=$1",[row.id,driver,driver==='human'?user:null,driver==='sequence'?enrolment:null,driver==='sequence'?'n8n':null]);await fixture.query('COMMIT');}finally{fixture.release();}
   const allowed=()=>admission(async c=>(await c.query('SELECT agent_driver_allows($1,$2,$3::uuid,NULL,$4,$5::uuid,NULL) AS allowed',[org,user,row.contact_id,driver==='human'?'draft':'campaign',driver==='human'?randomUUID():enrolment])).rows[0].allowed);expect(await allowed()).toBe(true);
   input.serviceEventId=randomUUID();input.receiptPreimage=JSON.stringify(['acquire.reply.delivery.v1',scope,binding,input.serviceEventId,'a'.repeat(64),'b'.repeat(64),new Date().toISOString(),['bounce',input.providerMessageId,'email',input.recipient,input.occurredAt]]);input.receiptFingerprint=createHash('sha256').update(input.receiptPreimage).digest('hex');input.changeFingerprint=input.receiptFingerprint;
   expect(await consume()).toBe(1);expect(await allowed()).toBe(false);expect(await store.conversation(thread,row.id)).toMatchObject({driver_kind:driver,phase:'held',engagement:'stopped',pause_reason:'delivery_failure'});
  }
  await recordedIntent(op,row,binding);const submitted=await positiveReceipt(binding,row.recipient_email);await store.markNativeCommunicationsOutcome(thread,op.id,submitted);const settled=await store.listBudgetAccounts();input.serviceEventId=randomUUID();input.receiptPreimage=JSON.stringify(['acquire.reply.delivery.v1',scope,binding,input.serviceEventId,'a'.repeat(64),'b'.repeat(64),new Date().toISOString(),['bounce',input.providerMessageId,'email',input.recipient,input.occurredAt]]);input.receiptFingerprint=createHash('sha256').update(input.receiptPreimage).digest('hex');input.changeFingerprint=input.receiptFingerprint;expect(await consume()).toBe(1);expect(await store.listBudgetAccounts()).toEqual(settled);expect((await pool.query('SELECT result,state FROM agent_operations WHERE id=$1',[op.id])).rows[0]).toMatchObject({state:'complete',result:{delivery:{status:'submitted',providerMessageId:submitted.receipt.message.id}}});
  await expect(pool.query('SELECT agent_communications_bounce($1,$2,$3,$4,$5,$6,$7,$8)',[binding,eventId,input.receiptFingerprint,input.changeFingerprint,input.recipient,input.providerMessageId,input.occurredAt,input.receiptPreimage])).rejects.toThrow('Held current delivery-failure');
 });

 it.runIf(process.env.RUN_AGENT_RECEIPT_WAKE_LOCAL_INTEGRATION==='true')('queues one fresh association recovery after exhausted polling without resetting attempts or sending authority',async()=>{
  const {row,op,binding}=await prepared(),intent=await recordedIntent(op,row,binding,false),key='acquire:agent:'+op.id+':1',evidence='e'.repeat(64);
  const old=await store.enqueueEvent(thread,'fixture-old-reconcile:'+op.id,'email.reconcile',{operationId:op.id});
  const setup=await pool.connect();try{await setup.query('BEGIN');await setup.query("SET LOCAL session_replication_role='replica'");await setup.query("UPDATE agent_events SET state='done',attempts=6 WHERE id=$1",[old.id]);await setup.query('COMMIT');}finally{setup.release();}
  const wake=(c:PoolClient,hash=evidence,id=binding,payload='a'.repeat(64))=>c.query('SELECT agent_communications_receipt_wake($1,$2,$3,$4,$5) AS queued',[id,op.id,key,payload,hash]);
  expect((await admission(async c=>{const r=await wake(c);await c.query('COMMIT');return r;})).rows[0].queued).toBe(1);
  expect((await admission(c=>wake(c))).rows[0].queued).toBe(0);
  await expect(admission(c=>wake(c,'f'.repeat(64)))).rejects.toThrow('association wake changed');
  await expect(admission(c=>wake(c,evidence,randomUUID()))).rejects.toThrow('Original owned native intent');
  await expect(admission(c=>wake(c,evidence,binding,'b'.repeat(64)))).rejects.toThrow('Original owned native intent');
  const events=(await pool.query("SELECT kind,state,attempts,payload FROM agent_events WHERE thread_id=$1 AND event_key=$2",[thread,'provider-association:'+intent])).rows;expect(events).toEqual([{kind:'email.reconcile',state:'pending',attempts:0,payload:{operationId:op.id,intentId:intent,associationEvidenceDigest:evidence}}]);
  expect((await pool.query('SELECT state,attempts FROM agent_events WHERE id=$1',[old.id])).rows[0]).toEqual({state:'done',attempts:6});
  const claimed=await pool.connect();let savedEvent;try{await claimed.query('BEGIN');await claimed.query("SET LOCAL session_replication_role='replica'");savedEvent=(await claimed.query("UPDATE agent_events SET state='leased',lease_owner=$3,lease_until=clock_timestamp()+interval '60 seconds',fence=fence+1,attempts=1 WHERE thread_id=$1 AND event_key=$2 RETURNING *",[thread,'provider-association:'+intent,randomUUID()])).rows[0];await claimed.query('COMMIT');}finally{claimed.release();}
  const run=await store.beginEventRun(savedEvent);expect(run.kind).toBe('started');if(run.kind==='started'){let lookups=0;const handlers=createNativeAgentHandlers({store:store as never,reconcileProvider:async(t,id)=>{expect(t).toBe(thread);expect(id).toBe(op.id);lookups++;return {known:true};}}),outcome=await handlers['email.reconcile']({event:savedEvent,runId:run.runId,signal:new AbortController().signal,assertCurrent:async()=>{expect(await store.eventRunCurrent(run.runId,savedEvent)).toBe(true);}});expect(outcome).toEqual({kind:'complete'});expect(lookups).toBe(1);expect(await store.finishEventRun(run.runId,savedEvent,outcome)).toBe(true);}

  expect((await pool.query('SELECT state FROM agent_operations WHERE id=$1',[op.id])).rows[0].state).toBe('running');
  const second=await prepared();await recordedIntent(second.op,second.row,second.binding,false);
  await admission(c=>c.query('SELECT agent_communications_receipt_wake($1,$2,$3,$4,$5)',[second.binding,second.op.id,'acquire:agent:'+second.op.id+':1','a'.repeat(64),evidence]));
  expect((await pool.query("SELECT count(*)::int AS n FROM agent_events WHERE thread_id=$1 AND event_key LIKE 'provider-association:%' AND payload->>'operationId'=$2",[thread,second.op.id])).rows[0].n).toBe(0);
 });

 it.runIf(process.env.RUN_AGENT_NO_SUBMISSION_LOCAL_INTEGRATION==='true')('resumes person B while person A has a live run, preserving same-person and unattributed-run fences',async()=>{
  if(!(await store.listBudgetAccounts()).length)await limits();
  const {row,op}=await prepared(),a=(await store.openConversation(thread,randomUUID(),{contactId:await contact(randomUUID()+'@example.invalid'),deliveryMode:'local_sink'})).id;
  const fixture=async(work:(c:PoolClient)=>Promise<unknown>)=>{const c=await pool.connect();try{await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");await work(c);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}};
  await fixture(c=>c.query("UPDATE agent_operations SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[op.id]));
  const c=await pool.connect();try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_agent_user');await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[org,user]);await c.query('SELECT agent_lock_send_gate()');await c.query('SELECT agent_communications_no_submission($1,NULL,NULL)',[op.id]);await c.query('COMMIT');}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  await store.ingestHistory(thread,row.id,{source:'communications',observedAt:new Date().toISOString(),complete:true,messages:[]});
  const held=await store.conversation(thread,row.id),input={conversationId:held.id,revision:held.revision,epoch:Number(held.epoch),contextRevision:held.context_revision,reason:'Human reviewed original no-submission proof and fresh account history.'};
  const event=randomUUID(),run=randomUUID(),owner=randomUUID();
  await fixture(async c=>{await c.query("INSERT INTO agent_events(id,thread_id,organization_id,mandate_id,owner_user_id,event_key,kind,payload,payload_digest,state,lease_owner,lease_until,fence) VALUES($1::uuid,$2,$3,$4,$5,$1::text,'conversation.reassess',$6,$7,'leased',$8,clock_timestamp()+interval '60 seconds',1)",[event,thread,org,mandate,user,JSON.stringify({conversationId:row.id}),'a'.repeat(64),owner]);await c.query("INSERT INTO agent_runs(id,thread_id,organization_id,mandate_id,owner_user_id,trigger_event_id,state,lease_owner,lease_until,fence) VALUES($1,$2,$3,$4,$5,$6,'running',$7,clock_timestamp()+interval '60 seconds',1)",[run,thread,org,mandate,user,event,owner]);});
  const payload=async(value:unknown)=>fixture(c=>c.query('UPDATE agent_events SET payload=$2 WHERE id=$1',[event,JSON.stringify(value)]));
  await expect(store.resumeHeldConversation(thread,randomUUID(),input)).rejects.toThrow('background run');
  await fixture(c=>c.query("UPDATE agent_events SET kind='email.reconcile' WHERE id=$1",[event]));await payload({operationId:op.id});await expect(store.resumeHeldConversation(thread,randomUUID(),input)).rejects.toThrow('background run');
  await fixture(c=>c.query("UPDATE agent_events SET kind='conversation.reassess' WHERE id=$1",[event]));await payload({});await expect(store.resumeHeldConversation(thread,randomUUID(),input)).rejects.toThrow('background run');
  await payload({conversationId:randomUUID()});await expect(store.resumeHeldConversation(thread,randomUUID(),input)).rejects.toThrow('background run');
  await payload({conversationId:a});await fixture(c=>c.query("UPDATE agent_events SET kind='mandate.supervise' WHERE id=$1",[event]));await expect(store.resumeHeldConversation(thread,randomUUID(),input)).rejects.toThrow('background run');
  await fixture(c=>c.query("UPDATE agent_events SET kind='conversation.reassess' WHERE id=$1",[event]));expect(await store.resumeHeldConversation(thread,randomUUID(),input)).toMatchObject({id:row.id,status:'active'});
  expect((await pool.query('SELECT state,lease_owner FROM agent_runs WHERE id=$1',[run])).rows[0]).toEqual({state:'running',lease_owner:owner});
  expect((await pool.query("SELECT count(*)::int n FROM communication_dispatch_intents WHERE source_kind='agent' AND source_id=$1",[op.id])).rows[0].n).toBe(0);
  await fixture(c=>c.query("UPDATE agent_runs SET state='complete' WHERE id=$1",[run]));
 });

});
