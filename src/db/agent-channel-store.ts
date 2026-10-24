import {projectAgentChannelDecisionContext} from './agent-channel-decision-context';
import{readManagedDefaults}from'@/lib/communications-bindings';
import{explicitAgentOptOut}from'@/domain/agent-execution';
import {z} from 'zod';
import {agentSequenceChannelHandoverSchema} from '@/domain/agent-sequence-channel-handover';
import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {resolveChannelReviewSchema} from '@/domain/channel-reviews';
import {lockAcquireSendGate} from '@/lib/campaign-send-gate';
import {configuredAgentRegisteredRuntime} from './agent-runtime-registry-store';
import type {AgentActor,AgentStoreOptions} from './agent-store';
import {AgentChatStore} from './agent-chat-store';
import {projectAgentChannelExecutionProgress} from './agent-execution-progress';
import {reviewWakeAuditCode} from './agent-channel-review-wake-proof';
import {agentRecordDigest,type AgentThread} from './agent-store';
import {agentChannelPolicyInputSchema,agentChannelRouteInputSchema,agentChannelSendingBudgetInputSchema} from '@/domain/agent-person-channel';
import {nativeHistorySchema,type NativeHistory} from '@/domain/agent-execution';
import {assertSameBinding,type ConnectionBinding,type DeliveryOutcome} from '../../communications/packages/contracts/src';
import type {NativeAgentDelivery} from './agent-outreach-store';
import {acceptAgentHistory} from '@/domain/agent-history';
const uuid=z.string().uuid();
const bindingDigest=(b:Record<string,unknown>)=>agentRecordDigest({applicationId:b.application_id,tenantId:b.organization_id,ownerId:b.owner_user_id,connectionId:b.service_connection_id,accountId:b.service_account_id,generation:b.generation,channel:b.channel,platform:b.platform,backend:b.backend});
export class AgentChannelStore extends AgentChatStore{
 private readonly reviewPool:Pick<Pool,'connect'>;
 constructor(pool:Pick<Pool,'connect'>,actor:AgentActor,options:AgentStoreOptions={}){super(pool,actor,options);this.reviewPool=pool;}
 /** Retry the exact committed decision after an API crash; the input is reloaded, never inferred. */
 async reconcileCommittedChannelReview(requestKey:string){
  uuid.parse(requestKey);if(!configuredAgentRegisteredRuntime())return {queued:0,conversationIds:[] as string[],runtimeId:null,remaining:0};
  const c=await this.reviewPool.connect();let raw:unknown;
  try{await c.query('BEGIN');await c.query('SET LOCAL ROLE acquire_campaign_user');
   const role=(await c.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];if(role?.name!=='acquire_campaign_user'||role.rolsuper||role.rolbypassrls)throw Error('Review proof role must enforce RLS');
   await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[this.actor.organizationId,this.actor.userId]);await lockAcquireSendGate(c,this.actor.organizationId,{required:true});
   if((await c.query('SELECT public.communications_lock_reply_member($1,$2) AS allowed',[this.actor.organizationId,this.actor.userId])).rows[0]?.allowed!==true)throw Error('Current review owner membership required');
   const rows=(await c.query("SELECT metadata FROM audit_events WHERE organization_id=$1 AND actor_id=$2 AND action='communications.reply_review_resolved' AND metadata->>'requestKey'=$3 LIMIT 2",[this.actor.organizationId,this.actor.userId,requestKey])).rows;
   if(rows.length!==1)throw Error('Exact committed review required');const m=rows[0].metadata;raw={requestKey:m.requestKey,bindingId:m.bindingId,serviceEventId:m.serviceEventId,expectedFingerprint:m.expectedFingerprint,createdAt:m.createdAt,decision:m.decision,reason:m.reason};await c.query('COMMIT');
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
  return this.wakeAfterChannelReview(raw);
 }
 /** A human unrelated-review clears a dependency, never supplies reply credit or send authority. */
 async wakeAfterChannelReview(raw:unknown){
  const input=resolveChannelReviewSchema.parse(raw),runtimeId=configuredAgentRegisteredRuntime();
  const empty={queued:0,conversationIds:[] as string[],runtimeId,remaining:0};if(!runtimeId)return empty;
  const reference='human-unrelated:'+input.requestKey,requestDigest=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const client=await this.reviewPool.connect();let resolvedAt:string,reviewedAt:string,reviewCode:'identity_pending'|'protocol';
  try{
   await client.query('BEGIN');await client.query('SET LOCAL ROLE acquire_campaign_user');
   const role=(await client.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
   if(role?.name!=='acquire_campaign_user'||role.rolsuper||role.rolbypassrls)throw Error('Review proof role must enforce RLS');
   await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[this.actor.organizationId,this.actor.userId]);
   await lockAcquireSendGate(client,this.actor.organizationId,{required:true});
   if((await client.query('SELECT public.communications_lock_reply_member($1,$2) AS allowed',[this.actor.organizationId,this.actor.userId])).rows[0]?.allowed!==true)throw Error('Current review owner membership required');
   const audits=(await client.query(`SELECT entity_type,entity_id,metadata,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS reviewed_at FROM audit_events WHERE organization_id=$1 AND actor_id=$2 AND action='communications.reply_review_resolved' AND metadata->>'requestKey'=$3 LIMIT 2`,[this.actor.organizationId,this.actor.userId,input.requestKey])).rows;
   const audit=audits[0],meta=audit?.metadata,code=meta?reviewWakeAuditCode(meta,input.serviceEventId):null;
   if(audits.length!==1||audit.entity_type!=='communication_reply_review'||audit.entity_id!==input.bindingId+':'+input.serviceEventId||meta.requestDigest!==requestDigest||meta.resolutionReference!==reference||meta.noReplyCredit!==true||!code||meta.expectedFingerprint!==input.expectedFingerprint||meta.bindingId!==input.bindingId||meta.serviceEventId!==input.serviceEventId||meta.decision!==input.decision)throw Error('Exact immutable human review audit required');
   reviewedAt=audit.reviewed_at;reviewCode=code!;
   const proof=(await client.query(`SELECT to_char(l.resolved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS resolved_at,to_jsonb(b) AS binding FROM communication_reply_review_latches l JOIN communication_event_receipts r ON r.binding_id=l.binding_id AND r.service_event_id=l.service_event_id AND r.organization_id=l.organization_id AND r.owner_user_id=l.owner_user_id JOIN communication_bindings b ON b.id=l.binding_id AND b.organization_id=l.organization_id AND b.owner_user_id=l.owner_user_id WHERE l.binding_id=$1 AND l.service_event_id=$2 AND l.organization_id=$3 AND l.owner_user_id=$4 AND l.resolved_at IS NOT NULL AND l.resolution_reference=$5 AND l.code=$8 AND date_trunc('milliseconds',l.created_at)=$6::timestamptz AND r.event_type=CASE WHEN $8='protocol' THEN 'account' ELSE 'message' END AND r.result='review' AND r.fingerprint_version='acquire.reply.delivery.v1' AND r.payload_fingerprint=$7`,[input.bindingId,input.serviceEventId,this.actor.organizationId,this.actor.userId,reference,input.createdAt,input.expectedFingerprint,reviewCode])).rows;
   if(proof.length!==1)throw Error('Exact resolved original review receipt required');
   if(reviewCode==='protocol'){const b=proof[0].binding,expectedBinding=createHash('sha256').update(JSON.stringify([b.application_id,b.organization_id,b.owner_user_id,b.service_connection_id,b.service_account_id,b.generation,b.channel,b.platform,b.backend])).digest('hex');if(meta.provenance.bindingDigest!==expectedBinding||Date.parse(meta.provenance.receivedAt)>Date.parse(reviewedAt))throw Error('Exact authenticated outbound review provenance required');}
   resolvedAt=proof[0].resolved_at;
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  return this.nativeTransaction(async c=>{
   const exact=(await c.query(`SELECT 1 FROM communication_reply_review_latches l JOIN communication_bindings b ON b.id=l.binding_id AND b.organization_id=l.organization_id AND b.owner_user_id=l.owner_user_id WHERE l.binding_id=$1 AND l.service_event_id=$2 AND l.organization_id=$3 AND l.owner_user_id=$4 AND l.resolved_at=$5::timestamptz AND l.resolution_reference=$6 AND l.code=$8 AND date_trunc('milliseconds',l.created_at)=$7::timestamptz`,[input.bindingId,input.serviceEventId,this.actor.organizationId,this.actor.userId,resolvedAt,reference,input.createdAt,reviewCode])).rowCount;
   if(exact!==1)throw Error('Review dependency changed before wake');
   // The barrier is organization-wide. Another unresolved review still blocks history.
   if((await c.query('SELECT 1 FROM communication_reply_review_latches WHERE organization_id=$1 AND resolved_at IS NULL LIMIT 1',[this.actor.organizationId])).rowCount)return empty;
   const eligibleSql=`SELECT v.id,v.thread_id,v.epoch,v.reminder_generation,t.mandate_id,t.organization_id,t.owner_user_id,t.revision FROM agent_conversations v JOIN agent_threads t ON t.id=v.thread_id JOIN agent_responsibilities r ON r.thread_id=t.id JOIN agent_runtime_registrations g ON g.thread_id=t.id AND g.responsibility_id=r.id AND g.responsibility_revision=r.revision JOIN mandates m ON m.id=t.mandate_id AND m.organization_id=t.organization_id WHERE t.organization_id=$1 AND t.owner_user_id=$2 AND v.organization_id=t.organization_id AND v.owner_user_id=t.owner_user_id AND v.mandate_id=t.mandate_id AND v.created_at<=$5::timestamptz AND v.phase='active' AND v.driver_kind='agent' AND v.history_complete=false AND v.engagement NOT IN('stopped','handoff') AND r.state IN('ready','waiting') AND r.mandate_revision=m.xmin::text AND g.runtime_id=$3 AND g.state='enabled' AND g.organization_id=t.organization_id AND g.owner_user_id=t.owner_user_id AND g.mandate_id=t.mandate_id AND NOT EXISTS(SELECT 1 FROM agent_handoffs h WHERE h.conversation_id=v.id AND h.state NOT IN('dismissed','meeting_confirmed')) AND NOT EXISTS(SELECT 1 FROM agent_events e WHERE e.thread_id=t.id AND e.event_key='channel-review-wake:'||$4||':'||v.id::text)`;
   const values=[this.actor.organizationId,this.actor.userId,runtimeId,input.requestKey,reviewedAt];
   const total=Number((await c.query('SELECT count(*)::text AS n FROM ('+eligibleSql+') candidate',values)).rows[0].n);
   const eligible=await c.query(eligibleSql+' ORDER BY t.id,v.id LIMIT 100 FOR UPDATE OF v,t,r',values);
   const rows=eligible.rows.slice(0,100),conversationIds:string[]=[];
   for(const row of rows){await this.emit(c,{id:row.thread_id,organization_id:row.organization_id,owner_user_id:row.owner_user_id,mandate_id:row.mandate_id,revision:row.revision},'channel-review-wake:'+input.requestKey+':'+row.id,'conversation.reassess',{conversationId:row.id,epoch:Number(row.epoch),reminderGeneration:row.reminder_generation});conversationIds.push(row.id);}
   return {queued:conversationIds.length,conversationIds,runtimeId,remaining:Math.max(0,total-rows.length)};
  });
 }

 async sequenceChannelHandoverPreview(threadId:string,enrolmentId:string){uuid.parse(enrolmentId);return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId);return(await c.query('SELECT public.agent_sequence_channel_handover_source($1::uuid,$2::uuid) AS source',[t.id,enrolmentId])).rows[0].source as {enrolmentId:string;versionId:string;generation:number;runtime:'legacy'|'n8n';state:string;contactId:string;contactName:string;startedAt:string;channelPolicyRevision:number;channels:z.infer<typeof agentSequenceChannelHandoverSchema>['channels'];sourceRevision:string};});}
 override async adoptSequenceConversation(threadId:string,key:string,raw:unknown){
  if(!raw||typeof raw!=='object'||!Object.hasOwn(raw,'channelPolicyRevision'))return super.adoptSequenceConversation(threadId,key,raw);
  const input=agentSequenceChannelHandoverSchema.parse(raw);return this.command(threadId,key,'ownership.adopt_sequence_channels',input,async(c,t)=>{
   const row=(await c.query('SELECT public.agent_adopt_sequence_channels($1::uuid,$2::jsonb) AS conversation',[t.id,JSON.stringify(input)])).rows[0].conversation;
   return {id:row.id as string,revision:row.revision as number,status:'sequence_owned',epoch:Number(row.epoch)};
  });
 }
 protected override async executionChannelProgress<T extends Record<string,unknown>>(c:PoolClient,t:AgentThread,conversations:T[]):Promise<T[]>{
  return projectAgentChannelExecutionProgress(c,t,conversations,this.businessSql());
 }
 private async policyProjection(c:PoolClient,mandateId:string,threadId?:string,defaults:Awaited<ReturnType<typeof readManagedDefaults>>=[]){
  const installed=(await c.query("SELECT to_regclass('public.agent_channel_policies') IS NOT NULL AS installed")).rows[0]?.installed===true;
  const row=installed&&threadId?(await c.query('SELECT * FROM agent_channel_policies WHERE thread_id=$1',[threadId])).rows[0]:null;
  const bindings=(await c.query("SELECT b.*,NOT EXISTS(SELECT 1 FROM communication_bindings newer WHERE newer.organization_id=b.organization_id AND newer.owner_user_id=b.owner_user_id AND newer.application_id=b.application_id AND newer.service_connection_id=b.service_connection_id AND newer.generation>b.generation) AS eligible_for_new_work FROM communication_bindings b WHERE b.organization_id=$1 AND b.owner_user_id=$2 AND b.application_id='acquire' AND b.backend='unipile' AND b.authority='service' AND public.agent_allowed_mandate_binding($3::uuid,b.id) ORDER BY b.channel,b.created_at DESC,b.id LIMIT 100",[this.actor.organizationId,this.actor.userId,mandateId])).rows;
  const balances=(await c.query(`SELECT id,scope_key,revision,cap::text,spent::text,reserved::text,(cap-spent-reserved)::text AS available,to_char(window_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS window_start_exact,to_char(window_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS window_end_exact FROM agent_budget_accounts WHERE organization_id=$1 AND scope_key LIKE $2 AND window_start<=clock_timestamp() AND window_end>clock_timestamp() ORDER BY scope_key,window_start DESC`,[this.actor.organizationId,'binding:%:sends'])).rows;
  const accounts=bindings.map(b=>{const digest=bindingDigest(b),a=balances.find(a=>a.scope_key==='binding:'+digest+':sends');return {channel:b.channel as 'email'|'whatsapp'|'linkedin',bindingId:b.id as string,bindingDigest:digest,label:[b.channel,b.platform,b.service_account_id].join(' · '),isDefault:defaults.some(d=>d.channel===b.channel&&d.connectionId===b.service_connection_id&&d.accountId===b.service_account_id&&d.generation===b.generation),eligibleForNewWork:b.eligible_for_new_work===true,budget:a?{id:a.id as string,revision:a.revision as number,cap:a.cap as string,spent:a.spent as string,reserved:a.reserved as string,available:a.available as string,windowStart:a.window_start_exact as string,windowEnd:a.window_end_exact as string}:null};});
  const policy=row?{revision:row.revision as number,channelOrder:row.channel_order as Array<'email'|'whatsapp'|'linkedin'>,delaySeconds:row.delay_seconds as number,bindings:row.bindings as Array<{channel:'email'|'whatsapp'|'linkedin';bindingId:string;bindingDigest:string}>,acceleratedSimulation:row.accelerated_simulation as boolean}:null;
  const canConfigureBudgets=(await c.query("SELECT 1 FROM member WHERE organization_id=$1 AND user_id=$2 AND role IN('owner','admin')",[this.actor.organizationId,this.actor.userId])).rowCount===1;
  return {mandateId,policy,accounts,canConfigureBudgets};
 }
 async channelPolicy(threadId:string){const defaults=await readManagedDefaults(this.actor);return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId);return this.policyProjection(c,t.mandate_id,t.id,defaults);});}
 /** The prepared recipient run is the source of demo routing defaults, never
  * whichever test account happens to appear first or be globally selected. */
 async demoOutreachAccounts(threadId:string){return this.nativeTransaction(async c=>{
  const t=await this.thread(c,threadId);
  const runs=(await c.query(`SELECT DISTINCT run.id,run.senders FROM public.agent_demo_runs run
   JOIN public.${this.workflowId(c)?'agent_effective_demo_contact_mappings':'agent_demo_contact_mappings'} mapping ON mapping.demo_run_id=run.id AND mapping.organization_id=run.organization_id AND mapping.created_by=run.owner_user_id
   JOIN public.${this.workflowModeTable(c)} mode ON mode.mandate_id=mapping.mandate_id AND mode.organization_id=mapping.organization_id AND mode.demo_id=mapping.demo_id
   WHERE mapping.mandate_id=$1 AND mapping.organization_id=$2 AND mapping.created_by=$3 AND mode.mode='demo' AND mode.created_by=$3`,[t.mandate_id,t.organization_id,t.owner_user_id])).rows;
  if(runs.length!==1)throw Error('One saved demo recipient run is required');
  return z.array(z.object({channel:z.enum(['email','whatsapp','linkedin']),bindingId:uuid,bindingDigest:z.string().regex(/^[a-f0-9]{64}$/)})).length(3).parse(runs[0].senders);
 });}
 /** Read-only timing exception. Final SQL admission independently rechecks the
  * same exact registered demo run; this supplies no approval or provider authority. */
 async testingSendWindowExempt(threadId:string,routeId:string){
  uuid.parse(routeId);return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);
   const guards=(await c.query("SELECT to_regprocedure('public.agent_gui_testing_send_window_exempt(uuid)') IS NOT NULL AS installed,to_regprocedure('public.agent_demo_send_window_exempt(uuid)') IS NOT NULL AS \"hostedInstalled\" ")).rows[0];
   if(guards?.installed!==true&&guards?.hostedInstalled!==true)return false;
   const guard=guards.hostedInstalled===true?'agent_demo_send_window_exempt':'agent_gui_testing_send_window_exempt';
   const rows=(await c.query(`SELECT public.${guard}(r.id) AS exempt FROM public.agent_conversation_channels r WHERE r.thread_id=$1 AND r.id=$2 AND r.organization_id=$3 AND r.owner_user_id=$4`,[t.id,routeId,this.actor.organizationId,this.actor.userId])).rows;
   return rows.length===1&&rows[0].exempt===true;
  });
 }
 async channelPolicyForMandate(mandateId:string){
  uuid.parse(mandateId);const defaults=await readManagedDefaults(this.actor);return this.nativeTransaction(async c=>{
   const mandate=(await c.query('SELECT id FROM mandates WHERE id=$1 AND organization_id=$2',[mandateId,this.actor.organizationId])).rows[0];if(!mandate)throw Error('Mandate not found');
   const t=(await c.query('SELECT id FROM agent_threads WHERE mandate_id=$1 AND organization_id=$2 AND owner_user_id=$3',[mandateId,this.actor.organizationId,this.actor.userId])).rows[0];
   return this.policyProjection(c,mandateId,t?.id,defaults);
  });
 }
 async saveChannelPolicy(threadId:string,key:string,raw:unknown){
  const input=agentChannelPolicyInputSchema.parse(raw);
  return this.command(threadId,key,'channel.policy',input,async(c,t)=>{
   const saved=(await c.query('SELECT public.agent_save_channel_policy($1::uuid,$2::integer,$3::jsonb,$4::integer,$5::jsonb,$6::boolean) AS policy',[t.id,input.expectedRevision,JSON.stringify(input.channelOrder),input.delaySeconds,JSON.stringify(input.bindings),input.acceleratedSimulation])).rows[0].policy;
   // Saving invalidates the old message context. Wake only current agent-owned
   // conversations so the ordinary history/decision path can prepare fresh
   // review proposals; never move deferred approvals or reuse their authority.
   const conversations=(await c.query(`SELECT v.id,v.epoch,v.reminder_generation FROM agent_conversations v
    JOIN agent_responsibilities r ON r.id=v.responsibility_id AND r.thread_id=v.thread_id
    JOIN mandates m ON m.id=v.mandate_id AND m.organization_id=v.organization_id
    WHERE v.thread_id=$1 AND v.organization_id=$2 AND v.owner_user_id=$3
    AND v.driver_kind='agent' AND v.phase='active' AND v.pending_driver IS NULL
    AND v.engagement NOT IN('stopped','handoff') AND r.state IN('ready','waiting') AND r.mandate_revision=m.xmin::text
    AND NOT public.agent_mandate_person_has_unresolved_sends(v.mandate_id,v.contact_id,NULL::uuid)
    AND NOT EXISTS(SELECT 1 FROM agent_handoffs h WHERE h.conversation_id=v.id AND h.state NOT IN('dismissed','meeting_confirmed'))
    ORDER BY v.id`,[t.id,t.organization_id,t.owner_user_id])).rows;
   for(const person of conversations)await this.emit(c,t,'channel-policy:'+saved.revision+':reassess:'+person.id,'conversation.reassess',{conversationId:person.id,epoch:Number(person.epoch),reminderGeneration:person.reminder_generation});
   return {id:t.id,revision:saved.revision as number,status:'channel_policy_saved'};
  });
 }
 async configureChannelSendingBudget(threadId:string,key:string,raw:unknown){
  const input=agentChannelSendingBudgetInputSchema.parse(raw);
  return this.command(threadId,key,'channel.budget',input,async(c,t)=>{
   const b=(await c.query("SELECT b.* FROM communication_bindings b JOIN agent_channel_policies p ON p.thread_id=$1 WHERE b.id=$2 AND b.organization_id=$3 AND b.owner_user_id=$4 AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.bindings) x WHERE x->>'bindingId'=b.id::text)",[t.id,input.bindingId,t.organization_id,t.owner_user_id])).rows[0];
   if(!b)throw Error('Exact reviewed owned account required');
   const scopeKey='binding:'+bindingDigest(b)+':sends';
   const a=(await c.query('SELECT public.agent_configure_budget($1,$2,$3::timestamptz,$4::timestamptz,$5::bigint,$6::integer) AS account',[scopeKey,'sends',input.windowStart,input.windowEnd,input.cap,input.expectedRevision])).rows[0].account;
   await this.controlNotice(c,t,'channel-budget:'+a.id+':'+a.revision,'You configured this exact account’s sending cap. This does not approve a message.',{bindingId:b.id,cap:input.cap,windowStart:input.windowStart,windowEnd:input.windowEnd});
   return {id:a.id as string,revision:a.revision as number,status:'configured'};
  });
 }
 async registerConversationChannel(threadId:string,key:string,raw:unknown){
  const input=agentChannelRouteInputSchema.parse(raw);
  return this.command(threadId,key,'channel.register',input,async(c,t)=>{
   const saved=(await c.query('SELECT public.agent_register_channel($1::uuid,$2::uuid,$3::integer,$4,$5::uuid,$6,$7,$8,$9::jsonb) AS route',[t.id,input.conversationId,input.revision,input.contextRevision,input.bindingId,input.channel,input.recipient.kind,input.recipient.value,JSON.stringify(input.identityProof)])).rows[0].route;
   return {id:saved.id as string,revision:saved.revision as number,status:'channel_registered'};
  });
 }
 protected async channelRows(c:PoolClient,t:AgentThread,conversationId:string,readOnly=false){
  const row=readOnly?(await c.query('SELECT id FROM agent_conversations WHERE id=$1 AND thread_id=$2',[conversationId,t.id])).rows[0]:await this.lockConversation(c,t,conversationId);
  if(!row)throw Error('Conversation not found');
  const installed=(await c.query("SELECT to_regclass('public.agent_conversation_channels') IS NOT NULL AS installed")).rows[0]?.installed===true;
  if(!installed)return [];
  const relationshipSelect=readOnly?'x.observed_at':'NULL::timestamptz';
  const relationshipJoin=readOnly?" LEFT JOIN agent_linkedin_relationships x ON x.route_id=r.id AND x.binding_digest=r.binding_digest AND x.identity_revision=r.identity_revision AND x.status<>'unknown'":'';
  return (await c.query(`SELECT r.*,p.revision AS policy_revision,${relationshipSelect} AS relationship_observed_at FROM agent_conversation_channels r JOIN agent_channel_policies p ON p.thread_id=$2${relationshipJoin} WHERE r.conversation_id=$1 ORDER BY array_position(p.channel_order,r.channel),r.id`,[row.id,t.id])).rows.map(r=>({id:r.id as string,conversationId:r.conversation_id as string,channel:r.channel as 'email'|'whatsapp'|'linkedin',bindingId:r.binding_id as string,bindingDigest:r.binding_digest as string,recipient:{kind:r.recipient_kind as 'email'|'phone'|'linkedin_profile',value:r.recipient_value as string},identityRevision:r.identity_revision as string,revision:r.revision as number,policyRevision:r.policy_revision as number,history:r.history as unknown[],historyComplete:r.history_complete as boolean,historyRevision:r.history_revision as string,historyObservedAt:r.history_observed_at?new Date(r.history_observed_at).toISOString():null,relationshipObservedAt:r.relationship_observed_at?new Date(r.relationship_observed_at).toISOString():null,nextAllowedAt:r.next_allowed_at?new Date(r.next_allowed_at).toISOString():null,coldCancelledAt:r.cold_cancelled_at?new Date(r.cold_cancelled_at).toISOString():null}));
 }
 /** Original account metadata for one history refresh; never dispatch authority. */
 async historyAccountSnapshot(threadId:string,conversationId:string){
  return this.nativeTransaction(async c=>{
   const t=await this.thread(c,threadId);
   const conversation=(await c.query('SELECT * FROM agent_conversations WHERE id=$1 AND thread_id=$2',[uuid.parse(conversationId),t.id])).rows[0];
   if(!conversation)throw Error('Conversation not found');
   const accounts=(await c.query(`SELECT b.* FROM communication_bindings b WHERE b.organization_id=$1 AND b.owner_user_id=$2 AND b.id IN (SELECT binding_id FROM agent_conversation_channels WHERE conversation_id=$3 AND thread_id=$4)`,[t.organization_id,t.owner_user_id,conversation.id,t.id])).rows;
   const routes=await this.channelRows(c,t,conversation.id,true);
   return {conversation,accounts,routes};
  },undefined,true);
 }
 async channelRoutes(threadId:string,conversationId:string){return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId);return this.channelRows(c,t,uuid.parse(conversationId),true);},undefined,true);}
 async ingestChannelHistory(threadId:string,conversationId:string,routeId:string,raw:unknown){
  uuid.parse(routeId);return this.nativeTransaction(async c=>{
   const t=await this.lockThread(c,threadId),person=await this.lockConversation(c,t,conversationId);
   const route=(await c.query('SELECT * FROM agent_conversation_channels WHERE id=$1 AND conversation_id=$2 AND thread_id=$3',[routeId,person.id,t.id])).rows[0];if(!route)throw Error('Original owned channel route unavailable');
   const now=(await c.query(`SELECT ${this.businessSql()} AS instant`)).rows[0].instant.toISOString();let next:NativeHistory;
   try{
    const input=nativeHistorySchema.parse(raw);if(input.source!=='communications')throw Error('Recorded provider history required');
    const messages=input.messages.map(message=>{
     if(message.routeId!==route.id||message.channel!==route.channel||message.bindingDigest!==route.binding_digest||!message.providerMessageId||message.id!=='channel-message:'+createHash('sha256').update(JSON.stringify([route.binding_digest,message.providerMessageId])).digest('hex'))throw Error('History route, original account or provider identity differs');
     const legacy=route.channel==='email'&&route.binding_id===person.binding_id?person.history.find((m:NativeHistory['messages'][number])=>!m.routeId&&m.id===message.providerMessageId):undefined;
     if(legacy){if(legacy.direction!==message.direction||legacy.text!==message.text||(legacy.subject??'')!==(message.subject??'')||Date.parse(legacy.at)!==Date.parse(message.at))throw Error('Original legacy history differs');return legacy;}
     return message;
    });
    const original=route.channel==='email'&&route.binding_id===person.binding_id&&person.history_source==='communications'?person.history.filter((m:NativeHistory['messages'][number])=>!m.routeId):[];
    const previous=route.history_observed_at?{source:'communications' as const,observedAt:new Date(route.history_observed_at).toISOString(),complete:route.history_complete,messages:route.history}:original.length?{source:'communications' as const,observedAt:new Date(person.history_observed_at).toISOString(),complete:person.history_complete,messages:original}:undefined;
    next=acceptAgentHistory(previous,{...input,messages},'communications',now);
   }catch{
    const changed=(await c.query("UPDATE agent_conversations SET phase=CASE WHEN driver_kind='agent' AND phase='active' THEN 'held' ELSE phase END,pause_reason=CASE WHEN driver_kind='agent' AND phase='active' OR pause_reason IN('provider_receipt_pending_history','provider_outcome_unknown','channel_history_pending') THEN 'history_conflict' ELSE pause_reason END,history_complete=false,revision=revision+1,epoch=epoch+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision",[person.id])).rows[0];
    await this.invalidateNativeReviews(c,t,person.id);await this.controlNotice(c,t,'route-history-conflict:'+route.id+':'+changed.revision,'A recorded channel history could not be verified. Automation is held for human review.',{conversationId:person.id,routeId:route.id,channel:route.channel});
    return {id:person.id as string,revision:changed.revision as number,status:'held',historyAccepted:false};
   }
   await c.query('SELECT public.agent_save_channel_history($1::uuid,$2::integer,$3::jsonb,$4::timestamptz,$5::boolean)',[route.id,route.revision,JSON.stringify(next.messages),next.observedAt,next.complete]);
   const routes=await this.channelRows(c,t,person.id),policy=(await c.query('SELECT channel_order FROM agent_channel_policies WHERE thread_id=$1',[t.id])).rows[0];
   const messages=new Map<string,NativeHistory['messages'][number]>();
   for(const message of [...person.history,...routes.flatMap(r=>r.history)] as NativeHistory['messages']){
    const previous=messages.get(message.id);if(previous&&agentRecordDigest(previous)!==agentRecordDigest(message))throw Error('Recorded cross-account history identity conflict');messages.set(message.id,message);
   }
   const complete=routes.length===policy.channel_order.length&&routes.every(r=>r.historyComplete),observations=routes.flatMap(r=>r.historyObservedAt?[r.historyObservedAt]:[]),observedAt=observations.sort().at(-1)??next.observedAt;
   const combined={source:'communications',observedAt,complete,messages:[...messages.values()],...(next.deliveryFailures?{deliveryFailures:next.deliveryFailures}:{})};
   return this.ingestNativeHistory(c,t,person.id,combined,{allowPendingChannelHistory:true});
  });
 }
 protected override async markRoutedCommunicationsOutcome(c:PoolClient,t:AgentThread,record:Record<string,unknown>,outcome:DeliveryOutcome):Promise<NativeAgentDelivery>{
  const op=record as {id:string;input:Record<string,unknown>;conversation_id:string;state:string;result?:{delivery?:NativeAgentDelivery}};
  const route=await this.nativeOperationRoute(c,t,op as {input:Record<string,unknown>;conversation_id:string});if(!route)throw Error('Original reviewed route required');
  const row=await this.lockConversation(c,t,op.conversation_id);
  if(op.state==='complete'&&op.result?.delivery?.status==='submitted'){
   if(outcome.status==='submitted'&&(!('message'in outcome.receipt)||!('providerMessageId'in op.result.delivery)||outcome.receipt.message.id!==op.result.delivery.providerMessageId))throw Error('Different original delivery receipt');return op.result.delivery;
  }
  if(op.state==='uncertain'&&op.result?.delivery?.status==='unknown'&&outcome.status!=='submitted')return op.result.delivery;
  if(!['running','uncertain'].includes(op.state))throw Error('No admitted original route send requires reconciliation');
  let delivery:NativeAgentDelivery={status:'unknown'};
  if(outcome.status==='submitted'){
   if(!('message'in outcome.receipt))throw Error('Original message receipt required');const receipt=outcome.receipt;
   if(!receipt.submittedAt||!Number.isFinite(Date.parse(receipt.submittedAt))||Date.parse(receipt.submittedAt)>this.businessNow()||!receipt.message.id||receipt.message.id.length>300||receipt.recipient.kind!==route.recipient.kind||receipt.recipient.value!==route.recipient.value)throw Error('Exact original channel recipient and timestamp required');
   const b=(await c.query('SELECT * FROM communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3',[route.bindingId,t.organization_id,t.owner_user_id])).rows[0];if(!b)throw Error('Original recorded account unavailable');
   const binding:ConnectionBinding={applicationId:b.application_id,tenantId:b.organization_id,ownerId:b.owner_user_id,connectionId:b.service_connection_id,accountId:b.service_account_id,generation:b.generation,channel:b.channel,platform:b.platform,backend:b.backend};assertSameBinding(binding,receipt.message.binding);
   const intent=(await c.query("SELECT i.id FROM communication_dispatch_intents i JOIN communication_dispatch_permits p ON p.intent_id=i.id WHERE i.organization_id=$1 AND i.owner_user_id=$2 AND i.source_kind='agent' AND i.source_id=$3 AND i.binding_id=$4 ORDER BY i.created_at,i.id LIMIT 1",[t.organization_id,t.owner_user_id,op.id,route.bindingId])).rows[0];if(!intent)throw Error('Original admitted routed intent required');
   delivery={status:'submitted',providerMessageId:receipt.message.id,submittedAt:receipt.submittedAt,intentId:intent.id};
  }
  const reservations=(await c.query("SELECT account_id FROM agent_budget_reservations WHERE operation_id=$1 AND state IN('reserved','uncertain') ORDER BY account_id",[op.id])).rows;
  if(reservations.length!==4)throw Error('Original four scoped send reservations required');
  await c.query('SELECT agent_settle_budget($1::uuid,$2::jsonb)',[op.id,JSON.stringify(reservations.map(a=>({accountId:a.account_id,actual:delivery.status==='submitted'?'1':null})))]);
  await c.query("UPDATE agent_authority_uses SET state=$2,outcome=$3,updated_at=now() WHERE operation_id=$1",[op.id,delivery.status==='submitted'?'settled':'uncertain',JSON.stringify(delivery)]);
  await c.query('UPDATE agent_operations SET state=$2,result=$3,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1',[op.id,delivery.status==='submitted'?'complete':'uncertain',JSON.stringify({delivery})]);
  if(delivery.status==='submitted')await c.query('SELECT public.agent_channel_record_submission($1::uuid)',[op.id]);
  const coldDue=delivery.status==='submitted'?(await c.query("SELECT r.id,p.revision,r.next_allowed_at FROM agent_conversation_channels r JOIN agent_channel_policies p ON p.thread_id=r.thread_id WHERE r.conversation_id=$1 AND r.cold_cancelled_at IS NULL AND r.next_allowed_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_conversations v,jsonb_array_elements(v.history) m WHERE v.id=r.conversation_id AND m->>'direction'='inbound') ORDER BY r.next_allowed_at,r.id LIMIT 1",[row.id])).rows[0]:null;
  if(coldDue){const due=new Date(coldDue.next_allowed_at).toISOString();await this.emit(c,t,'channel-due:'+op.id,'channel.due',{conversationId:row.id,routeId:coldDue.id,policyRevision:coldDue.revision,scheduledAt:due},due);}
  const changed=(await c.query(`UPDATE agent_conversations SET history_complete=false,epoch=epoch+1,revision=revision+1,reminder_generation=reminder_generation+1,next_wakeup_at=NULL,
   phase=CASE WHEN driver_kind='agent' AND phase='active' AND NOT $2 THEN 'held' ELSE phase END,
   pause_reason=CASE WHEN driver_kind<>'agent' OR phase IN('paused','quiescing','complete') OR pause_reason IS NOT NULL AND pause_reason NOT IN('provider_receipt_pending_history','provider_outcome_unknown','channel_history_pending') THEN pause_reason WHEN $2 THEN 'provider_receipt_pending_history' ELSE 'provider_outcome_unknown' END,updated_at=clock_timestamp() WHERE id=$1 RETURNING revision`,[row.id,delivery.status==='submitted'])).rows[0];
  await this.invalidateNativeReviews(c,t,row.id);
  await this.emitOperational(c,t,delivery.status==='submitted'?'provider-history:'+op.id:'provider-reconcile:'+op.id,delivery.status==='submitted'?'conversation.history_changed':route.channel+'.reconcile',delivery.status==='submitted'?{conversationId:row.id}:{operationId:op.id},new Date(Date.now()+(delivery.status==='submitted'?2000:30000)).toISOString());
  await this.controlNotice(c,t,'provider-outcome:'+op.id+':'+changed.revision,delivery.status==='submitted'?'The original '+route.channel+' message submission was confirmed. All recorded channel histories must be checked before another action.':'The original '+route.channel+' outcome is uncertain. Automation remains held and its budget reserved; no new send was attempted.',{operationId:op.id,conversationId:row.id,routeId:route.id,channel:route.channel,...delivery});
  return delivery;
 }
 protected override async revokePersonDelegations(c:PoolClient,t:AgentThread,conversationId:string,email:string|null){
  await super.revokePersonDelegations(c,t,conversationId,email);
  const installed=(await c.query("SELECT to_regclass('public.agent_conversation_channels') IS NOT NULL AS installed")).rows[0]?.installed;if(!installed)return;
  await c.query("UPDATE agent_authority_grants g SET revoked_at=clock_timestamp(),revision=revision+1 WHERE g.thread_id=$1 AND g.revoked_at IS NULL AND EXISTS(SELECT 1 FROM agent_conversation_channels r WHERE r.conversation_id=$2 AND (g.route_ids ? r.id::text OR g.recipient_keys ? (r.channel||':'||r.recipient_value)))",[t.id,conversationId]);
 }
 protected override async heldRoutedReconciliation(c:PoolClient,t:AgentThread,row:Record<string,unknown>){
  const proof=(await c.query("SELECT o.* FROM agent_operations o WHERE o.conversation_id=$1 AND o.thread_id=$2 AND o.input ? 'routeId' AND o.name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','linkedin.invitation') AND ((o.state='failed' AND o.result->'delivery'->>'status'='not_submitted' AND EXISTS(SELECT 1 FROM agent_authority_uses u WHERE u.operation_id=o.id AND u.state='released') AND (SELECT count(*) FROM agent_budget_reservations b WHERE b.operation_id=o.id AND b.state='settled' AND b.actual=0)=4) OR (o.state='complete' AND o.result->'delivery'->>'status'='submitted' AND EXISTS(SELECT 1 FROM agent_authority_uses u WHERE u.operation_id=o.id AND u.state='settled') AND (SELECT count(*) FROM agent_budget_reservations b WHERE b.operation_id=o.id AND b.state='settled' AND b.actual=1)=4)) ORDER BY o.updated_at DESC,o.id DESC LIMIT 1",[row.id,t.id])).rows[0];
  if(!proof)return null;const route=await this.nativeOperationRoute(c,t,proof);if(!route)throw Error('Original recorded route reconciliation required');
  const delivery=proof.result.delivery;
  if(delivery.status==='submitted'){
   if(!(await c.query("SELECT 1 FROM communication_dispatch_intents i JOIN communication_dispatch_permits p ON p.intent_id=i.id WHERE i.id=$1 AND i.source_kind='agent' AND i.source_id=$2 AND i.binding_id=$3 AND i.organization_id=$4 AND i.owner_user_id=$5",[delivery.intentId,proof.id,route.bindingId,t.organization_id,t.owner_user_id])).rowCount)throw Error('Original admitted channel receipt required');
  }else if(delivery.intentId){if(!(await c.query("SELECT 1 FROM communication_dispatch_intents i JOIN communication_intent_resolutions r ON r.intent_id=i.id WHERE i.id=$1 AND i.source_kind='agent' AND i.source_id=$2 AND i.binding_id=$3 AND r.proof_digest=$4",[delivery.intentId,proof.id,route.bindingId,delivery.proofDigest])).rowCount)throw Error('Original channel no-submission proof required');}
  else if(delivery.reason!=='expired_without_application_intent'||(await c.query("SELECT 1 FROM communication_dispatch_intents WHERE source_kind='agent' AND source_id=$1",[proof.id])).rowCount)throw Error('Original unprepared channel proof required');
  return proof as Record<string,unknown>;
 }
 protected override async assertConversationReviewHistory(c:PoolClient,t:AgentThread,row:Record<string,unknown>){
  const routes=await this.channelRows(c,t,String(row.id));if(!routes.length)return super.assertConversationReviewHistory(c,t,row);
  const now=(await c.query(`SELECT ${this.businessSql()} AS instant`)).rows[0].instant as Date,observed=row.history_observed_at as Date|null,policy=(await c.query('SELECT channel_order,bindings FROM agent_channel_policies WHERE thread_id=$1',[t.id])).rows[0];
  if(!row.history_complete||row.history_source!=='communications'||!observed||observed>now||now.getTime()-observed.getTime()>300000||!policy||routes.length!==policy.channel_order.length||routes.some(r=>!policy.channel_order.includes(r.channel)||!policy.bindings.some((b:{channel:string;bindingId:string;bindingDigest:string})=>b.channel===r.channel&&b.bindingId===r.bindingId&&b.bindingDigest===r.bindingDigest)||!r.historyComplete||!r.historyObservedAt||Date.parse(r.historyObservedAt)>now.getTime()||Date.parse(r.historyObservedAt)<now.getTime()-300000))throw Error('Refresh every recorded channel history before reassessment');
  if((row.history as NativeHistory['messages']).some(m=>m.direction==='inbound'&&explicitAgentOptOut(m.text)))throw Error('An opted-out person cannot be reassessed');
  const bindings=(await c.query('SELECT * FROM communication_bindings WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND owner_user_id=$3',[routes.map(r=>r.bindingId),t.organization_id,t.owner_user_id])).rows;
  if(routes.some(r=>{const b=bindings.find(b=>b.id===r.bindingId);return !b||b.backend!=='unipile'||b.authority!=='service'||bindingDigest(b)!==r.bindingDigest;}))throw Error('Original recorded channel account changed');
  const allowed=(await c.query("SELECT NOT public.agent_mandate_person_has_unresolved_sends((SELECT mandate_id FROM agent_conversations WHERE id=$2),$1::uuid,NULL::uuid) AND NOT public.agent_mandate_legacy_sequence_occupied((SELECT mandate_id FROM agent_conversations WHERE id=$2),$1::uuid) AND NOT EXISTS(SELECT 1 FROM agent_conversation_channels r WHERE r.conversation_id=$2 AND (r.identity_source->>'revision' IS DISTINCT FROM (SELECT xmin::text FROM contacts WHERE id=$1))) AND NOT EXISTS(SELECT 1 FROM contacts x WHERE 'contact:'||x.id::text=ANY(public.agent_person_keys($3,$1::uuid)) AND (x.fictionalised OR coalesce(x.personal_data->>'doNotContact','false')<>'false')) AND NOT EXISTS(SELECT 1 FROM suppressions s JOIN agent_conversation_channels r ON r.conversation_id=$2 WHERE s.organization_id=$3 AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(r.recipient_value,'@',2))) AS allowed",[row.contact_id,row.id,t.organization_id])).rows[0]?.allowed;
  if(allowed!==true)throw Error('Current person, original accounts and unresolved outcomes must be clear');
 }
 protected override async assertRoutedResumeHistory(c:PoolClient,t:AgentThread,row:Record<string,unknown>,record:Record<string,unknown>){
  const proof=record as {id:string;input:Record<string,unknown>;conversation_id:string;result:{delivery:{status:string;providerMessageId?:string;effect?:string;providerOperationId?:string}}},route=await this.nativeOperationRoute(c,t,proof);if(!route)throw Error('Original recorded route required');
  const routes=await this.channelRows(c,t,String(row.id)),policy=(await c.query('SELECT channel_order FROM agent_channel_policies WHERE thread_id=$1',[t.id])).rows[0],now=(await c.query(`SELECT ${this.businessSql()} AS instant`)).rows[0].instant as Date;
  if(!policy||routes.length!==policy.channel_order.length||routes.some(r=>!r.historyComplete||!r.historyObservedAt||Date.parse(r.historyObservedAt)>now.getTime()||Date.parse(r.historyObservedAt)<now.getTime()-300000))throw Error('Verify every recorded channel history before resuming');
  if(record.name==='linkedin.invitation'||proof.result.delivery.effect==='invitation')await this.assertInvitationResumeHistory(c,t,row,record);
  else if(proof.result.delivery.status==='submitted'&&!routes.some(r=>r.id===route.id&&r.history.some(raw=>{const m=raw as NativeHistory['messages'][number];return m.direction==='outbound'&&m.providerMessageId===proof.result.delivery.providerMessageId&&m.routeId===route.id&&m.bindingDigest===route.bindingDigest;})))throw Error('Verify the original routed provider message before resuming');
  const bindings=(await c.query('SELECT * FROM communication_bindings WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND owner_user_id=$3',[routes.map(r=>r.bindingId),t.organization_id,t.owner_user_id])).rows;
  if(routes.some(r=>{const b=bindings.find(b=>b.id===r.bindingId);return !b||bindingDigest(b)!==r.bindingDigest;}))throw Error('Original recorded channel account changed');
  const allowed=(await c.query("SELECT NOT public.agent_mandate_person_has_unresolved_sends((SELECT mandate_id FROM agent_conversations WHERE id=$2),$1::uuid,NULL::uuid) AND NOT public.agent_mandate_legacy_sequence_occupied((SELECT mandate_id FROM agent_conversations WHERE id=$2),$1::uuid) AND NOT EXISTS(SELECT 1 FROM agent_conversation_channels r WHERE r.conversation_id=$2 AND (r.identity_source->>'revision' IS DISTINCT FROM (SELECT xmin::text FROM contacts WHERE id=$1))) AND NOT EXISTS(SELECT 1 FROM contacts x WHERE 'contact:'||x.id::text=ANY(public.agent_person_keys($3,$1::uuid)) AND (x.fictionalised OR coalesce(x.personal_data->>'doNotContact','false')<>'false')) AND NOT EXISTS(SELECT 1 FROM suppressions s JOIN agent_conversation_channels r ON r.conversation_id=$2 WHERE s.organization_id=$3 AND (lower(s.address)=lower(r.recipient_value) OR r.channel='email' AND lower(s.domain)=split_part(r.recipient_value,'@',2))) AS allowed",[row.contact_id,row.id,t.organization_id])).rows[0]?.allowed;
  if(allowed!==true)throw Error('Current person, original accounts and unresolved outcomes must be clear');
  await c.query("UPDATE agent_authority_grants g SET revoked_at=clock_timestamp(),revision=revision+1 WHERE g.thread_id=$1 AND g.revoked_at IS NULL AND EXISTS(SELECT 1 FROM agent_conversation_channels r WHERE r.conversation_id=$2 AND (g.route_ids ? r.id::text OR g.recipient_keys ? (r.channel||':'||r.recipient_value)))",[t.id,row.id]);
 }
 protected async assertInvitationResumeHistory(_c:PoolClient,_t:AgentThread,_row:Record<string,unknown>,_proof:Record<string,unknown>):Promise<void>{void _c;void _t;void _row;void _proof;throw Error('Fresh verified invitation relationship required');}
 async channelDueReassessment(threadId:string,raw:unknown){
  const input=z.object({conversationId:uuid,routeId:uuid,policyRevision:z.number().int().positive(),scheduledAt:z.string().datetime({offset:true})}).strict().parse(raw);
  return this.nativeTransaction(async c=>{const t=await this.lockThread(c,threadId);const result=(await c.query('SELECT public.agent_channel_due_reassessment($1::uuid,$2::uuid,$3::integer,$4::timestamptz) AS work',[t.id,input.routeId,input.policyRevision,input.scheduledAt])).rows[0]?.work;
   if(!result)return null;if(result.conversationId!==input.conversationId)throw Error('Saved channel due conversation differs');return result as {conversationId:string;epoch:number;reminderGeneration:number};
  });
 }
 protected override async nativeChannelDecisionContext(c:PoolClient,t:AgentThread,row:Record<string,unknown>){
  const routes=await this.channelRows(c,t,String(row.id));
  return projectAgentChannelDecisionContext(c,routes);
 }
}
