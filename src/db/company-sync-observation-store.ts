import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {PgDialect} from 'drizzle-orm/pg-core';
import {lockResearchPersistence} from '../lib/research-persistence-lock';
import {normalizeCompanyIdentity,type CompanyIdentity} from './company-identity-policy';
import {companyIdentityDigest,companyIdentityObservationInputSchema,CompanyIdentityReviewError,type CompanyIdentitySqlClient} from './company-identity-store';
import {responseHash} from '../domain/firmable-history';
import {publishCompanyMembershipProjection} from './company-membership-projection-store';
type Actor={organizationId:string;userId:string};
export type FirmableSyncCompanyObservationInput={runId:string;mandateId:string;targetId:string;expectedGeneration:number;source:CompanyIdentity;sourceFacts:z.infer<typeof companyIdentityObservationInputSchema>['sourceFacts']};
export type FirmableSyncCompanyObservationResult={handled:false;legacy:true}|{handled:true;targetId:string;observationId:string;replayed:boolean};
const actorSchema=z.object({organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)}).strict();
const uuid=z.string().uuid(),dialect=new PgDialect();
/** Genuine company-response provenance, never a borrowed research job. Only an
 * already accepted current membership may append refresh facts. No canonical
 * target/contact/source history is overwritten and no new identity is chosen. */
