import {z} from 'zod';
import {nativeEmailDraftSchema,explicitAgentOptOut,containsAgentOutboundLink} from '@/domain/agent-execution';
import {agentConversationContextSchema} from './agent-conversation-engine';
import type {AgentExecutionFence} from '@/db/agent-execution-store';
import type {AgentSequenceStore} from '@/db/agent-sequence-store';
import {agentGuidanceSnapshotSchema} from './agent-guidance-snapshot';
import {campaignDraftDefinition,campaignDefinition} from '@/domain/campaign';
const uuid=z.string().uuid();
const chatSequenceDefinition=z.object({schemaVersion:z.literal(1),steps:z.array(z.discriminatedUnion('kind',[
 z.object({id:uuid,kind:z.literal('email'),title:z.string().trim().min(1).max(100),subject:z.string().trim().min(1).max(200).refine(v=>!containsAgentOutboundLink(v),'Links require a human handoff'),body:z.string().trim().min(1).max(2000).refine(v=>!containsAgentOutboundLink(v),'Links require a human handoff')}).strict(),
 z.object({id:uuid,kind:z.literal('wait'),title:z.string().trim().min(1).max(100),days:z.number().int().min(1).max(30)}).strict(),
])).min(1).max(5)}).strict().refine(value=>campaignDraftDefinition.safeParse(value).success&&campaignDefinition.safeParse(value).success,'Provide a complete alternating email/wait sequence').refine(value=>new TextEncoder().encode(JSON.stringify(value)).length<=12000,'Use the full builder for larger sequences');
const proposal=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('none')}).strict(),z.object({kind:z.literal('research')}).strict(),z.object({kind:z.literal('people')}).strict(),z.object({kind:z.literal('targets')}).strict(),
 z.object({kind:z.literal('draft'),draft:nativeEmailDraftSchema}).strict(),
 z.object({kind:z.literal('sequence'),name:z.string().trim().min(1).max(100),definition:chatSequenceDefinition}).strict(),
]);
export const nativeChatDecisionSchema=z.object({text:z.string().trim().min(1).max(4000),proposal}).strict();
const scope={mandateRevision:z.string().regex(/^\d{1,30}$/),responsibilityId:uuid,responsibilityRevision:z.number().int().positive()};
const delivery=z.discriminatedUnion('mode',[z.object({mode:z.literal('communications'),bindingId:uuid}).strict(),z.object({mode:z.literal('local_sink')}).strict()]);
export const nativeChatContextSchema=z.object({...scope,conversation:agentConversationContextSchema.nullable(),delivery:delivery.nullable(),outreach:z.object({executionMode:z.enum(['real','demo']),demoContacts:z.object({prepared:z.number().int().nonnegative(),stale:z.number().int().nonnegative(),outreachReady:z.boolean()}).strict().optional(),channelPolicySaved:z.boolean(),conversations:z.number().int().nonnegative(),sendWindowWait:z.object({approvedMessages:z.number().int().positive(),nextAt:z.string().datetime({offset:true})}).strict().optional()}).strict().optional(),sequenceGuidance:agentGuidanceSnapshotSchema.optional()}).strict();
export const nativeChatPlanSchema=z.object({version:z.literal(1),...scope,proposal:proposal.refine(value=>value.kind!=='none'),conversation:z.object({conversationId:uuid,revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),delivery:delivery.optional(),sequenceGuidance:agentGuidanceSnapshotSchema.optional()}).strict().superRefine((value,c)=>{if(value.sequenceGuidance&&value.proposal.kind!=='sequence')c.addIssue({code:'custom',message:'Sequence guidance can only accompany sequence drafts'});if(value.proposal.kind==='draft'&&!value.conversation)c.addIssue({code:'custom',message:'Exact selected conversation required'});if(value.proposal.kind==='targets'&&!value.delivery)c.addIssue({code:'custom',message:'Explicit selected account required'});});
export type NativeChatPlan=z.infer<typeof nativeChatPlanSchema>;
export function prepareNativeChatDecision(raw:unknown,rawContext:unknown){
 const result=nativeChatDecisionSchema.parse(raw),context=nativeChatContextSchema.parse(rawContext);
 if(result.proposal.kind==='none')return {text:result.text};
 if(result.proposal.kind==='targets'&&!context.delivery){if(context.outreach?.executionMode==='demo'&&context.outreach.demoContacts?.outreachReady&&context.outreach.channelPolicySaved)return {text:'Your simulated contacts are prepared. Review them in the card below using your saved channel choices, then review the proposed messages. This chat message has not started outreach.'};return {text:'Select the recorded email account in the conversation controls, then review cached contacts. No account or delivery mode was selected by chat.'};}
 if(result.proposal.kind==='draft'&&!context.conversation)throw new Error('An exact server selected conversation is required');
 if(result.proposal.kind==='draft'){
  const c=context.conversation!,observed=Date.parse(c.historyObservedAt??'');
  if(c.driver!=='agent'||c.phase!=='active'||!c.supervisionActive||!c.historyComplete||!Number.isFinite(observed)||observed>Date.now()||Date.now()-observed>300000||c.history.some(m=>m.direction==='inbound'&&explicitAgentOptOut(m.text)))throw new Error('Conversation needs human review before drafting');
  const sources=new Set([...c.sources.map(v=>v.id),...c.history.map(v=>v.id),...c.guidance.map(v=>v.id)]);if(result.proposal.draft.sourceIds.some(id=>!sources.has(id)))throw new Error('Unknown draft evidence requires review');
 }
 const plan=nativeChatPlanSchema.parse({version:1,mandateRevision:context.mandateRevision,responsibilityId:context.responsibilityId,responsibilityRevision:context.responsibilityRevision,proposal:result.proposal,...(result.proposal.kind==='sequence'&&context.sequenceGuidance?{sequenceGuidance:context.sequenceGuidance}:{}),...(result.proposal.kind==='targets'?{delivery:context.delivery}:{}),...(result.proposal.kind==='draft'?{conversation:{conversationId:context.conversation!.conversationId,revision:context.conversation!.revision,contextRevision:context.conversation!.contextRevision}}:{})});
 // Model prose is not an execution receipt. Always describe the persisted intent.
 return {text:'I queued a request to prepare '+({research:'a company research plan',people:'a contact enrichment plan',targets:'a cached contact selection',draft:'an email draft',sequence:'a structured sequence draft only',none:'a review'}[result.proposal.kind])+'. It still needs current-context checks and human review. No research or email has been authorised by this chat message.',plan};
}
type ToolStore=Pick<AgentSequenceStore,'researchSupervisionContext'|'proposeResearchPlan'|'proposePeopleResearch'|'proposeTargetSelection'|'proposeNativeEmail'|'proposeSequenceDraft'>;
export async function dispatchNativeChatPlan(store:ToolStore,threadId:string,answerOperationId:string,raw:unknown,authority?:AgentExecutionFence){
 const plan=nativeChatPlanSchema.parse(raw),current=await store.researchSupervisionContext(threadId),r=current.responsibility;
 if(!r||!['ready','waiting'].includes(r.state)||r.id!==plan.responsibilityId||r.revision!==plan.responsibilityRevision||r.mandateRevision!==plan.mandateRevision||current.mandateRevision!==plan.mandateRevision)throw new Error('Chat goal changed; review the current mandate');
 const key='chat-proposal:'+answerOperationId;
 switch(plan.proposal.kind){
 case 'research':return store.proposeResearchPlan(threadId,key,{mandateRevision:plan.mandateRevision,responsibilityId:plan.responsibilityId,responsibilityRevision:plan.responsibilityRevision},authority);
 case 'people':return store.proposePeopleResearch(threadId,key,authority);
 case 'targets':return store.proposeTargetSelection(threadId,key,plan.delivery,authority);
 case 'sequence':return plan.sequenceGuidance?store.proposeSequenceDraft(threadId,key,{name:plan.proposal.name,definition:plan.proposal.definition},authority,{guidanceSnapshot:plan.sequenceGuidance}):store.proposeSequenceDraft(threadId,key,{name:plan.proposal.name,definition:plan.proposal.definition},authority);
 case 'draft':return store.proposeNativeEmail(threadId,key,{...plan.conversation,draft:plan.proposal.draft},authority,{forceHumanReview:true});
 default:throw new Error('No executable chat proposal');
 }
}
