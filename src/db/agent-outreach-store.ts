import {isAgentLegacyEmailOperation} from '@/domain/agent-operation-classifications';
import {agentChannelMessageSqlNames,agentLegacyEmailSqlNames,agentNativeDispatchSqlNames} from './agent-operation-sql';
import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {AgentThread} from './agent-store';
import {recordedAgentBindingDigest,type AgentExecutionFence} from './agent-execution-store';
import {AgentLifecycleStore} from './agent-lifecycle-store';
import {agentRecordDigest as digest} from './agent-store';
import {resolveDemoBuyerProfile} from '@/lib/agent-demo-buyer-profile';
import {AgentPreBeginSendBudgetError} from '@/lib/agent-pre-begin-send-budget-error';
import {publicBuyerProfile} from '@/domain/buyer-profile';
import {agentReplyCausalitySchema} from '@/domain/agent-reply-causality';
import {agentConversationContextSchema} from '@/lib/agent-conversation-engine';
import {targetRecordToRankedTarget} from './target-record-mapper';
import type {CompanyProjectionTargetRecord} from '@/domain/company-membership-projection';
import {selectAgentGuidance} from '@/domain/agent-guidance';
import {nativeEmailDraftSchema,nativeOutboundDraftSchema} from '@/domain/agent-execution';
import {authorityGrantSchema} from '@/domain/agent-authority';
import {assertSameBinding,type ConnectionBinding,type DeliveryOutcome} from '../../communications/packages/contracts/src';
const uuid=z.string().uuid();
const proposalSchema=z.object({conversationId:uuid,revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/),draft:nativeEmailDraftSchema}).strict();
export type NativeAgentDelivery={status:'submitted';providerMessageId:string;submittedAt:string;intentId:string}|{status:'submitted';effect:'invitation';providerOperationId:string;submittedAt:string;intentId:string}|{status:'unknown'};
const companyProjectionSchema=z.object({target:z.object({id:uuid,organizationId:z.string(),companyName:z.string(),domain:z.string(),firmableCompanyId:z.string().nullable().optional(),firmographics:z.record(z.string(),z.unknown())}).passthrough(),screening:z.record(z.string(),z.unknown()),blockedReasons:z.array(z.string()),observation:z.object({id:uuid,digest:z.string().regex(/^[a-f0-9]{64}$/)}),digest:z.string().regex(/^[a-f0-9]{64}$/)});
/** A bounded factual view, not raw provider JSON or another buyer's workflow. */
function nativeCompanyEvidence(raw:unknown,expectedTarget:string,organizationId:string){
 const p=companyProjectionSchema.parse(raw);
 if(p.target.id!==expectedTarget||p.target.organizationId!==organizationId)throw Error('Company projection identity differs from the owned contact');
 const target=targetRecordToRankedTarget(p.target as unknown as CompanyProjectionTargetRecord,[]);
 const compact=(field:{value:unknown;missingReason?:string;provenance:Record<string,unknown>})=>({value:typeof field.value==='string'?field.value.slice(0,1200):field.value,...(typeof field.value==='string'&&field.value.length>1200?{valueIsExcerpt:true}:{}),...(field.missingReason?{missingReason:field.missingReason.slice(0,300)}:{}),provenance:{source:String(field.provenance.source??'').slice(0,200),capturedAt:field.provenance.capturedAt,scope:field.provenance.scope,basis:field.provenance.basis}});
 const description=target.sourceData?.firmable?.description;
 const result={id:target.id,domain:target.domain,firmableId:p.target.firmableCompanyId??null,...(description?{descriptionExcerpt:description.slice(0,3000),descriptionIsExcerpt:description.length>3000}:{}),sector:compact(target.sector),state:target.state,headcount:compact(target.headcount),...(target.headcountBand?{headcountBand:compact(target.headcountBand)}:{}),revenue:compact(target.revenue),ebitda:compact(target.ebitda),establishedYear:compact(target.establishedYear),screening:p.screening,blockedReasons:p.blockedReasons,observation:p.observation,projectionDigest:p.digest};
 if(JSON.stringify(result).length>10500)throw Error('Current company evidence exceeds the bounded model context');
 return{companyName:p.target.companyName,companySource:'accepted_mandate_observation',company:result};
}
/** Native proposals share the existing review ledger. The local sink below is
 * an explicit simulation, not a communications-service/provider submission. */
