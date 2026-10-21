import {agentNativeDispatchSqlNames} from './agent-operation-sql';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {AgentSequenceExecutionStore} from './agent-sequence-execution-store';
import {agentRecordDigest as digest,type AgentThread} from './agent-store';
import {loadApprovedAgentGuidance,assertAgentGuidanceSnapshot} from '@/lib/agent-guidance-snapshot';
import {nativeChatPlanSchema,nativeChatContextSchema} from '@/lib/agent-chat-plan';
export class AgentChatStore extends AgentSequenceExecutionStore{
 async nativeChatContext(threadId:string,question:string){
  const state=await this.executionState(threadId),r=state.responsibility;
  if(!r||!['ready','waiting'].includes(r.state)||r.mandate_revision!==state.mandateRevision)return null;
  // A typed recipient address or exact conversation UUID is an explicit target.
  // Never silently choose the first or only conversation/account.
  const mentioned=state.conversations.filter(row=>question.includes(row.id)||question.toLowerCase().includes(String(row.recipient_email).toLowerCase()));
  const conversation=mentioned.length===1?await this.nativeDecisionContext(threadId,mentioned[0].id):null;
  const t=await this.findThread(r.mandate_id);if(!t||t.id!==threadId)throw new Error('Owned chat thread required');
  const choices=await this.targetDeliveryOptions(t.mandate_id),bindings=choices.bindings.filter(row=>question.toLowerCase().includes('use email account '+row.id.toLowerCase()));
  const delivery=bindings.length===1?{mode:'communications',bindingId:bindings[0].id}:choices.simulationEnabled&&/\buse local simulation\b/i.test(question)?{mode:'local_sink'}:null;
  // These are saved setup facts, never a chat-selected delivery account or send authority.
  const savedOutreach=await this.nativeTransaction(async c=>{
   const owned=await this.thread(c,threadId);
   if((await c.query("SELECT to_regclass('public.agent_channel_policies') IS NOT NULL AS installed")).rows[0]?.installed!==true)return {channelPolicySaved:false};
   const channelPolicySaved=(await c.query('SELECT EXISTS(SELECT 1 FROM agent_channel_policies WHERE thread_id=$1 AND organization_id=$2) AS saved',[owned.id,owned.organization_id])).rows[0]?.saved===true;
   if(!channelPolicySaved)return {channelPolicySaved};
   // The latest fenced worker outcome, original approved operation and absence
   // of an admitted dispatch intent together ground this waiting projection.
   // Re-read current policy here: a later accelerated-policy save invalidates
   // this explanation even if the old event still has a future wake-up time.
   const wait=(await c.query(`SELECT count(DISTINCT o.id)::int AS approved_messages,min(e.available_at) AS next_at
    FROM agent_events e JOIN agent_channel_policies p ON p.thread_id=e.thread_id
    JOIN agent_review_batches b ON b.thread_id=e.thread_id AND b.id::text=e.payload->>'reviewBatchId' AND b.state='approved'
    JOIN LATERAL jsonb_array_elements(b.manifest) item ON true
    JOIN agent_operations o ON o.thread_id=e.thread_id AND o.id::text=item->>'operationId' AND o.state='approved'
    JOIN LATERAL (SELECT r.state,r.stop_reason FROM agent_runs r WHERE r.trigger_event_id=e.id AND r.thread_id=e.thread_id ORDER BY r.created_at DESC,r.id DESC LIMIT 1) last_run ON true
    WHERE e.thread_id=$1 AND e.organization_id=$2 AND e.owner_user_id=$3 AND e.kind='review.approved' AND e.state='pending'
     AND last_run.state='waiting' AND last_run.stop_reason='Waiting for the next permitted sending window.'
     AND p.accelerated_simulation IS FALSE AND e.available_at>${this.businessSql()}
     AND (e.operational_not_before_at IS NULL OR e.operational_not_before_at<=clock_timestamp())
     AND o.name IN(${agentNativeDispatchSqlNames})
     AND NOT EXISTS(SELECT 1 FROM communication_dispatch_intents i WHERE i.source_kind='agent' AND i.source_id=o.id AND i.organization_id=$2 AND i.owner_user_id=$3)`,[owned.id,owned.organization_id,owned.owner_user_id])).rows[0];
   const nextAt=wait?.next_at?new Date(wait.next_at).getTime():NaN;
   return {channelPolicySaved,...(Number.isSafeInteger(wait?.approved_messages)&&wait.approved_messages>0&&Number.isFinite(nextAt)?{sendWindowWait:{approvedMessages:wait.approved_messages as number,nextAt:new Date(nextAt).toISOString()}}:{})};
  });
  const outreach={executionMode:state.executionMode,...(state.demoContacts?{demoContacts:{prepared:state.demoContacts.prepared,stale:state.demoContacts.stale,outreachReady:state.demoContacts.outreachReady}}:{}),...savedOutreach,conversations:state.conversations.length};
  const sequenceGuidance=process.env.AGENT_GUIDANCE_ENABLED==='true'?await this.nativeTransaction(async c=>{const owned=await this.thread(c,threadId),mandate=(await c.query('SELECT natural_language FROM mandates WHERE id=$1 AND organization_id=$2',[owned.mandate_id,owned.organization_id])).rows[0];return loadApprovedAgentGuidance(c,owned,{categories:['tone','buyer_context','follow_up'],query:(question+' sequence email introduction follow up '+String(mandate?.natural_language??'')).slice(0,16000)});}):undefined;
  return nativeChatContextSchema.parse({...(sequenceGuidance?{sequenceGuidance}:{}),mandateRevision:state.mandateRevision,responsibilityId:r.id,responsibilityRevision:r.revision,conversation,delivery,outreach});
 }
 protected async persistConversationPlan(c:PoolClient,t:AgentThread,operationId:string,raw:unknown){
  const plan=nativeChatPlanSchema.parse(raw);if(plan.sequenceGuidance)await assertAgentGuidanceSnapshot(c,t,plan.sequenceGuidance);
  const r=(await c.query('SELECT r.*,m.xmin::text AS current_revision FROM agent_responsibilities r JOIN mandates m ON m.id=r.mandate_id AND m.organization_id=r.organization_id WHERE r.thread_id=$1 FOR UPDATE OF r',[t.id])).rows[0];
  if(!r||!['ready','waiting'].includes(r.state)||r.id!==plan.responsibilityId||r.revision!==plan.responsibilityRevision||r.mandate_revision!==plan.mandateRevision||r.current_revision!==plan.mandateRevision)throw new Error('Chat goal changed while preparing the proposal');
  const model=(await c.query("SELECT result FROM agent_operations WHERE thread_id=$1 AND name='conversation.answer.model' AND request_key='chat-model:'||$2::text AND state='complete'",[t.id,operationId])).rows[0];
  if(!model||digest(model.result?.response?.proposal)!==digest(plan.proposal))throw new Error('Exact accounted chat decision required');
  if(plan.conversation){const row=await this.lockConversation(c,t,plan.conversation.conversationId);if(row.revision!==plan.conversation.revision||row.context_revision!==plan.conversation.contextRevision)throw new Error('Selected conversation changed while preparing the proposal');}
  await this.emit(c,t,'chat-plan:'+operationId,'chat.plan_requested',{answerOperationId:operationId});return plan;
 }
 async completedChatPlan(threadId:string,operationId:string){return this.nativeTransaction(async c=>{const t=await this.thread(c,threadId),row=(await c.query("SELECT result FROM agent_operations WHERE id=$1 AND thread_id=$2 AND name='conversation.answer' AND state='complete'",[z.string().uuid().parse(operationId),t.id])).rows[0];if(!row)throw new Error('Completed owned chat turn required');return nativeChatPlanSchema.parse(row.result?.nativePlan);});}
}
