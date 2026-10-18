import { z } from 'zod';

/** A proposal, never a send permission. Sequence graphs/n8n are deliberately absent. */
export const conversationDecisionSchema=z.object({
 intent:z.enum(['no_reply','interest','question','objection','wrong_person','not_now','not_interested','opt_out','meeting_ready','uncertain']),
 action:z.enum(['reply','wait','stop','handoff','review']),
 rationale:z.string().trim().min(1).max(2000),
 reply:z.string().trim().min(1).max(6000).optional(),
 wakeAt:z.string().datetime({offset:true}).optional(),
 sourceIds:z.array(z.string().min(1).max(200)).max(20),
 historyRevision:z.string().min(1).max(200),ownerRevision:z.number().int().positive(),
}).strict();
export type ConversationDecision=z.infer<typeof conversationDecisionSchema>;
export type ConversationDecisionContext={
 now:string;historyRevision:string;ownerRevision:number;owner:'agent'|'sequence'|'human';
 historyComplete:boolean;approvedSourceIds:string[];suppressed:boolean;humanTakeover:boolean;maxWakeAt?:string;
};
export function validateConversationDecision(raw:unknown,context:ConversationDecisionContext){
 const decision=conversationDecisionSchema.parse(raw);
 if(context.owner!=='agent')throw new Error('Conversation has another execution owner');
 if(decision.historyRevision!==context.historyRevision || decision.ownerRevision!==context.ownerRevision)throw new Error('Conversation context changed; reassess before approval');
 if(decision.intent==='not_interested'&&decision.action!=='stop')throw new Error('Not interested requires stop');
 if(decision.intent==='opt_out' && decision.action!=='stop')throw new Error('Opt-out requires stop');
 if(decision.intent==='meeting_ready' && decision.action!=='handoff')throw new Error('Meeting readiness requires human handoff');
 if(decision.intent==='uncertain' && decision.action!=='review')throw new Error('Uncertain intent requires human review');
 if(decision.sourceIds.some(id=>!context.approvedSourceIds.includes(id)))throw new Error('Unknown evidence source');
 if(decision.action==='reply'){
  if(context.suppressed || context.humanTakeover)throw new Error('Automated outbound is held');
  if(!context.historyComplete)throw new Error('Incomplete history requires human review');
  if(!decision.reply)throw new Error('Reply text required');
 }else if(decision.reply)throw new Error('Only a reply proposal may contain outbound text');
 if(decision.action==='wait'){
  const now=Date.parse(context.now),wake=Date.parse(decision.wakeAt||'');
  if(!Number.isFinite(now)||!Number.isFinite(wake)||wake<=now)throw new Error('Reassessment must be in the future');
  if(context.maxWakeAt && wake>Date.parse(context.maxWakeAt))throw new Error('Reassessment exceeds the allowed horizon');
 }else if(decision.wakeAt)throw new Error('Only a wait proposal may schedule reassessment');
 // Mode/grant admission is deliberately separate: a model cannot approve itself
 // or turn a draft into a send by returning a boolean or changing this proposal.
 return {...decision,requiresReview:true as const};
}