export class AgentOutreachStore extends AgentLifecycleStore{
 protected async assertLegacyAgentEmail(c:PoolClient,t:AgentThread){
  const installed=(await c.query("SELECT to_regclass('public.agent_channel_policies') IS NOT NULL AS installed")).rows[0]?.installed===true;
  if(installed&&(await c.query('SELECT 1 FROM agent_channel_policies WHERE thread_id=$1',[t.id])).rowCount)throw Error('This mandate requires its explicitly reviewed channel route');
 }
 /** Trusted communications adapter only. Late original receipts are recorded
  * even after cancellation; recording an outcome never grants another send. */
 async markNativeCommunicationsOutcome(threadId:string,operationId:string,outcome:DeliveryOutcome):Promise<NativeAgentDelivery>{
  uuid.parse(operationId);return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId),op=(await c.query(`SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN(${agentChannelMessageSqlNames}) FOR UPDATE`,[operationId,t.id])).rows[0];
   if(!op)throw new Error('Owned native operation unavailable');
   if(Object.hasOwn(op.input??{},'routeId'))return this.markRoutedCommunicationsOutcome(c,t,op,outcome);
   const row=await this.lockConversation(c,t,op.conversation_id);if(row.delivery_mode!=='communications')throw new Error('Recorded communications outcome required');
   if(op.state==='complete'&&op.result?.delivery?.status==='submitted'){
    if(outcome.status==='submitted'&&'message'in outcome.receipt&&outcome.receipt.message.id!==op.result.delivery.providerMessageId)throw new Error('Different original delivery receipt');
    return op.result.delivery;
   }
   if(op.state==='uncertain'&&op.result?.delivery?.status==='unknown'&&outcome.status!=='submitted')return op.result.delivery;
   if(!['running','uncertain'].includes(op.state))throw new Error('No admitted native send requires reconciliation');
   let delivery:{status:'submitted';providerMessageId:string;submittedAt:string;intentId:string}|{status:'unknown'}={status:'unknown'};
   if(outcome.status==='submitted'){
    if(!('message'in outcome.receipt))throw new Error('Verified original email receipt required');
    const receipt=outcome.receipt,at=receipt.submittedAt;
    if(!at||!Number.isFinite(Date.parse(at))||Date.parse(at)>this.businessNow()||!receipt.message.id||receipt.message.id.length>300||receipt.recipient.kind!=='email'||receipt.recipient.value!==row.recipient_email)throw new Error('Verified original recipient and timestamp required');
    const b=(await c.query('SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',[row.binding_id,t.organization_id,t.owner_user_id])).rows[0];
    if(!b)throw new Error('Original recorded account unavailable');
    const binding:ConnectionBinding={applicationId:b.application_id,tenantId:b.organization_id,ownerId:b.owner_user_id,connectionId:b.service_connection_id,accountId:b.service_account_id,generation:b.generation,channel:b.channel,platform:b.platform,backend:b.backend};assertSameBinding(binding,receipt.message.binding);
    const intent=(await c.query("SELECT i.id FROM communication_dispatch_intents i JOIN communication_dispatch_permits p ON p.intent_id=i.id WHERE i.organization_id=$1 AND i.owner_user_id=$2 AND i.source_kind='agent' AND i.source_id=$3 AND i.binding_id=$4 ORDER BY i.created_at LIMIT 1",[t.organization_id,t.owner_user_id,op.id,row.binding_id])).rows[0];
    if(!intent)throw new Error('Original admitted communications intent required');
    delivery={status:'submitted',providerMessageId:receipt.message.id,submittedAt:at,intentId:intent.id};
   }
   const reservations=(await c.query("SELECT account_id FROM agent_budget_reservations WHERE operation_id=$1 AND state IN('reserved','uncertain') ORDER BY account_id",[op.id])).rows;
   if(reservations.length!==3)throw new Error('Original send reservations required');
   await c.query('SELECT agent_settle_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(reservations.map(a=>({accountId:a.account_id,actual:delivery.status==='submitted'?'1':null})))]);
   await c.query("UPDATE agent_authority_uses SET state=$2,outcome=$3,updated_at=now() WHERE operation_id=$1",[op.id,delivery.status==='submitted'?'settled':'uncertain',JSON.stringify(delivery)]);
   await c.query('UPDATE agent_operations SET state=$2,result=$3,lease_until=NULL,updated_at=now() WHERE id=$1',[op.id,delivery.status==='submitted'?'complete':'uncertain',JSON.stringify({delivery})]);
   const changed=(await c.query(`UPDATE agent_conversations SET history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,
    phase=CASE WHEN $2 THEN phase WHEN driver_kind='agent' THEN 'held' ELSE phase END,
    pause_reason=CASE WHEN driver_kind<>'agent' OR phase IN('paused','quiescing','complete') OR pause_reason IS NOT NULL AND pause_reason NOT IN('provider_receipt_pending_history','provider_outcome_unknown','channel_history_pending') THEN pause_reason WHEN $2 THEN 'provider_receipt_pending_history' ELSE 'provider_outcome_unknown' END,updated_at=now() WHERE id=$1 RETURNING revision`,[row.id,delivery.status==='submitted'])).rows[0];
   await this.invalidateNativeReviews(c,t,row.id);
   if(delivery.status==='submitted')await this.emitOperational(c,t,'provider-history:'+op.id,'conversation.history_changed',{conversationId:row.id},new Date(Date.now()+2000).toISOString());
   else await this.emitOperational(c,t,'provider-reconcile:'+op.id,'email.reconcile',{operationId:op.id},new Date(Date.now()+30000).toISOString());
   await this.controlNotice(c,t,'provider-outcome:'+op.id+':'+changed.revision,delivery.status==='submitted'?'The communications service confirmed the original email submission. I will verify the updated conversation history before further work.':'The original provider outcome is uncertain. Automation is held and its send budget remains reserved; no new send was attempted.',{operationId:op.id,conversationId:row.id,...delivery});
   return delivery;
  });
 }
 protected async markRoutedCommunicationsOutcome(_c:PoolClient,_t:AgentThread,_op:Record<string,unknown>,_outcome:DeliveryOutcome):Promise<NativeAgentDelivery>{void _c;void _t;void _op;void _outcome;throw Error('Recorded channel outcome capability unavailable');}
 async markNativeChannelOutcome(threadId:string,operationId:string,outcome:DeliveryOutcome){return this.markNativeCommunicationsOutcome(threadId,operationId,outcome);}
 async createConversationGrant(threadId:string,key:string,raw:unknown){
  const input=z.object({mandateRevision:z.string().regex(/^\d{1,30}$/),conversationIds:z.array(uuid).min(1).max(200).refine(ids=>new Set(ids).size===ids.length),actions:z.array(z.enum(['initial_email','reply_email','follow_up_email'])).min(1).max(3),maxSends:z.number().int().min(1).max(100),expiresAt:z.string().datetime({offset:true})}).strict().parse(raw);
  return this.command(threadId,key,'authority.create',input,async(c,t,commandId)=>{
   await this.assertLegacyAgentEmail(c,t);
   const mandate=(await c.query('SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];
   if(mandate?.revision!==input.mandateRevision)throw new Error('Review the changed mandate before delegating sends');
   const rows:{id:string;driver_kind:string;phase:string;binding_digest:string;recipient_email:string}[]=[];for(const id of [...input.conversationIds].sort())rows.push(await this.lockConversation(c,t,id));
   if(rows.some(row=>row.driver_kind!=='agent'||row.phase!=='active'||row.binding_digest!==rows[0].binding_digest))throw new Error('Select active agent conversations on the same recorded account');
   if(!(await c.query("SELECT 1 FROM agent_responsibilities WHERE thread_id=$1 AND state IN('ready','waiting')",[t.id])).rowCount)throw new Error('Current supervision required');
   const now=(await c.query('SELECT clock_timestamp() AS now')).rows[0].now as Date;
   const value=authorityGrantSchema.parse({id:commandId,actions:input.actions,maxSends:input.maxSends,expiresAt:input.expiresAt,organizationId:t.organization_id,mandateId:t.mandate_id,userId:t.owner_user_id,threadId:t.id,revision:1,channel:'email',recipientKeys:rows.map(row=>'email:'+row.recipient_email),bindingDigest:rows[0].binding_digest,usedSends:0,approvedBy:t.owner_user_id,approvedAt:now.toISOString()});
   const grant=(await c.query(`INSERT INTO agent_authority_grants(id,thread_id,organization_id,mandate_id,owner_user_id,channel,actions,recipient_keys,binding_digest,max_sends,expires_at,approved_by,approved_at)
    VALUES($1,$2,$3,$4,$5,'email',$6,$7,$8,$9,$10,$5,$11) RETURNING id,revision`,[commandId,t.id,t.organization_id,t.mandate_id,t.owner_user_id,JSON.stringify(value.actions),JSON.stringify(value.recipientKeys),value.bindingDigest,value.maxSends,value.expiresAt,now])).rows[0];
   await this.controlNotice(c,t,'authority-created:'+commandId,'You enabled bounded email delegation for '+rows.length+' selected conversations, up to '+value.maxSends+' sends until '+value.expiresAt+'. Booking links still require a human. You can revoke this authority at any time.',{grantId:grant.id,actions:value.actions,recipientKeys:value.recipientKeys,maxSends:value.maxSends,expiresAt:value.expiresAt});
   await this.emit(c,t,'authority-created:'+commandId,'authority.changed',{grantId:grant.id});
   return {id:grant.id as string,revision:grant.revision as number,status:'active'};
  });
 }
 async createChannelGrant(threadId:string,key:string,raw:unknown){
  const input=z.object({mandateRevision:z.string().regex(/^\d{1,30}$/),routeIds:z.array(uuid).min(1).max(200).refine(ids=>new Set(ids).size===ids.length),actions:z.array(z.enum(['initial_email','reply_email','follow_up_email','initial_whatsapp','reply_whatsapp','follow_up_whatsapp','initial_linkedin','reply_linkedin','follow_up_linkedin'])).min(1).max(3),maxSends:z.number().int().min(1).max(100),expiresAt:z.string().datetime({offset:true})}).strict().parse(raw);
  return this.command(threadId,key,'authority.create_channels',input,async(c,t,commandId)=>{
   const mandate=(await c.query('SELECT xmin::text AS revision FROM mandates WHERE id=$1 AND organization_id=$2',[t.mandate_id,t.organization_id])).rows[0];if(mandate?.revision!==input.mandateRevision)throw Error('Review the current mandate before granting authority');
   const routes=(await c.query('SELECT r.*,v.phase,v.driver_kind FROM agent_conversation_channels r JOIN agent_conversations v ON v.id=r.conversation_id WHERE r.id=ANY($1::uuid[]) AND r.thread_id=$2 ORDER BY r.id FOR UPDATE OF v',[input.routeIds,t.id])).rows;
   if(routes.length!==input.routeIds.length||routes.some(r=>r.phase!=='active'||r.driver_kind!=='agent'||r.binding_digest!==routes[0].binding_digest||r.channel!==routes[0].channel))throw Error('Select active person routes on one exact owned channel account');
   if(!(await c.query("SELECT 1 FROM agent_responsibilities WHERE thread_id=$1 AND state IN('ready','waiting')",[t.id])).rowCount)throw Error('Current supervision required');
   const now=(await c.query('SELECT clock_timestamp() AS instant')).rows[0].instant;
   const value=authorityGrantSchema.parse({id:commandId,organizationId:t.organization_id,mandateId:t.mandate_id,userId:t.owner_user_id,threadId:t.id,revision:1,channel:routes[0].channel,actions:input.actions,routeIds:input.routeIds,recipientKeys:routes.map(r=>r.channel+':'+r.recipient_value),bindingDigest:routes[0].binding_digest,maxSends:input.maxSends,usedSends:0,approvedBy:t.owner_user_id,approvedAt:now.toISOString(),expiresAt:input.expiresAt});
   const grant=(await c.query('INSERT INTO agent_authority_grants(id,thread_id,organization_id,mandate_id,owner_user_id,channel,actions,recipient_keys,route_ids,binding_digest,max_sends,expires_at,approved_by,approved_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$5,$13) RETURNING id,revision',[commandId,t.id,t.organization_id,t.mandate_id,t.owner_user_id,value.channel,JSON.stringify(value.actions),JSON.stringify(value.recipientKeys),JSON.stringify(value.routeIds),value.bindingDigest,value.maxSends,value.expiresAt,now])).rows[0];
   await this.controlNotice(c,t,'authority-created:'+commandId,'You approved bounded delegation for these exact '+value.channel+' routes. Other channels, invitations and booking links still require separate human approval.',{grantId:grant.id,routeIds:value.routeIds,actions:value.actions,maxSends:value.maxSends,expiresAt:value.expiresAt});
   await this.emit(c,t,'authority-created:'+commandId,'authority.changed',{grantId:grant.id});return {id:grant.id as string,revision:grant.revision as number,status:'active'};
  });
 }
 async revokeConversationGrant(threadId:string,key:string,raw:unknown){
  const input=z.object({grantId:uuid,revision:z.number().int().positive()}).strict().parse(raw);
  return this.command(threadId,key,'authority.revoke',input,async(c,t,commandId)=>{
   const row=(await c.query('SELECT * FROM agent_authority_grants WHERE id=$1 AND thread_id=$2 FOR UPDATE',[input.grantId,t.id])).rows[0];
   if(!row||row.revision!==input.revision||row.revoked_at)throw new Error('Authority changed; refresh before revoking');
   const grant=(await c.query('UPDATE agent_authority_grants SET revoked_at=clock_timestamp(),revision=revision+1 WHERE id=$1 RETURNING revision',[row.id])).rows[0];
   await this.controlNotice(c,t,'authority-revoked:'+commandId,'You revoked this email delegation. No new send can use it.',{grantId:row.id});
   await this.emit(c,t,'authority-revoked:'+commandId,'authority.changed',{grantId:row.id});return {id:row.id as string,revision:grant.revision as number,status:'revoked'};
  });
 }
 async delegatedDispatchTarget(threadId:string,operationId:string){
  uuid.parse(operationId);return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);
   const op=(await c.query(`SELECT o.*,v.delivery_mode,v.binding_digest,v.recipient_email FROM agent_operations o JOIN agent_conversations v ON v.id=o.conversation_id AND v.thread_id=o.thread_id WHERE o.id=$1 AND o.thread_id=$2 AND o.state='proposed' AND o.name IN(${agentChannelMessageSqlNames})`,[operationId,t.id])).rows[0];
   if(!op||op.input?.requiresHumanReview===true)return null;
   const route=await this.nativeOperationRoute(c,t,op),kind=op.name.split('.').reverse().join('_'),channel=route?.channel??'email',recipientKey=route?channel+':'+route.recipient.value:'email:'+op.recipient_email,binding=route?.bindingDigest??op.binding_digest;
   if(!route)await this.assertLegacyAgentEmail(c,t);
   const grant=(await c.query("SELECT id,revision FROM agent_authority_grants WHERE thread_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp() AND used_sends<max_sends AND binding_digest=$2 AND recipient_keys ? $3 AND actions ? $4 AND channel=$5 AND ($6::text IS NULL AND route_ids='[]'::jsonb OR $6::text IS NOT NULL AND route_ids ? $6) ORDER BY expires_at,id LIMIT 1",[t.id,binding,recipientKey,kind,channel,route?.id??null])).rows[0];
   return grant?{id:op.id as string,conversationId:op.conversation_id as string,deliveryMode:op.delivery_mode as 'local_sink'|'communications',grant:{id:grant.id as string,revision:grant.revision as number}}:null;
  });
 }
 async abandonUnpreparedNativeEmail(threadId:string,operationId:string,authority:AgentExecutionFence){
  uuid.parse(operationId);return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'email-unprepared:'+operationId);
   const op=(await c.query(`SELECT o.state,o.result,o.lease_until<=clock_timestamp() AS expired,EXISTS(SELECT 1 FROM communication_dispatch_intents i WHERE i.organization_id=o.organization_id AND i.owner_user_id=o.owner_user_id AND i.source_kind='agent' AND i.source_id=o.id) AS has_intent FROM agent_operations o WHERE o.id=$1 AND o.thread_id=$2 AND o.name IN(${agentChannelMessageSqlNames}) FOR UPDATE`,[operationId,t.id])).rows[0];
   if(!op)throw new Error('Owned native email operation unavailable');
   if(op.state==='failed'&&op.result?.delivery?.status==='not_submitted')return true;
   if(!['running','uncertain'].includes(op.state)||!op.expired||op.has_intent)return false;
   const outcome=(await c.query('SELECT agent_communications_no_submission($1::uuid,NULL::uuid,NULL::text,$2::uuid,$3::uuid,$4::uuid,$5::bigint) AS outcome',[operationId,authority.runId,authority.eventId,authority.leaseOwner,authority.fence])).rows[0]?.outcome;
   if(outcome?.status!=='not_submitted')throw new Error('Unprepared native outcome needs review');
   return true;
  });
 }
 async nativeEmailDispatchRecord(threadId:string,operationId:string){
  uuid.parse(operationId);return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);
   const row=(await c.query(`SELECT o.id AS operation_id,o.conversation_id,o.state AS operation_state,o.result AS operation_result,c.binding_id,c.delivery_mode,c.binding_digest,c.recipient_email
    FROM agent_operations o JOIN agent_conversations c ON c.id=o.conversation_id AND c.thread_id=o.thread_id
    WHERE o.id=$1 AND o.thread_id=$2 AND o.name IN(${agentLegacyEmailSqlNames})`,[operationId,t.id])).rows[0];
   if(!row)throw new Error('Owned native email operation unavailable');
   return {operationId:row.operation_id as string,conversationId:row.conversation_id as string,notSubmitted:row.operation_state==='failed'&&row.operation_result?.delivery?.status==='not_submitted',submitted:row.operation_state==='complete'&&row.operation_result?.delivery?.status==='submitted',bindingId:row.binding_id as string|null,deliveryMode:row.delivery_mode as 'local_sink'|'communications',bindingDigest:row.binding_digest as string,recipient:row.recipient_email as string};
  });
 }
 async reviewDispatchTargets(threadId:string,batchId:string){
  uuid.parse(batchId);return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);
   const batch=(await c.query("SELECT manifest FROM agent_review_batches WHERE id=$1 AND thread_id=$2 AND state='approved'",[batchId,t.id])).rows[0];
   if(!batch)throw new Error('Current approved batch required');
   const ids=z.array(z.object({operationId:uuid})).min(1).max(50).parse(batch.manifest).map(i=>i.operationId);
   const rows=(await c.query('SELECT o.id,o.name,o.conversation_id AS "conversationId",c.delivery_mode FROM agent_operations o LEFT JOIN agent_conversations c ON c.id=o.conversation_id AND c.thread_id=o.thread_id WHERE o.thread_id=$1 AND o.id=ANY($2::uuid[]) ORDER BY o.id',[t.id,ids])).rows;
   if(rows.length!==ids.length)throw new Error('Approved batch operation is unavailable');return rows;
  });
 }
 async holdNativeConversation(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence){
  const input=z.object({conversationId:uuid,revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(1).max(2000)}).strict().parse(raw);
  return this.command(threadId,key,'conversation.hold',input,async(c,t,commandId)=>{
   const row=await this.lockConversation(c,t,input.conversationId);
   if(row.revision!==input.revision||row.context_revision!==input.contextRevision||row.driver_kind!=='agent'||row.phase!=='active')throw new Error('Conversation changed before review hold');
   const updated=(await c.query("UPDATE agent_conversations SET phase='held',pause_reason='human_review_required',epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=now() WHERE id=$1 RETURNING revision",[row.id])).rows[0];
   await this.invalidateNativeReviews(c,t,row.id);
   await this.controlNotice(c,t,'human-review:'+commandId,'I need your help before continuing this conversation. Automation is held; no message was sent.',{conversationId:row.id,reason:input.reason});
   return {id:row.id as string,revision:updated.revision as number,status:'held'};
  },authority);
 }
 async stopNativeConversation(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence){
  const input=z.object({conversationId:uuid,revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(1).max(2000)}).strict().parse(raw);
  return this.command(threadId,key,'conversation.stop',input,async(c,t,commandId)=>{
   const row=await this.lockConversation(c,t,input.conversationId);
   if(row.revision!==input.revision||row.context_revision!==input.contextRevision)throw new Error('Conversation changed; reassess before stopping');
   if(row.driver_kind!=='agent'||row.phase!=='active')throw new Error('Agent does not own an active conversation');
   const updated=(await c.query("UPDATE agent_conversations SET phase='complete',engagement='stopped',pause_reason='conversation_stopped',epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=now() WHERE id=$1 RETURNING revision",[row.id])).rows[0];
   await this.controlNotice(c,t,'stop:'+commandId,'This conversation is stopped. No further automated follow-up will be sent.',{conversationId:row.id,reason:input.reason});
   return {id:row.id as string,revision:updated.revision as number,status:'stopped'};
  },authority);
 }
 async refreshLocalConversationHistory(threadId:string,conversationId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId),row=await this.lockConversation(c,t,conversationId);
   if(row.delivery_mode!=='local_sink'||row.history_source!=='local_fixture'||!row.history_complete)throw new Error('Verified local history required; provider coverage cannot be replaced by a fixture');
   await c.query(`UPDATE agent_conversations SET history_observed_at=${this.businessSql()},updated_at=now() WHERE id=$1`,[row.id]);
  });
 }
 async pendingNativeEmail(threadId:string,conversationId:string,contextRevision:string){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);await this.lockConversation(c,t,conversationId);
   return !!(await c.query(`SELECT id FROM agent_operations WHERE thread_id=$1 AND conversation_id=$2 AND name IN(${agentChannelMessageSqlNames}) AND input->>'contextRevision'=$3 AND state IN('proposed','approved','running','uncertain') AND (state<>'proposed' OR EXISTS(SELECT 1 FROM agent_review_batches b WHERE b.thread_id=$1 AND b.state='pending' AND b.manifest @> jsonb_build_array(jsonb_build_object('operationId',agent_operations.id)))) LIMIT 1`,[t.id,conversationId,contextRevision])).rowCount;
  });
 }
 protected async publicConversationFacts(c:PoolClient,t:AgentThread,conversationId:string){
  const facts=(await c.query('SELECT agent_public_conversation_facts($1::uuid) AS facts',[conversationId])).rows[0].facts;
  // A server-stamped fictional buyer is scoped to this exact saved demo. Real
  // mandates continue to use the protected organisation disclosure projection.
  const scenario=(await c.query(`/* demo-buyer-profile-context */ SELECT m.id,m.provenance,mode.mode AS execution_mode,mode.demo_id
   FROM mandates m JOIN agent_mandate_execution_modes mode ON mode.mandate_id=m.id AND mode.organization_id=m.organization_id
   WHERE m.id=$1 AND m.organization_id=$2 AND mode.mode='demo' AND mode.demo_id=m.id`,[t.mandate_id,t.organization_id])).rows[0];
  const profile=scenario?resolveDemoBuyerProfile({executionMode:scenario.execution_mode,demoId:scenario.demo_id,mandateId:t.mandate_id,provenance:scenario.provenance}):null;
  return profile?{...facts,buyerProfile:publicBuyerProfile(profile)}:facts;
 }
 async nativeDecisionContext(threadId:string,conversationId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId),row=await this.lockConversation(c,t,conversationId);
   const facts=await this.publicConversationFacts(c,t,row.id);
   let companyEvidence:ReturnType<typeof nativeCompanyEvidence>|undefined;
   const projectionInstalled=(await c.query("SELECT to_regprocedure('public.agent_company_membership_projection(uuid,uuid)') IS NOT NULL AS installed")).rows[0]?.installed===true;
   if(projectionInstalled){
    const protectedCompany=(await c.query('SELECT p.target_id,public.agent_company_membership_projection($1::uuid,p.target_id) AS projection FROM contacts p WHERE p.id=$2 AND p.organization_id=$3 AND p.target_id IS NOT NULL',[t.mandate_id,row.contact_id,t.organization_id])).rows[0];
    if(protectedCompany?.projection!==undefined&&protectedCompany.projection!==null)companyEvidence=nativeCompanyEvidence(protectedCompany.projection,protectedCompany.target_id,t.organization_id);
   }
   const sources:Array<{id:string;text:string;publicDisclosureApproved?:true}>=[{id:'mandate:'+t.mandate_id,text:facts.goal as string},{id:'contact:'+row.contact_id,text:JSON.stringify({name:facts.contactName,companyName:facts.companyName,...(facts.companySource?{companySource:facts.companySource}:{}),...companyEvidence})}];
   // The protected public-facts function emits this allow-listed profile only
   // after saved organisation publicProfileApproved=true. Never infer approval
   // from a caller's source ID, mandate text or a lead's assertion.
   if(facts.buyerProfile)sources.push({id:'buyer-profile',text:JSON.stringify(facts.buyerProfile),publicDisclosureApproved:true});
   const records=(await c.query("SELECT id,revision,state,input FROM agent_operations WHERE thread_id=$1 AND name='guidance.memory' AND state='approved' ORDER BY id LIMIT 100",[t.id])).rows.map(r=>({...r,organizationId:t.organization_id,mandateId:t.mandate_id,userId:t.owner_user_id}));
   const guidance=selectAgentGuidance(records,{organizationId:t.organization_id,mandateId:t.mandate_id,userId:t.owner_user_id},facts.goal+' '+row.history.slice(-5).map((m:{text:string})=>m.text).join(' ')).map(g=>({id:g.id,revision:g.revision,text:g.input.text}));
   const active=!!(await c.query("SELECT 1 FROM agent_responsibilities WHERE id=$1 AND state IN('ready','waiting')",[row.responsibility_id])).rowCount;
   const channelContext=await this.nativeChannelDecisionContext(c,t,row);
   return agentConversationContextSchema.parse({conversationId:row.id,epoch:Number(row.epoch),reminderGeneration:row.reminder_generation,revision:row.revision,contextRevision:row.context_revision,phase:row.phase,driver:row.driver_kind,supervisionActive:active,deliveryMode:row.delivery_mode,historyComplete:row.history_complete,historyObservedAt:row.history_observed_at?.toISOString()??null,goal:facts.goal,history:row.history,sources,guidance,...channelContext});
  });
 }
 protected async nativeChannelDecisionContext(_c:PoolClient,_t:AgentThread,_row:Record<string,unknown>):Promise<Record<string,unknown>>{void _c;void _t;void _row;return {};}
 async proposeNativeMessage(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence,options?:{forceHumanReview?:boolean}){
  const input=z.object({conversationId:uuid,revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/),draft:nativeOutboundDraftSchema}).strict().parse(raw);
  if(!input.draft.routeId)return this.proposeNativeEmail(threadId,key,input,authority,options);
  return this.command(threadId,key,'message.propose',{...input,...(options?.forceHumanReview?{requiresHumanReview:true}:{})},async(c,t,commandId)=>{
   const row=await this.lockConversation(c,t,input.conversationId),draft=input.draft;
   const route=(await c.query('SELECT r.*,p.revision AS policy_revision FROM agent_conversation_channels r JOIN agent_channel_policies p ON p.thread_id=r.thread_id WHERE r.id=$1 AND r.conversation_id=$2 AND r.thread_id=$3 ',[draft.routeId,row.id,t.id])).rows[0];
   if(!route||row.revision!==input.revision||row.context_revision!==input.contextRevision)throw Error('Person or reviewed route changed; reassess before drafting');
   if(row.driver_kind!=='agent'||row.phase!=='active'||!row.history_complete||['handoff','stopped'].includes(row.engagement))throw Error('An active verified person conversation is required');
   const [stage,channel]=draft.kind.split(/_(?=[^_]+$)/);
   if(channel!==route.channel)throw Error('Draft channel differs from the exact reviewed route');
   if((await c.query('SELECT public.agent_channel_proposal_permitted($1::uuid,$2) AS allowed',[route.id,stage])).rows[0]?.allowed!==true)throw Error('Reviewed route is waiting, cancelled or does not match the conversation stage');
   const guidance=(await c.query("SELECT id FROM agent_operations WHERE thread_id=$1 AND name='guidance.memory' AND state='approved'",[t.id])).rows;
   const sources=new Set(['mandate:'+t.mandate_id,'contact:'+row.contact_id,...guidance.map(g=>g.id),...row.history.map((m:{id:string})=>m.id)]);
   const facts=await this.publicConversationFacts(c,t,row.id);if(facts.buyerProfile)sources.add('buyer-profile');
   if(draft.sourceIds.some(id=>!sources.has(id)))throw Error('Unknown proposal evidence');
   let replyCausality;
   if(stage==='reply'){
    replyCausality=agentReplyCausalitySchema.parse((await c.query('SELECT public.agent_channel_reply_causality($1::uuid) AS causality',[route.id])).rows[0]?.causality);
    if(replyCausality.historyRevision!==row.history_revision||replyCausality.routeHistoryRevision!==route.history_revision)throw Error('Captured reply history changed; reassess before drafting');
   }
   const name=channel+'.'+stage,value={...draft,...(replyCausality?{replyCausality}:{}),...(options?.forceHumanReview?{requiresHumanReview:true}:{}),recipientKey:channel+':'+route.recipient_value,contextRevision:row.context_revision,bindingDigest:route.binding_digest,identityRevision:route.identity_revision,policyRevision:route.policy_revision,historyRevision:row.history_revision,routeHistoryRevision:route.history_revision,ownerRevision:row.revision,epoch:Number(row.epoch)},hash=digest({name,input:value});
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,conversation_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'native-message:'+commandId,name,JSON.stringify(value),hash,row.id])).rows[0];
   const manifest=[{operationId:op.id,revision:op.revision,digest:hash,contextRevision:row.context_revision}];
   const batch=(await c.query(`INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'native-review:'+commandId,JSON.stringify(manifest),digest(manifest)])).rows[0];
   await this.controlNotice(c,t,'draft-notice:'+commandId,'I prepared a '+channel+' message for your review. It has not been sent.',{operationId:op.id,reviewBatchId:batch.id,conversationId:row.id,routeId:route.id,channel,recipient:route.recipient_value,bindingId:route.binding_id,rationale:draft.rationale});
   if(!options?.forceHumanReview)await this.emit(c,t,'native-proposal:'+op.id,'email.proposed',{operationId:op.id,reviewBatchId:batch.id});
   return {id:op.id as string,revision:op.revision as number,status:'proposed',reviewBatchId:batch.id as string};
  },authority);
 }
 async proposeNativeEmail(threadId:string,key:string,raw:unknown,authority?:AgentExecutionFence,options?:{forceHumanReview?:boolean}){
  const input={...proposalSchema.parse(raw),...(options?.forceHumanReview?{requiresHumanReview:true}:{})};
  return this.command(threadId,key,'email.propose',input,async(c,t,commandId)=>{
   await this.assertLegacyAgentEmail(c,t);
   const row=await this.lockConversation(c,t,input.conversationId),draft=input.draft;
   if(row.revision!==input.revision||row.context_revision!==input.contextRevision)throw new Error('Conversation changed; reassess before drafting');
   if(row.driver_kind!=='agent'||row.phase!=='active'||!row.history_complete||['handoff','stopped'].includes(row.engagement))throw new Error('An active verified agent conversation is required');
   const available=(await c.query(`SELECT $1::timestamptz<=${this.businessSql()} AND $1::timestamptz>${this.businessSql()}-interval '5 minutes' AND EXISTS(SELECT 1 FROM agent_responsibilities WHERE id=$2 AND state IN('ready','waiting')) AS allowed`,[row.history_observed_at,row.responsibility_id])).rows[0]?.allowed;
   if(available!==true)throw new Error('Refresh history and supervision before drafting');
   if(draft.kind==='initial_email'&&row.history.length||draft.kind==='reply_email'&&!row.history.some((m:{direction:string})=>m.direction==='inbound')||draft.kind==='follow_up_email'&&!row.history.some((m:{direction:string})=>m.direction==='outbound'))throw new Error('Draft kind differs from the conversation history');
   const guidance=(await c.query("SELECT id FROM agent_operations WHERE thread_id=$1 AND name='guidance.memory' AND state='approved'",[t.id])).rows;
   const facts=await this.publicConversationFacts(c,t,row.id);
   const sources=new Set(['mandate:'+t.mandate_id,'contact:'+row.contact_id,...guidance.map(g=>g.id),...row.history.map((m:{id:string})=>m.id)]);
   if(facts.buyerProfile)sources.add('buyer-profile');
   if(draft.sourceIds.some(id=>!sources.has(id)))throw new Error('Unknown proposal evidence');
   const name={initial_email:'email.initial',reply_email:'email.reply',follow_up_email:'email.follow_up'}[draft.kind];
   const value={...draft,...(input.requiresHumanReview?{requiresHumanReview:true}:{}),recipientKey:'email:'+row.recipient_email,contextRevision:row.context_revision,bindingDigest:row.binding_digest,historyRevision:row.history_revision,ownerRevision:row.revision,epoch:Number(row.epoch)};
   const hash=digest({name,input:value});
   const op=(await c.query(`INSERT INTO agent_operations(thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,conversation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'native-email:'+commandId,name,JSON.stringify(value),hash,row.id])).rows[0];
   const manifest=[{operationId:op.id,revision:op.revision,digest:hash,contextRevision:row.context_revision}];
   const batch=(await c.query(`INSERT INTO agent_review_batches(thread_id,organization_id,mandate_id,owner_user_id,request_key,manifest,manifest_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[t.id,t.organization_id,t.mandate_id,t.owner_user_id,'native-review:'+commandId,JSON.stringify(manifest),digest(manifest)])).rows[0];
   await this.controlNotice(c,t,'draft-notice:'+commandId,'I prepared an email for your review. It has not been sent.',{operationId:op.id,reviewBatchId:batch.id,conversationId:row.id,rationale:draft.rationale});
   if(!input.requiresHumanReview)await this.emit(c,t,'native-proposal:'+op.id,'email.proposed',{operationId:op.id,reviewBatchId:batch.id});
   return {id:op.id as string,revision:op.revision as number,status:'proposed',reviewBatchId:batch.id as string};
  },authority);
 }
 protected async prepareNativeEmailAuthority(c:PoolClient,t:AgentThread,op:{id:string;state:string;result?:{reason?:string};conversation_id:string;input:Record<string,unknown>;revision:number;input_digest:string},delegation?:{id:string;revision:number},route?:{bindingDigest:string}){
   if(op.state==='failed'&&op.result?.reason==='context_changed')throw new Error('Conversation changed; reassess and review again');
   if(delegation&&op.input.requiresHumanReview===true)throw new Error('This draft requires exact human review');
   if(op.state!=='approved'&&!(delegation&&op.state==='proposed'))throw new Error('Current human approval or scoped delegated grant required');
   const row=await this.lockConversation(c,t,op.conversation_id);
   if(op.input.contextRevision!==row.context_revision)throw new Error('Conversation changed; reassess and review the draft again');
   let batch:{id:string}|undefined;
   if(!delegation){
    const item={operationId:op.id,revision:op.revision,digest:op.input_digest,contextRevision:row.context_revision};
    batch=(await c.query("SELECT id FROM agent_review_batches WHERE thread_id=$1 AND state='approved' AND manifest @> $2::jsonb ORDER BY created_at,id LIMIT 1",[t.id,JSON.stringify([item])])).rows[0];
    if(!batch)throw new Error('Exact approved review batch required');
   }else if(op.state!=='proposed')throw new Error('Delegated work must be a current unapproved proposal');
   const running=(await c.query("UPDATE agent_operations SET state='running',fence=fence+1,lease_until=clock_timestamp()+interval '30 seconds',updated_at=now() WHERE id=$1 RETURNING *",[op.id])).rows[0];
   const scopeKeys=['organization:sends','user:'+t.owner_user_id+':sends','mandate:'+t.mandate_id+':sends'];
   if(route)scopeKeys.push('binding:'+route.bindingDigest+':sends');
   const accounts=(await c.query("SELECT DISTINCT ON(scope_key) id,scope_key FROM agent_budget_accounts WHERE organization_id=$1 AND unit='sends' AND scope_key=ANY($2::text[]) AND window_start<=clock_timestamp() AND window_end>clock_timestamp() ORDER BY scope_key,window_start DESC,id",[t.organization_id,scopeKeys])).rows;
   if(accounts.length!==scopeKeys.length)throw new Error('Configure current organisation, user and mandate sending limits before delivery');
   try{await c.query('SELECT agent_reserve_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(accounts.map(a=>({accountId:a.id,amount:'1'})))]);}catch(error){
    // Translate only this kernel's fixed refusal. Other database failures and
    // post-admission exceptions retain their original uncertain-outcome path.
    if(error instanceof Error&&'code'in error&&error.code==='P0001'&&error.message==='Shared budget exhausted or expired')throw new AgentPreBeginSendBudgetError(t.id,row.id,op.id);
    throw error;
   }
   await c.query(`INSERT INTO agent_authority_uses(operation_id,conversation_id,organization_id,mandate_id,owner_user_id,thread_id,review_batch_id,grant_id,grant_revision,operation_revision,operation_fence,operation_digest,context_revision,binding_digest,state)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'reserved')`,[op.id,row.id,t.organization_id,t.mandate_id,t.owner_user_id,t.id,batch?.id??null,delegation?.id??null,delegation?.revision??null,op.revision,running.fence,op.input_digest,row.context_revision,route?.bindingDigest??row.binding_digest]);
   return {row,running,accounts};
 }
 async beginNativeCommunicationsMessage(threadId:string,operationId:string,authority?:AgentExecutionFence,delegation?:{id:string;revision:number}){
  const record=await this.channelDispatchRecord(threadId,operationId);
  if(!record.route)return this.beginNativeCommunicationsEmail(threadId,operationId,authority,delegation);
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'message-authority:'+operationId);
   const op=(await c.query('SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 FOR UPDATE',[uuid.parse(operationId),t.id])).rows[0];
   const route=await this.nativeOperationRoute(c,t,op);if(!route)throw Error('The original reviewed message route is required');
   let row=await this.lockConversation(c,t,op.conversation_id),running=op;
   if(op.state!=='running')({row,running}=await this.prepareNativeEmailAuthority(c,t,op,delegation,route));
   if(authority)await c.query("UPDATE agent_operations o SET lease_until=LEAST(o.lease_until,r.created_at+interval '45 seconds',r.lease_until) FROM agent_runs r WHERE o.id=$1 AND r.id=$2",[op.id,authority.runId]);
   if((await c.query('SELECT agent_operation_authorised($1::uuid) AS allowed',[op.id])).rows[0]?.allowed!==true)throw Error('Current native channel authority or policy unavailable');
   await this.emitOperational(c,t,'provider-reconcile:'+op.id,route.channel+'.reconcile',{operationId:op.id},new Date(Date.now()+30000).toISOString());
   return {operationId:op.id as string,conversationId:row.id as string,routeId:route.id,epoch:Number(row.epoch),fence:String(running.fence),bindingId:route.bindingId,recipient:route.recipient,channel:route.channel,subject:op.input.subject as string,body:op.input.body as string};
  });
 }
 protected async nativeOperationRoute(c:PoolClient,t:AgentThread,op:{input:Record<string,unknown>;conversation_id:string}){
  if(!Object.hasOwn(op.input??{},'routeId'))return null;uuid.parse(op.input.routeId);
  const r=(await c.query('SELECT * FROM agent_conversation_channels WHERE id=$1 AND conversation_id=$2 AND thread_id=$3',[op.input.routeId,op.conversation_id,t.id])).rows[0];
  if(!r||r.binding_digest!==op.input.bindingDigest)throw Error('Original owned route unavailable; no account fallback is allowed');
  return {id:r.id as string,conversationId:r.conversation_id as string,channel:r.channel as 'email'|'whatsapp'|'linkedin',bindingId:r.binding_id as string,bindingDigest:r.binding_digest as string,recipient:{kind:r.recipient_kind as 'email'|'phone'|'linkedin_profile',value:r.recipient_value as string},identityRevision:r.identity_revision as string,history:r.history,historyComplete:r.history_complete as boolean,historyObservedAt:r.history_observed_at?new Date(r.history_observed_at).toISOString():null,nextAllowedAt:r.next_allowed_at?new Date(r.next_allowed_at).toISOString():null};
 }
 /** Fresh server-only proof that retrying history cannot re-enter an old effect. */
 async preBeginHistoryRetryProof(threadId:string,operationId:string,conversationId:string){
  uuid.parse(operationId);uuid.parse(conversationId);return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);
   const result=(await c.query(`SELECT o.state IN('proposed','approved') AND o.fence=0 AND o.lease_until IS NULL
    AND v.driver_kind='agent' AND v.phase='active' AND v.pending_driver IS NULL AND v.engagement NOT IN('stopped','handoff')
    AND o.input->>'contextRevision'=public.agent_context_revision(v.id)
    AND NOT EXISTS(SELECT 1 FROM communication_dispatch_intents i WHERE i.source_kind='agent' AND i.source_id=o.id)
    AND NOT EXISTS(SELECT 1 FROM agent_authority_uses u WHERE u.operation_id=o.id)
    AND NOT EXISTS(SELECT 1 FROM agent_budget_reservations r JOIN agent_budget_accounts a ON a.id=r.account_id WHERE r.operation_id=o.id AND a.unit='sends') AS allowed
    FROM agent_operations o JOIN agent_conversations v ON v.id=o.conversation_id AND v.thread_id=o.thread_id
    WHERE o.id=$1 AND o.thread_id=$2 AND v.id=$3 AND o.name IN(${agentNativeDispatchSqlNames})`,[operationId,t.id,conversationId])).rows[0]?.allowed;
   return result===true;
  });
 }
 /** Capture account metadata only for this dispatch invocation, inside the
  * existing actor/member-fenced transaction. This is not send authority. */
 async channelDispatchRecord(threadId:string,operationId:string,options:{includeOriginalAccount?:boolean}={}){
  uuid.parse(operationId);return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId),op=(await c.query(`SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN(${agentChannelMessageSqlNames})`,[operationId,t.id])).rows[0];
   if(!op)throw Error('Owned native message operation unavailable');
   // The dispatch snapshot needs owned identity/account metadata, not a context
   // digest. History ingestion, begin and final source admission still compute
   // and check their fresh context independently. Other callers keep the digest.
   const conversation=options.includeOriginalAccount===true?(await c.query('SELECT c.* FROM agent_conversations c WHERE c.id=$1 AND c.thread_id=$2 FOR UPDATE',[uuid.parse(op.conversation_id),t.id])).rows[0]:await this.lockConversation(c,t,op.conversation_id);
   if(!conversation)throw Error('Conversation not found');
   const route=await this.nativeOperationRoute(c,t,op);
   if(!route){if(!isAgentLegacyEmailOperation(op.name))throw Error('Social messages require their original reviewed route');await this.assertLegacyAgentEmail(c,t);}
   let originalAccount:Record<string,unknown>|undefined;
   if(options.includeOriginalAccount===true){
    const bindingId=route?.bindingId??conversation.binding_id,bindingDigest=route?.bindingDigest??conversation.binding_digest,channel=route?.channel??'email';
    if(conversation.delivery_mode!=='communications'||typeof bindingId!=='string')throw Error('Recorded native communications account required');
    const rows=(await c.query("SELECT * FROM public.communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND application_id='acquire' AND authority='service' AND backend='unipile'",[bindingId,this.actor.organizationId,this.actor.userId])).rows;
    const saved=rows[0];
    if(rows.length!==1||saved.id!==bindingId||saved.organization_id!==this.actor.organizationId||saved.owner_user_id!==this.actor.userId||saved.application_id!=='acquire'||saved.authority!=='service'||saved.backend!=='unipile'||saved.channel!==channel||recordedAgentBindingDigest(saved)!==bindingDigest)throw Error('Original native account changed');
    const value:ConnectionBinding={applicationId:saved.application_id,tenantId:saved.organization_id,ownerId:saved.owner_user_id,connectionId:saved.service_connection_id,accountId:saved.service_account_id,generation:saved.generation,channel:saved.channel,platform:saved.platform,backend:saved.backend};assertSameBinding(value,value);
    originalAccount=saved;
   }
   return {conversation,operation:op,route,submitted:op.state==='complete'&&op.result?.delivery?.status==='submitted',notSubmitted:op.state==='failed'&&op.result?.delivery?.status==='not_submitted',...(originalAccount?{originalAccount}:{})};
  });
 }
 async beginNativeCommunicationsEmail(threadId:string,operationId:string,authority?:AgentExecutionFence,delegation?:{id:string;revision:number}){
  uuid.parse(operationId);if(delegation){uuid.parse(delegation.id);z.number().int().positive().parse(delegation.revision);}
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'email-authority:'+operationId);
   await this.assertLegacyAgentEmail(c,t);
   const op=(await c.query(`SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN(${agentLegacyEmailSqlNames}) FOR UPDATE`,[operationId,t.id])).rows[0];
   if(!op)throw new Error('Native email operation not found');
   const conversation=await this.lockConversation(c,t,op.conversation_id);
   if(conversation.delivery_mode!=='communications')throw new Error('The recorded communications delivery mode is required');
   let row=conversation,running=op;
   if(op.state!=='running')({row,running}=await this.prepareNativeEmailAuthority(c,t,op,delegation));
   if(authority)await c.query("UPDATE agent_operations o SET lease_until=LEAST(o.lease_until,r.created_at+interval '45 seconds',r.lease_until) FROM agent_runs r WHERE o.id=$1 AND r.id=$2",[op.id,authority.runId]);
   if((await c.query('SELECT agent_operation_authorised($1::uuid) AS allowed',[op.id])).rows[0]?.allowed!==true)throw new Error('Current native sending authority or policy unavailable');
   await this.emitOperational(c,t,'provider-reconcile:'+op.id,'email.reconcile',{operationId:op.id},new Date(Date.now()+30000).toISOString());
   return {operationId:op.id as string,conversationId:row.id as string,epoch:Number(row.epoch),fence:String(running.fence),bindingId:row.binding_id as string,recipient:row.recipient_email as string,subject:op.input.subject as string,body:op.input.body as string,contextRevision:row.context_revision as string,inputDigest:op.input_digest as string};
  });
 }
 async deliverApprovedLocalEmail(threadId:string,operationId:string,authority?:AgentExecutionFence){return this.deliverLocalEmail(threadId,operationId,authority);}
 async deliverDelegatedLocalEmail(threadId:string,operationId:string,delegation:{id:string;revision:number},authority?:AgentExecutionFence){
  uuid.parse(delegation.id);z.number().int().positive().parse(delegation.revision);return this.deliverLocalEmail(threadId,operationId,authority,delegation);
 }
 private async deliverLocalEmail(threadId:string,operationId:string,authority?:AgentExecutionFence,delegation?:{id:string;revision:number}){
  uuid.parse(operationId);
  return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId);await this.assertExecutionFence(c,t,authority,'email-authority:'+operationId);
   const op=(await c.query(`SELECT * FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name IN(${agentLegacyEmailSqlNames}) FOR UPDATE`,[operationId,t.id])).rows[0];
   if(!op)throw new Error('Native email operation not found');
   const existing=(await c.query('SELECT * FROM agent_sink_messages WHERE operation_id=$1',[op.id])).rows[0];
   if(existing){if(op.state!=='complete'||existing.payload_digest!==op.input_digest)throw new Error('Simulation receipt needs reconciliation');return {status:'simulated' as const,receiptId:existing.message_id as string,operationId:op.id as string};}
   const recorded=await this.lockConversation(c,t,op.conversation_id);
   if(recorded.delivery_mode!=='local_sink')throw new Error('This operation requires communications-service dispatch; the local sink cannot change its delivery mode');
   const {row,accounts}=await this.prepareNativeEmailAuthority(c,t,op,delegation);
   // The database trigger rechecks current owner, membership, history, contact,
   // opt-outs, review, binding and reserved budget under the shared send gate.
   const receipt=(await c.query(`INSERT INTO agent_sink_messages(operation_id,conversation_id,organization_id,mandate_id,owner_user_id,thread_id,recipient_email,subject,body,payload_digest)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[op.id,row.id,t.organization_id,t.mandate_id,t.owner_user_id,t.id,row.recipient_email,op.input.subject,op.input.body,op.input_digest])).rows[0];
   const result={status:'simulated' as const,receiptId:receipt.message_id as string,operationId:op.id as string};
   await c.query('SELECT agent_settle_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(accounts.map(a=>({accountId:a.id,actual:'1'})))]);
   await c.query("UPDATE agent_authority_uses SET state='settled',outcome=$2,updated_at=now() WHERE operation_id=$1",[op.id,JSON.stringify(result)]);
   await c.query("UPDATE agent_operations SET state='complete',result=$2,lease_until=NULL,updated_at=now() WHERE id=$1",[op.id,JSON.stringify({delivery:result})]);
   const history=[...row.history,{id:'local:'+receipt.message_id,direction:'outbound',subject:receipt.subject,text:receipt.body,at:receipt.simulated_at.toISOString()}];
   if(history.length>200)throw new Error('Conversation history limit reached; human review required');
   const current=(await c.query(`UPDATE agent_conversations SET history=$2,history_revision=$3,history_observed_at=${this.businessSql()},revision=revision+1,epoch=epoch+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=now() WHERE id=$1 RETURNING epoch::text,reminder_generation`,[row.id,JSON.stringify(history),digest(history)])).rows[0];
   await this.invalidateNativeReviews(c,t,row.id);
   await this.emit(c,t,'post-delivery:'+op.id,'conversation.reassess',{conversationId:row.id,epoch:Number(current.epoch),reminderGeneration:current.reminder_generation});
   await this.controlNotice(c,t,'local-delivery:'+op.id,'The approved email was delivered to the local test sink. No provider email was sent.',{conversationId:row.id,...result});
   await this.emit(c,t,'local-delivery:'+op.id,'email.simulated',{conversationId:row.id,...result});return result;
  });
 }
}
