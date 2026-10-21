import type {ResearchPersistenceDatabase} from '@/lib/research-persistence-lock';
import {acceptedCompanyObservationSchema,type AcceptedCompanyObservation} from '@/domain/company-membership-projection';
import {sql} from 'drizzle-orm';
import {z} from 'zod';

const rows=(result:unknown):unknown[]=>Array.isArray(result)?result:(result as {rows:unknown[]}).rows;
const scopedObservation=acceptedCompanyObservationSchema.extend({organizationId:z.string(),mandateId:z.string().uuid(),targetId:z.string().uuid()}).strict();

/** A missing optional schema leaves historical reads on their existing path. */
export async function loadAcceptedCompanyObservations(database:ResearchPersistenceDatabase,organizationId:string,mandateId:string,targetIds:string[]):Promise<Map<string,AcceptedCompanyObservation>>{
 const identities=[...new Set(z.array(z.string().uuid()).parse(targetIds))],found=new Map<string,AcceptedCompanyObservation>();
 if(!identities.length)return found;
 z.string().min(1).parse(organizationId);z.string().uuid().parse(mandateId);
 const flags=z.array(z.object({installed:z.boolean()}).strict()).length(1).parse(rows(await database.execute(sql`SELECT to_regclass('public.company_identity_accepted_observations') IS NOT NULL AS installed`)));
 if(!flags[0].installed)return found;
 const results=rows(await database.execute(sql`SELECT DISTINCT ON (o.target_id)
  o.id,o.organization_id AS "organizationId",o.mandate_id AS "mandateId",o.target_id AS "targetId",
  o.input_digest AS "inputDigest",o.observed_at AS "observedAt",o.source_facts AS "sourceFacts"
  FROM public.company_identity_accepted_observations o
  WHERE o.organization_id=${organizationId} AND o.mandate_id=${mandateId}::uuid
  AND o.target_id IN (${sql.join(identities.map(id=>sql`${id}::uuid`),sql`, `)})
  ORDER BY o.target_id,o.observed_at DESC,o.created_at DESC,o.id DESC`));
 for(const raw of results){
  const record=raw as Record<string,unknown>;
  const observedAt=record.observedAt instanceof Date||typeof record.observedAt==='string'?new Date(record.observedAt).toISOString():record.observedAt;
  const observation=scopedObservation.parse({...record,observedAt});
  if(observation.organizationId!==organizationId||observation.mandateId!==mandateId||!identities.includes(observation.targetId)||found.has(observation.targetId))throw Error('Company observation scope mismatch.');
  const {organizationId:omittedOrg,mandateId:omittedMandate,targetId,...value}=observation;void omittedOrg;void omittedMandate;
  found.set(targetId,value);
 }
 return found;
}
