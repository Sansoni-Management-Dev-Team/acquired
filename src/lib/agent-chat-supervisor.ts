import {z} from 'zod';
import type {AgentChatStore} from '@/db/agent-chat-store';
import type {AgentEventHandler} from './agent-event-worker';
import {dispatchNativeChatPlan} from './agent-chat-plan';
export function createNativeChatProposalHandler(store:AgentChatStore):AgentEventHandler{return async input=>{
 const {answerOperationId}=z.object({answerOperationId:z.string().uuid()}).strict().parse(input.event.payload);
 const plan=await store.completedChatPlan(input.event.thread_id,answerOperationId);await input.assertCurrent();
 await dispatchNativeChatPlan(store,input.event.thread_id,answerOperationId,plan,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});return {kind:'complete'};
};}
