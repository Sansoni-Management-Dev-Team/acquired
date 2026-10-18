import {z} from 'zod';
const id=z.string().min(1).max(200);
const sourceBase={id:z.string().uuid(),digest:z.string().regex(/^[a-f0-9]{64}$/)};
export const guidanceSourceEntitySchema=z.discriminatedUnion('kind',[
 z.object({...sourceBase,kind:z.enum(['operation','handoff','target_review']),revision:z.number().int().positive()}).strict(),
 z.object({...sourceBase,kind:z.literal('sequence_draft'),revision:z.string().regex(/^[0-9]{1,10}$/)}).strict(),
]);
export const qualificationPolicySchema=z.object({avoidTerms:z.array(z.string().trim().min(3).max(80)).max(8),preferTerms:z.array(z.string().trim().min(3).max(80)).max(8)}).strict().refine(value=>value.avoidTerms.length+value.preferTerms.length>0,'Add a reviewed phrase');
export const guidanceInputSchema=z.object({
 text:z.string().trim().min(1).max(2000),
 category:z.enum(['qualification','tone','buyer_context','follow_up']),
 sourceMessageId:z.string().uuid(),
 sourceEntity:guidanceSourceEntitySchema.optional(),
 qualificationPolicy:qualificationPolicySchema.optional(),
 triggerTerms:z.array(z.string().trim().min(2).max(80)).max(12),
}).strict().refine(value=>!value.qualificationPolicy||value.category==='qualification','Company phrase policies require qualification guidance');
export const guidanceViewSchema=z.object({
 id:z.string().uuid(),revision:z.number().int().positive(),state:z.enum(['proposed','approved','rejected']),
 organizationId:id,mandateId:id,userId:id,input:guidanceInputSchema,
}).strict();
export type AgentGuidanceView=z.infer<typeof guidanceViewSchema>;
export type AgentGuidanceScope={organizationId:string;mandateId:string;userId:string};
/** Bounded deterministic retrieval. Guidance remains data for the model, never
 * authority, qualification evidence, budget or a substitute for current input. */
export function selectAgentGuidance(records:unknown[],scope:AgentGuidanceScope,query:string):AgentGuidanceView[]{
 const text=query.slice(0,16000).toLocaleLowerCase('en-AU');
 const candidates=records.flatMap(raw=>{
  const parsed=guidanceViewSchema.safeParse(raw);if(!parsed.success)return [];
  const item=parsed.data;
  if(item.state!=='approved'||item.organizationId!==scope.organizationId||item.mandateId!==scope.mandateId||item.userId!==scope.userId)return [];
  const terms=item.input.triggerTerms,score=terms.filter(term=>text.includes(term.toLocaleLowerCase('en-AU'))).length;
  return terms.length&&!score?[]:[{item,score}];
 }).sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id));
 const selected:AgentGuidanceView[]=[];let characters=0;
 for(const {item} of candidates){if(selected.length>=5)break;if(characters+item.input.text.length>4000)continue;selected.push(item);characters+=item.input.text.length;}
 return selected;
}
