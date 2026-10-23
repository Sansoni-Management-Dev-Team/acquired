import{createHash}from'node:crypto';
import{z}from'zod';
import{targetRecordToRankedTarget}from'@/db/target-record-mapper';
import{assessmentDecisionView,accreditationSchema,assessmentSchema,initialAssessment,briefSchema,briefToMandate,emptyBrief,searchReadiness}from'./acquisition';
import{screenCompanyCandidate}from'./company-screening';
import{assessMembership}from'./mandate-assessment';
import type{SavedResearchFinding}from'./research';
export type CompanyProjectionTargetRecord=Parameters<typeof targetRecordToRankedTarget>[0];
const sourceFacts=z.object({firmographics:z.record(z.string(),z.unknown()),identifiers:z.record(z.string(),z.unknown()),firmableCompanyId:z.string().min(1).optional()}).strict();
export const acceptedCompanyObservationSchema=z.object({id:z.string().uuid(),inputDigest:z.string().regex(/^[a-f0-9]{64}$/),observedAt:z.string().datetime({offset:true}),sourceFacts}).strict();
export type AcceptedCompanyObservation=z.infer<typeof acceptedCompanyObservationSchema>;
function canonical(value:unknown):unknown{if(value instanceof Date)return value.toISOString();if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
/** Observation facts replace the old fact snapshot. Identity and workflow stay
 * canonical; buyer decisions are projected separately, never persisted here. */
export function applyCompanyObservationToTargetRecord<T extends CompanyProjectionTargetRecord>(targetRecord:T,raw:AcceptedCompanyObservation|null):T{
 if(!raw)return{...targetRecord};const observation=acceptedCompanyObservationSchema.parse(raw);
 const canonicalFacts=targetRecord.firmographics&&typeof targetRecord.firmographics==='object'?targetRecord.firmographics as Record<string,unknown>:{},accreditations=Object.hasOwn(canonicalFacts,'accreditations')?z.array(accreditationSchema).safeParse(canonicalFacts.accreditations):undefined;
 return{...targetRecord,firmographics:{...observation.sourceFacts.firmographics,...(accreditations?.success?{accreditations:accreditations.data}:{})},identifiers:observation.sourceFacts.identifiers,...(observation.sourceFacts.firmableCompanyId!==undefined?{firmableCompanyId:observation.sourceFacts.firmableCompanyId}:{})};
}
export function buildCompanyMembershipProjection(input:{targetRecord:CompanyProjectionTargetRecord;brief:unknown;assessment:unknown;findings:SavedResearchFinding[];observation:AcceptedCompanyObservation|null}){
 const parsedBrief=briefSchema.safeParse(input.brief),brief=parsedBrief.success?parsedBrief.data:emptyBrief(),parsedAssessment=assessmentSchema.safeParse(input.assessment),assessment=parsedAssessment.success?parsedAssessment.data:initialAssessment,observed=applyCompanyObservationToTargetRecord(input.targetRecord,input.observation);
 const facts={...(observed.firmographics as Record<string,unknown>)};
 for(const key of['screening','scores','band','qualification','status','fitScore','ripenessScore','financeabilityScore','confidenceScore','financeability','scoreExplanation'])delete facts[key];
 const factual={...observed,firmographics:facts,fitScore:null,ripenessScore:null,financeabilityScore:null,confidenceScore:null,band:'cold' as const,qualification:'research' as const};
 const target=targetRecordToRankedTarget(factual,[]),effectiveAssessment=assessmentDecisionView(brief,target,assessment),screening=screenCompanyCandidate(target,briefToMandate(brief)),ranked=assessMembership(target,brief,effectiveAssessment,null,input.findings);
 const currentCompanyBlockedReasons=[...(!parsedAssessment.success?['company_assessment_review_required']:[]),...(!parsedBrief.success||searchReadiness(brief).length?['company_criteria_review_required']:[]),...(screening.eligibility==='excluded'||ranked.scores.band==='excluded'||['excluded','parked'].includes(effectiveAssessment.stage)?['company_excluded']:[])];
 const effectiveTargetRecord={...factual,firmographics:{...facts,screening},fitScore:ranked.scores.fit,ripenessScore:ranked.scores.ripeness,financeabilityScore:ranked.scores.financeability,confidenceScore:ranked.scores.confidence,band:ranked.scores.band,qualification:ranked.scores.qualification};
 const projectionDigest=digest({version:1,target:{id:observed.id,organizationId:observed.organizationId,domain:observed.domain,firmableCompanyId:effectiveTargetRecord.firmableCompanyId,identifiers:effectiveTargetRecord.identifiers,firmographics:facts},brief,assessment:effectiveAssessment,findings:input.findings,observation:input.observation?{id:input.observation.id,inputDigest:input.observation.inputDigest,observedAt:input.observation.observedAt}:null,screening,currentCompanyBlockedReasons});
 return{effectiveTargetRecord,effectiveAssessment,screening,currentCompanyBlockedReasons,projectionDigest};
}
