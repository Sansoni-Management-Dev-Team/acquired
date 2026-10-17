import {z} from 'zod';
const id=z.string().trim().min(1).max(200);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
const messageAction=z.enum(['initial_email','reply_email','follow_up_email','initial_whatsapp','reply_whatsapp','follow_up_whatsapp','initial_linkedin','reply_linkedin','follow_up_linkedin']);
const scopeSchema=z.object({organizationId:id,mandateId:id,userId:id,threadId:id});
export const reviewItemSchema=z.object({operationId:z.string().uuid(),revision:z.number().int().positive(),digest,contextRevision:id}).strict();
export type AgentReviewItem=z.infer<typeof reviewItemSchema>;
const manifestSchema=z.array(reviewItemSchema).min(1).max(50).refine(items=>new Set(items.map(i=>i.operationId)).size===items.length,'Duplicate operation');
export const reviewApprovalSchema=scopeSchema.extend({items:manifestSchema}).strict();
export const authorityGrantSchema=scopeSchema.extend({
 id,revision:z.number().int().positive(),channel:z.enum(['email','whatsapp','linkedin']),routeIds:z.array(z.string().uuid()).min(1).max(200).refine(ids=>new Set(ids).size===ids.length).optional(),
 actions:z.array(messageAction).min(1).max(3),
 recipientKeys:z.array(id.refine(value=>value!=='*'&&!value.includes('*'),'Explicit recipients required')).min(1).max(200),
 bindingDigest:digest,maxSends:z.number().int().min(1).max(100),usedSends:z.number().int().nonnegative(),
 approvedBy:id,approvedAt:z.string().datetime({offset:true}),expiresAt:z.string().datetime({offset:true}),revokedAt:z.string().datetime({offset:true}).optional(),
}).strict().refine(g=>g.actions.every(a=>a.endsWith('_'+g.channel))&&(g.channel==='email'||!!g.routeIds?.length),'One exact channel and explicit social routes required').refine(g=>g.usedSends<=g.maxSends,'Grant usage exceeds cap').refine(g=>{
 const duration=Date.parse(g.expiresAt)-Date.parse(g.approvedAt);
 return duration>0&&duration<=7*86400000;
},'Grant duration must be at most seven days');
const actionSchema=scopeSchema.extend({kind:messageAction,routeId:z.string().uuid().optional(),recipientKey:id,bindingDigest:digest,...reviewItemSchema.shape}).strict().refine(a=>a.kind.endsWith('_email')||!!a.routeId,'An exact social route is required');
export type AgentAuthorityAction=z.infer<typeof actionSchema>;
export type AgentAuthorityContext={now:string;owner:'agent'|'sequence'|'human';suppressed:boolean;humanTakeover:boolean;historyComplete:boolean;currentContextRevision:string};
const sameItem=(a:AgentReviewItem,b:AgentReviewItem)=>a.operationId===b.operationId&&a.revision===b.revision&&a.digest===b.digest&&a.contextRevision===b.contextRevision;
export function assertExactReviewBatch(expected:unknown,presented:unknown){
 const a=manifestSchema.parse(expected),b=manifestSchema.parse(presented);
 if(a.length!==b.length||a.some(item=>!b.some(other=>sameItem(item,other))))throw new Error('Review batch changed; refresh and review again');
 return a;
}
/** Server-side policy only. Call inside the dispatch transaction with fresh,
 * locked records. A delegated result still requires atomic grant consumption,
 * budgets, send window and communications admission; it is not a send permit. */
export function admitAgentAuthority(rawAction:unknown,context:AgentAuthorityContext,authority:{approval?:unknown;grant?:unknown}):{mode:'reviewed'}|{mode:'delegated';grantId:string;grantRevision:number}{
 const action=actionSchema.parse(rawAction);
 const now=Date.parse(context.now);
 if(!Number.isFinite(now))throw new Error('Current time unavailable');
 if(context.owner!=='agent'||context.humanTakeover)throw new Error('Agent no longer owns this conversation');
 if(context.suppressed)throw new Error('Outbound is suppressed');
 if(!context.historyComplete||context.currentContextRevision!==action.contextRevision)throw new Error('Conversation context changed or history is incomplete');
 const sameScope=(value:z.infer<typeof scopeSchema>)=>['organizationId','mandateId','userId','threadId'].every(k=>value[k as keyof typeof value]===action[k as keyof typeof value]);
 if(authority.approval){
  const approval=reviewApprovalSchema.parse(authority.approval);
  if(!sameScope(approval)||!approval.items.some(item=>sameItem(item,action)))throw new Error('Exact current approval required');
  return {mode:'reviewed'};
 }
 if(authority.grant){
  const grant=authorityGrantSchema.parse(authority.grant);
  if((grant.routeIds&&!action.routeId)||(action.routeId&&(!grant.routeIds?.includes(action.routeId)))||!sameScope(grant)||grant.revokedAt||Date.parse(grant.expiresAt)<=now||Date.parse(grant.approvedAt)>now||grant.usedSends>=grant.maxSends||grant.bindingDigest!==action.bindingDigest||!grant.recipientKeys.includes(action.recipientKey)||!grant.actions.includes(action.kind))throw new Error('Delegated authority is unavailable for this action');
  return {mode:'delegated',grantId:grant.id,grantRevision:grant.revision};
 }
 throw new Error('Human approval required');
}
