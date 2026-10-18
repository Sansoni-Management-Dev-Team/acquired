import {z} from 'zod';
import type {PoolClient} from 'pg';
import {AgentModelStore} from './agent-model-store';
import {agentRecordDigest as digest,type AgentThread} from './agent-store';
import {recordedAgentBindingDigest} from './agent-execution-store';
import {explicitAgentOptOut} from '@/domain/agent-execution';
import {outreachEmail} from '@/domain/outreach-contact';
import {agentDriverSchema,beginAgentHandover,commitAgentHandover,type AgentDriver,type AgentExecutionOwner} from '@/domain/agent-ownership';
const uuid=z.string().uuid(),positive=z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const expected=z.object({conversationId:uuid,revision:positive,contextRevision:z.string().regex(/^[a-f0-9]{64}$/),epoch:positive}).strict();
const beginSchema=expected.extend({target:agentDriverSchema,reason:z.string().trim().min(5).max(2000)}).strict();
export class AgentOwnershipStore extends AgentModelStore{
 async adoptSequenceConversation(threadId:string,key:string,raw:unknown){
  const input=z.object({enrolmentId:uuid,expectedVersionId:uuid}).strict().parse(raw);
  return this.command(threadId,key,'ownership.adopt_sequence',input,async(c,t,commandId)=>{
   const responsibility=(await c.query("SELECT * FROM agent_responsibilities WHERE thread_id=$1 AND state IN('ready','waiting') FOR UPDATE",[t.id])).rows[0];
   if(!responsibility)throw new Error('Start the reviewed mandate responsibility before requesting an agent handover');
   const source=(await c.query('SELECT agent_sequence_handover_source($1::uuid,$2::uuid) AS source',[t.id,input.enrolmentId])).rows[0].source;
   if(source.versionId!==input.expectedVersionId||!['active','paused','needs_review'].includes(source.state))throw new Error('Original sequence version or state changed');
   if(!source.bindingId||source.otherChannelBindings!==0)throw new Error('V1 handover requires the original recorded email-only service account; no backend or default account was substituted');
   if((await c.query('SELECT agent_legacy_sequence_conflicts($1::uuid,$2::uuid) AS conflicts',[source.contactId,input.enrolmentId])).rows[0]?.conflicts!==false)throw new Error('Another sequence owns this canonical identity');
   const contact=(await c.query('SELECT * FROM contacts WHERE id=$1 AND organization_id=$2',[source.contactId,t.organization_id])).rows[0];
   const email=outreachEmail(contact?.personal_data?.email);
   if(!contact||!email||email!==source.recipientEmail||contact.fictionalised!==false||contact.personal_data?.doNotContact===true)throw new Error('Review changed contact or recipient before handover');
   const binding=(await c.query("SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND channel='email' AND backend='unipile' AND authority='service'",[source.bindingId,t.organization_id,t.owner_user_id])).rows[0];
   if(!binding)throw new Error('Original owned email account unavailable');
   const row=(await c.query(`INSERT INTO agent_conversations(thread_id,organization_id,mandate_id,owner_user_id,responsibility_id,contact_id,delivery_mode,binding_id,binding_digest,recipient_email,driver_kind,sequence_enrolment_id,sequence_runtime,driver_generation,phase,history_revision,coverage_bindings)
    VALUES($1,$2,$3,$4,$5,$6,'communications',$7,$8,$9,'sequence',$10,$11,$12,'active',$13,$14) RETURNING id,revision,epoch::text`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,responsibility.id,source.contactId,binding.id,recordedAgentBindingDigest(binding),email,source.enrolmentId,source.runtime,source.generation,digest([]),JSON.stringify([{channel:'email',bindingId:binding.id,since:source.startedAt}])])).rows[0];
   const identities=(await c.query('SELECT agent_person_keys($1,$2::uuid) AS identities',[t.organization_id,source.contactId])).rows[0].identities as string[];
   for(const identity of identities)await c.query('INSERT INTO agent_person_claims(organization_id,identity_key,conversation_id,owner_user_id) VALUES($1,$2,$3,$4)',[t.organization_id,identity,row.id,t.owner_user_id]);
   await this.controlNotice(c,t,'sequence-adopt:'+commandId,'The original sequence account and published version are recorded. Its runtime still owns the conversation until an explicit reconciled handover.',{conversationId:row.id,enrolmentId:source.enrolmentId,versionId:source.versionId,runtime:source.runtime});
   return {id:row.id as string,revision:row.revision as number,status:'sequence_owned',epoch:Number(row.epoch)};
  });
 }
 private ownerSnapshot(row:Record<string,unknown>):AgentExecutionOwner{
  const driver=row.driver_kind==='sequence'?{kind:'sequence',enrolmentId:row.sequence_enrolment_id,runtime:row.sequence_runtime,generation:row.driver_generation}:row.driver_kind==='human'?{kind:'human',userId:row.human_user_id}:{kind:'agent',responsibilityId:row.responsibility_id};
  return {driver:agentDriverSchema.parse(driver),epoch:positive.parse(row.epoch),revision:positive.parse(row.revision),status:z.enum(['active','paused','quiescing','held','complete']).parse(row.phase),contextRevision:z.string().regex(/^[a-f0-9]{64}$/).parse(row.context_revision),retiredSequenceIds:z.array(uuid).parse(row.retired_enrolments),...(row.pending_driver?{pendingDriver:agentDriverSchema.parse(row.pending_driver)}:{})};
 }
 private async validateDriverTarget(c:PoolClient,t:AgentThread,row:Record<string,unknown>,driver:AgentDriver){
  if(driver.kind==='human'){
   if(driver.userId!==t.owner_user_id)throw new Error('This account can only be taken over by its authenticated owner');
  }else if(driver.kind==='agent'){
   if(driver.responsibilityId!==row.responsibility_id||!(await c.query("SELECT 1 FROM agent_responsibilities WHERE id=$1 AND thread_id=$2 AND state IN('ready','waiting')",[driver.responsibilityId,t.id])).rowCount)throw new Error('Current active agent responsibility required');
   if(row.engagement==='handoff'&&(await c.query("SELECT 1 FROM agent_handoffs WHERE conversation_id=$1 AND state IN('pending','acknowledged','link_sent','meeting_confirmed')",[row.id])).rowCount)throw new Error('Resolve the human booking handoff before resuming automation');
  }else{
   if(row.delivery_mode!=='communications')throw new Error('A local simulation cannot switch to a real sequence delivery account');
   const matches=(await c.query('SELECT agent_sequence_driver_matches($1::uuid,$2::uuid,$3,$4::integer) AS matches',[row.id,driver.enrolmentId,driver.runtime,driver.generation])).rows[0]?.matches;
   if(matches!==true)throw new Error('Fresh sequence enrolment must retain the same recorded account and version');
  }
 }
 private async heldReconciledEmail(c:PoolClient,t:AgentThread,input:z.infer<typeof expected>){
  const row=await this.lockConversation(c,t,input.conversationId);
  if(row.revision!==input.revision||Number(row.epoch)!==input.epoch||row.context_revision!==input.contextRevision)throw Error('Conversation changed; refresh before resuming');
  if(row.driver_kind!=='agent'||row.phase!=='held'||row.pending_driver||!['provider_no_submission_confirmed','provider_receipt_pending_history'].includes(row.pause_reason)||['stopped','handoff'].includes(row.engagement))throw Error('Only a reconciled held agent conversation can resume');
  const routedProof=await this.heldRoutedReconciliation(c,t,row);if(routedProof)return {row,proof:routedProof};
  const proof=(await c.query("SELECT o.* FROM agent_operations o WHERE o.conversation_id=$1 AND o.thread_id=$2 AND o.name IN('email.initial','email.reply','email.follow_up') AND ((o.state='failed' AND o.result->'delivery'->>'status'='not_submitted' AND EXISTS(SELECT 1 FROM agent_authority_uses u WHERE u.operation_id=o.id AND u.state='released') AND (SELECT count(*) FROM agent_budget_reservations r WHERE r.operation_id=o.id AND r.state='settled' AND r.actual=0)=3) OR (o.state='complete' AND o.result->'delivery'->>'status'='submitted' AND EXISTS(SELECT 1 FROM agent_authority_uses u WHERE u.operation_id=o.id AND u.state='settled') AND (SELECT count(*) FROM agent_budget_reservations r WHERE r.operation_id=o.id AND r.state='settled' AND r.actual=1)=3)) ORDER BY o.updated_at DESC,o.id DESC LIMIT 1",[row.id,t.id])).rows[0];
  if(!proof)throw Error('Recorded original email reconciliation is required');
  const delivery=proof.result.delivery;
  if(delivery.status==='submitted'){if(!(await c.query("SELECT 1 FROM communication_dispatch_intents i JOIN communication_dispatch_permits p ON p.intent_id=i.id WHERE i.id=$1 AND i.source_kind='agent' AND i.source_id=$2 AND i.binding_id=$3",[delivery.intentId,proof.id,row.binding_id])).rowCount)throw Error('Original admitted delivery receipt unavailable');}
  else if(delivery.intentId){if(!(await c.query("SELECT 1 FROM communication_dispatch_intents i JOIN communication_intent_resolutions r ON r.intent_id=i.id WHERE i.id=$1 AND i.source_kind='agent' AND i.source_id=$2 AND i.binding_id=$3 AND r.proof_digest=$4",[delivery.intentId,proof.id,row.binding_id,delivery.proofDigest])).rowCount)throw Error('Original no-submission disposition unavailable');}
  else if(delivery.reason!=='expired_without_application_intent'||(await c.query("SELECT 1 FROM communication_dispatch_intents WHERE source_kind='agent' AND source_id=$1",[proof.id])).rowCount)throw Error('Original unprepared-operation proof unavailable');
  return {row,proof};
 }
 protected async heldRoutedReconciliation(_c:PoolClient,_t:AgentThread,_row:Record<string,unknown>):Promise<Record<string,unknown>|null>{void _c;void _t;void _row;return null;}
 protected async assertRoutedResumeHistory(_c:PoolClient,_t:AgentThread,_row:Record<string,unknown>,_proof:Record<string,unknown>):Promise<void>{void _c;void _t;void _row;void _proof;throw Error('Recorded route recovery unavailable');}
 protected async assertConversationReviewHistory(c:PoolClient,t:AgentThread,row:Record<string,unknown>){
  const now=(await c.query('SELECT clock_timestamp() AS instant')).rows[0].instant as Date,observed=row.history_observed_at as Date|null;
  if(!row.history_complete||!observed||observed>now||now.getTime()-observed.getTime()>300000||row.history_source!==(row.delivery_mode==='communications'?'communications':'local_fixture'))throw Error('Refresh complete recorded history before requesting reassessment');
  if((row.history as {direction:string;text:string}[]).some(m=>m.direction==='inbound'&&explicitAgentOptOut(m.text)))throw Error('An opted-out person cannot be reassessed for outreach');
  const contact=(await c.query('SELECT * FROM contacts WHERE id=$1 AND organization_id=$2',[row.contact_id,t.organization_id])).rows[0];
  if(!contact||contact.fictionalised!==false||(contact.personal_data?.doNotContact??false)!==false||outreachEmail(contact.personal_data?.email)!==row.recipient_email)throw Error('Current contact identity is unavailable');
  if(row.delivery_mode==='communications'){
   const binding=(await c.query('SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',[row.binding_id,t.organization_id,t.owner_user_id])).rows[0];
   if(!binding||binding.channel!=='email'||binding.authority!=='service'||binding.backend!=='unipile'||recordedAgentBindingDigest(binding)!==row.binding_digest||(row.coverage_bindings as {bindingId:string}[]).some(r=>r.bindingId!==binding.id))throw Error('Original recorded history account coverage changed');
  }
 }
 private async reviewableConversation(c:PoolClient,t:AgentThread,input:z.infer<typeof expected>,historyOnly=false){
  const row=await this.lockConversation(c,t,input.conversationId);
  if(row.revision!==input.revision||Number(row.epoch)!==input.epoch||row.context_revision!==input.contextRevision)throw Error('Conversation changed; review its current state first');
  if(row.driver_kind!=='agent'||row.pending_driver||!(row.phase==='active'||row.phase==='held'&&row.pause_reason==='human_review_required')||['stopped','handoff'].includes(row.engagement))throw Error('Only an active agent conversation or a human-review agent hold can be reviewed');
  if(!(await c.query("SELECT 1 FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=$1 AND r.thread_id=$2 AND r.state IN('ready','waiting') AND r.mandate_revision=m.xmin::text",[row.responsibility_id,t.id])).rowCount)throw Error('Review and start the current mandate responsibility first');
  if((await c.query(`SELECT 1 FROM agent_runs r
    LEFT JOIN agent_events e ON e.id=r.trigger_event_id AND e.thread_id=r.thread_id
    LEFT JOIN agent_conversations target ON target.id::text=e.payload->>'conversationId' AND target.thread_id=r.thread_id AND e.kind IN('conversation.reassess','conversation.reminder','conversation.history_changed','channel.due')
    LEFT JOIN agent_operations operation ON operation.id::text=e.payload->>'operationId' AND operation.thread_id=r.thread_id AND e.kind IN('email.proposed','email.reconcile','whatsapp.proposed','whatsapp.reconcile','linkedin.proposed','linkedin.reconcile')
    WHERE r.thread_id=$1 AND r.state='running' AND (r.lease_until IS NULL OR r.lease_until>clock_timestamp())
    AND (target.id=$2::uuid OR operation.conversation_id=$2::uuid OR (target.id IS NULL AND operation.conversation_id IS NULL)) LIMIT 1`,[t.id,row.id])).rowCount)throw Error('Finish the current person or mandate background work before reviewing');
  const latest=(row.history as {direction:string;at:string}[]).filter(m=>m.direction==='inbound').map(m=>Date.parse(m.at)).sort((a,b)=>b-a)[0];
  const blocked=(await c.query("SELECT public.agent_person_has_unresolved_sends($1::uuid,NULL::uuid) OR public.agent_legacy_sequence_occupied($1::uuid) OR EXISTS(SELECT 1 FROM agent_operations WHERE conversation_id=$2 AND state IN('running','uncertain')) OR EXISTS(SELECT 1 FROM agent_handoffs WHERE conversation_id=$2 AND state<>'dismissed') OR EXISTS(SELECT 1 FROM communication_reply_review_latches WHERE organization_id=$3 AND resolved_at IS NULL) OR EXISTS(SELECT 1 FROM suppressions WHERE organization_id=$3 AND (lower(address)=lower($4) OR lower(domain)=split_part(lower($4),'@',2))) OR EXISTS(SELECT 1 FROM campaign_reply_holds h WHERE h.organization_id=$3 AND public.agent_person_keys($3,h.contact_id)&&public.agent_person_keys($3,$1::uuid) AND (h.reason<>'reply_received' OR $5::timestamptz IS NULL OR h.received_at>$5::timestamptz)) OR EXISTS(SELECT 1 FROM campaign_contact_holds WHERE organization_id=$3 AND lower(email)=lower($4) AND (reason<>'reply_received' OR $5::timestamptz IS NULL)) AS blocked",[row.contact_id,row.id,t.organization_id,row.recipient_email,Number.isFinite(latest)?new Date(latest).toISOString():null])).rows[0]?.blocked;
  let historyReadClear=false;
  if(blocked===true&&historyOnly){
   const ready=(await c.query("SELECT to_regprocedure('public.agent_review_history_holds_clear(uuid)') IS NOT NULL AS installed")).rows[0]?.installed;
   if(ready===true)historyReadClear=(await c.query('SELECT public.agent_review_history_holds_clear($1::uuid) AS clear',[row.id])).rows[0]?.clear===true;
  }
  if(blocked!==false&&!historyReadClear)throw Error('Resolve current unknown outcomes, ownership, suppression or channel review before reassessment');
  return row;
 }
 async requestConversationReviewHistory(threadId:string,key:string,raw:unknown){
  const input=expected.parse(raw);return this.command(threadId,key,'conversation.review_history',input,async(c,t,commandId)=>{
   const row=await this.reviewableConversation(c,t,input,true);await this.invalidateNativeReviews(c,t,row.id);await this.revokePersonDelegations(c,t,row.id,row.recipient_email);
   const updated=(await c.query("UPDATE agent_conversations SET phase='held',pause_reason='human_review_required',history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision,epoch",[row.id])).rows[0];
   await this.emit(c,t,'review-history:'+commandId,'conversation.history_changed',{conversationId:row.id});await this.controlNotice(c,t,'review-history:'+commandId,'You requested fresh history from every recorded account. Automation remains held for your separate reassessment decision; old drafts and sending permissions were invalidated.',{conversationId:row.id});return{id:row.id as string,revision:updated.revision as number,status:'history_requested',epoch:Number(updated.epoch)};
  });
 }
 async reassessConversationAfterReview(threadId:string,key:string,raw:unknown){
  const input=expected.extend({reason:z.string().trim().min(5).max(2000)}).strict().parse(raw);return this.command(threadId,key,'conversation.review_reassess',input,async(c,t,commandId)=>{
   const row=await this.reviewableConversation(c,t,input);await this.assertConversationReviewHistory(c,t,row);await this.invalidateNativeReviews(c,t,row.id);await this.revokePersonDelegations(c,t,row.id,row.recipient_email);
   const updated=(await c.query("UPDATE agent_conversations SET phase='active',pause_reason=NULL,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision,epoch,reminder_generation",[row.id])).rows[0];
   await this.emit(c,t,'review-reassess:'+commandId,'conversation.reassess',{conversationId:row.id,epoch:Number(updated.epoch),reminderGeneration:updated.reminder_generation});await this.controlNotice(c,t,'review-reassess:'+commandId,'You reviewed the current complete history and requested a fresh assessment. Any new message requires new approval; no previous send or approval was retried.',{conversationId:row.id,reason:input.reason});return{id:row.id as string,revision:updated.revision as number,status:'reassessment_requested',epoch:Number(updated.epoch)};
  });
 }
 async requestHeldHistoryRefresh(threadId:string,key:string,raw:unknown){
  const input=expected.parse(raw);return this.command(threadId,key,'conversation.refresh_held',input,async(c,t,commandId)=>{
   const {row}=await this.heldReconciledEmail(c,t,input);await this.emit(c,t,'held-history:'+commandId,'conversation.history_changed',{conversationId:row.id});
   await this.controlNotice(c,t,'held-history:'+commandId,'A fresh recorded-account history check was requested. Automation remains held.',{conversationId:row.id});return {id:row.id as string,revision:row.revision as number,status:'history_requested',epoch:Number(row.epoch)};
  });
 }
 async resumeHeldConversation(threadId:string,key:string,raw:unknown){
  const input=expected.extend({reason:z.string().trim().min(5).max(2000)}).strict().parse(raw);
  return this.command(threadId,key,'conversation.resume_held',input,async(c,t,commandId)=>{
   const {row,proof}=await this.heldReconciledEmail(c,t,input);
   const active=(await c.query("SELECT r.id FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=$1 AND r.thread_id=$2 AND r.state IN('ready','waiting') AND r.mandate_revision=m.xmin::text",[row.responsibility_id,t.id])).rowCount;if(!active)throw Error('Review and start the current mandate responsibility first');
   // A person-scoped run fences that person; mandate-wide or unattributed work
   // remains conservative. Another verified person may continue independently.
   if((await c.query(`SELECT 1 FROM agent_runs r
    LEFT JOIN agent_events e ON e.id=r.trigger_event_id AND e.thread_id=r.thread_id
    LEFT JOIN agent_conversations target ON target.id::text=e.payload->>'conversationId' AND target.thread_id=r.thread_id AND e.kind IN('conversation.reassess','conversation.reminder','conversation.history_changed','channel.due')
    LEFT JOIN agent_operations operation ON operation.id::text=e.payload->>'operationId' AND operation.thread_id=r.thread_id AND e.kind IN('email.proposed','email.reconcile','whatsapp.proposed','whatsapp.reconcile','linkedin.proposed','linkedin.reconcile')
    WHERE r.thread_id=$1 AND r.state='running' AND (r.lease_until IS NULL OR r.lease_until>clock_timestamp())
    AND (target.id=$2::uuid OR operation.conversation_id=$2::uuid OR (target.id IS NULL AND operation.conversation_id IS NULL)) LIMIT 1`,[t.id,row.id])).rowCount)throw Error('Finish or reconcile the current background run before resuming');
   const now=(await c.query('SELECT clock_timestamp() AS instant')).rows[0].instant as Date,observed=row.history_observed_at as Date|null;
   if(row.delivery_mode!=='communications'||row.history_source!=='communications'||!row.history_complete||!observed||observed>now||now.getTime()-observed.getTime()>300000||observed<proof.updated_at)throw Error('Refresh verified complete history after reconciliation before resuming');
   if(!Object.hasOwn(proof.input??{},'routeId')&&proof.result.delivery.status==='submitted'&&!row.history.some((message:{id:string;direction:string})=>message.id===proof.result.delivery.providerMessageId&&message.direction==='outbound'))throw Error('Verify original provider message reflection before resuming');
   if(row.history.some((message:{direction:string;text:string})=>message.direction==='inbound'&&explicitAgentOptOut(message.text)))throw Error('An opted-out conversation cannot resume');
   if(Object.hasOwn(proof.input??{},'routeId'))await this.assertRoutedResumeHistory(c,t,row,proof);else{
   const contact=(await c.query('SELECT * FROM contacts WHERE id=$1 AND organization_id=$2',[row.contact_id,t.organization_id])).rows[0],binding=(await c.query('SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',[row.binding_id,t.organization_id,t.owner_user_id])).rows[0];
   if(!contact||contact.fictionalised!==false||(contact.personal_data?.doNotContact??false)!==false||outreachEmail(contact.personal_data?.email)!==row.recipient_email||!binding||binding.channel!=='email'||binding.authority!=='service'||binding.backend!=='unipile'||recordedAgentBindingDigest(binding)!==row.binding_digest)throw Error('Original contact or account changed');
   if((await c.query('SELECT agent_person_has_unresolved_sends($1::uuid,NULL::uuid) AS unresolved',[row.contact_id])).rows[0]?.unresolved!==false||(await c.query('SELECT agent_legacy_sequence_occupied($1::uuid) AS occupied',[row.contact_id])).rows[0]?.occupied!==false||(await c.query('SELECT agent_history_accounts_clear($1::uuid) AS clear',[proof.id])).rows[0]?.clear!==true)throw Error('Reconcile all recorded accounts and outstanding sends before resuming');
   }
   const latest=row.history.filter((m:{direction:string})=>m.direction==='inbound').map((m:{at:string})=>Date.parse(m.at)).sort((a:number,b:number)=>b-a)[0];
   const blocked=(await c.query("SELECT EXISTS(SELECT 1 FROM suppressions WHERE organization_id=$1 AND (lower(address)=$2 OR lower(domain)=split_part($2,'@',2))) OR EXISTS(SELECT 1 FROM communication_reply_review_latches WHERE organization_id=$1 AND resolved_at IS NULL) OR EXISTS(SELECT 1 FROM campaign_reply_holds h WHERE h.organization_id=$1 AND agent_person_keys($1,h.contact_id)&&agent_person_keys($1,$3::uuid) AND (h.reason<>'reply_received' OR $4::timestamptz IS NULL OR h.received_at>$4::timestamptz)) OR EXISTS(SELECT 1 FROM campaign_contact_holds WHERE organization_id=$1 AND lower(email)=$2 AND (reason<>'reply_received' OR $4::timestamptz IS NULL)) OR EXISTS(SELECT 1 FROM agent_handoffs WHERE conversation_id=$5 AND state<>'dismissed') AS blocked",[t.organization_id,row.recipient_email,row.contact_id,Number.isFinite(latest)?new Date(latest).toISOString():null,row.id])).rows[0]?.blocked;
   if(blocked!==false)throw Error('Resolve the current suppression, reply review or human handoff first');
   await this.invalidateNativeReviews(c,t,row.id);await this.revokePersonDelegations(c,t,row.id,row.recipient_email);
   const updated=(await c.query("UPDATE agent_conversations SET phase='active',pause_reason=NULL,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision,epoch,reminder_generation",[row.id])).rows[0];
   await this.controlNotice(c,t,'held-resumed:'+commandId,'You resumed this reconciled conversation with fresh verified history. Previous approvals and delegated permissions remain revoked; any new draft needs fresh authority.',{conversationId:row.id,reason:input.reason});await this.emit(c,t,'held-reassess:'+commandId,'conversation.reassess',{conversationId:row.id,epoch:Number(updated.epoch),reminderGeneration:updated.reminder_generation});return {id:row.id as string,revision:updated.revision as number,status:'active',epoch:Number(updated.epoch)};
  });
 }
 async beginConversationHandover(threadId:string,key:string,raw:unknown){
  const input=beginSchema.parse(raw);
  return this.command(threadId,key,'ownership.begin',input,async(c,t,commandId)=>{
   const row=await this.lockConversation(c,t,input.conversationId);
   if(row.driver_kind==='agent'&&input.target.kind==='agent')throw new Error('The agent already owns this conversation; use the explicit resume control for a reconciled hold');
   if(row.engagement==='stopped'||row.phase==='complete')throw new Error('A stopped conversation cannot be silently reactivated');
   await this.validateDriverTarget(c,t,row,input.target);
   const next=beginAgentHandover(this.ownerSnapshot(row),input.target,{epoch:input.epoch,revision:input.revision,contextRevision:input.contextRevision});
   await c.query("UPDATE agent_conversations SET phase='quiescing',pending_driver=$2,retired_enrolments=$3::uuid[],epoch=$4::bigint,revision=$5,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,pause_reason='ownership_handover',updated_at=now() WHERE id=$1",[row.id,JSON.stringify(next.pendingDriver),next.retiredSequenceIds,next.epoch,next.revision]);
   await this.invalidateNativeReviews(c,t,row.id);
   await this.revokePersonDelegations(c,t,row.id,row.recipient_email);
   await this.controlNotice(c,t,'ownership-begin:'+commandId,'Conversation handover is pending. New automated sends are fenced while the previous driver and any uncertain sends are reconciled.',{conversationId:row.id,target:input.target,reason:input.reason});
   return {id:row.id as string,revision:next.revision,status:'quiescing',epoch:next.epoch};
  });
 }
 async commitConversationHandover(threadId:string,key:string,raw:unknown){
  const input=expected.parse(raw);
  return this.command(threadId,key,'ownership.commit',input,async(c,t,commandId)=>{
   const row=await this.lockConversation(c,t,input.conversationId),current=this.ownerSnapshot(row);
   if(current.revision!==input.revision||current.contextRevision!==input.contextRevision||current.epoch!==input.epoch||!current.pendingDriver)throw new Error('Handover changed; refresh before committing');
   await this.validateDriverTarget(c,t,row,current.pendingDriver);
   let quiesced=true;
   if(current.driver.kind==='sequence'){
    const previous=(await c.query('SELECT state FROM campaign_enrolments WHERE id=$1',[current.driver.enrolmentId])).rows[0];quiesced=!!previous&&['stopped','completed'].includes(previous.state);
   }
   const unresolved=(await c.query('SELECT agent_person_has_unresolved_sends($1::uuid,NULL::uuid) AS unresolved',[row.contact_id])).rows[0]?.unresolved;
   const conflicts=current.pendingDriver.kind==='sequence'?(await c.query('SELECT agent_legacy_sequence_conflicts($1::uuid,$2::uuid) AS conflicts',[row.contact_id,current.pendingDriver.enrolmentId])).rows[0]?.conflicts:(await c.query('SELECT agent_legacy_sequence_occupied($1::uuid) AS occupied',[row.contact_id])).rows[0]?.occupied;
   if(conflicts!==false)throw new Error('Another sequence still owns a canonical contact identity');
   const next=commitAgentHandover(current,input.epoch,{unknownSends:unresolved===false?0:1,inFlightSends:unresolved===false?0:1,previousDriverQuiesced:quiesced});
   const target=next.driver;
   const updated=(await c.query(`UPDATE agent_conversations SET driver_kind=$2,sequence_enrolment_id=$3,sequence_runtime=$4,driver_generation=$5,human_user_id=$6,
    phase='active',pending_driver=NULL,pause_reason=NULL,epoch=$7::bigint,revision=$8,engagement=CASE WHEN engagement='handoff' AND $2='agent' THEN 'engaged' ELSE engagement END,updated_at=now() WHERE id=$1 RETURNING reminder_generation`,[row.id,target.kind,target.kind==='sequence'?target.enrolmentId:null,target.kind==='sequence'?target.runtime:null,target.kind==='sequence'?target.generation:1,target.kind==='human'?target.userId:null,next.epoch,next.revision])).rows[0];
   if(target.kind==='agent')await this.emit(c,t,'handover-reassess:'+commandId,'conversation.reassess',{conversationId:row.id,epoch:next.epoch,reminderGeneration:updated.reminder_generation});
   await this.controlNotice(c,t,'ownership-commit:'+commandId,target.kind==='human'?'You now own this conversation. Automated prospect messages are paused.':'Conversation ownership changed after reconciliation. Existing sequence versions and retired callbacks remain fenced.',{conversationId:row.id,target,epoch:next.epoch});
   await this.emit(c,t,'ownership:'+commandId,'ownership.changed',{conversationId:row.id,target,epoch:next.epoch});
   return {id:row.id as string,revision:next.revision,status:'active',epoch:next.epoch};
  });
 }
}
