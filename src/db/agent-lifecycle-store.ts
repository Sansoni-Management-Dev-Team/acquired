import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {AgentExecutionFence} from './agent-execution-store';
import {AgentExecutionStore} from './agent-execution-store';
import {agentRecordDigest as digest,type AgentThread} from './agent-store';
import {acceptAgentHistory,validateAgentWakeup,nextAgentEngagement} from '@/domain/agent-history';
import {explicitAgentOptOut,nativeHistorySchema,type NativeHistory} from '@/domain/agent-execution';
const uuid=z.string().uuid();
const expectedSchema=z.object({conversationId:uuid,revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const reminderCommand=expectedSchema.extend({reminder:z.unknown()}).strict();
const handoffCommand=expectedSchema.extend({reason:z.string().trim().min(1).max(2000),summary:z.string().trim().min(1).max(6000)}).strict();
/** Trusted execution adapter. Do not expose ingestHistory as a model or client
 * tool: provider history and completeness are facts obtained by the server. */
export class AgentLifecycleStore extends AgentExecutionStore{
 protected async lockConversation(c:PoolClient,t:AgentThread,id:string){
  const row=(await c.query('SELECT c.*,agent_context_revision(c.id) AS context_revision FROM agent_conversations c WHERE c.id=$1 AND c.thread_id=$2 FOR UPDATE',[uuid.parse(id),t.id])).rows[0];
  if(!row)throw new Error('Conversation not found');return row;
 }
 async ingestHistory(threadId:string,conversationId:string,raw:unknown){
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);return this.ingestNativeHistory(c,t,conversationId,raw);
  });
 }
 protected async ingestNativeHistory(c:PoolClient,t:AgentThread,conversationId:string,raw:unknown,options?:{allowPendingChannelHistory:boolean}){
   const old=await this.lockConversation(c,t,conversationId);
   const now=(await c.query('SELECT clock_timestamp() AS instant')).rows[0].instant.toISOString();
   const previous:NativeHistory|undefined=old.history_source==='unavailable'?undefined:{source:old.history_source,observedAt:old.history_observed_at.toISOString(),complete:old.history_complete,messages:old.history};
   const delivery=nativeHistorySchema.safeParse(raw);
   if(delivery.success&&delivery.data.deliveryFailures?.length){
    const evidence=delivery.data;
    if(old.delivery_mode!=='communications'||evidence.source!=='communications'||Date.parse(evidence.observedAt)>Date.parse(now)||evidence.deliveryFailures!.some(item=>Date.parse(item.at)>Date.parse(evidence.observedAt)))throw Error('Verified delivery-failure evidence required');
    if(old.pause_reason!=='delivery_failure'){
     const held=(await c.query("UPDATE agent_conversations SET phase='held',engagement='stopped',pause_reason='delivery_failure',pending_driver=NULL,history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=now() WHERE id=$1 RETURNING revision",[old.id])).rows[0];
     await this.invalidateNativeReviews(c,t,old.id);
     await this.revokePersonDelegations(c,t,old.id,old.recipient_email);
     await this.controlNotice(c,t,'delivery-failure:'+old.id,'The email provider reported a delivery failure. Outreach to this address is stopped. Review the recipient and original account; no follow-up or replacement send was created.',{conversationId:old.id,bindingId:old.binding_id,observedAt:evidence.observedAt,deliveryFailures:evidence.deliveryFailures});
     return {id:old.id as string,revision:held.revision as number,status:'held',historyAccepted:false};
    }
    return {id:old.id as string,revision:old.revision as number,status:'held',historyAccepted:false};
   }
   let next:NativeHistory;
   try{next=acceptAgentHistory(previous,raw,old.delivery_mode,now);}
   catch{
    // Commit the hold even on a conflicting/late provider snapshot. Keeping the
    // old history fresh would incorrectly leave an earlier approval usable.
    const held=(await c.query("UPDATE agent_conversations SET phase=CASE WHEN driver_kind='agent' AND phase='active' THEN 'held' ELSE phase END,pause_reason=CASE WHEN driver_kind='agent' AND phase='active' OR pause_reason IN('provider_receipt_pending_history','provider_outcome_unknown','channel_history_pending') THEN 'history_conflict' ELSE pause_reason END,history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=now() WHERE id=$1 RETURNING revision",[old.id])).rows[0];
    await this.invalidateNativeReviews(c,t,old.id);
    await this.controlNotice(c,t,'history-conflict:'+old.id+':'+held.revision,'Conversation history could not be verified. Automation is held for human review.',{conversationId:old.id});
    return {id:old.id as string,revision:held.revision as number,status:'held',historyAccepted:false};
   }
   if(next.source==='communications'&&next.complete){
    const submitted=(await c.query("SELECT result->'delivery'->>'providerMessageId' AS message_id,input->>'routeId' AS route_id,input->>'bindingDigest' AS binding_digest FROM agent_operations WHERE conversation_id=$1 AND thread_id=$2 AND state='complete' AND result->'delivery'->>'status'='submitted' AND result->'delivery'->>'effect' IS DISTINCT FROM 'invitation'",[old.id,t.id])).rows;
    if(submitted.some(item=>typeof item.message_id!=='string'||!next.messages.some(message=>(message.providerMessageId??message.id)===item.message_id&&message.direction==='outbound'&&(!item.route_id||message.routeId===item.route_id&&message.bindingDigest===item.binding_digest)))){
     // Provider submission may precede history visibility. Keep the saved
     // conversation incomplete until the original receipt is reflected.
     await c.query("UPDATE agent_conversations SET history_complete=false,pause_reason=CASE WHEN driver_kind='agent' AND phase='active' THEN 'provider_receipt_pending_history' ELSE pause_reason END,updated_at=now() WHERE id=$1",[old.id]);
     return {id:old.id as string,revision:old.revision as number,status:'provider_history_pending',historyAccepted:true};
    }
   }
   const historyRevision=digest(next.messages),changed=old.history_revision!==historyRevision||old.history_complete!==next.complete||old.history_source!==next.source;
   const optedOut=next.messages.some(m=>m.direction==='inbound'&&explicitAgentOptOut(m.text));
   let transportResumed=false;
   if(!optedOut&&next.complete&&next.source==='communications'&&old.delivery_mode==='communications'&&old.phase==='held'&&old.driver_kind==='agent'&&old.pause_reason==='provider_receipt_pending_history'&&!old.pending_driver&&!['handoff','stopped'].includes(old.engagement)){
    const proof=(await c.query(`SELECT EXISTS(SELECT 1 FROM agent_operations o JOIN agent_authority_uses u ON u.operation_id=o.id AND u.state='settled'
     JOIN communication_dispatch_intents i ON i.id=(o.result->'delivery'->>'intentId')::uuid AND i.source_kind='agent' AND i.source_id=o.id AND i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id
     JOIN communication_dispatch_permits p ON p.intent_id=i.id WHERE o.conversation_id=$1 AND o.thread_id=$2 AND o.state='complete' AND o.result->'delivery'->>'status'='submitted' AND o.result->'delivery'->>'effect' IS DISTINCT FROM 'invitation' AND o.id=(SELECT latest.id FROM agent_operations latest WHERE latest.conversation_id=$1 AND latest.thread_id=$2 AND latest.state='complete' AND latest.result->'delivery'->>'status'='submitted' ORDER BY latest.updated_at DESC,latest.id DESC LIMIT 1))
     AND EXISTS(SELECT 1 FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.id=$3 AND r.state IN('ready','waiting') AND r.mandate_revision=m.xmin::text)
     AND EXISTS(SELECT 1 FROM contacts WHERE id=$4 AND organization_id=$5 AND fictionalised=false AND coalesce(personal_data->>'doNotContact','false')='false')
     AND NOT EXISTS(SELECT 1 FROM suppressions WHERE organization_id=$5 AND (lower(address)=$6 OR lower(domain)=split_part($6,'@',2)))
     AND NOT EXISTS(SELECT 1 FROM communication_reply_review_latches WHERE organization_id=$5 AND resolved_at IS NULL)
     AND NOT EXISTS(SELECT 1 FROM agent_handoffs WHERE conversation_id=$1 AND state<>'dismissed')
     AND NOT EXISTS(SELECT 1 FROM campaign_reply_holds h WHERE h.organization_id=$5 AND agent_person_keys($5,h.contact_id)&&agent_person_keys($5,$4::uuid) AND (h.reason<>'reply_received' OR $7::timestamptz IS NULL OR h.received_at>$7::timestamptz))
     AND NOT EXISTS(SELECT 1 FROM campaign_contact_holds WHERE organization_id=$5 AND lower(email)=$6 AND (reason<>'reply_received' OR $7::timestamptz IS NULL))
     AND NOT agent_person_has_unresolved_sends($4::uuid,NULL::uuid) AS allowed`,[old.id,t.id,old.responsibility_id,old.contact_id,t.organization_id,old.recipient_email,next.messages.filter(m=>m.direction==='inbound').at(-1)?.at??null])).rows[0]?.allowed===true;
    const installed=(await c.query("SELECT to_regclass('public.agent_conversation_channels') IS NOT NULL AS installed")).rows[0]?.installed===true;
    const routes=installed?(await c.query('SELECT binding_id,history_complete,history_observed_at FROM agent_conversation_channels WHERE conversation_id=$1',[old.id])).rows:[];
    const covered=new Set([old.binding_id,...routes.filter(r=>r.history_complete&&r.history_observed_at&&Date.parse(r.history_observed_at)<=Date.parse(now)&&Date.parse(r.history_observed_at)>=Date.parse(now)-300000).map(r=>r.binding_id)]);
    transportResumed=proof&&routes.every(r=>r.history_complete&&r.history_observed_at&&Date.parse(r.history_observed_at)<=Date.parse(now)&&Date.parse(r.history_observed_at)>=Date.parse(now)-300000)&&old.coverage_bindings.every((r:{bindingId:string})=>covered.has(r.bindingId));
   }
   const status=optedOut?'complete':!next.complete?(options?.allowPendingChannelHistory?old.phase:'held'):transportResumed?'active':old.phase;
   const engagement=nextAgentEngagement(old.engagement,next.messages);
   const semantic=changed||old.phase!==status||old.engagement!==engagement;
   const row=(await c.query(`UPDATE agent_conversations SET history=$2,history_revision=$3,history_complete=$4,history_source=$5,history_observed_at=$6,
    engagement=$7,phase=$8,pause_reason=CASE WHEN $9 THEN 'opt_out' WHEN $11 THEN NULL WHEN pause_reason='delivery_failure' THEN pause_reason WHEN NOT $4 AND $12 AND driver_kind='agent' AND phase='active' THEN 'channel_history_pending' WHEN NOT $4 AND NOT $12 THEN 'history_incomplete' WHEN $4 AND pause_reason='channel_history_pending' THEN NULL ELSE pause_reason END,
    pending_driver=CASE WHEN $9 OR NOT $4 AND NOT $12 THEN NULL ELSE pending_driver END,
    revision=revision+$10,epoch=epoch+CASE WHEN $10=1 THEN 1 ELSE 0 END,
    reminder_generation=reminder_generation+CASE WHEN $10=1 THEN 1 ELSE 0 END,next_wakeup_at=CASE WHEN $10=1 THEN NULL ELSE next_wakeup_at END,updated_at=now()
    WHERE id=$1 RETURNING *`,[old.id,JSON.stringify(next.messages),historyRevision,next.complete,next.source,next.observedAt,engagement,status,optedOut,semantic?1:0,transportResumed,options?.allowPendingChannelHistory??false])).rows[0];
   if(semantic)await this.invalidateNativeReviews(c,t,old.id);
   if(transportResumed)await this.controlNotice(c,t,'provider-history-resumed:'+old.id+':'+row.revision,'The original submission is reconciled and its complete history is verified. The transport-only hold is cleared; future messages still require their own approval.',{conversationId:old.id,reason:'provider_receipt_pending_history'});
   if(optedOut){
    await this.revokePersonDelegations(c,t,old.id,old.recipient_email);
    // A durable stop on this conversation is immediate. Cross-runtime duplicate
    // claims fence this identity; the trusted provider ingress also owns its
    // existing organisation suppression/hold materialisation.
    if(old.engagement!=='stopped')await this.controlNotice(c,t,'opt-out:'+old.id+':'+row.revision,'The lead asked not to be contacted. This conversation is stopped and no reply was drafted.',{conversationId:old.id});
   }else if(changed&&row.phase==='active'&&row.driver_kind==='agent'&&row.history_complete)await this.emit(c,t,'history:'+old.id+':'+row.revision,'conversation.reassess',{conversationId:old.id,epoch:Number(row.epoch),reminderGeneration:row.reminder_generation});
   return {id:old.id as string,revision:row.revision as number,status:row.phase as string,historyAccepted:true};
 }
 async scheduleConversation(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence){
  const input=reminderCommand.parse(raw);
  return this.command(threadId,key,'conversation.remind',input,async(c,t,commandId)=>{
   const row=await this.lockConversation(c,t,input.conversationId);
   if(row.revision!==input.revision||row.context_revision!==input.contextRevision)throw new Error('Conversation changed; reassess before scheduling');
   if(row.phase!=='active'||row.driver_kind!=='agent'||['handoff','stopped'].includes(row.engagement))throw new Error('Agent does not own an active conversation');
   if(!(await c.query("SELECT 1 FROM agent_responsibilities WHERE id=$1 AND state IN('ready','waiting')",[row.responsibility_id])).rowCount)throw new Error('Agent supervision is paused');
   const now=(await c.query('SELECT clock_timestamp() AS instant')).rows[0].instant.toISOString(),reminder=validateAgentWakeup(input.reminder,now);
   const current=(await c.query('UPDATE agent_conversations SET next_wakeup_at=$2,time_zone=$3,wakeup_reason=$4,reminder_generation=reminder_generation+1,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',[row.id,reminder.wakeAt,reminder.timeZone,reminder.reason])).rows[0];
   await this.emit(c,t,'reminder:'+row.id+':'+current.reminder_generation,'conversation.reminder',{conversationId:row.id,epoch:Number(current.epoch),reminderGeneration:current.reminder_generation},reminder.wakeAt);
   await this.controlNotice(c,t,'reminder-notice:'+commandId,'I will reassess this conversation at the saved time. This reminder does not approve an email.',{conversationId:row.id,...reminder});
   return {id:row.id as string,revision:current.revision as number,status:'scheduled',epoch:Number(current.epoch)};
  },authority);
 }
 async handoffConversation(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence){
  const input=handoffCommand.parse(raw);
  return this.command(threadId,key,'conversation.handoff',input,async(c,t,commandId)=>{
   const row=await this.lockConversation(c,t,input.conversationId);
   if(row.revision!==input.revision||row.context_revision!==input.contextRevision)throw new Error('Conversation changed; reassess before handoff');
   if(row.phase!=='active'||row.driver_kind!=='agent'||!row.history_complete||!row.history.some((m:{direction:string})=>m.direction==='inbound'))throw new Error('A verified active conversation with a lead reply is required');
   await this.invalidateNativeReviews(c,t,row.id);
   const task=(await c.query(`INSERT INTO agent_handoffs(conversation_id,organization_id,mandate_id,owner_user_id,thread_id,assignee_user_id,source_history_revision,context)
    VALUES($1,$2,$3,$4,$5,$4,$6,$7) RETURNING id,revision`,[row.id,t.organization_id,t.mandate_id,t.owner_user_id,t.id,row.history_revision,JSON.stringify({reason:input.reason,summary:input.summary,contactId:row.contact_id,recipient:row.recipient_email,contextRevision:row.context_revision,bookingLinkSent:false})])).rows[0];
   await this.revokePersonDelegations(c,t,row.id,row.recipient_email);
   await c.query("UPDATE agent_conversations SET phase='paused',pause_reason='meeting_handoff',engagement='handoff',driver_kind='human',human_user_id=$2,sequence_enrolment_id=NULL,sequence_runtime=NULL,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=now() WHERE id=$1",[row.id,t.owner_user_id]);
   await this.controlNotice(c,t,'handoff-notice:'+commandId,'This lead is ready to discuss a call. Please review the conversation and send the booking link. Automated follow-ups are paused.',{taskId:task.id,...input});
   await this.emit(c,t,'handoff:'+task.id,'human.handoff_required',{taskId:task.id,conversationId:row.id,assigneeUserId:t.owner_user_id});
   return {id:task.id as string,revision:task.revision as number,status:'pending'};
  },authority);
 }
 async listHandoffs(threadId:string){
  return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId);return(await c.query('SELECT * FROM agent_handoffs WHERE thread_id=$1 ORDER BY created_at DESC,id LIMIT 100',[t.id])).rows;});
 }
}
