import {z} from 'zod';
import {agentGuidanceSnapshotSchema,type AgentGuidanceSnapshot} from './agent-guidance-snapshot';
export const companyGuidanceAssessmentSchema=z.object({excluded:z.boolean(),preferenceScore:z.number().int().nonnegative(),explanations:z.array(z.object({guidanceId:z.string().uuid(),revision:z.number().int().positive(),status:z.enum(['avoid','prefer','unmatched','context_only']),matchedTerms:z.array(z.string().max(80)).max(8),reason:z.string().max(1200)}).strict()).max(5)}).strict();
const normal=(s:string)=>s.toLocaleLowerCase('en-AU').replace(/[‐‑–—-]/g,' ').replace(/\s+/g,' ').trim();
function evidenced(text:string,term:string){const needle=normal(term);let start=0;while((start=text.indexOf(needle,start))>=0){const before=text.slice(Math.max(0,start-45),start),whole=!/[\p{L}\p{N}]/u.test(text[start-1]??'')&&!/[\p{L}\p{N}]/u.test(text[start+needle.length]??'');if(whole&&!/\b(?:not|never|without|no|isn['’]t|aren['’]t|don['’]t)\b[^.!?]{0,30}$/.test(before))return true;start+=needle.length;}return false;}
/** Literal reviewed phrases affect native prioritisation only. They do not
 * rewrite mandate criteria or persist a qualification fact about the company. */
export function assessCompanyGuidance(raw:AgentGuidanceSnapshot,evidence:unknown){
 const snapshot=agentGuidanceSnapshotSchema.parse(raw),serialized=JSON.stringify(evidence??{});if(serialized.length>64000)throw new Error('Company evidence exceeds bounded guidance review; inspect it in the main workspace');const text=normal(serialized);let excluded=false,preferenceScore=0;
 const explanations=snapshot.items.filter(item=>item.state==='approved'&&item.input.category==='qualification').map(item=>{
  const policy=item.input.qualificationPolicy,avoid=policy?.avoidTerms.filter(term=>evidenced(text,term))??[],prefer=policy?.preferTerms.filter(term=>evidenced(text,term))??[];
  if(avoid.length)excluded=true;preferenceScore+=prefer.length;
  const status=avoid.length?'avoid':prefer.length?'prefer':policy?'unmatched':'context_only';
  return {guidanceId:item.id,revision:item.revision,status,matchedTerms:avoid.length?avoid:prefer,reason:avoid.length?`Company evidence matches your reviewed avoidance phrase: ${avoid.join(', ')}. Excluded from native allocation; the saved mandate and qualification are unchanged.`:prefer.length?`Company evidence matches your reviewed preference: ${prefer.join(', ')}.`:policy?'No reviewed phrase was supported by available company evidence; fit remains unknown.':'Read this approved guidance in the human fit review; no automatic rule was inferred from free text.'};
 });return companyGuidanceAssessmentSchema.parse({excluded,preferenceScore,explanations});
}