export async function appendFirmableSyncCompanyObservation(c:CompanyIdentitySqlClient,rawActor:Actor,input:FirmableSyncCompanyObservationInput):Promise<FirmableSyncCompanyObservationResult>{
 const actor=actorSchema.parse(rawActor);for(const id of[input.runId,input.mandateId,input.targetId])uuid.parse(id);z.number().int().positive().parse(input.expectedGeneration);
 await lockResearchPersistence({execute:query=>{const q=dialect.sqlToQuery(query);return c.query(q.sql,q.params);}},actor.organizationId);
 if(!(await c.query('SELECT id FROM member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[actor.organizationId,actor.userId])).rowCount)throw new CompanyIdentityReviewError('Current organisation membership required.',403);
 const run=(await c.query('SELECT * FROM firmable_sync_runs WHERE id=$1 AND organization_id=$2 AND actor_id=$3 AND target_id=$4 FOR UPDATE',[input.runId,actor.organizationId,actor.userId,input.targetId])).rows[0];
 if(!run)throw new CompanyIdentityReviewError('Company refresh source unavailable.',404);
 if(!(await c.query('SELECT target_id FROM mandate_targets WHERE organization_id=$1 AND mandate_id=$2 AND target_id=$3 FOR SHARE',[actor.organizationId,input.mandateId,input.targetId])).rowCount)throw new CompanyIdentityReviewError('Company refresh membership unavailable.',404);
 const accepted=(await c.query('SELECT * FROM company_identity_accepted_observations WHERE organization_id=$1 AND mandate_id=$2 AND target_id=$3 ORDER BY observed_at DESC,created_at DESC,id DESC LIMIT 1',[actor.organizationId,input.mandateId,input.targetId])).rows[0];
 if(!accepted){
  if((await c.query('SELECT id FROM company_identity_accepted_observations WHERE organization_id=$1 AND target_id=$2 LIMIT 1',[actor.organizationId,input.targetId])).rowCount)throw new CompanyIdentityReviewError('Review current company membership facts before refreshing this canonical company.');
  return{handled:false,legacy:true};
 }
 const original=(await c.query('SELECT o.*,r.target_id FROM company_identity_observations o JOIN company_identity_resolutions r ON r.observation_id=o.id AND r.organization_id=o.organization_id WHERE o.request_key=$1',[input.runId])).rows[0];
 if(original){
  if(original.source_kind!=='firmable_sync'||original.firmable_sync_run_id!==input.runId||original.organization_id!==actor.organizationId||original.created_by!==actor.userId||original.mandate_id!==input.mandateId||original.target_id!==input.targetId)throw new CompanyIdentityReviewError('Company refresh conflicts with its original source.');
  return{handled:true,targetId:input.targetId,observationId:original.id,replayed:true};
 }
 const identity=normalizeCompanyIdentity(input.source);
 const facts=companyIdentityObservationInputSchema.shape.sourceFacts.parse(input.sourceFacts);
 if(JSON.stringify(facts).length>250000)throw new CompanyIdentityReviewError('Company refresh source is too large for review.');
 if(facts.firmableCompanyId!==identity.firmableId||facts.identifiers.firmableId!==undefined&&facts.identifiers.firmableId!==identity.firmableId||facts.identifiers.abn!==undefined&&facts.identifiers.abn!==identity.abn)throw new CompanyIdentityReviewError('Company identity requires review before refresh.');
 if(!['queued','running'].includes(run.status)||run.generation!==input.expectedGeneration)throw new CompanyIdentityReviewError('Company refresh changed or is no longer active.');
 const current=(await c.query('SELECT id,domain,firmable_company_id FROM targets WHERE id=$1 AND organization_id=$2 FOR SHARE',[input.targetId,actor.organizationId])).rows[0];
 const prior=accepted.source as CompanyIdentity;
 if(!current||!identity.firmableId||prior.domain!==identity.domain||prior.firmableId!==identity.firmableId||prior.abn!==undefined&&prior.abn!==identity.abn||normalizeCompanyIdentity({companyName:identity.companyName,domain:current.domain}).domain!==identity.domain||current.firmable_company_id!==null&&current.firmable_company_id!==identity.firmableId||run.firmable_company_id!==identity.firmableId)throw new CompanyIdentityReviewError('Company identity requires review before refresh.');
 const company=(await c.query('SELECT people_generation FROM firmable_companies WHERE id=$1 FOR SHARE',[identity.firmableId])).rows[0];
 if(!company||company.people_generation!==run.generation)throw new CompanyIdentityReviewError('Company refresh generation changed.');
 const receipt=(await c.query('SELECT * FROM firmable_company_responses WHERE run_id=$1 AND successful=true AND http_status=200 AND response IS NOT NULL ORDER BY fetched_at DESC,id DESC LIMIT 1 FOR SHARE',[input.runId])).rows[0];
 if(!receipt||receipt.firmable_company_id!==identity.firmableId||receipt.response_hash!==responseHash(receipt.response))throw new CompanyIdentityReviewError('Verified company refresh source required.');
 const raw=receipt.response as Record<string,unknown>;
 const rawDomain=typeof raw.fqdn==='string'?raw.fqdn:typeof raw.website==='string'?raw.website:'';
 let verifiedDomain:string;
 try{verifiedDomain=normalizeCompanyIdentity({companyName:identity.companyName,domain:rawDomain}).domain;}catch{throw new CompanyIdentityReviewError('Company response identity requires review.');}
 const codes=raw.industry_codes&&typeof raw.industry_codes==='object'?raw.industry_codes as Record<string,unknown>:{};
 const reportedAbn=String(codes.abn??raw.abn??'').replace(/\D/g,'')||undefined;
 if(raw.id!==identity.firmableId||verifiedDomain!==identity.domain||identity.abn!==reportedAbn)throw new CompanyIdentityReviewError('Company response identity requires review.');
 const observedAt=new Date(receipt.fetched_at).toISOString(),source={...identity,observedAt,sourceUrl:`https://app.firmable.com/dashboard/company/${identity.firmableId}`};
 const provenance={runId:input.runId,responseId:receipt.id,responseHash:receipt.response_hash,generation:run.generation};
 const observationId=randomUUID(),digest=companyIdentityDigest({source,sourceFacts:facts,provenance,mandateId:input.mandateId,targetId:input.targetId});
 await c.query("INSERT INTO company_identity_observations(id,request_key,organization_id,mandate_id,job_id,created_by,source,source_facts,input_digest,observed_at,source_kind,firmable_sync_run_id,source_provenance) VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,'firmable_sync',$2,$10)",[observationId,input.runId,actor.organizationId,input.mandateId,actor.userId,source,facts,digest,observedAt,provenance]);
 await c.query('INSERT INTO company_identity_resolutions(observation_id,organization_id,target_id) VALUES($1,$2,$3)',[observationId,actor.organizationId,input.targetId]);
 await publishCompanyMembershipProjection(c,actor,{mandateId:input.mandateId,targetId:input.targetId});
 return{handled:true,targetId:input.targetId,observationId,replayed:false};
}
