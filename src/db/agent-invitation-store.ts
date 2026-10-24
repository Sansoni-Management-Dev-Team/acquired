import {agentNativeDispatchSqlNames} from './agent-operation-sql';
import{z}from'zod';
import type{PoolClient}from'pg';
import{AgentChannelStore}from'./agent-channel-store';
import {projectAgentInvitationExecutionProgress} from './agent-execution-progress';
import {projectAgentInvitationDecisionContext} from './agent-channel-decision-context';
import{type AgentThread}from'./agent-store';
import type{AgentExecutionFence}from'./agent-execution-store';
import{agentChannelRelationshipSchema,type AgentInvitationDelivery}from'@/domain/agent-invitation';
import{assertSameBinding,type ConnectionBinding,type DeliveryOutcome}from'../../communications/packages/contracts/src';
const uuid=z.string().uuid();
/** Invitation actions are distinct from sent messages and always require HIL. */
export class AgentInvitationStore extends AgentChannelStore{
 async activitySnapshot(threadId:string,includeGuidance:boolean){
  return this.readBundle(async()=>({
   records:await this.messages(threadId),
   batches:await this.listReviewBatches(threadId,{pendingOnly:true}),
   guidance:includeGuidance?await this.listGuidance(threadId):[],
  }));
 }
 /** Fixed database-only projections share one ownership gate. No provider calls,
  * account mutations, drafts, sends or authorization caches are allowed here. */
 async controlsSnapshot(mandateId:string,threadId?:string){
  return this.readBundle(async()=>({
   state:threadId?await this.executionState(threadId):null,
   inbox:await this.handoffInbox(mandateId),
   grants:threadId?await this.listAuthorityGrants(threadId):[],
   targetOptions:await this.targetDeliveryOptions(mandateId),
  }));
 }

