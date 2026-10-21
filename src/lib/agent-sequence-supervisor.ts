import {z} from 'zod';
import type {AgentEventHandler} from './agent-event-worker';
import type {AgentSequenceExecutionStore} from '@/db/agent-sequence-execution-store';
type Port=Pick<AgentSequenceExecutionStore,'reviewDispatchTargets'|'saveApprovedSequenceDraft'|'executeApprovedPublication'|'enrolApprovedSequence'>;
export function createSequenceApprovedHandler(store:Port):AgentEventHandler{return async input=>{
 const {reviewBatchId}=z.object({reviewBatchId:z.string().uuid()}).parse(input.event.payload),targets=await store.reviewDispatchTargets(input.event.thread_id,reviewBatchId),names=new Set(targets.map(t=>t.name));
 if(!targets.length||names.size!==1||targets.some(target=>!['sequence.prepare','sequence.publish','sequence.enrol'].includes(target.name)))return {kind:'review',message:'Each sequence capability requires its separate exact reviewed batch.'};
 const fence={runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence};
 for(const target of targets){await input.assertCurrent();if(target.name==='sequence.prepare')await store.saveApprovedSequenceDraft(input.event.thread_id,target.id,fence);else if(target.name==='sequence.publish'){const result=await store.executeApprovedPublication(input.event.thread_id,target.id,fence);if(result.kind==='review')return {kind:'review',message:result.reason};}else{const result=await store.enrolApprovedSequence(input.event.thread_id,target.id,fence);if(result.needsReview)return {kind:'review',message:'Changed contacts remain held for individual review; eligible contacts were enrolled with first-conversation holds.'};}}
 return {kind:'complete'};
};}
