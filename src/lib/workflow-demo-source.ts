import type {PoolClient} from 'pg';
import type {AgentActor} from '@/db/agent-store';
import type {MembershipView} from '@/domain/acquisition';
import {agentActorSchema} from '@/db/agent-store';
import {assessmentDecisionView,assessmentSchema,briefSchema,type AcquisitionBrief} from '@/domain/acquisition';
import {readableStoredBrief} from '@/domain/stored-brief';
import {assessMembership} from '@/domain/mandate-assessment';
import {z} from 'zod';
import {drizzle} from 'drizzle-orm/node-postgres';
import * as schema from '@/db/schema';
import{targetRecordToRankedTarget}from'@/db/target-record-mapper';
import{loadAcceptedCompanyObservations}from'@/db/company-observation-read-model';
import{buildCompanyMembershipProjection,type CompanyProjectionTargetRecord}from'@/domain/company-membership-projection';
import type{SavedResearchFinding}from'@/domain/research';
export type WorkflowDemoSource={mandateId:string;mandateRevision:string};
export type WorkflowDemoSourcePorts={memberships?:(mandateId:string,targetIds:string[])=>Promise<MembershipView[]>};
async function nativeSourceMemberships(client:PoolClient,actor:AgentActor,mandateId:string,targetIds:string[],brief:AcquisitionBrief):Promise<MembershipView[]>{
 const records=(await client.query(`SELECT /* workflow-demo-native-facts */ mt.version,mt.assessment,
  jsonb_build_object('id',t.id,'organizationId',t.organization_id,'companyName',t.company_name,'domain',t.domain,
   'identifiers',t.identifiers,'firmographics',t.firmographics,'firmableCompanyId',t.firmable_company_id,
   'status',t.status,'qualification',t.qualification,'fitScore',t.fit_score,'ripenessScore',t.ripeness_score,
   'financeabilityScore',t.financeability_score,'confidenceScore',t.confidence_score,'band',t.band) AS target,
  (SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'jobId',f.job_id,'targetId',f.target_id,'sourceUrl',f.source_url,
   'observedAt',f.observed_at,'evidence',f.evidence,'confidence',f.confidence) ORDER BY f.observed_at DESC,f.id),'[]')
   FROM(SELECT * FROM research_findings f WHERE f.organization_id=$2 AND f.mandate_id=$1 AND f.target_id=t.id
    ORDER BY f.observed_at DESC,f.id LIMIT 20)f) AS findings
  FROM mandate_targets mt JOIN targets t ON t.id=mt.target_id AND t.organization_id=mt.organization_id
  WHERE mt.mandate_id=$1 AND mt.organization_id=$2 AND t.id=ANY($3::uuid[]) ORDER BY t.id LIMIT 50`,[mandateId,actor.organizationId,targetIds])).rows;
 const observations=await loadAcceptedCompanyObservations(drizzle({client,schema}),actor.organizationId,mandateId,targetIds);
 return records.flatMap(row=>{
  const record=row.target as CompanyProjectionTargetRecord;
  if(record?.organizationId!==actor.organizationId||!targetIds.includes(record.id))return [];
  const assessment=assessmentSchema.safeParse(row.assessment);if(!assessment.success)return [];
  const findings=row.findings as SavedResearchFinding[],observation=observations.get(record.id);
  if(observation){
   const projected=buildCompanyMembershipProjection({targetRecord:record,brief,assessment:assessment.data,findings,observation});
   if(projected.currentCompanyBlockedReasons.length)return [];
   return [{target:targetRecordToRankedTarget(projected.effectiveTargetRecord,[]),assessment:projected.effectiveAssessment,researchFindings:findings,accreditations:[],version:row.version}];
  }
  return [{target:targetRecordToRankedTarget(record,[]),assessment:assessment.data,researchFindings:findings,accreditations:[],version:row.version}];
 });
}
/** Source usability hint before the policy fence, never outreach authority. The
 * existing SQL start command must recheck source ownership, unused state and the
 * returned mandate revision. Only materialized people count; display projections
 * and company totals cannot establish that this source can exercise outreach. */
