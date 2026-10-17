import {expect,it,vi} from 'vitest';
import {createNativeAgentHandlers} from './agent-native-handlers';
import type {AgentModelStore} from '@/db/agent-model-store';
import type {AgentConversationContext} from './agent-conversation-engine';
const id='10000000-0000-4000-8000-000000000001';
const context={conversationId:id,epoch:1,reminderGeneration:1,revision:1,contextRevision:'a'.repeat(64),phase:'active',driver:'agent',supervisionActive:true,deliveryMode:'local_sink',historyComplete:true,historyObservedAt:new Date().toISOString(),goal:'Acquire a suitable business',history:[],sources:[{id:'mandate',text:'Acquisition goal'}],guidance:[]} satisfies AgentConversationContext;
const event={id,thread_id:id,kind:'conversation.reassess',payload:{conversationId:id,epoch:1,reminderGeneration:1},lease_owner:id,fence:'1',attempts:1};
const execution={event,runId:id,signal:new AbortController().signal,assertCurrent:vi.fn().mockResolvedValue(undefined)};
function fixture(){
 const mock={nativeDecisionContext:vi.fn().mockResolvedValue(context),refreshLocalConversationHistory:vi.fn().mockResolvedValue(undefined),pendingNativeEmail:vi.fn().mockResolvedValue(false),proposeNativeEmail:vi.fn().mockResolvedValue({status:'proposed'}),scheduleConversation:vi.fn(),handoffConversation:vi.fn(),stopNativeConversation:vi.fn(),holdNativeConversation:vi.fn(),reviewDispatchTargets:vi.fn(),deliverApprovedLocalEmail:vi.fn(),delegatedDispatchTarget:vi.fn().mockResolvedValue(null),deliverDelegatedLocalEmail:vi.fn()};
 const decide=vi.fn().mockResolvedValue({action:'draft',draft:{kind:'initial_email',intent:'initial',subject:'Acquisition enquiry',body:'Would you consider a confidential conversation?',rationale:'A permitted first approach',sourceIds:['mandate']}});
 return {mock,decide,handlers:createNativeAgentHandlers({store:mock as unknown as AgentModelStore,decide:()=>decide})};
}
it('turns a due persisted event into a saved proposal with a current execution fence',async()=>{
 const {mock,decide,handlers}=fixture();expect(await handlers['conversation.reassess'](execution)).toEqual({kind:'complete'});
 expect(decide).toHaveBeenCalledOnce();expect(mock.proposeNativeEmail).toHaveBeenCalledWith(id,expect.any(String),expect.objectContaining({conversationId:id}),{runId:id,eventId:id,leaseOwner:id,fence:'1'});
 expect(mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();
});
it('does not spend model tokens for a superseded reminder or an already proposed current draft',async()=>{
 for(const changed of [{epoch:2},{reminderGeneration:2},{phase:'paused'}]){const {mock,decide,handlers}=fixture();mock.nativeDecisionContext.mockResolvedValue({...context,...changed});await handlers['conversation.reminder'](execution);expect(decide).not.toHaveBeenCalled();}
 const {mock,decide,handlers}=fixture();mock.pendingNativeEmail.mockResolvedValue(true);await handlers['conversation.reassess'](execution);expect(decide).not.toHaveBeenCalled();
});
it('uses the exact approved batch targets and local mode without resolving a new provider default',async()=>{
 const {mock,handlers}=fixture();mock.reviewDispatchTargets.mockResolvedValue([{id,name:'email.initial',delivery_mode:'local_sink'}]);
 const input={...execution,event:{...event,kind:'review.approved',payload:{reviewBatchId:id}}};expect(await handlers['review.approved'](input)).toEqual({kind:'complete'});expect(mock.deliverApprovedLocalEmail).toHaveBeenCalledWith(id,id,expect.objectContaining({runId:id}));
 mock.reviewDispatchTargets.mockResolvedValue([{id,name:'email.initial',delivery_mode:'communications'}]);expect((await handlers['review.approved'](input)).kind).toBe('review');expect(mock.deliverApprovedLocalEmail).toHaveBeenCalledTimes(1);
});
it('acknowledges saved audit notifications without generating another notification or model call',async()=>{
 const {mock,decide,handlers}=fixture();for(const kind of ['control.changed','model.accounted','research.proposed','research.provider_accounted','email.simulated','human.handoff_required'])expect(await handlers[kind](execution)).toEqual({kind:'complete'});expect(decide).not.toHaveBeenCalled();expect(mock.proposeNativeEmail).not.toHaveBeenCalled();
});

it('consumes only an explicit bounded delegation for a proposed email event',async()=>{
 const {mock,handlers}=fixture();const input={...execution,event:{...event,kind:'email.proposed',payload:{operationId:id}}};
 expect(await handlers['email.proposed'](input)).toEqual({kind:'complete'});expect(mock.deliverDelegatedLocalEmail).not.toHaveBeenCalled();
 mock.delegatedDispatchTarget.mockResolvedValue({id,deliveryMode:'local_sink',grant:{id,revision:1}});
 expect(await handlers['email.proposed'](input)).toEqual({kind:'complete'});expect(mock.deliverDelegatedLocalEmail).toHaveBeenCalledWith(id,id,{id,revision:1},expect.objectContaining({runId:id}));
});

it('routes an exact approved target batch to allocation without dispatching email',async()=>{
 const {mock}=fixture();mock.reviewDispatchTargets.mockResolvedValue([{id,name:'target.select'}]);
 const targetApproved=vi.fn().mockResolvedValue({kind:'complete'});
 const handlers=createNativeAgentHandlers({store:mock as unknown as AgentModelStore,targetApproved});
 const input={...execution,event:{...event,kind:'review.approved',payload:{reviewBatchId:id}}};
 expect(await handlers['review.approved'](input)).toEqual({kind:'complete'});
 expect(targetApproved).toHaveBeenCalledWith(input);expect(mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();
 mock.reviewDispatchTargets.mockResolvedValue([{id,name:'target.select'},{id,name:'email.initial',delivery_mode:'local_sink'}]);
 expect((await handlers['review.approved'](input)).kind).toBe('review');expect(targetApproved).toHaveBeenCalledTimes(1);
});

it('requires the separate exact people-enrichment review and never treats it as company or email approval',async()=>{
 const {mock}=fixture();mock.reviewDispatchTargets.mockResolvedValue([{id,name:'research.people'}]);
 const peopleApproved=vi.fn().mockResolvedValue({kind:'complete'}),researchApproved=vi.fn();
 const handlers=createNativeAgentHandlers({store:mock as unknown as AgentModelStore,peopleApproved,researchApproved});
 const input={...execution,event:{...event,kind:'review.approved',payload:{reviewBatchId:id}}};
 expect(await handlers['review.approved'](input)).toEqual({kind:'complete'});expect(peopleApproved).toHaveBeenCalledWith(input);expect(researchApproved).not.toHaveBeenCalled();expect(mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();
 mock.reviewDispatchTargets.mockResolvedValue([{id,name:'research.people'},{id,name:'research.start'}]);
 expect((await handlers['review.approved'](input)).kind).toBe('review');expect(peopleApproved).toHaveBeenCalledTimes(1);
});
it('routes exact sequence draft approval without granting publication or email authority',async()=>{
 const {mock}=fixture();mock.reviewDispatchTargets.mockResolvedValue([{id,name:'sequence.prepare'}]);const sequenceApproved=vi.fn().mockResolvedValue({kind:'complete'}),handlers=createNativeAgentHandlers({store:mock as unknown as AgentModelStore,sequenceApproved}),input={...execution,event:{...event,kind:'review.approved',payload:{reviewBatchId:id}}};
 expect(await handlers['review.approved'](input)).toEqual({kind:'complete'});expect(sequenceApproved).toHaveBeenCalledWith(input);expect(mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();mock.reviewDispatchTargets.mockResolvedValue([{id,name:'sequence.prepare'},{id,name:'email.initial',delivery_mode:'local_sink'}]);expect((await handlers['review.approved'](input)).kind).toBe('review');expect(sequenceApproved).toHaveBeenCalledTimes(1);
});

it('reconciles an original uncertain email receipt without drafting or submitting another email',async()=>{
 const {mock,decide}=fixture();const reconcileProvider=vi.fn().mockResolvedValue({known:false});
 const handlers=createNativeAgentHandlers({store:mock as unknown as AgentModelStore,reconcileProvider});
 const input={...execution,event:{...event,kind:'email.reconcile',payload:{operationId:id}}};
 expect((await handlers['email.reconcile'](input)).kind).toBe('defer');expect(reconcileProvider).toHaveBeenCalledWith(id,id,expect.objectContaining({runId:id,eventId:id}));
 reconcileProvider.mockResolvedValue({known:true});expect(await handlers['email.reconcile'](input)).toEqual({kind:'complete'});
 expect(decide).not.toHaveBeenCalled();expect(mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();expect(mock.deliverDelegatedLocalEmail).not.toHaveBeenCalled();
});
it.each(['email.reconcile','whatsapp.reconcile','linkedin.reconcile'])('accepts trusted receipt-association metadata for lookup-only %s and rejects partial or extra metadata',async kind=>{
 const {mock,decide}=fixture(),reconcileProvider=vi.fn().mockResolvedValue({known:true}),handlers=createNativeAgentHandlers({store:mock as unknown as AgentModelStore,reconcileProvider});
 const input={...execution,event:{...event,kind,payload:{operationId:id,intentId:id,associationEvidenceDigest:'a'.repeat(64)}}};
 expect(await handlers[kind](input)).toEqual({kind:'complete'});expect(reconcileProvider).toHaveBeenCalledTimes(1);expect(decide).not.toHaveBeenCalled();
 for(const payload of [{operationId:id,intentId:id},{operationId:id,associationEvidenceDigest:'a'.repeat(64)},{...input.event.payload,arbitrary:true}])await expect(handlers[kind]({...input,event:{...input.event,payload}})).rejects.toThrow();
 expect(reconcileProvider).toHaveBeenCalledTimes(1);
});
it('distinguishes trusted pending reply processing from a bounded retry of an ordinary read error',async()=>{
 const {ReplyProcessingPendingError}=await import('../../communications/packages/core/src/history-pending');
 for(const kind of ['conversation.history_changed','conversation.reassess','conversation.reminder']){const f=fixture(),refreshProviderHistory=vi.fn().mockRejectedValue(new ReplyProcessingPendingError());f.mock.nativeDecisionContext.mockResolvedValue({...context,deliveryMode:'communications'});const handlers=createNativeAgentHandlers({store:f.mock as unknown as AgentModelStore,decide:()=>f.decide,refreshProviderHistory});const actual={...execution,event:{...event,kind,payload:kind==='conversation.history_changed'?{conversationId:id}:event.payload}};const before=Date.now(),result=await handlers[kind](actual);expect(result.kind).toBe('defer');if(result.kind==='defer')expect(Date.parse(result.wakeAt)).toBeGreaterThanOrEqual(before+29000);expect(f.decide).not.toHaveBeenCalled();expect(f.mock.proposeNativeEmail).not.toHaveBeenCalled();expect(f.mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();refreshProviderHistory.mockRejectedValueOnce(Error('Recorded reply processing is pending'));const untyped=await handlers[kind](actual);expect(untyped).toMatchObject({kind:'defer',reason:expect.stringContaining('bounded read-only refresh')});expect(untyped).not.toMatchObject({reason:expect.stringContaining('application acknowledgement')});}
});

it('places invalid model decisions into visible human review rather than leaving an active failed reassessment',async()=>{
 for(const decision of [{action:'send',approved:true},{action:'draft',draft:{kind:'initial_email',intent:'initial',subject:'Hello',body:'A grounded introduction.',rationale:'Introduction',sourceIds:['invented-evidence']}}]){
  const f=fixture();f.decide.mockResolvedValue(decision);
  const result=await f.handlers['conversation.reassess'](execution);
  expect(result.kind).toBe('review');expect(f.mock.holdNativeConversation).toHaveBeenCalledWith(id,expect.stringContaining(':hold'),expect.objectContaining({conversationId:id,reason:expect.any(String)}),expect.objectContaining({runId:id}));
  expect(f.mock.proposeNativeEmail).not.toHaveBeenCalled();
 }
});

it('dispatches reviewed social operations using the recorded communications adapter only',async()=>{
 const f=fixture(),dispatchProvider=vi.fn().mockResolvedValue(undefined),handlers=createNativeAgentHandlers({store:f.mock as unknown as AgentModelStore,dispatchProvider});
 for(const name of ['whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up']){
  f.mock.reviewDispatchTargets.mockResolvedValue([{id,name,delivery_mode:'communications'}]);
  expect(await handlers['review.approved']({...execution,event:{...event,kind:'review.approved',payload:{reviewBatchId:id}}})).toEqual({kind:'complete'});
 }
 expect(dispatchProvider).toHaveBeenCalledTimes(6);expect(f.mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();
});

it('durably retries bounded read-only history failures before requesting human review, without spending model or send authority',async()=>{
 const f=fixture();f.mock.nativeDecisionContext.mockResolvedValue({...context,deliveryMode:'communications'});
 const refreshProviderHistory=vi.fn().mockRejectedValue(Error('Private transport failure'));
 const handlers=createNativeAgentHandlers({store:f.mock as unknown as AgentModelStore,decide:()=>f.decide,refreshProviderHistory});
 const before=Date.now(),first=await handlers['conversation.reassess'](execution);
 expect(first.kind).toBe('defer');if(first.kind==='defer'){expect(Date.parse(first.wakeAt)).toBeGreaterThanOrEqual(before+29000);expect(first.reason).not.toContain('Private');}
 const exhausted=await handlers['conversation.reassess']({...execution,event:{...event,attempts:3}});expect(exhausted.kind).toBe('review');expect(f.mock.holdNativeConversation).toHaveBeenCalledOnce();
 expect(f.decide).not.toHaveBeenCalled();expect(f.mock.proposeNativeEmail).not.toHaveBeenCalled();expect(f.mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();
});

it('uses a persisted channel due wake even after the mutable person reminder was replaced, while keeping human review',async()=>{
 const f=fixture(),channelDue=vi.fn().mockResolvedValue({conversationId:id,epoch:1,reminderGeneration:7});
 f.mock.nativeDecisionContext.mockResolvedValue({...context,reminderGeneration:7});
 const handlers=createNativeAgentHandlers({store:f.mock as unknown as AgentModelStore,decide:()=>f.decide,channelDue});
 const payload={conversationId:id,routeId:id,policyRevision:2,scheduledAt:new Date().toISOString()};
 expect(await handlers['channel.due']({...execution,event:{...event,kind:'channel.due',payload}})).toEqual({kind:'complete'});
 expect(channelDue).toHaveBeenCalledWith(id,payload);expect(f.decide).toHaveBeenCalledOnce();
 expect(f.mock.proposeNativeEmail).toHaveBeenCalledOnce();expect(f.mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();
});
it('does not read history or spend model tokens when the saved channel due wake is no longer eligible',async()=>{
 const f=fixture(),channelDue=vi.fn().mockResolvedValue(null),refreshProviderHistory=vi.fn();
 const handlers=createNativeAgentHandlers({store:f.mock as unknown as AgentModelStore,decide:()=>f.decide,channelDue,refreshProviderHistory});
 const payload={conversationId:id,routeId:id,policyRevision:1,scheduledAt:new Date().toISOString()};
 expect(await handlers['channel.due']({...execution,event:{...event,kind:'channel.due',payload}})).toEqual({kind:'complete'});
 expect(refreshProviderHistory).not.toHaveBeenCalled();expect(f.decide).not.toHaveBeenCalled();expect(f.mock.proposeNativeEmail).not.toHaveBeenCalled();
});
it('rechecks actual provider readiness before a human-requested reassessment can spend tokens or propose a message',async()=>{const{mock,decide}=fixture();mock.nativeDecisionContext.mockResolvedValue({...context,deliveryMode:'communications'});const refreshProviderHistory=vi.fn().mockRejectedValue(new Error('Original recorded connection unavailable')),handlers=createNativeAgentHandlers({store:mock as unknown as AgentModelStore,decide:()=>decide,refreshProviderHistory});expect((await handlers['conversation.reassess'](execution)).kind).toBe('defer');expect(refreshProviderHistory).toHaveBeenCalledExactlyOnceWith(id,id);expect(decide).not.toHaveBeenCalled();expect(mock.proposeNativeEmail).not.toHaveBeenCalled();expect(mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();});

it('defers only exact typed pre-begin history failures for reviewed and delegated messages, then requires human review after three reads',async()=>{
 const{AgentPreBeginHistoryError}=await import('./agent-pre-begin-history-error');
 for(const kind of['review.approved','email.proposed','whatsapp.proposed','linkedin.proposed']){const f=fixture();Object.assign(f.mock,{delegatedDispatchTarget:vi.fn(async()=>({id,conversationId:id,deliveryMode:'communications',grant:{id,revision:1}}))});f.mock.reviewDispatchTargets.mockResolvedValue([{id,conversationId:id,name:'whatsapp.initial',delivery_mode:'communications'}]);const dispatchProvider=vi.fn().mockRejectedValue(new AgentPreBeginHistoryError(id,id,id,Error('Private transient history failure'))),handlers=createNativeAgentHandlers({store:f.mock as unknown as AgentModelStore,dispatchProvider}),input={...execution,event:{...event,kind,payload:kind==='review.approved'?{reviewBatchId:id}:{operationId:id}}};
 expect(await handlers[kind](input)).toMatchObject({kind:'defer',reason:expect.stringContaining('bounded read-only refresh')});expect(f.mock.holdNativeConversation).not.toHaveBeenCalled();
 const{ReplyProcessingPendingError}=await import('../../communications/packages/core/src/history-pending');dispatchProvider.mockRejectedValueOnce(new AgentPreBeginHistoryError(id,id,id,new ReplyProcessingPendingError()));expect(await handlers[kind]({...input,event:{...input.event,attempts:3}})).toMatchObject({kind:'defer',reason:expect.stringContaining('application acknowledgement')});
 expect(await handlers[kind]({...input,event:{...input.event,attempts:3}})).toMatchObject({kind:'review',message:expect.stringContaining('three attempts')});expect(f.mock.holdNativeConversation).toHaveBeenCalledOnce();expect(f.decide).not.toHaveBeenCalled();expect(f.mock.proposeNativeEmail).not.toHaveBeenCalled();
 }
});
it('does not defer post-begin errors, mismatched pre-begin identities or a batch that already dispatched another target',async()=>{
 const{AgentPreBeginHistoryError}=await import('./agent-pre-begin-history-error'),other='20000000-0000-4000-8000-000000000001';
 for(const error of[Error('Failure after native admission'),new AgentPreBeginHistoryError(other,id,id,Error('read')),new AgentPreBeginHistoryError(id,id,other,Error('read')),new AgentPreBeginHistoryError(id,other,id,Error('read'))]){const f=fixture();f.mock.reviewDispatchTargets.mockResolvedValue([{id,conversationId:id,name:'email.initial',delivery_mode:'communications'}]);const handlers=createNativeAgentHandlers({store:f.mock as unknown as AgentModelStore,dispatchProvider:vi.fn().mockRejectedValue(error)});await expect(handlers['review.approved']({...execution,event:{...event,kind:'review.approved',payload:{reviewBatchId:id}}})).rejects.toBe(error);}
 const f=fixture();f.mock.reviewDispatchTargets.mockResolvedValue([{id:other,conversationId:other,name:'email.initial',delivery_mode:'communications'},{id,conversationId:id,name:'whatsapp.initial',delivery_mode:'communications'}]);const dispatchProvider=vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new AgentPreBeginHistoryError(id,id,id,Error('read'))),handlers=createNativeAgentHandlers({store:f.mock as unknown as AgentModelStore,dispatchProvider});await expect(handlers['review.approved']({...execution,event:{...event,kind:'review.approved',payload:{reviewBatchId:id}}})).rejects.toBeInstanceOf(AgentPreBeginHistoryError);expect(dispatchProvider).toHaveBeenCalledTimes(2);
});

it('defers a privately branded authenticated refresh lease wait at the existing ordinary-read boundary without model/send/hold',async()=>{
 const {HistoryRefreshBusyError}=await import('../../communications/packages/core/src/history-refresh-busy');
 const {mock,decide}=fixture();mock.nativeDecisionContext.mockResolvedValue({...context,deliveryMode:'communications'});
 const error=new HistoryRefreshBusyError({applicationId:'acquire',tenantId:'fixture',ownerId:'fixture',connectionId:'fixture',accountId:'fixture',generation:1,channel:'email',platform:'gmail',backend:'unipile'});
 const handlers=createNativeAgentHandlers({store:mock as unknown as AgentModelStore,decide:()=>decide,refreshProviderHistory:async()=>{throw error;}});
 expect(await handlers['conversation.reassess']({...execution,event:{...event,attempts:4}})).toMatchObject({kind:'defer',reason:expect.stringContaining('refresh')});
 expect(decide).not.toHaveBeenCalled();expect(mock.holdNativeConversation).not.toHaveBeenCalled();expect(mock.deliverApprovedLocalEmail).not.toHaveBeenCalled();
});

it('accepts trusted lease busy only inside the exact already-proven pre-begin envelope and rejects forged pending causes',async()=>{
 const {HistoryRefreshBusyError}=await import('../../communications/packages/core/src/history-refresh-busy');const {AgentPreBeginHistoryError}=await import('./agent-pre-begin-history-error');
 const {mock}=fixture();mock.nativeDecisionContext.mockResolvedValue({...context,deliveryMode:'communications'});mock.reviewDispatchTargets.mockResolvedValue([{id,name:'email.initial',delivery_mode:'communications',conversationId:id}]);
 const cause=new HistoryRefreshBusyError({applicationId:'acquire',tenantId:'fixture',ownerId:'fixture',connectionId:'fixture',accountId:'fixture',generation:1,channel:'email',platform:'gmail',backend:'unipile'});
 const input={...execution,event:{...event,kind:'review.approved',attempts:4,payload:{reviewBatchId:id}}};
 const dispatch=vi.fn();const handlers=createNativeAgentHandlers({store:mock as unknown as AgentModelStore,dispatchProvider:dispatch});
 dispatch.mockRejectedValue(new AgentPreBeginHistoryError(id,id,id,cause));expect(await handlers['review.approved'](input)).toMatchObject({kind:'defer'});expect(mock.holdNativeConversation).not.toHaveBeenCalled();
 dispatch.mockRejectedValue(new AgentPreBeginHistoryError(id,'20000000-0000-4000-8000-000000000002',id,cause));await expect(handlers['review.approved'](input)).rejects.toThrow();
 const forged=Object.create(HistoryRefreshBusyError.prototype);dispatch.mockRejectedValue(new AgentPreBeginHistoryError(id,id,id,forged));expect(await handlers['review.approved'](input)).toMatchObject({kind:'review'});expect(mock.holdNativeConversation).toHaveBeenCalledOnce();
});
