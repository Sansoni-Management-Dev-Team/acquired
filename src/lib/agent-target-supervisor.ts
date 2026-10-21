import {agentContactReviewBatchSize} from '@/domain/agent-mode';
import {agentPersonChannelRecipientSchema,agentChannelIdentityProofSchema,type AgentPersonChannelRecipient} from '@/domain/agent-person-channel';
import type {AgentGuidanceSnapshot} from './agent-guidance-snapshot';
import {assessCompanyGuidance} from './agent-qualification-guidance';
import {z} from 'zod';
import {assessmentDecisionView,assessmentSchema,initialAssessment,type AcquisitionBrief} from '@/domain/acquisition';
import {assessMembership} from '@/domain/mandate-assessment';
import {reviewMandateFit} from '@/domain/mandate-fit';
import {targetRecordToRankedTarget} from '@/db/target-record-mapper';
import {agentRecordDigest as digest} from '@/db/agent-store';
import type {SavedResearchFinding} from '@/domain/research';
export type AgentTargetChannel=AgentPersonChannelRecipient&{bindingId:string;bindingDigest:string;identityProof:{kind:'recorded_contact';revision:string};senderLabel?:string};
export const agentTargetDeliverySchema=z.discriminatedUnion('mode',[z.object({mode:z.literal('channels'),policyRevision:z.number().int().positive()}).strict(),z.object({mode:z.literal('local_sink')}).strict(),z.object({mode:z.literal('communications'),bindingId:z.string().uuid(),bindingDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]);
export type AgentTargetDelivery=z.infer<typeof agentTargetDeliverySchema>;
export type AgentTargetCandidate={contactId:string;targetId:string|null;sourceKind?:'researched_target'|'manual_contact';companyName?:string;name:string;email:string;channels?:AgentTargetChannel[];sourceRevision:string;identityKeys?:string[];target:Record<string,unknown>|null;assessment:unknown;findings:SavedResearchFinding[];blockedReasons:string[]};
export type AgentTargetContext={mandateRevision:string;responsibilityId:string;responsibilityRevision:number;brief:AcquisitionBrief;candidates:AgentTargetCandidate[];companies:number;contacts:number;guidance?:AgentGuidanceSnapshot};
/** Reuses the main workspace's deterministic mandate fit matrix. Unknown fit
 * stays unknown; a human selection review is not a persisted qualification. */
export function buildAgentTargetSelection(context:AgentTargetContext,delivery:AgentTargetDelivery){
 const selected:{contactId:string;targetId:string|null;sourceKind?:'manual_contact';name:string;recipient:string;channels?:AgentTargetChannel[];sourceRevision:string;qualificationConfirmed:boolean;guidanceAssessment?:ReturnType<typeof assessCompanyGuidance>;fit:{key:string;status:string;reason:string;sources:string[]}[]}[]=[],excluded:{contactId:string;reasons:string[];guidanceAssessment?:ReturnType<typeof assessCompanyGuidance>}[]=[];const emails=new Set<string>(),identities=new Set<string>();
 const assessed=context.candidates.map(candidate=>({candidate,guidanceAssessment:context.guidance?assessCompanyGuidance(context.guidance,{target:candidate.target??{},findings:candidate.findings}):undefined})).sort((a,b)=>(b.guidanceAssessment?.preferenceScore??0)-(a.guidanceAssessment?.preferenceScore??0));
 for(const {candidate,guidanceAssessment} of assessed){
  const reasons=[...candidate.blockedReasons,...(guidanceAssessment?.excluded?['approved_qualification_guidance']:[])],email=candidate.email.trim().toLowerCase();
  if(delivery.mode!=='channels'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))reasons.push('missing_or_invalid_email');
  if(delivery.mode==='channels'&&(!candidate.channels?.length||candidate.channels.some(route=>!agentPersonChannelRecipientSchema.safeParse({channel:route.channel,recipient:route.recipient}).success||!agentChannelIdentityProofSchema.safeParse(route.identityProof).success)))reasons.push('missing_or_invalid_reviewed_channels');
  if(email&&emails.has(email))reasons.push('duplicate_recipient');
  if(candidate.identityKeys?.some(key=>identities.has(key)))reasons.push('duplicate_person');
  const parsed=assessmentSchema.safeParse(candidate.assessment),assessment=parsed.success?parsed.data:initialAssessment;
  const manual=candidate.sourceKind==='manual_contact';
  let fitRows:{key:string;status:string;reason:string;sources:string[]}[];
  if(manual){
   if(candidate.targetId!==null||candidate.target!==null||candidate.findings.length)reasons.push('manual_contact_evidence_conflict');
   fitRows=context.brief.criteria.map(criterion=>({key:criterion.key,status:'unknown',reason:'Manual contact entry has no company research or verified mandate-fit evidence.',sources:[]}));
  }else{
   if(!candidate.target||!candidate.targetId){excluded.push({contactId:candidate.contactId,reasons:[...reasons,'missing_company_evidence']});continue;}
   const target=targetRecordToRankedTarget(candidate.target as unknown as Parameters<typeof targetRecordToRankedTarget>[0],[]),decision=assessmentDecisionView(context.brief,target,assessment),fit=reviewMandateFit(context.brief,target,decision,candidate.findings),ranked=assessMembership(target,context.brief,decision,null,candidate.findings);
   if(ranked.scores.band==='excluded')reasons.push('excluded_by_mandate_review');
   fitRows=fit.rows.map(row=>({key:row.key,status:row.status,reason:row.reason.slice(0,160),sources:row.sources.filter(source=>source.length<=300).slice(0,1)}));
  }
  if(reasons.length||selected.length>=agentContactReviewBatchSize){excluded.push({contactId:candidate.contactId,reasons:reasons.length?reasons:['batch_limit'],...(guidanceAssessment?{guidanceAssessment}:{})});continue;}
  emails.add(email);for(const key of candidate.identityKeys??[])identities.add(key);selected.push({contactId:candidate.contactId,targetId:candidate.targetId,...(manual?{sourceKind:'manual_contact' as const}:{}),name:candidate.name.trim()?candidate.name.slice(0,200):'Contact name not verified',recipient:email,...(delivery.mode==='channels'?{channels:candidate.channels}:{}),sourceRevision:candidate.sourceRevision,qualificationConfirmed:manual?false:assessment.qualificationConfirmed,...(guidanceAssessment?{guidanceAssessment}:{}),fit:fitRows});
 }
 const source={mandateRevision:context.mandateRevision,responsibilityId:context.responsibilityId,responsibilityRevision:context.responsibilityRevision,delivery,selected,...(context.guidance?{guidance:context.guidance}:{})};
 return {nativeTargetSelectionVersion:1 as const,...source,contextRevision:digest(source),excluded:excluded.slice(0,50),counts:{companies:context.companies,contacts:context.contacts,reviewed:context.candidates.length,selected:selected.length,excluded:excluded.length},notice:'Human approval selects these exact contacts and their recorded delivery mode. Unknown and estimated fit remains unverified. Manual contacts have no company research or confirmed qualification. Full source evidence for researched companies remains in the company workspace. This does not approve or send any email.'};
}