 protected override async assertInvitationResumeHistory(c:PoolClient,t:AgentThread,row:Record<string,unknown>,proof:Record<string,unknown>){
  const input=z.object({routeId:uuid,bindingDigest:z.string().regex(/^[a-f0-9]{64}$/)}).passthrough().parse(proof.input),result=z.object({delivery:z.object({status:z.enum(['submitted','not_submitted']),effect:z.literal('invitation').optional(),providerOperationId:z.string().optional(),intentId:z.string().optional()}).passthrough()}).passthrough().parse(proof.result);
  const positive=result.delivery.status==='submitted';if(positive&&(result.delivery.effect!=='invitation'||!result.delivery.providerOperationId||!result.delivery.intentId))throw Error('Original invitation action receipt required');
  const anchor=this.reconciliationBusinessAnchor(proof);
  const allowed=(await c.query(`SELECT EXISTS(SELECT 1 FROM agent_linkedin_relationships x JOIN agent_conversation_channels r ON r.id=x.route_id WHERE r.id=$1 AND r.conversation_id=$2 AND r.thread_id=$3 AND r.organization_id=$4 AND r.owner_user_id=$5 AND r.channel='linkedin' AND r.binding_digest=$6 AND x.binding_digest=r.binding_digest AND x.identity_revision=r.identity_revision AND x.observed_at<=${this.businessSql()} AND x.observed_at>=${this.businessSql()}-interval '5 minutes' AND x.observed_at>=$7::timestamptz AND x.status<>'unknown' AND (NOT $8 OR x.status IN('connected','invitation_pending')) AND (NOT $8 OR EXISTS(SELECT 1 FROM agent_linkedin_invitations i WHERE i.operation_id=$9::uuid AND i.route_id=r.id AND i.binding_digest=r.binding_digest AND i.identity_revision=r.identity_revision AND i.state IN('pending','accepted') AND i.provider_operation_id=$10 AND i.intent_id::text=$11))) AS allowed`,[input.routeId,row.id,t.id,t.organization_id,t.owner_user_id,input.bindingDigest,anchor,positive,proof.id,result.delivery.providerOperationId??null,result.delivery.intentId??null])).rows[0]?.allowed;
  if(allowed!==true)throw Error('Refresh the exact verified LinkedIn relationship after original reconciliation before resuming');
 }
 protected override async invalidateNativeReviews(c:PoolClient,t:AgentThread,conversationId:string){
  await super.invalidateNativeReviews(c,t,conversationId);
  const ids=(await c.query("UPDATE agent_operations SET state='failed',result=jsonb_build_object('reason','context_changed'),updated_at=clock_timestamp() WHERE thread_id=$1 AND conversation_id=$2 AND name='linkedin.invitation' AND state IN('proposed','approved') RETURNING id",[t.id,conversationId])).rows.map(r=>r.id);
  if(ids.length)await c.query("UPDATE agent_review_batches b SET state='invalidated' WHERE b.thread_id=$1 AND b.state='pending' AND EXISTS(SELECT 1 FROM jsonb_array_elements(b.manifest) item WHERE item->>'operationId'=ANY($2::text[]))",[t.id,ids]);
 }
 protected override async executionChannelProgress<T extends Record<string,unknown>>(c:PoolClient,t:AgentThread,conversations:T[]):Promise<T[]>{
  const people=await super.executionChannelProgress(c,t,conversations);
  return projectAgentInvitationExecutionProgress(c,t,people);
 }
 async ingestChannelRelationship(threadId:string,conversationId:string,routeId:string,raw:unknown){
  const observation=agentChannelRelationshipSchema.parse(raw);uuid.parse(routeId);
  return this.nativeTransaction(async c=>{const t=await this.lockThread(c,threadId),row=await this.lockConversation(c,t,conversationId),route=(await this.channelRows(c,t,row.id)).find(r=>r.id===routeId);
   if(!route||route.channel!=='linkedin')throw Error('Exact owned LinkedIn route required');
   const result=(await c.query('SELECT public.agent_ingest_channel_relationship($1::uuid,$2,$3,$4,$5::boolean,$6::timestamptz) AS result',[route.id,route.bindingDigest,route.identityRevision,observation.status,observation.canMessage,observation.observedAt])).rows[0].result;
   return {revision:result.revision as number,changed:result.changed===true};
  });
 }
 protected override async nativeChannelDecisionContext(c:PoolClient,t:AgentThread,row:Record<string,unknown>){
  const base=await super.nativeChannelDecisionContext(c,t,row);
  return projectAgentInvitationDecisionContext(c,t,row,base);
 }
 override async proposeNativeMessage(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence,options?:{forceHumanReview?:boolean}){
  const invite=raw!==null&&typeof raw==='object'&&(raw as {draft?:{kind?:unknown}}).draft?.kind==='invitation_linkedin';
  const result=await super.proposeNativeMessage(threadId,key,raw,authority,invite?{forceHumanReview:true}:options);
  if(invite)await this.nativeTransaction(async c=>{const t=await this.thread(c,threadId);await this.emit(c,t,'invitation-proposed:'+result.id,'linkedin.invitation_proposed',{operationId:result.id,reviewBatchId:result.reviewBatchId});});
  return result;
 }
 override async pendingNativeEmail(threadId:string,conversationId:string,contextRevision:string){return this.nativeTransaction(async c=>{
  const t=await this.thread(c,threadId);await this.lockConversation(c,t,conversationId);
  return !!(await c.query(`SELECT id FROM agent_operations WHERE thread_id=$1 AND conversation_id=$2 AND name IN(${agentNativeDispatchSqlNames}) AND input->>'contextRevision'=$3 AND state IN('proposed','approved','running','uncertain') AND (state<>'proposed' OR EXISTS(SELECT 1 FROM agent_review_batches b WHERE b.thread_id=$1 AND b.state='pending' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',agent_operations.id)))) LIMIT 1`,[t.id,conversationId,contextRevision])).rowCount;
 });}
 override async channelDispatchRecord(threadId:string,operationId:string,options:{includeOriginalAccount?:boolean}={}){
  const invitation=await this.nativeTransaction(async c=>{const t=await this.thread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='linkedin.invitation'",[uuid.parse(operationId),t.id])).rows[0];if(!op)return null;
   const conversation=await this.lockConversation(c,t,op.conversation_id),route=await this.nativeOperationRoute(c,t,op);if(!route||route.channel!=='linkedin')throw Error('Original reviewed invitation route required');
   return {conversation,operation:op,route,submitted:op.state==='complete'&&op.result?.delivery?.status==='submitted',notSubmitted:op.state==='failed'&&op.result?.delivery?.status==='not_submitted',effect:'invitation' as const};});
  return invitation??super.channelDispatchRecord(threadId,operationId,options);
 }
 override async beginNativeCommunicationsMessage(threadId:string,operationId:string,authority?:AgentExecutionFence,delegation?:{id:string;revision:number}){
  const record=await this.channelDispatchRecord(threadId,operationId);if(record.operation.name!=='linkedin.invitation')return record.route?this.beginNativeRoutedCommunicationsMessage(threadId,operationId,authority,delegation):this.beginNativeCommunicationsEmail(threadId,operationId,authority,delegation);
  if(delegation)throw Error('LinkedIn invitations require exact human review');
  return this.nativeTransaction(async c=>{const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'invitation-authority:'+operationId);
   const op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='linkedin.invitation' FOR UPDATE",[operationId,t.id])).rows[0];if(!op||op.input.requiresHumanReview!==true)throw Error('Exact human-reviewed invitation required');
   const route=await this.nativeOperationRoute(c,t,op);if(!route||route.channel!=='linkedin')throw Error('Original reviewed invitation route required');
   let row=await this.lockConversation(c,t,op.conversation_id),running=op;if(op.state!=='running')({row,running}=await this.prepareNativeEmailAuthority(c,t,op,undefined,route));
   if(authority)await c.query("UPDATE agent_operations o SET lease_until=LEAST(o.lease_until,r.created_at+interval '45 seconds',r.lease_until) FROM agent_runs r WHERE o.id=$1 AND r.id=$2",[op.id,authority.runId]);
   if((await c.query('SELECT agent_operation_authorised($1::uuid) AS allowed',[op.id])).rows[0]?.allowed!==true)throw Error('Current invitation authority or policy unavailable');
   await this.emitOperational(c,t,'provider-reconcile:'+op.id,'linkedin.reconcile',{operationId:op.id},new Date(Date.now()+30000).toISOString());
   return {operationId:op.id as string,conversationId:row.id as string,routeId:route.id,epoch:Number(row.epoch),fence:String(running.fence),bindingId:route.bindingId,recipient:route.recipient,channel:'linkedin' as const,subject:'',body:op.input.body as string,effect:'invitation' as const};
  });
 }
 override async abandonUnpreparedNativeEmail(threadId:string,operationId:string,authority:AgentExecutionFence){
  const record=await this.channelDispatchRecord(threadId,operationId);if(record.operation.name!=='linkedin.invitation')return super.abandonUnpreparedNativeEmail(threadId,operationId,authority);
  return this.nativeTransaction(async c=>{const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'invitation-unprepared:'+operationId);
   const op=(await c.query("SELECT o.state,o.result,o.lease_until<=clock_timestamp() AS expired,EXISTS(SELECT 1 FROM communication_dispatch_intents i WHERE i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id AND i.source_kind='agent' AND i.source_id=o.id) AS has_intent FROM agent_operations o WHERE o.id=$1 AND o.thread_id=$2 AND o.name='linkedin.invitation' FOR UPDATE",[operationId,t.id])).rows[0];if(!op)throw Error('Owned original invitation required');if(op.state==='failed'&&op.result?.delivery?.status==='not_submitted')return true;if(!['running','uncertain'].includes(op.state)||!op.expired||op.has_intent)return false;
   const outcome=(await c.query('SELECT agent_communications_no_submission($1::uuid,NULL::uuid,NULL::text,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS outcome',[operationId,authority.runId,authority.eventId,authority.leaseOwner,authority.fence])).rows[0]?.outcome;if(outcome?.status!=='not_submitted')throw Error('Original invitation outcome needs review');return true;
  });
 }
 override async markNativeCommunicationsOutcome(threadId:string,operationId:string,outcome:DeliveryOutcome){
  const record=await this.channelDispatchRecord(threadId,operationId);if(record.operation.name!=='linkedin.invitation')return super.markNativeCommunicationsOutcome(threadId,operationId,outcome);
  return this.nativeTransaction(async c=>{const t=await this.lockThread(c,threadId),op=(await c.query("SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='linkedin.invitation' FOR UPDATE",[operationId,t.id])).rows[0],row=await this.lockConversation(c,t,op.conversation_id),route=await this.nativeOperationRoute(c,t,op);if(!route||route.channel!=='linkedin')throw Error('Original invitation route required');
   if(op.state==='complete'&&op.result?.delivery?.status==='submitted'){if(outcome.status==='submitted'&&(!('operation'in outcome.receipt)||outcome.receipt.operation.id!==op.result.delivery.providerOperationId))throw Error('Different original invitation receipt');return op.result.delivery as AgentInvitationDelivery;}
   if(op.state==='uncertain'&&outcome.status!=='submitted')return {status:'unknown' as const};if(!['running','uncertain'].includes(op.state))throw Error('No original admitted invitation requires reconciliation');
   let delivery:AgentInvitationDelivery|{status:'unknown'}={status:'unknown'};
   if(outcome.status==='submitted'){
    const receipt=outcome.receipt;if(!('operation'in receipt)||!receipt.submittedAt||!Number.isFinite(Date.parse(receipt.submittedAt))||Date.parse(receipt.submittedAt)>this.businessNow()||!receipt.operation.id||receipt.operation.id.length>2048||receipt.recipient.kind!==route.recipient.kind||receipt.recipient.value!==route.recipient.value)throw Error('Exact original invitation action receipt required');
    const b=(await c.query('SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',[route.bindingId,t.organization_id,t.owner_user_id])).rows[0];if(!b)throw Error('Original invitation account unavailable');
    const binding:ConnectionBinding={applicationId:b.application_id,tenantId:b.organization_id,ownerId:b.owner_user_id,connectionId:b.service_connection_id,accountId:b.service_account_id,generation:b.generation,channel:b.channel,platform:b.platform,backend:b.backend};assertSameBinding(binding,receipt.operation.binding);
    const intent=(await c.query("SELECT i.id FROM communication_dispatch_intents i JOIN communication_dispatch_permits p ON p.intent_id=i.id WHERE i.organization_id=$1 AND i.owner_user_id=$2 AND i.source_kind='agent' AND i.source_id=$3 AND i.binding_id=$4 AND i.operation='invitation' ORDER BY i.created_at LIMIT 1",[t.organization_id,t.owner_user_id,op.id,route.bindingId])).rows[0];if(!intent)throw Error('Original admitted invitation intent required');
    delivery={status:'submitted',effect:'invitation',providerOperationId:receipt.operation.id,submittedAt:receipt.submittedAt,intentId:intent.id};
   }
   const reservations=(await c.query("SELECT account_id FROM agent_budget_reservations WHERE operation_id=$1 AND state IN('reserved','uncertain') ORDER BY account_id",[op.id])).rows;if(reservations.length!==4)throw Error('All original invitation send reservations required');
   await c.query('SELECT agent_settle_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(reservations.map(a=>({accountId:a.account_id,actual:delivery.status==='submitted'?'1':null})))]);
   await c.query("UPDATE agent_authority_uses SET state=$2,outcome=$3,updated_at=now() WHERE operation_id=$1",[op.id,delivery.status==='submitted'?'settled':'uncertain',JSON.stringify(delivery)]);
   await c.query('UPDATE agent_operations SET state=$2,result=$3,lease_until=NULL,updated_at=now() WHERE id=$1',[op.id,delivery.status==='submitted'?'complete':'uncertain',JSON.stringify({delivery})]);
   await c.query('SELECT public.agent_record_invitation_outcome($1::uuid,$2::jsonb)',[op.id,JSON.stringify(delivery)]);
   let nextDue:string|null=null;if(delivery.status==='submitted'){const due=(await c.query('SELECT public.agent_channel_record_submission($1::uuid) AS due',[op.id])).rows[0].due;nextDue=new Date(due).toISOString();}
   const changed=(await c.query(`UPDATE agent_conversations SET phase=CASE WHEN $2 THEN phase WHEN driver_kind='agent' THEN 'held' ELSE phase END,pause_reason=CASE WHEN $2 THEN CASE WHEN driver_kind='agent' AND phase='held' AND pause_reason='provider_outcome_unknown' THEN 'provider_receipt_pending_history' ELSE pause_reason END ELSE 'provider_outcome_unknown' END,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=CASE WHEN $2 AND driver_kind='agent' AND phase='active' THEN LEAST($3::timestamptz,${this.businessSql()}+interval '1 day') ELSE NULL END,updated_at=clock_timestamp() WHERE id=$1 RETURNING epoch::text,reminder_generation,next_wakeup_at`,[row.id,delivery.status==='submitted',nextDue])).rows[0];
   await this.invalidateNativeReviews(c,t,row.id);
   if(delivery.status==='submitted'&&changed.next_wakeup_at)await this.emit(c,t,'invitation-check:'+op.id,'conversation.reminder',{conversationId:row.id,epoch:Number(changed.epoch),reminderGeneration:changed.reminder_generation},new Date(changed.next_wakeup_at).toISOString());
   else if(delivery.status==='unknown')await this.emitOperational(c,t,'provider-reconcile:'+op.id,'linkedin.reconcile',{operationId:op.id},new Date(Date.now()+30000).toISOString());
   await this.controlNotice(c,t,'invitation-outcome:'+op.id,delivery.status==='submitted'?'The reviewed LinkedIn invitation was submitted. Acceptance is not confirmed; I will check the recorded relationship later.':'The original invitation outcome is unknown. Automation is held without resending.',{operationId:op.id,conversationId:row.id,routeId:route.id,...delivery});return delivery;
  });
 }
}
