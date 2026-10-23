import type {Pool,PoolClient} from 'pg';
import {drizzle} from 'drizzle-orm/node-postgres';
import {z} from 'zod';
import {AcquisitionRepository} from '@/db/acquisition-repository';
import {agentActorSchema,agentRecordDigest,type AgentActor} from '@/db/agent-store';
import * as schema from '@/db/schema';
import {briefSchema} from '@/domain/acquisition';
import {readableStoredBrief} from '@/domain/stored-brief';

const uuid=z.string().uuid();
const revision=z.string().regex(/^\d{1,30}$/);
const maxCompanies=20,maxContacts=1000;
export const cachedDemoMinimumSize={companies:3,people:50} as const;
function largeEnoughForNewDemo(selection:CachedDemoResearchSelection|undefined){
 return selection&&selection.companyCount>=cachedDemoMinimumSize.companies&&selection.peopleCount>=cachedDemoMinimumSize.people?selection:undefined;
}
export const cachedDemoResearchSelectionSchema=z.object({
 version:z.literal(1),sourceMandateId:uuid,sourceMandateRevision:revision,brief:briefSchema,
 targetIds:z.array(uuid).min(1).max(maxCompanies).refine(v=>new Set(v).size===v.length),
 companyCount:z.number().int().min(1).max(maxCompanies),peopleCount:z.number().int().min(1).max(maxContacts),
 sourceDigest:z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(v=>v.companyCount===v.targetIds.length);
export type CachedDemoResearchSelection=z.infer<typeof cachedDemoResearchSelectionSchema>;
export class CachedDemoResearchError extends Error{constructor(message:string,readonly status=409){super(message);this.name='CachedDemoResearchError';}}
type Query=Pick<PoolClient,'query'>;
const sourceRow=z.object({id:uuid,revision,filters:z.unknown(),createdBy:z.string(),cached:z.boolean(),successfulResearch:z.boolean()});
const targetRow=z.object({id:uuid,revision,firmableId:z.string().regex(/^f\d+$/)});
const contactRow=z.object({id:uuid,targetId:uuid,revision});
/** Saved identities and revisions only: no contact channels or fresh-provider
 * authority are created by selecting a cached demonstration. */
async function sourceSelection(c:Query,actor:AgentActor,sourceMandateId:string,locking=false):Promise<CachedDemoResearchSelection|undefined>{
 const result=await c.query(`/* cached-demo-source */ SELECT m.id,m.xmin::text AS revision,m.filters,m.created_by AS "createdBy",
  EXISTS(SELECT 1 FROM audit_events a WHERE a.id=m.id AND a.organization_id=m.organization_id AND a.action='agent.mandate_created' AND a.metadata->'initialResearch'->>'source'='cached') AS cached,
  EXISTS(SELECT 1 FROM research_jobs j WHERE j.organization_id=m.organization_id AND j.mandate_id=m.id AND j.created_by=m.created_by AND j.status IN('complete','partial')) AS "successfulResearch"
  FROM mandates m WHERE m.id=$1 AND m.organization_id=$2 AND m.created_by=$3
  AND EXISTS(SELECT 1 FROM member member WHERE member.organization_id=m.organization_id AND member.user_id=$3)${locking?' FOR SHARE OF m':''}`,[sourceMandateId,actor.organizationId,actor.userId]);
 const parsed=sourceRow.safeParse(result.rows[0]);
 if(!parsed.success||parsed.data.createdBy!==actor.userId||parsed.data.cached||!parsed.data.successfulResearch)return;
 const source=parsed.data,filters=source.filters as {brief?:unknown}|null,brief=briefSchema.safeParse(readableStoredBrief(filters?.brief));
 if(!brief.success)return;
 // Existing identity claims win. Unclaimed repeated provider identities are
 // represented once, deterministically; historical duplicate rows stay intact.
 const targetResult=await c.query(`/* cached-demo-targets */ SELECT t.id,t.xmin::text AS revision,coalesce(t.firmable_company_id,t.identifiers->>'firmableId') AS "firmableId"
  FROM targets t JOIN mandate_targets mt ON mt.target_id=t.id AND mt.organization_id=t.organization_id
  WHERE mt.mandate_id=$1 AND t.organization_id=$2
  AND coalesce(t.firmable_company_id,t.identifiers->>'firmableId','') ~ '^f[0-9]+$'
  AND NOT (t.firmable_company_id IS NOT NULL AND t.identifiers->>'firmableId' IS NOT NULL AND t.firmable_company_id<>t.identifiers->>'firmableId')
  AND NOT (t.firmographics ? 'offlineFixture')
  AND NOT EXISTS(SELECT 1 FROM company_identity_claims claim WHERE claim.organization_id=t.organization_id AND claim.identity_key='firmable:'||coalesce(t.firmable_company_id,t.identifiers->>'firmableId') AND claim.target_id<>t.id)
  AND EXISTS(SELECT 1 FROM contacts person WHERE person.organization_id=t.organization_id AND person.target_id=t.id AND person.fictionalised=false AND person.firmable_person_id IS NOT NULL AND coalesce(person.personal_data->>'doNotContact','false')='false')
  ORDER BY t.id LIMIT 200${locking?' FOR SHARE OF t,mt':''}`,[sourceMandateId,actor.organizationId]);
 const rows=z.array(targetRow).max(200).safeParse(targetResult.rows);if(!rows.success)return;
 const seen=new Set<string>(),targets=rows.data.filter(row=>{if(seen.has(row.firmableId))return false;seen.add(row.firmableId);return true;}).slice(0,maxCompanies);
 if(!targets.length)return;
 const contactResult=await c.query(`/* cached-demo-contacts */ SELECT person.id,person.target_id AS "targetId",person.xmin::text AS revision
  FROM contacts person WHERE person.organization_id=$1 AND person.target_id=ANY($2::uuid[])
  AND person.fictionalised=false AND person.firmable_person_id IS NOT NULL AND coalesce(person.personal_data->>'doNotContact','false')='false'
  ORDER BY person.id LIMIT 1001${locking?' FOR SHARE OF person':''}`,[actor.organizationId,targets.map(row=>row.id)]);
 const people=z.array(contactRow).min(1).max(maxContacts).safeParse(contactResult.rows);
 if(!people.success||targets.some(t=>!people.data.some(p=>p.targetId===t.id)))return;
 const frame={version:1 as const,sourceMandateId:source.id,sourceMandateRevision:source.revision,brief:brief.data,targets,people:people.data};
 return cachedDemoResearchSelectionSchema.parse({version:1,sourceMandateId:source.id,sourceMandateRevision:source.revision,brief:brief.data,targetIds:targets.map(t=>t.id),companyCount:targets.length,peopleCount:people.data.length,sourceDigest:agentRecordDigest(frame)});
}
/** Rotate original successful actor-owned sources by their least recent saved
 * demo creation. Reads do not consume a turn; exact source/retry manifests stay
 * frozen. No cache is unavailable, never a fallback to live research. */
export async function selectCachedDemoResearch(pool:Pick<Pool,'query'>,rawActor:AgentActor,options:{sourceMandateId?:string}={}):Promise<CachedDemoResearchSelection|undefined>{
 const actor=agentActorSchema.parse(rawActor);
 if(options.sourceMandateId)return largeEnoughForNewDemo(await sourceSelection(pool,actor,uuid.parse(options.sourceMandateId)));
 const candidates=await pool.query(`/* cached-demo-candidates */ SELECT m.id FROM mandates m
  JOIN LATERAL (SELECT count(DISTINCT coalesce(t.firmable_company_id,t.identifiers->>'firmableId')) AS companies,count(DISTINCT person.id) AS people
   FROM mandate_targets mt JOIN targets t ON t.id=mt.target_id AND t.organization_id=mt.organization_id
   JOIN contacts person ON person.target_id=t.id AND person.organization_id=t.organization_id
   WHERE mt.mandate_id=m.id AND mt.organization_id=m.organization_id
   AND person.fictionalised=false AND person.firmable_person_id IS NOT NULL AND coalesce(person.personal_data->>'doNotContact','false')='false'
   AND coalesce(t.firmable_company_id,t.identifiers->>'firmableId','') ~ '^f[0-9]+$'
   AND NOT (t.firmable_company_id IS NOT NULL AND t.identifiers->>'firmableId' IS NOT NULL AND t.firmable_company_id<>t.identifiers->>'firmableId')
   AND NOT (t.firmographics ? 'offlineFixture')
   AND NOT EXISTS(SELECT 1 FROM company_identity_claims claim WHERE claim.organization_id=t.organization_id AND claim.identity_key='firmable:'||coalesce(t.firmable_company_id,t.identifiers->>'firmableId') AND claim.target_id<>t.id)
  ) source_size ON source_size.companies>=$3 AND source_size.people>=$4
  LEFT JOIN LATERAL (SELECT max(demo_use.created_at) AS last_used_at FROM audit_events demo_use
   WHERE demo_use.organization_id=m.organization_id AND demo_use.actor_id=$2
   AND demo_use.action='agent.mandate_created' AND demo_use.entity_type='mandate' AND demo_use.entity_id=demo_use.id::text
   AND demo_use.metadata->'initialResearch'->>'source'='cached'
   AND demo_use.metadata->'initialResearch'->'cachedDemo'->'selection'->>'sourceMandateId'=m.id::text
  ) demo_usage ON true
  WHERE m.organization_id=$1 AND m.created_by=$2
  AND EXISTS(SELECT 1 FROM member member WHERE member.organization_id=m.organization_id AND member.user_id=$2)
  AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.id=m.id AND a.organization_id=m.organization_id AND a.action='agent.mandate_created' AND a.metadata->'initialResearch'->>'source'='cached')
  AND EXISTS(SELECT 1 FROM research_jobs j WHERE j.organization_id=m.organization_id AND j.mandate_id=m.id AND j.created_by=$2 AND j.status IN('complete','partial'))
  AND EXISTS(SELECT 1 FROM mandate_targets mt JOIN contacts person ON person.organization_id=mt.organization_id AND person.target_id=mt.target_id WHERE mt.organization_id=m.organization_id AND mt.mandate_id=m.id AND person.fictionalised=false AND person.firmable_person_id IS NOT NULL AND coalesce(person.personal_data->>'doNotContact','false')='false')
  ORDER BY demo_usage.last_used_at ASC NULLS FIRST,(SELECT count(*) FROM mandate_targets mt WHERE mt.organization_id=m.organization_id AND mt.mandate_id=m.id) DESC,m.created_at DESC,m.id
  LIMIT 10`,[actor.organizationId,actor.userId,cachedDemoMinimumSize.companies,cachedDemoMinimumSize.people]);
 for(const row of z.array(z.object({id:uuid})).max(10).parse(candidates.rows)){
  const selection=largeEnoughForNewDemo(await sourceSelection(pool,actor,row.id));if(selection)return selection;
 }
}
/** Reuse the normal membership command on canonical IDs. Only memberships in
 * the newly created demo are written; original research, people and receipts
 * retain their identity, age and provenance. */
export async function attachCachedDemoResearch(pool:Pick<Pool,'connect'>,rawActor:AgentActor,newMandateId:string,rawSelection:CachedDemoResearchSelection):Promise<{sourceMandateId:string;companyCount:number;peopleCount:number}>{
 const actor=agentActorSchema.parse(rawActor),selection=cachedDemoResearchSelectionSchema.parse(rawSelection);uuid.parse(newMandateId);
 if(newMandateId===selection.sourceMandateId)throw new CachedDemoResearchError('Create a new demo before reusing saved research.');
 const c=await pool.connect();try{
  await c.query('BEGIN');
  await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');
  await c.query('SELECT public.communications_lock_send_gate($1)',[actor.organizationId]);
  if(!(await c.query('SELECT id FROM member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[actor.organizationId,actor.userId])).rowCount)throw new CachedDemoResearchError('Current organisation membership required.',403);
  const destination=(await c.query(`/* cached-demo-destination */ SELECT m.id,m.xmin::text AS revision,m.created_by AS "createdBy",mode.mode,mode.demo_id AS "demoId",mode.created_by AS "modeCreatedBy",a.metadata
   FROM mandates m JOIN agent_mandate_execution_modes mode ON mode.mandate_id=m.id AND mode.organization_id=m.organization_id
   JOIN audit_events a ON a.id=m.id AND a.entity_id=m.id::text AND a.organization_id=m.organization_id AND a.actor_id=m.created_by AND a.action='agent.mandate_created' AND a.entity_type='mandate'
   WHERE m.id=$1 AND m.organization_id=$2 AND m.created_by=$3 FOR SHARE OF m,mode`,[newMandateId,actor.organizationId,actor.userId])).rows[0];
  const saved=cachedDemoResearchSelectionSchema.safeParse(destination?.metadata?.initialResearch?.cachedDemo?.selection);
  if(!destination||destination.id!==newMandateId||destination.createdBy!==actor.userId||destination.modeCreatedBy!==actor.userId||destination.mode!=='demo'||destination.demoId!==newMandateId)throw new CachedDemoResearchError('The owned demo mandate is unavailable.',404);
  if(destination.metadata?.initialResearch?.source!=='cached'||destination.revision!==destination.metadata?.initialResearch?.creationRevision||!saved.success||agentRecordDigest(saved.data)!==agentRecordDigest(selection))throw new CachedDemoResearchError('The saved cached-demo request changed or is unavailable.');
  const current=await sourceSelection(c,actor,selection.sourceMandateId,true);
  if(!current||agentRecordDigest(current)!==agentRecordDigest(selection))throw new CachedDemoResearchError('The saved research changed or is unavailable. Choose the cached demo again.');
  const database=drizzle({client:c,schema});
  await new AcquisitionRepository(actor.organizationId,database).attachMany(newMandateId,selection.targetIds);
  await c.query('COMMIT');
  return{sourceMandateId:selection.sourceMandateId,companyCount:selection.companyCount,peopleCount:selection.peopleCount};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
