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
  const sequenceGuidance=process.env.AGENT_GUIDANCE_ENABLED==='true'?await this.nativeTransaction(async c=>{const owned=await this.thread(c,threadId),mandate=(await c.query('SELECT natural_language FROM mandates WHERE id=$1 AND organization_id=$2',[owned.mandate_id,owned.organization_id])).rows[0];return loadApprovedAgentGuidance(c,owned,{categories:['tone','buyer_context','follow_up'],query:(question+' sequence email introduction follow up '+String(mandate?.natural_language??'')).slice(0,16000)});}):undefined;
  return nativeChatContextSchema.parse({...(sequenceGuidance?{sequenceGuidance}:{}),mandateRevision:state.mandateRevision,responsibilityId:r.id,responsibilityRevision:r.revision,conversation,delivery});
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