export async function selectWorkflowDemoSource(client:PoolClient,rawActor:AgentActor,ports:WorkflowDemoSourcePorts={}):Promise<WorkflowDemoSource|undefined>{
 const actor=agentActorSchema.parse(rawActor);
 const rows=await client.query(`WITH candidate_sources AS MATERIALIZED (
  SELECT m.id,m.xmin::text AS revision,m.filters->'brief' AS brief,m.created_at
  FROM mandates m WHERE m.organization_id=$1 AND m.created_by=$2 AND jsonb_typeof(m.filters->'brief')='object'
  AND NOT EXISTS(SELECT 1 FROM acquisition_workflow_executions w WHERE w.mandate_id=m.id AND (w.preset IN('demo','live') OR w.state NOT IN('complete','failed','cancelled')))
  AND EXISTS(SELECT 1 FROM research_jobs j WHERE j.mandate_id=m.id AND j.organization_id=$1 AND j.created_by=$2 AND j.status IN('complete','partial'))
  AND EXISTS(SELECT 1 FROM mandate_targets mt JOIN contacts p ON p.target_id=mt.target_id AND p.organization_id=mt.organization_id
   WHERE mt.organization_id=$1 AND mt.mandate_id=m.id AND p.fictionalised=false AND p.firmable_person_id IS NOT NULL
   AND coalesce(p.personal_data->>'doNotContact','false')='false')
  ORDER BY m.created_at DESC,m.id LIMIT 25
 ) SELECT /* workflow-demo-sources */ id,revision,brief FROM candidate_sources
 WHERE public.acquisition_workflow_mandate_unused(id,$1,$2)
 AND public.acquisition_workflow_has_saved_people(id,$1,$2)
 ORDER BY created_at DESC,id`,[actor.organizationId,actor.userId]);
 const sources=z.array(z.object({id:z.string().uuid(),revision:z.string().regex(/^\d{1,30}$/),brief:z.unknown()})).max(25).parse(rows.rows);
 for(const source of sources){
  const brief=briefSchema.safeParse(readableStoredBrief(source.brief));if(!brief.success)continue;
  // Match the researched snapshot's first 50 contacts before filtering; a
  // usable person beyond its bounded page cannot make an empty Start pass.
  const people=await client.query(`WITH candidate_contacts AS (
    SELECT c.* FROM contacts c JOIN mandate_targets mt ON mt.target_id=c.target_id AND mt.organization_id=c.organization_id
    WHERE mt.mandate_id=$1 AND c.organization_id=$2
    ORDER BY EXISTS(SELECT 1 FROM agent_person_claims claim WHERE claim.organization_id=$2 AND claim.identity_key='contact:'||c.id::text),
     c.fictionalised,coalesce(c.personal_data->>'doNotContact','false')<>'false',coalesce(c.personal_data->>'email','')='',c.id LIMIT 50
   ) SELECT DISTINCT /* workflow-demo-contact-targets */ t.id
   FROM candidate_contacts c JOIN targets t ON t.id=c.target_id AND t.organization_id=c.organization_id
   WHERE c.organization_id=$2
   AND c.fictionalised=false AND c.firmable_person_id IS NOT NULL AND coalesce(c.personal_data->>'doNotContact','false')='false'
   AND coalesce(t.firmable_company_id,t.identifiers->>'firmableId','')~'^f[0-9]+$'
   AND NOT(t.firmable_company_id IS NOT NULL AND t.identifiers->>'firmableId' IS NOT NULL AND t.firmable_company_id<>t.identifiers->>'firmableId')
   AND NOT(t.firmographics ? 'offlineFixture')
   AND NOT EXISTS(SELECT 1 FROM company_identity_claims claim WHERE claim.organization_id=$2 AND claim.identity_key='firmable:'||coalesce(t.firmable_company_id,t.identifiers->>'firmableId') AND claim.target_id<>t.id)
   AND NOT EXISTS(SELECT 1 FROM agent_person_claims claim JOIN agent_conversations owned ON owned.id=claim.conversation_id AND owned.organization_id=claim.organization_id WHERE claim.organization_id=$2 AND owned.contact_id=c.id)
   AND NOT EXISTS(SELECT 1 FROM campaign_enrolments e WHERE e.organization_id=$2 AND e.contact_id=c.id AND e.state IN('active','paused','needs_review'))
   AND NOT EXISTS(SELECT 1 FROM sequence_enrolments e WHERE e.organization_id=$2 AND e.contact_id=c.id AND e.state::text NOT IN('completed','stopped'))
   AND NOT EXISTS(SELECT 1 FROM suppressions s WHERE s.organization_id=$2 AND (lower(s.address)=lower(btrim(c.personal_data->>'email')) OR lower(s.domain)=split_part(lower(btrim(c.personal_data->>'email')),'@',2)))
   ORDER BY t.id LIMIT 50`,[source.id,actor.organizationId]);
  const targetIds=z.array(z.object({id:z.string().uuid()})).max(50).parse(people.rows).map(row=>row.id);if(!targetIds.length)continue;
  for(const member of await (ports.memberships?ports.memberships(source.id,targetIds):nativeSourceMemberships(client,actor,source.id,targetIds,brief.data))){
   if(member.target.organisationId!==actor.organizationId||!targetIds.includes(member.target.id))continue;
   const saved=assessmentSchema.safeParse(member.assessment);if(!saved.success||saved.data.stage==='parked')continue;
   const decision=assessmentDecisionView(brief.data,member.target,saved.data);
   if(assessMembership(member.target,brief.data,decision,null,member.researchFindings??[]).scores.band!=='excluded')return {mandateId:source.id,mandateRevision:source.revision};
  }
 }
}
