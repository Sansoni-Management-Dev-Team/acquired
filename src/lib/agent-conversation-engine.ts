import {z} from 'zod';
import {nativeOutboundDraftSchema,nativeHistoryMessageSchema,nativeReminderSchema,explicitAgentOptOut} from '@/domain/agent-execution';
import {validateAgentWakeup} from '@/domain/agent-history';
import type {AgentEventOutcome} from '@/domain/agent-events';
import {agentChannelRelationshipSchema} from '@/domain/agent-invitation';
const sourceIds=z.array(z.string().min(1).max(300)).max(20);
/** A reviewed decision failure is safe to show as a human decision request.
 * Provider/DB errors must keep their own retry and reconciliation semantics. */
export class AgentDecisionReviewError extends Error{}
export const nativeConversationDecisionSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('draft'),draft:nativeOutboundDraftSchema}).strict(),
 z.object({action:z.literal('wait'),reminder:nativeReminderSchema,sourceIds}).strict(),
 z.object({action:z.literal('handoff'),reason:z.string().trim().min(1).max(2000),summary:z.string().trim().min(1).max(6000),sourceIds}).strict(),
 z.object({action:z.literal('stop'),reason:z.string().trim().min(1).max(2000),sourceIds}).strict(),
 z.object({action:z.literal('review'),reason:z.string().trim().min(1).max(2000),sourceIds}).strict(),
]);
export type NativeConversationDecision=z.infer<typeof nativeConversationDecisionSchema>;
export const agentConversationContextSchema=z.object({
 conversationId:z.string().uuid(),epoch:z.number().int().positive(),reminderGeneration:z.number().int().positive(),revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/),
 phase:z.enum(['active','paused','quiescing','held','complete']),driver:z.enum(['agent','sequence','human']),supervisionActive:z.boolean(),deliveryMode:z.enum(['local_sink','communications']),
 historyComplete:z.boolean(),historyObservedAt:z.string().datetime({offset:true}).nullable(),goal:z.string().min(1).max(100000),history:z.array(nativeHistoryMessageSchema).max(200),
 sources:z.array(z.object({id:z.string().min(1).max(300),text:z.string().min(1).max(12000),publicDisclosureApproved:z.literal(true).optional()}).strict()).max(100),
 guidance:z.array(z.object({id:z.string().uuid(),revision:z.number().int().positive(),text:z.string().max(2000)}).strict()).max(5),
 channels:z.array(z.object({id:z.string().uuid(),channel:z.enum(['email','whatsapp','linkedin']),historyComplete:z.boolean(),historyObservedAt:z.string().datetime({offset:true}).nullable(),readiness:z.enum(['ready','waiting','review']),nextAllowedAt:z.string().datetime({offset:true}).nullable(),unansweredInboundHistoryId:z.string().min(1).max(300).optional(),allowedActions:z.array(z.enum(['initial','reply','follow_up','invitation'])).max(4).optional(),relationship:agentChannelRelationshipSchema.optional()}).strict()).max(3).refine(routes=>new Set(routes.map(r=>r.id)).size===routes.length&&new Set(routes.map(r=>r.channel)).size===routes.length,'Unique recorded channel routes required').optional(),
}).strict();
export type AgentConversationContext=z.infer<typeof agentConversationContextSchema>;
export interface AgentConversationEnginePort{
 load(conversationId:string):Promise<AgentConversationContext>;
 /** The production adapter reserves and accounts for each model attempt. */
 decide(context:AgentConversationContext):Promise<unknown>;
 /** Must recheck the current context, membership, authority and owner atomically.
  * This is never a direct provider call; drafts remain proposals. */
 commit(context:AgentConversationContext,decision:NativeConversationDecision,requestKey:string):Promise<unknown>;
 now():string;
}
export async function reassessAgentConversation(port:AgentConversationEnginePort,event:{conversationId:string;epoch:number;reminderGeneration:number;requestKey:string}):Promise<AgentEventOutcome>{
 const context=agentConversationContextSchema.parse(await port.load(event.conversationId));
 if(context.conversationId!==event.conversationId)throw new Error('Conversation identity differs');
 if(context.epoch!==event.epoch||context.reminderGeneration!==event.reminderGeneration||context.driver!=='agent'||context.phase!=='active'||!context.supervisionActive)return {kind:'complete'};
 // Explicit safety signals are deterministic and bypass the language model.
 if(context.history.some(m=>m.direction==='inbound'&&explicitAgentOptOut(m.text))){
  await port.commit(context,{action:'stop',reason:'The lead explicitly requested no further contact.',sourceIds:[]},event.requestKey);return {kind:'complete'};
 }
 if(!context.historyComplete)return {kind:'review',message:'Verified complete conversation history is required before reassessment.'};
 const instant=Date.parse(port.now()),observed=Date.parse(context.historyObservedAt??'');
 if(!Number.isFinite(instant)||!Number.isFinite(observed)||observed>instant||instant-observed>300000)return {kind:'review',message:'Refresh the conversation history before reassessment.'};
 if(new TextEncoder().encode(JSON.stringify(context)).length>32000)return {kind:'review',message:'This conversation exceeds the bounded model context. Human review is required; history was not silently truncated.'};
 const parsed=nativeConversationDecisionSchema.safeParse(await port.decide(context));
 if(!parsed.success)throw new AgentDecisionReviewError('The model returned an unsupported decision. Human review is required; no action was taken.');
 let decision=parsed.data;
 const permitted=new Set([...context.sources.map(s=>s.id),...context.history.map(m=>m.id),...context.guidance.map(g=>g.id)]);
 const used=decision.action==='draft'?decision.draft.sourceIds:decision.sourceIds;
 if(used.some(id=>!permitted.has(id)))throw new AgentDecisionReviewError('Unknown decision evidence. The proposed action needs human review.');
 if(decision.action==='draft'){
  const hasInbound=context.history.some(m=>m.direction==='inbound');
  const draft=decision.draft,channel=draft.kind.endsWith('_whatsapp')?'whatsapp':draft.kind.endsWith('_linkedin')?'linkedin':'email';
  const stage=draft.kind==='invitation_linkedin'?'invitation':draft.kind.startsWith('initial_')?'initial':draft.kind.startsWith('reply_')?'reply':'follow_up';
  const selected=draft.routeId?context.channels?.find(route=>route.id===draft.routeId):undefined;
  if(context.channels?.length||draft.routeId||channel!=='email'){
   if(!selected||selected.channel!==channel)throw new AgentDecisionReviewError('A draft requires its exact recorded channel route');
   const routeObserved=Date.parse(selected.historyObservedAt??'');
   if(!selected.historyComplete||selected.readiness!=='ready'||!Number.isFinite(routeObserved)||routeObserved>instant||instant-routeObserved>300000)throw new AgentDecisionReviewError('The selected channel requires fresh complete history and readiness');
   if(selected.nextAllowedAt&&Date.parse(selected.nextAllowedAt)>instant)throw new AgentDecisionReviewError('The selected channel is not due yet');
   if(selected.allowedActions&&!selected.allowedActions.includes(stage))throw new AgentDecisionReviewError('This action is not currently permitted on the recorded channel');
  }
  const routeHistory=selected?context.history.filter(m=>m.routeId===selected.id||(!m.routeId&&channel==='email')):context.history;
  const newestFirst=(a:AgentConversationContext['history'][number],b:AgentConversationContext['history'][number])=>Date.parse(b.at)-Date.parse(a.at)||(a.id>b.id?-1:a.id<b.id?1:0);
  const latestInbound=context.history.filter(m=>m.direction==='inbound').sort(newestFirst)[0];
  if(stage==='invitation'){
   const relationship=selected?.relationship,observed=Date.parse(relationship?.observedAt??'');
   if(channel!=='linkedin'||!selected?.allowedActions?.includes('invitation')||!relationship||relationship.status!=='not_connected'||!Number.isFinite(observed)||observed>instant||instant-observed>300000||hasInbound||routeHistory.length)throw new AgentDecisionReviewError('An invitation requires fresh not-connected proof, an empty LinkedIn route and a person who has not replied');
  }else if(channel==='linkedin'&&selected?.relationship){
   const relationship=selected.relationship,observed=Date.parse(relationship.observedAt);
   if(relationship.status!=='connected'||relationship.canMessage!==true||observed>instant||instant-observed>300000)throw new AgentDecisionReviewError('A direct LinkedIn message requires a fresh verified connection');
  }
  if(draft.kind.startsWith('reply_')){
   if(!latestInbound)throw new AgentDecisionReviewError('A reply requires an inbound message');
   // Simultaneous verified incoming messages may offer more than one route.
   // Select only this route's newest candidate at the person's maximum time.
   const candidates=(selected?routeHistory:context.history).filter(m=>m.direction==='inbound'&&Date.parse(m.at)===Date.parse(latestInbound.at));
   // This optional ID comes only from the protected SQL projection. It resolves
   // equal-time history using original submitted operations, never message-ID order.
   const provenId=selected?.unansweredInboundHistoryId;
   const replyInbound=provenId?candidates.find(m=>m.id===provenId):candidates.length===1?candidates[0]:undefined;
   if(provenId&&!replyInbound)throw new AgentDecisionReviewError('Protected reply candidate differs from the current latest route history');
   if(candidates.length>1&&!provenId)throw new AgentDecisionReviewError('Ambiguous latest reply candidates require human review');
   if(!replyInbound)throw new AgentDecisionReviewError('A reply must use a latest inbound channel');
   const latestOutbound=context.history.filter(m=>m.direction==='outbound').sort(newestFirst)[0];
   // Model decisions remain accounted and recorded; never turn an already
   // answered inbound into another send proposal, including after a retry.
   if(latestOutbound&&(Date.parse(latestOutbound.at)>Date.parse(replyInbound.at)||Date.parse(latestOutbound.at)===Date.parse(replyInbound.at)&&!provenId)){
    await port.commit(context,{action:'wait',reminder:{wakeAt:new Date(instant+86400000).toISOString(),timeZone:'UTC',reason:'The latest inbound has already been answered. Wait for a new reply before drafting another response.'},sourceIds:[latestOutbound.id]},event.requestKey+':await-reply');
    return {kind:'complete'};
   }
  }
  if(draft.kind.startsWith('initial_')&&(hasInbound||routeHistory.length))throw new AgentDecisionReviewError('An initial cold message requires an empty channel and a person who has not replied');
  if(draft.kind.startsWith('follow_up_')){
   if(!routeHistory.some(m=>m.direction==='outbound'))throw new AgentDecisionReviewError('A follow-up requires an earlier outbound message on this channel');
   if(latestInbound){
    // A tied incoming turn can be answered on any of its verified routes.
    // Continue only on the route actually used for the latest person answer;
    // canonical message-ID ordering must not choose another conversation.
    const latestOutbound=context.history.filter(m=>m.direction==='outbound').sort(newestFirst)[0];
    const onSelectedRoute=(message:AgentConversationContext['history'][number])=>selected
     ?message.routeId?message.routeId===selected.id&&(message.channel??channel)===channel:channel==='email'&&(message.channel??'email')==='email'
     :!message.routeId&&(message.channel??'email')==='email';
    if(!latestOutbound||Date.parse(latestOutbound.at)<=Date.parse(latestInbound.at))throw new AgentDecisionReviewError('The newest inbound needs an answer before a follow-up');
    if(!onSelectedRoute(latestOutbound)||context.history.some(m=>m.direction==='outbound'&&Date.parse(m.at)===Date.parse(latestOutbound.at)&&!onSelectedRoute(m)))throw new AgentDecisionReviewError('A conversational follow-up must remain on the actual answered channel');
    if(!routeHistory.some(m=>m.direction==='inbound'&&Date.parse(m.at)===Date.parse(latestInbound.at)&&onSelectedRoute(m)))throw new AgentDecisionReviewError('A follow-up requires this route to share the newest incoming turn');
   }
  }
 }
 if(decision.action==='handoff'&&!context.history.some(m=>m.direction==='inbound'))throw new AgentDecisionReviewError('A call handoff requires a lead reply');
 if(decision.action==='wait')try{
  // The accounted model result stays immutable. A wake that was already invalid
  // when inference began cannot be rescued by execution-time normalization.
  const original=validateAgentWakeup(decision.reminder,new Date(instant).toISOString()),completedAt=port.now(),completed=Date.parse(completedAt);
  if(!Number.isFinite(completed)||completed<instant||completed-instant>45000)throw Error('Model planning exceeded its bounded clock window');
  if(Date.parse(original.wakeAt)<completed+30000){
   decision={...decision,reminder:{...original,wakeAt:new Date(completed+30000).toISOString(),reason:original.reason.slice(0,1500)+' Scheduler deferred the requested wake-up '+original.wakeAt+' to preserve a 30-second future commit margin after model planning.'}};
  }
  validateAgentWakeup(decision.reminder,completedAt);
 }catch{throw new AgentDecisionReviewError('The requested wake-up is outside the supported future reminder window.');}
 if(decision.action==='review')return {kind:'review',message:decision.reason};
 await port.commit(context,decision,event.requestKey);return {kind:'complete'};
}
