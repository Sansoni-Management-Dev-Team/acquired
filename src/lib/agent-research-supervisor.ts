import {researchWorker} from './research-service';
import {z} from 'zod';
import type {AgentResearchStore} from '@/db/agent-research-store';
import type {AgentEventHandler} from './agent-event-worker';
const trigger=z.object({responsibilityId:z.string().uuid(),revision:z.number().int().positive()}).strict();
/** Browser-independent handler; planning makes no provider requests. The store
 * repeats all scope/version/fence checks in its atomic proposal transaction. */
export function createResearchSupervisor(store:Pick<AgentResearchStore,'researchSupervisionContext'|'proposeResearchPlan'>,options?:{reuseCached?:(input:Parameters<AgentEventHandler>[0])=>Promise<boolean>}):AgentEventHandler{
 return async input=>{
  const expected=trigger.parse(input.event.payload),current=await store.researchSupervisionContext(input.event.thread_id),r=current.responsibility;
  if(!r||r.id!==expected.responsibilityId||r.revision!==expected.revision||!['ready','waiting'].includes(r.state))return {kind:'complete'};
  if(r.mandateRevision!==current.mandateRevision)return {kind:'review',message:'The mandate changed. Review and resume supervision against the current saved brief.'};
  await input.assertCurrent();
  if(options?.reuseCached&&await options.reuseCached(input))return {kind:'complete'};
  await store.proposeResearchPlan(input.event.thread_id,'research-supervision:'+r.id+':'+r.revision,{responsibilityId:r.id,responsibilityRevision:r.revision,mandateRevision:current.mandateRevision},{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});
  return {kind:'complete'};
 };
}

/** Approval saves work plus an outbox; it is never labelled completed research. */
export function createResearchApprovedHandler(store:Pick<AgentResearchStore,'reviewDispatchTargets'|'persistApprovedResearchLaunch'>):AgentEventHandler{
 return async input=>{
  const {reviewBatchId}=z.object({reviewBatchId:z.string().uuid()}).parse(input.event.payload),targets=await store.reviewDispatchTargets(input.event.thread_id,reviewBatchId);
  if(!targets.length||targets.some(t=>t.name!=='research.start'))return {kind:'review',message:'Research approval requires an exact research batch. No mixed operation was dispatched.'};
  for(const target of targets){
   await input.assertCurrent();
   await store.persistApprovedResearchLaunch(input.event.thread_id,target.id,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});
  }
  return {kind:'complete'};
 };
}
/** Guarded dispatch milestone. Complete physical-attempt provider integration
 * is deliberately required; a concurrent slot is not a spend permit. */
export function createResearchDispatchHandler(store:Pick<AgentResearchStore,'persistApprovedResearchLaunch'|'beginNativeResearchDispatch'|'finishNativeResearchDispatch'>,dispatch:(jobId:string)=>Promise<unknown>=jobId=>researchWorker('/jobs/'+jobId,'POST')):AgentEventHandler{
 return async input=>{
  const payload=z.object({operationId:z.string().uuid(),researchJobId:z.string().uuid()}).strict().parse(input.event.payload);
  await input.assertCurrent();
  const saved=await store.persistApprovedResearchLaunch(input.event.thread_id,payload.operationId,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});
  if(saved.jobId!==payload.researchJobId)throw new Error('Research dispatch handle changed');
  if(!saved.dispatchReady)return {kind:'review',message:'The approved research job is saved. Configure current provider call and cost limits before execution.'};
  const intent=await store.beginNativeResearchDispatch(input.event.thread_id,payload.operationId,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});
  if(intent.kind==='cached')return {kind:'complete'};
  await input.assertCurrent();
  try{await dispatch(intent.jobId);}catch{await store.finishNativeResearchDispatch(input.event.thread_id,intent.operationId,false);return {kind:'review',message:'The worker dispatch acknowledgement is uncertain. Reconcile its existing saved handle before another dispatch.'};}
  await store.finishNativeResearchDispatch(input.event.thread_id,intent.operationId,true);return {kind:'complete'};
 };
}
