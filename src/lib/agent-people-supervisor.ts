import {z} from 'zod';
import type {AgentPeopleStore} from '@/db/agent-people-store';
import type {AgentEventHandler} from './agent-event-worker';
import {researchWorker} from './research-service';
export function createPeoplePlanSupervisor(store:Pick<AgentPeopleStore,'proposePeopleResearch'>):AgentEventHandler{
 return async input=>{await input.assertCurrent();await store.proposePeopleResearch(input.event.thread_id,'people-supervision:'+input.event.id,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});return {kind:'complete'};};
}
export function createPeopleApprovedHandler(store:Pick<AgentPeopleStore,'reviewDispatchTargets'|'persistApprovedPeopleLaunch'>):AgentEventHandler{
 return async input=>{const {reviewBatchId}=z.object({reviewBatchId:z.string().uuid()}).parse(input.event.payload),targets=await store.reviewDispatchTargets(input.event.thread_id,reviewBatchId);if(!targets.length||targets.some(t=>t.name!=='research.people'))return {kind:'review',message:'Contact enrichment requires an exact company selection review. No mixed work was dispatched.'};
 for(const target of targets){await input.assertCurrent();await store.persistApprovedPeopleLaunch(input.event.thread_id,target.id,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});}return {kind:'complete'};};
}
export function createPeopleDispatchHandler(store:Pick<AgentPeopleStore,'persistApprovedPeopleLaunch'|'beginNativeResearchDispatch'|'finishNativeResearchDispatch'>,dispatch:(job:string)=>Promise<unknown>=id=>researchWorker('/jobs/'+id,'POST')):AgentEventHandler{
 return async input=>{const payload=z.object({operationId:z.string().uuid(),researchJobId:z.string().uuid()}).strict().parse(input.event.payload),fence={runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence};await input.assertCurrent();const saved=await store.persistApprovedPeopleLaunch(input.event.thread_id,payload.operationId,fence);if(saved.jobId!==payload.researchJobId)throw new Error('People dispatch handle changed');if(!saved.dispatchReady)return {kind:'review',message:'Configure current provider call and cost limits before contact enrichment.'};
 const intent=await store.beginNativeResearchDispatch(input.event.thread_id,payload.operationId,fence);if(intent.kind==='cached')return {kind:'complete'};await input.assertCurrent();try{await dispatch(intent.jobId);}catch{await store.finishNativeResearchDispatch(input.event.thread_id,intent.operationId,false);return {kind:'review',message:'Contact-enrichment worker acknowledgement is uncertain. Reconcile the existing handle before retrying.'};}await store.finishNativeResearchDispatch(input.event.thread_id,intent.operationId,true);return {kind:'complete'};};
}

/** Progress toward the current goal without choosing a delivery account or
 * treating company research as contact/send permission. */
export function createResearchCompletedSupervisor(store:Pick<AgentPeopleStore,'researchCompletionInfo'|'targetSelectionContext'|'peopleResearchContext'|'proposePeopleResearch'|'recordResearchNextStep'>):AgentEventHandler{
 return async input=>{
  const {operationId}=z.object({operationId:z.string().uuid()}).parse(input.event.payload),thread=input.event.thread_id,authority={runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence};
  const completed=await store.researchCompletionInfo(thread,operationId),targets=await store.targetSelectionContext(thread);
  await input.assertCurrent();
  if(targets.candidates.some(c=>c.blockedReasons.length===0&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))){
   await store.recordResearchNextStep(thread,'research-next:'+operationId,{kind:'cached_contacts',message:'Cached email contacts are available for review. Choose your recorded email account, then use “Review cached contacts” to review the exact recipients and fit evidence. No account, conversation or email was selected automatically.'},authority);return {kind:'complete'};
  }
  if(completed.name==='research.start'){
   const people=await store.peopleResearchContext(thread);
   if(people.companies.some((c:{firmableId:string;blockedReasons:string[]})=>/^f\d+$/.test(c.firmableId)&&c.blockedReasons.length===0)){
    await store.proposePeopleResearch(thread,'people-after-research:'+operationId,authority);return {kind:'complete'};
   }
  }
  await store.recordResearchNextStep(thread,'research-next:'+operationId,{kind:'needs_review',message:'Research results need review before further work. There are no currently usable cached email contacts. Review missing company identity or contact data, mandate fit, suppression, prior outreach and ownership. No repeated enrichment or outreach was started.'},authority);return {kind:'complete'};
 };
}

/** Saved current-tenant evidence is checked before proposing any new provider
 * spend. Human selection of the original account remains explicit. */
export function reuseCachedMandateTargets(store:Pick<AgentPeopleStore,'targetSelectionContext'|'peopleResearchContext'|'proposePeopleResearch'|'recordResearchNextStep'>){
 return async(input:Parameters<AgentEventHandler>[0])=>{
  const thread=input.event.thread_id,authority={runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence},targets=await store.targetSelectionContext(thread);await input.assertCurrent();
  if(targets.candidates.some(c=>c.blockedReasons.length===0&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))){await store.recordResearchNextStep(thread,'cached-goal:'+input.event.id,{kind:'cached_contacts',message:'This mandate already has cached email contacts to review. Choose your recorded email account and use “Review cached contacts”. New research and outreach have not been started.'},authority);return true;}
  const people=await store.peopleResearchContext(thread);
  if(people.companies.some((c:{firmableId:string;blockedReasons:string[]})=>/^f\d+$/.test(c.firmableId)&&c.blockedReasons.length===0)){await store.proposePeopleResearch(thread,'cached-companies:'+input.event.id,authority);return true;}
  return false;
 };
}
