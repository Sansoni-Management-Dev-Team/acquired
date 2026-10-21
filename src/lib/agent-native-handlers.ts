import {isAgentNativeDispatchOperation} from '@/domain/agent-operation-classifications';
import{AgentPreBeginSendWindowError}from'./agent-pre-begin-send-window-error';
import{AgentPreBeginSendBudgetError}from'./agent-pre-begin-send-budget-error';
import{observeDispatchStage,withDispatchObservation}from'../../communications/packages/core/src/dispatch-diagnostic';
import {businessNow} from '../../communications/packages/core/src/business-clock';
import {assertAgentBusinessTimeScope,type AgentBusinessTimeContext,type AgentBusinessTimeScope} from './agent-business-time';
import {isHistoryRefreshBusyError} from '../../communications/packages/core/src/history-refresh-busy';
import {AgentPreBeginHistoryError} from './agent-pre-begin-history-error';
import{ReplyProcessingPendingError}from'../../communications/packages/core/src/history-pending';
import {z} from 'zod';
import type {AgentModelStore} from '@/db/agent-model-store';
import type {AgentExecutionFence} from '@/db/agent-execution-store';
import type {AgentEventHandler} from './agent-event-worker';
import type {AgentEventOutcome} from '@/domain/agent-events';
import {reassessAgentConversation,AgentDecisionReviewError,type AgentConversationContext} from './agent-conversation-engine';
import {createNativeModelDecision} from './agent-model-decision';
const uuid=z.string().uuid();
const reassessment=z.object({conversationId:uuid,epoch:z.number().int().positive(),reminderGeneration:z.number().int().positive()}).strict();
export function createNativeAgentHandlers(options:{store:AgentModelStore & {proposeNativeMessage?:(threadId:string,key:string,input:unknown,authority?:AgentExecutionFence)=>Promise<unknown>};businessTime?:{context:AgentBusinessTimeContext;scope:AgentBusinessTimeScope};decide?:(input:{threadId:string;requestKey:string;authority:AgentExecutionFence})=>(context:AgentConversationContext)=>Promise<unknown>;chatProposal?:AgentEventHandler;supervise?:AgentEventHandler;researchApproved?:AgentEventHandler;sequenceApproved?:AgentEventHandler;targetApproved?:AgentEventHandler;peopleApproved?:AgentEventHandler;fieldsApproved?:AgentEventHandler;fieldsDispatch?:AgentEventHandler;peopleDispatch?:AgentEventHandler;researchCompleted?:AgentEventHandler;reconcileProvider?:(threadId:string,operationId:string,authority:AgentExecutionFence)=>Promise<{known:boolean}>;researchDispatch?:AgentEventHandler;handoffReminder?:AgentEventHandler;dispatchProvider?:(threadId:string,operationId:string,authority:AgentExecutionFence,delegation?:{id:string;revision:number})=>Promise<void>;channelDue?:(threadId:string,payload:unknown)=>Promise<{conversationId:string;epoch:number;reminderGeneration:number}|null>;refreshProviderHistory?:(threadId:string,conversationId:string)=>Promise<void>}){
 const businessClock=(()=>{const time=options.businessTime;if(!time)return undefined;assertAgentBusinessTimeScope(time.context,time.scope);return time.context;})();
 const now=()=>new Date(businessNow(businessClock)).toISOString();
 const sendWindowWait=(error:AgentPreBeginSendWindowError):AgentEventOutcome=>{
  if(error.businessContext&&error.businessContext!==businessClock)throw error;
  return {kind:'defer',...(error.businessContext?{timeBasis:'business'as const}:{}),wakeAt:error.wakeAt,reason:error.message};
 };
 const pendingHistory=()=>({kind:'defer'as const,wakeAt:new Date(Date.now()+30000).toISOString(),reason:'Waiting for verified reply processing and application acknowledgement before reading conversation history.'});
 const store=options.store,handlers:Record<string,AgentEventHandler>={};
 const fence=(value:Parameters<AgentEventHandler>[0]):AgentExecutionFence=>({runId:value.runId,eventId:value.event.id,leaseOwner:value.event.lease_owner,fence:value.event.fence});
 const historyFailure=async(input:Parameters<AgentEventHandler>[0],conversationId:string,error:unknown):Promise<AgentEventOutcome>=>{
  if(error instanceof ReplyProcessingPendingError)return pendingHistory();
  if(isHistoryRefreshBusyError(error))return {kind:'defer',wakeAt:new Date(Date.now()+30000).toISOString(),reason:'Waiting for the authenticated recorded-account history refresh already in progress.'};
  // This port performs history/identity reads and idempotent ingestion only.
  // Retrying it cannot repeat a provider send or spend another model call.
  if(!(error instanceof AgentDecisionReviewError)&&input.event.attempts<3)return {kind:'defer',wakeAt:new Date(Date.now()+30000).toISOString(),reason:'Unable to verify conversation history. A bounded read-only refresh will retry before any decision or send.'};
  const message=error instanceof AgentDecisionReviewError?error.message:'Conversation history could not be verified after three attempts. Human review is required before outreach continues.';
  const current=await store.nativeDecisionContext(input.event.thread_id,conversationId);await input.assertCurrent();
  if(current.driver==='agent'&&current.phase==='active')await store.holdNativeConversation(input.event.thread_id,'history-review:'+input.event.id,{conversationId,revision:current.revision,contextRevision:current.contextRevision,reason:message},fence(input));
  return {kind:'review',message};
 };
 const processConversation:AgentEventHandler=async input=>{
  const trigger=reassessment.parse(input.event.payload),threadId=input.event.thread_id,authority=fence(input),requestKey='reassess:'+input.event.id;
  let context=await store.nativeDecisionContext(threadId,trigger.conversationId);
  if(context.epoch!==trigger.epoch||context.reminderGeneration!==trigger.reminderGeneration||context.driver!=='agent'||context.phase!=='active'||!context.supervisionActive)return {kind:'complete'};
  await input.assertCurrent();
  if(context.deliveryMode==='local_sink')await store.refreshLocalConversationHistory(threadId,trigger.conversationId);
  else{
   if(!options.refreshProviderHistory)return {kind:'review',message:'Conversation history needs the recorded communications account adapter before drafting.'};
   try{await options.refreshProviderHistory(threadId,trigger.conversationId);}catch(error){return historyFailure(input,trigger.conversationId,error);}
  }
  context=await store.nativeDecisionContext(threadId,trigger.conversationId);
  if(await store.pendingNativeEmail(threadId,trigger.conversationId,context.contextRevision))return {kind:'complete'};
  const decide=options.decide?.({threadId,requestKey,authority})??createNativeModelDecision({store,threadId,requestKey,authority,now});
  const outcome=await reassessAgentConversation({load:async()=>context,decide,now,commit:async(current,decision,key)=>{
   return withDispatchObservation({decisionAction:decision.action},()=>observeDispatchStage('native.decision',async()=>{
   await input.assertCurrent();
   const expected={conversationId:current.conversationId,revision:current.revision,contextRevision:current.contextRevision};
   if(decision.action==='draft'){
    if(decision.draft.kind.endsWith('_email')&&!decision.draft.routeId)return store.proposeNativeEmail(threadId,key,{...expected,draft:decision.draft},authority);
    if(!store.proposeNativeMessage)throw new AgentDecisionReviewError('The recorded channel proposal tool is unavailable. Human review is required.');
    return store.proposeNativeMessage(threadId,key,{...expected,draft:decision.draft},authority);
   }
   if(decision.action==='wait')return store.scheduleConversation(threadId,key,{...expected,reminder:decision.reminder},authority);
   if(decision.action==='handoff')return store.handoffConversation(threadId,key,{...expected,reason:decision.reason,summary:decision.summary},authority);
   if(decision.action==='stop')return store.stopNativeConversation(threadId,key,{...expected,reason:decision.reason},authority);
   throw new Error('Unsupported execution action');
   }));
  }},{...trigger,requestKey}).catch(error=>{if(error instanceof AgentDecisionReviewError)return {kind:'review' as const,message:error.message};throw error;});
  if(outcome.kind==='review')await store.holdNativeConversation(threadId,requestKey+':hold',{conversationId:context.conversationId,revision:context.revision,contextRevision:context.contextRevision,reason:outcome.message},authority);
  return outcome;
 };
 handlers['conversation.reassess']=processConversation;handlers['conversation.reminder']=processConversation;
 handlers['channel.due']=async input=>{
  const payload=z.object({conversationId:uuid,routeId:uuid,policyRevision:z.number().int().positive(),scheduledAt:z.string().datetime()}).strict().parse(input.event.payload);
  if(!options.channelDue)return {kind:'review',message:'The saved channel reminder needs its recorded eligibility adapter.'};
  await input.assertCurrent();const trigger=await options.channelDue(input.event.thread_id,payload);
  if(!trigger)return {kind:'complete'};
  return processConversation({...input,event:{...input.event,payload:reassessment.parse(trigger)}});
 };
 handlers['conversation.history_changed']=async input=>{
  const {conversationId}=z.object({conversationId:uuid}).strict().parse(input.event.payload);
  if(!options.refreshProviderHistory)return {kind:'review',message:'Updated conversation history needs its recorded account adapter.'};
  await input.assertCurrent();try{await options.refreshProviderHistory(input.event.thread_id,conversationId);}catch(error){return historyFailure(input,conversationId,error);}
  const current=await store.conversation(input.event.thread_id,conversationId);
  return current.history_complete?{kind:'complete'}:{kind:'defer',wakeAt:new Date(Date.now()+5000).toISOString(),reason:'Waiting for the original submission to appear in provider history'};
 };
 handlers['review.approved']=async input=>{
  const {reviewBatchId}=z.object({reviewBatchId:uuid}).parse(input.event.payload);
  const targets=await store.reviewDispatchTargets(input.event.thread_id,reviewBatchId);
  if(targets.length&&targets.every(target=>['sequence.prepare','sequence.publish','sequence.enrol'].includes(target.name)))return options.sequenceApproved?options.sequenceApproved(input):{kind:'review',message:'Sequence draft saving is waiting for its exact reviewed execution adapter.'};
  if(targets.length&&targets.every(target=>target.name==='target.select'))return options.targetApproved?options.targetApproved(input):{kind:'review',message:'Contact allocation is waiting for its recorded execution adapter.'};
  if(targets.length&&targets.every(target=>target.name==='research.fields'))return options.fieldsApproved?options.fieldsApproved(input):{kind:'review',message:'Public fields are waiting for their separately reviewed execution adapter.'};
  if(targets.length&&targets.every(target=>target.name==='research.people'))return options.peopleApproved?options.peopleApproved(input):{kind:'review',message:'People enrichment is waiting for its separately reviewed execution adapter.'};
  if(targets.length&&targets.every(target=>target.name==='research.start'))return options.researchApproved?options.researchApproved(input):{kind:'review',message:'Research approval is waiting for its recorded execution adapter.'};
  if(targets.some(target=>!isAgentNativeDispatchOperation(target.name)||!['local_sink','communications'].includes(target.delivery_mode)||target.delivery_mode==='local_sink'&&!target.name.startsWith('email.')||target.delivery_mode==='communications'&&!options.dispatchProvider))return {kind:'review',message:'This approved work requires its recorded execution adapter. No account or delivery mode was changed.'};
  let dispatched=false;
  for(const target of targets){await input.assertCurrent();try{if(target.delivery_mode==='local_sink')await store.deliverApprovedLocalEmail(input.event.thread_id,target.id,fence(input));else await options.dispatchProvider!(input.event.thread_id,target.id,fence(input));}catch(error){
   if(!dispatched&&error instanceof AgentPreBeginSendBudgetError&&error.threadId===input.event.thread_id&&error.operationId===target.id&&error.conversationId===target.conversationId)return {kind:'review',message:error.message};
   if(!dispatched&&error instanceof AgentPreBeginSendWindowError&&error.threadId===input.event.thread_id&&error.operationId===target.id&&error.conversationId===target.conversationId)return sendWindowWait(error);
   if(!dispatched&&error instanceof AgentPreBeginHistoryError&&error.threadId===input.event.thread_id&&error.operationId===target.id&&error.conversationId===target.conversationId)return historyFailure(input,error.conversationId,error.historyError);
   throw error;
  }dispatched=true;}
  return {kind:'complete'};
 };
 handlers['chat.plan_requested']=options.chatProposal??(async()=>({kind:'review',message:'The saved chat proposal needs its current-context review adapter.'}));
 handlers['mandate.supervise']=options.supervise??(async()=>({kind:'review',message:'Mandate supervision needs its research and qualification tools before it can allocate conversations.'}));
 handlers['fields.dispatch']=options.fieldsDispatch??(async()=>({kind:'review',message:'Approved public fields need their recorded execution adapter.'}));
 handlers['fields.proposed']=async()=>({kind:'complete'});
 handlers['people.dispatch']=options.peopleDispatch??(async()=>({kind:'review',message:'Approved people enrichment is waiting for its recorded execution adapter.'}));
 handlers['research.completed']=options.researchCompleted??(async()=>({kind:'review',message:'Research finished. Review saved company evidence and contacts before outreach.'}));
 handlers['research.dispatch']=options.researchDispatch??(async()=>({kind:'review',message:'Approved research is waiting for its budgeted execution adapter.'}));
 handlers['human.handoff_reminder']=options.handoffReminder??(async()=>({kind:'review',message:'Human task reminder is waiting for its internal notification handler.'}));
 handlers['email.reconcile']=async input=>{
  const {operationId}=z.object({operationId:uuid,intentId:uuid.optional(),associationEvidenceDigest:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict().refine(v=>(v.intentId===undefined)===(v.associationEvidenceDigest===undefined),'Receipt metadata must be paired').parse(input.event.payload);
  if(!options.reconcileProvider)return {kind:'review',message:'The original email outcome needs its recorded account receipt lookup. No new send was attempted.'};
  await input.assertCurrent();const result=await options.reconcileProvider(input.event.thread_id,operationId,fence(input));
  return result.known?{kind:'complete'}:{kind:'defer',wakeAt:new Date(Date.now()+30000).toISOString(),reason:'The original email outcome is still unknown. Automation remains held; only its original receipt is being checked.'};
 };
 handlers['email.proposed']=async input=>{
  const {operationId}=z.object({operationId:uuid}).parse(input.event.payload);
  const target=await store.delegatedDispatchTarget(input.event.thread_id,operationId);if(!target)return {kind:'complete'};
  await input.assertCurrent();
  if(target.deliveryMode==='local_sink')await store.deliverDelegatedLocalEmail(input.event.thread_id,target.id,target.grant,fence(input));
  else if(options.dispatchProvider)try{await options.dispatchProvider(input.event.thread_id,target.id,fence(input),target.grant);}catch(error){
   if(error instanceof AgentPreBeginSendBudgetError&&error.threadId===input.event.thread_id&&error.operationId===target.id&&error.conversationId===target.conversationId)return {kind:'review',message:error.message};
   if(error instanceof AgentPreBeginSendWindowError&&error.threadId===input.event.thread_id&&error.operationId===target.id&&error.conversationId===target.conversationId)return sendWindowWait(error);
   if(error instanceof AgentPreBeginHistoryError&&error.threadId===input.event.thread_id&&error.operationId===target.id&&error.conversationId===target.conversationId)return historyFailure(input,error.conversationId,error.historyError);
   throw error;
  }
  else return {kind:'review',message:'Delegated email requires its recorded communications adapter.'};
  return {kind:'complete'};
 };
 for(const channel of ['whatsapp','linkedin']){handlers[channel+'.proposed']=handlers['email.proposed'];handlers[channel+'.reconcile']=handlers['email.reconcile'];}
 const acknowledge:AgentEventHandler=async()=>({kind:'complete'});
 for(const kind of ['research.proposed','research.provider_accounted','sequence.draft_proposed','sequence.draft_saved','sequence.publication_proposed','sequence.published','sequence.enrolment_proposed','sequence.enrolled','people.proposed','target.proposed','target.allocated','authority.changed','human.handoff_updated','ownership.changed','control.changed','model.accounted','email.simulated','linkedin.invitation_proposed','human.handoff_required','review.rejected','guidance.proposed','guidance.edited','guidance.approved','guidance.rejected'])handlers[kind]=acknowledge;
 for(const [eventKind,handler]of Object.entries(handlers))handlers[eventKind]=input=>withDispatchObservation(input.event.payload as Parameters<typeof withDispatchObservation>[0],()=>withDispatchObservation({eventKind,eventId:input.event.id,threadId:input.event.thread_id,mandateId:input.event.mandate_id,runId:input.runId,attempt:input.event.attempts},()=>observeDispatchStage('native.handler',()=>handler(input))));
 return handlers;
}
