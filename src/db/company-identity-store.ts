import {wakeAfterCompanyIdentityDecision} from './company-identity-decision-wake';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import {sql} from 'drizzle-orm';
import {PgDialect} from 'drizzle-orm/pg-core';
import type {ResearchPersistenceDatabase} from '../lib/research-persistence-lock';
import { lockResearchPersistence } from '../lib/research-persistence-lock';
import { assertNativeResearchPersistence } from '../lib/agent-research-context';
import { companyIdentityDecisionSchema, companyIdentityReviewSchema, canAdoptCompanyIdentityReview, type CompanyIdentityReview, type CompanyIdentityDecisionReceipt } from '../domain/company-identity-review';
import {initialAssessment} from '../domain/acquisition';
import {publishCompanyMembershipProjection} from './company-membership-projection-store';
import { classifyCompanyIdentity, normalizeCompanyIdentity, type CompanyIdentity } from './company-identity-policy';

export type CompanyIdentityDatabase=ResearchPersistenceDatabase&{transaction<T>(work:(tx:ResearchPersistenceDatabase)=>Promise<T>):Promise<T>};
export type CompanyIdentitySqlClient=Pick<PoolClient,'query'>;
const dialect=new PgDialect();
function persistenceDatabase(c:CompanyIdentitySqlClient):ResearchPersistenceDatabase{return{execute:query=>{const compiled=dialect.sqlToQuery(query);return c.query(compiled.sql,compiled.params);}};}
/** Fixed internal SQL only; binds every numbered parameter as a Drizzle value.
 * This lets normal/native callers reuse their existing Drizzle transaction,
 * without a second connection/transaction or unsafe value interpolation. */
export function companyIdentityDrizzleClient(database:ResearchPersistenceDatabase):CompanyIdentitySqlClient{
 return {query:async(text:string,values:unknown[]=[])=>{
  const chunks=text.split(/(\$\d+)/g).map(part=>{
   if(!/^\$\d+$/.test(part))return sql.raw(part);
   const index=Number(part.slice(1));
   if(!Number.isSafeInteger(index)||index<1||index>values.length||values[index-1]===undefined)throw new CompanyIdentityReviewError('Missing SQL parameter.',500);
   return sql`${sql.param(values[index-1])}`;
  });
  const result=await database.execute(sql.join(chunks,sql.empty()));
  return Array.isArray(result)?{rows:result,rowCount:result.length}:result;
 }} as CompanyIdentitySqlClient;
}
const uuid=z.string().uuid();
const actorSchema=z.object({organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)});
type Actor=z.infer<typeof actorSchema>;
const buyerKeys=['screening','scores','band','qualification','status','fitScore','ripenessScore','financeabilityScore','confidenceScore','financeability','scoreExplanation'];
export const companyIdentityObservationInputSchema=z.object({
 requestKey:uuid,jobId:uuid,companyName:z.string().trim().min(1).max(1000),domain:z.string().min(1).max(1000),
 firmableId:z.string().regex(/^f[0-9]+$/).max(200).optional(),abn:z.string().regex(/^\d{11}$/).optional(),
 observedAt:z.string().datetime({offset:true}),sourceUrl:z.string().url().max(4000),
 sourceFacts:z.object({firmographics:z.record(z.string(),z.unknown()).refine(v=>buyerKeys.every(k=>!(k in v)),'Company facts cannot contain buyer decisions'),identifiers:z.record(z.string(),z.unknown()),firmableCompanyId:z.string().regex(/^f[0-9]+$/).max(200).optional()}).strict(),
}).strict().refine(v=>(v.sourceFacts.firmableCompanyId===undefined||v.sourceFacts.firmableCompanyId===v.firmableId),'Provider identity must match').refine(v=>(v.sourceFacts.identifiers.firmableId===undefined||v.sourceFacts.identifiers.firmableId===v.firmableId)&&(v.sourceFacts.identifiers.abn===undefined||v.sourceFacts.identifiers.abn===v.abn),'Source identifiers must match').refine(v=>JSON.stringify(v.sourceFacts).length<=250000,'Company observation too large');
export type CompanyIdentityObservationInput=z.infer<typeof companyIdentityObservationInputSchema>;
export type CompanyIdentityPersistenceResult={status:'persisted';targetId:string;observationId:string}|{status:'review_required'|'skipped';reviewId:string;observationId:string};
export class CompanyIdentityReviewError extends Error {constructor(message:string,readonly status=409){super(message);this.name='CompanyIdentityReviewError';}}
function canonical(value:unknown):unknown {if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));return value;}
export function companyIdentityDigest(value:unknown){return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
type Observation={id:string;job_id:string;mandate_id:string;created_by:string;source:CompanyIdentity&{observedAt:string;sourceUrl:string};source_facts:CompanyIdentityObservationInput['sourceFacts'];input_digest:string};
type Candidate=CompanyIdentityReview['candidates'][number]&{identityConflict?:boolean};
async function member(c:CompanyIdentitySqlClient,actor:Actor,locking=false){
 if(!(await c.query(`SELECT id FROM member WHERE organization_id=$1 AND user_id=$2${locking?' FOR SHARE':''}`,[actor.organizationId,actor.userId])).rowCount)throw new CompanyIdentityReviewError('Current organisation membership required.',403);
}
async function ownedMandate(c:CompanyIdentitySqlClient,actor:Actor,mandateId:string,locking=false){
 if(!(await c.query(`SELECT id FROM mandates WHERE id=$1 AND organization_id=$2${locking?' FOR SHARE':''}`,[uuid.parse(mandateId),actor.organizationId])).rowCount)throw new CompanyIdentityReviewError('Mandate unavailable.',404);
}
async function candidates(c:CompanyIdentitySqlClient,actor:Actor,source:CompanyIdentity,locking=false):Promise<Candidate[]>{
 // 51 is an overflow sentinel, never a truncated set of adoptable choices.
 const rows=(await c.query(`SELECT t.id AS "targetId",t.xmin::text AS "sourceRevision",t.company_name AS "companyName",t.domain,
 coalesce(t.firmable_company_id,t.identifiers->>'firmableId') AS "firmableId",nullif(regexp_replace(coalesce(t.identifiers->>'abn',''),'[[:space:]]','','g'),'') AS abn,
 (t.firmable_company_id IS NOT NULL AND t.identifiers->>'firmableId' IS NOT NULL AND t.firmable_company_id<>t.identifiers->>'firmableId') AS "identityConflict",
 (SELECT count(*)::int FROM contacts x WHERE x.organization_id=t.organization_id AND x.target_id=t.id) AS "savedPeopleCount",
 (SELECT count(*)::int FROM mandate_targets x WHERE x.organization_id=t.organization_id AND x.target_id=t.id) AS "mandateCount"
 FROM targets t WHERE t.organization_id=$1 AND (
 ($2::text IS NOT NULL AND (t.firmable_company_id=$2 OR t.identifiers->>'firmableId'=$2)) OR
 lower(regexp_replace(regexp_replace(regexp_replace(coalesce(t.domain,''),'^https?://','','i'),'^www\\.','','i'),'/.*$',''))=$3 OR
 ($4::text IS NOT NULL AND regexp_replace(coalesce(t.identifiers->>'abn',''),'[[:space:]]','','g')=$4))
 ORDER BY t.id LIMIT 51${locking?' FOR UPDATE OF t':''}`,[actor.organizationId,source.firmableId??null,source.domain,source.abn??null])).rows;
 if(rows.length>50)throw new CompanyIdentityReviewError('Company identity has too many candidates for a complete review.');
 return rows.map(row=>{let domain:string;try{domain=normalizeCompanyIdentity({companyName:row.companyName,domain:row.domain??''}).domain;}catch{domain='invalid-domain';}return {...row,domain,firmableId:row.firmableId??undefined,abn:row.abn??undefined};});
}
function identityKeys(source:CompanyIdentity){return [`domain:${source.domain}`,...(source.firmableId?[`firmable:${source.firmableId}`]:[]),...(source.abn?[`abn:${source.abn}`]:[])].sort();}
async function existingClaims(c:CompanyIdentitySqlClient,actor:Actor,source:CompanyIdentity){
 const rows=(await c.query('SELECT identity_key,target_id FROM company_identity_claims WHERE organization_id=$1 AND (identity_key=ANY($2::text[]) OR target_id IN(SELECT target_id FROM company_identity_claims WHERE organization_id=$1 AND identity_key=ANY($2::text[]))) ORDER BY identity_key LIMIT 51',[actor.organizationId,identityKeys(source)])).rows;
 if(rows.length>50)throw new CompanyIdentityReviewError('Company identity has too many established claims for a complete review.');
 const targets=new Set<string>(rows.map(row=>row.target_id));
 const mismatched=rows.some(row=>(row.identity_key.startsWith('firmable:')&&source.firmableId!==undefined&&row.identity_key!==`firmable:${source.firmableId}`)||(row.identity_key.startsWith('abn:')&&source.abn!==undefined&&row.identity_key!==`abn:${source.abn}`)||(row.identity_key.startsWith('domain:')&&row.identity_key!==`domain:${source.domain}`));
 return {conflicting:targets.size>1||mismatched,targetId:targets.size===1?[...targets][0]:undefined};
}
async function claim(c:CompanyIdentitySqlClient,actor:Actor,source:CompanyIdentity,targetId:string,observationId:string){
 for(const key of identityKeys(source)){
  const result=await c.query('INSERT INTO company_identity_claims(organization_id,identity_key,target_id,observation_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING target_id',[actor.organizationId,key,targetId,observationId]);
  if(!result.rowCount&&(await c.query('SELECT target_id FROM company_identity_claims WHERE organization_id=$1 AND identity_key=$2',[actor.organizationId,key])).rows[0]?.target_id!==targetId)throw new CompanyIdentityReviewError('The canonical company changed. Review the current identity.');
 }
}
async function attach(c:CompanyIdentitySqlClient,actor:Actor,mandateId:string,targetId:string){
 const exists=await c.query('SELECT id FROM targets WHERE id=$1 AND organization_id=$2 FOR SHARE',[targetId,actor.organizationId]);
 if(!exists.rowCount)throw new CompanyIdentityReviewError('Company unavailable.',404);
 await c.query('INSERT INTO mandate_targets(organization_id,mandate_id,target_id,assessment) VALUES($1,$2,$3,$4) ON CONFLICT(mandate_id,target_id) DO NOTHING',[actor.organizationId,mandateId,targetId,initialAssessment]);
}
async function previewContext(c:CompanyIdentitySqlClient,actor:Actor,reviewId:string,mandateId:string,locking=false):Promise<{review:CompanyIdentityReview;automaticTargetId?:string}>{
 const row=(await c.query(`SELECT r.id,r.revision,r.state,o.* FROM company_identity_reviews r JOIN company_identity_observations o ON o.id=r.observation_id AND o.organization_id=r.organization_id AND o.mandate_id=r.mandate_id WHERE r.id=$1 AND r.organization_id=$2 AND r.mandate_id=$3${locking?' FOR UPDATE OF r':''}`,[reviewId,actor.organizationId,mandateId])).rows[0] as (Observation&{revision:number;state:string})|undefined;
 if(!row||row.state!=='pending')throw new CompanyIdentityReviewError('Company identity review unavailable.',404);
 const job=(await c.query(`SELECT status,organization_id,mandate_id,created_by,config FROM research_jobs WHERE id=$1${locking?' FOR SHARE':''}`,[row.job_id])).rows[0];
 let sourceChanged=!job||['cancelled','failed'].includes(job.status)||job.organization_id!==actor.organizationId||job.mandate_id!==mandateId||job.created_by!==row.created_by;
 const parentId=job?.config?.parentJobId??job?.config?.companyBackgroundResearch?.sourceRootId;
 if(parentId!==undefined){
  if(!uuid.safeParse(parentId).success)sourceChanged=true;
  else{const parent=(await c.query(`SELECT status FROM research_jobs WHERE id=$1 AND organization_id=$2 AND mandate_id=$3 AND created_by=$4${locking?' FOR SHARE':''}`,[parentId,actor.organizationId,mandateId,job.created_by])).rows[0];if(!parent||['cancelled','failed'].includes(parent.status))sourceChanged=true;}
 }
 const items=await candidates(c,actor,row.source,locking);
 const claims=await existingClaims(c,actor,row.source);
 const resolution=classifyCompanyIdentity(row.source,items,claims.targetId);
 const reason=claims.conflicting?'conflicting_identifiers':(sourceChanged||claims.targetId!==undefined)?'source_changed':items.some(i=>i.identityConflict)?'conflicting_identifiers':resolution.kind==='review'?resolution.reason:'source_changed';
 const value={reviewId,revision:row.revision,source:{observationId:row.id,jobId:row.job_id,mandateId,...row.source},candidates:items.map(item=>({targetId:item.targetId,sourceRevision:item.sourceRevision,companyName:item.companyName,domain:item.domain,...(item.firmableId?{firmableId:item.firmableId}:{}),...(item.abn?{abn:item.abn}:{}),savedPeopleCount:item.savedPeopleCount,mandateCount:item.mandateCount})),reason};
 const automaticTargetId=!sourceChanged&&!claims.conflicting&&!items.some(i=>i.identityConflict)&&resolution.kind==='reuse'&&row.source.firmableId&&items.every(i=>i.firmableId===row.source.firmableId)?resolution.targetId:undefined;
 return {review:companyIdentityReviewSchema.parse({...value,previewDigest:companyIdentityDigest(value)}),...(automaticTargetId?{automaticTargetId}:{})};
}
async function preview(c:CompanyIdentitySqlClient,actor:Actor,reviewId:string,mandateId:string,locking=false):Promise<CompanyIdentityReview>{return(await previewContext(c,actor,reviewId,mandateId,locking)).review;}

async function recordedResolution(c:CompanyIdentitySqlClient,actor:Actor,prior:Observation):Promise<CompanyIdentityPersistenceResult>{
 const saved=(await c.query('SELECT target_id,review_id FROM company_identity_resolutions WHERE observation_id=$1 AND organization_id=$2',[prior.id,actor.organizationId])).rows[0];
 if(!saved)throw new CompanyIdentityReviewError('The saved observation is incomplete.');
 if(saved.target_id)return{status:'persisted',targetId:saved.target_id,observationId:prior.id};
 const decided=(await c.query('SELECT receipt FROM company_identity_decisions WHERE review_id=$1 AND organization_id=$2 AND mandate_id=$3',[saved.review_id,actor.organizationId,prior.mandate_id])).rows[0]?.receipt;
 if(decided?.status==='adopted')return{status:'persisted',targetId:decided.targetId,observationId:prior.id};
 return{status:decided?.status==='skipped'?'skipped':'review_required',reviewId:saved.review_id,observationId:prior.id};
}
/** Lookup only. Callers must retain their current-job/cancellation write fences
 * before materializing a child. An original receipt does not grant new write or
 * provider authority, and needs neither another fetch nor a new observedAt. */
export async function getRecordedCompanyPersistence(c:CompanyIdentitySqlClient,rawActor:Actor,input:{jobId:string;requestKey:string}):Promise<CompanyIdentityPersistenceResult|null>{
 const actor=actorSchema.parse(rawActor);uuid.parse(input.jobId);uuid.parse(input.requestKey);await member(c,actor);
 const job=(await c.query('SELECT mandate_id FROM research_jobs WHERE id=$1 AND organization_id=$2 AND created_by=$3',[input.jobId,actor.organizationId,actor.userId])).rows[0];
 if(!job)throw new CompanyIdentityReviewError('The research source is unavailable.',404);
 const prior=(await c.query('SELECT * FROM company_identity_observations WHERE request_key=$1',[input.requestKey])).rows[0] as (Observation&{organization_id:string})|undefined;
 if(!prior)return null;
 if(prior.organization_id!==actor.organizationId||prior.created_by!==actor.userId||prior.job_id!==input.jobId||prior.mandate_id!==job.mandate_id)throw new CompanyIdentityReviewError('The observation request conflicts with its saved source.');
 return recordedResolution(c,actor,prior);
}
/** Trusted source persistence port, called inside the caller's transaction. It
 * takes the shared global-before-org lock contract BEFORE reading/locking jobs.
 * It performs no network I/O and never updates an existing target or contact. */
export async function persistResearchedCompany(c:CompanyIdentitySqlClient,rawActor:Actor,rawInput:CompanyIdentityObservationInput):Promise<CompanyIdentityPersistenceResult>{
 const actor=actorSchema.parse(rawActor),input=companyIdentityObservationInputSchema.parse(rawInput),identity=normalizeCompanyIdentity({companyName:input.companyName,domain:input.domain,...(input.firmableId?{firmableId:input.firmableId}:{}),...(input.abn?{abn:input.abn}:{})});
 await lockResearchPersistence(persistenceDatabase(c),actor.organizationId);await member(c,actor,true);
 const digest=companyIdentityDigest({...input,...identity});
 const prior=(await c.query('SELECT * FROM company_identity_observations WHERE request_key=$1',[input.requestKey])).rows[0] as (Observation&{organization_id:string})|undefined;
 if(prior){
 if(prior.organization_id!==actor.organizationId||prior.created_by!==actor.userId||prior.job_id!==input.jobId||prior.input_digest!==digest)throw new CompanyIdentityReviewError('The observation request conflicts with its saved source.');
 return recordedResolution(c,actor,prior);
 }
 const job=(await c.query('SELECT organization_id AS "organizationId",mandate_id AS "mandateId",created_by AS "createdBy",config,status FROM research_jobs WHERE id=$1 AND organization_id=$2 AND created_by=$3 FOR SHARE',[input.jobId,actor.organizationId,actor.userId])).rows[0];
 if(!job||['cancelled','failed'].includes(job.status))throw new CompanyIdentityReviewError('The research source is no longer eligible.');
 await ownedMandate(c,actor,job.mandateId,true);await assertNativeResearchPersistence(persistenceDatabase(c),job);
 const parentId=job.config?.parentJobId??job.config?.companyBackgroundResearch?.sourceRootId;
 if(parentId!==undefined){
  if(!uuid.safeParse(parentId).success)throw new CompanyIdentityReviewError('The research source is no longer eligible.');
  const parent=(await c.query('SELECT status FROM research_jobs WHERE id=$1 AND organization_id=$2 AND mandate_id=$3 AND created_by=$4 FOR SHARE',[parentId,actor.organizationId,job.mandateId,actor.userId])).rows[0];
  if(!parent||['cancelled','failed'].includes(parent.status))throw new CompanyIdentityReviewError('The research source is no longer eligible.');
 }
 const observationId=randomUUID(),source={...identity,observedAt:input.observedAt,sourceUrl:input.sourceUrl};
 await c.query('INSERT INTO company_identity_observations(id,request_key,organization_id,mandate_id,job_id,created_by,source,source_facts,input_digest,observed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[observationId,input.requestKey,actor.organizationId,job.mandateId,input.jobId,actor.userId,source,input.sourceFacts,digest,input.observedAt]);
 const items=await candidates(c,actor,identity,true),claims=await existingClaims(c,actor,identity);
 const resolution=(claims.conflicting||items.some(i=>i.identityConflict))?{kind:'review' as const,reason:'conflicting_identifiers' as const}:classifyCompanyIdentity(identity,items,claims.targetId);
 if(resolution.kind==='review'){
 const reviewId=randomUUID();await c.query('INSERT INTO company_identity_reviews(id,observation_id,organization_id,mandate_id) VALUES($1,$2,$3,$4)',[reviewId,observationId,actor.organizationId,job.mandateId]);
 await c.query('INSERT INTO company_identity_resolutions(observation_id,organization_id,review_id) VALUES($1,$2,$3)',[observationId,actor.organizationId,reviewId]);
 return {status:'review_required',reviewId,observationId};
 }
 const targetId=resolution.kind==='reuse'?resolution.targetId:randomUUID();
 if(resolution.kind==='create')await c.query("INSERT INTO targets(id,organization_id,mandate_id,company_name,domain,firmable_company_id,identifiers,firmographics,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'identified')",[targetId,actor.organizationId,job.mandateId,identity.companyName,identity.domain,identity.firmableId??null,{...input.sourceFacts.identifiers,...(identity.firmableId?{firmableId:identity.firmableId}:{}),...(identity.abn?{abn:identity.abn}:{})},input.sourceFacts.firmographics]);
 await claim(c,actor,identity,targetId,observationId);await attach(c,actor,job.mandateId,targetId);
 await c.query('INSERT INTO company_identity_resolutions(observation_id,organization_id,target_id) VALUES($1,$2,$3)',[observationId,actor.organizationId,targetId]);
 return {status:'persisted',targetId,observationId};
}
export class CompanyIdentityStore {
 private actor:Actor;
 private database?:CompanyIdentityDatabase;
 constructor(private pool:Pool|null,actor:Actor){this.actor=actorSchema.parse(actor);}
 static usingDrizzle(database:CompanyIdentityDatabase,actor:Actor){const store=new CompanyIdentityStore(null,actor);store.database=database;return store;}
 private async transaction<T>(write:boolean,work:(c:CompanyIdentitySqlClient)=>Promise<T>){
 if(this.database)return this.database.transaction(async tx=>{
  const c=companyIdentityDrizzleClient(tx);
  if(!write)await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='15s'");
  if(write)await lockResearchPersistence(persistenceDatabase(c),this.actor.organizationId);
  await member(c,this.actor,write);return work(c);
 });
 if(!this.pool)throw new CompanyIdentityReviewError('Company identity storage unavailable.',503);
 const c=await this.pool.connect();try{await c.query(write?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await c.query("SET LOCAL lock_timeout='5s'");await c.query("SET LOCAL statement_timeout='15s'");if(write)await lockResearchPersistence(persistenceDatabase(c),this.actor.organizationId);await member(c,this.actor,write);const result=await work(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
 }
 async persist(rawInput:CompanyIdentityObservationInput){
  const input=companyIdentityObservationInputSchema.parse(rawInput);
  return this.transaction(true,async c=>{
   const original=await getRecordedCompanyPersistence(c,this.actor,{jobId:input.jobId,requestKey:input.requestKey});
   const result=await persistResearchedCompany(c,this.actor,input);
   if(!original&&result.status==='persisted'){
    const job=(await c.query('SELECT mandate_id FROM research_jobs WHERE id=$1 AND organization_id=$2 AND created_by=$3',[input.jobId,this.actor.organizationId,this.actor.userId])).rows[0];
    if(!job)throw new CompanyIdentityReviewError('The research source is unavailable.',404);
    await publishCompanyMembershipProjection(c,this.actor,{mandateId:job.mandate_id,targetId:result.targetId});
   }
   return result;
  });
 }
 async list(mandateId:string):Promise<CompanyIdentityReview[]>{return this.transaction(false,async c=>{
 await ownedMandate(c,this.actor,mandateId);
 const rows=(await c.query("SELECT id FROM company_identity_reviews WHERE organization_id=$1 AND mandate_id=$2 AND state='pending' ORDER BY created_at,id LIMIT 51",[this.actor.organizationId,mandateId])).rows;
 if(rows.length>50)throw new CompanyIdentityReviewError('There are too many pending identity reviews. Narrow the research batch.');
 return Promise.all(rows.map(row=>preview(c,this.actor,row.id,mandateId)));
 });}
 /** Reconcile only exact provider identities; never manufacture a human
  * choice, rewrite old receipts, move historical records or grant outreach. */
 async reconcileDuplicates(mandateId:string):Promise<{resolved:number}>{
  const result=await this.transaction(true,async c=>{
   await ownedMandate(c,this.actor,mandateId,true);
   const rows=(await c.query("SELECT id FROM company_identity_reviews WHERE organization_id=$1 AND mandate_id=$2 AND state='pending' ORDER BY created_at,id LIMIT 51",[this.actor.organizationId,mandateId])).rows;
   if(rows.length>50)throw new CompanyIdentityReviewError('There are too many pending identity reviews. Narrow the research batch.');
   let resolved=0;
   for(const row of rows){
    const {review:current,automaticTargetId:targetId}=await previewContext(c,this.actor,row.id,mandateId,true);
    if(!targetId)continue;
    const requestKey=randomUUID(),receipt:CompanyIdentityDecisionReceipt={reviewId:current.reviewId,status:'adopted',targetId};
    const recordedPreview={...current,automaticResolution:'exact_firmable_id_v1'};
    await claim(c,this.actor,current.source,targetId,current.source.observationId);await attach(c,this.actor,mandateId,targetId);
    await c.query('INSERT INTO company_identity_decisions(request_key,review_id,organization_id,mandate_id,decided_by,input_digest,preview,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[requestKey,current.reviewId,this.actor.organizationId,mandateId,this.actor.userId,companyIdentityDigest({policy:'exact_firmable_id_v1',reviewId:current.reviewId,targetId,previewDigest:current.previewDigest}),recordedPreview,receipt]);
    await c.query("UPDATE company_identity_reviews SET state='adopted',revision=revision+1 WHERE id=$1 AND state='pending'",[current.reviewId]);
    await publishCompanyMembershipProjection(c,this.actor,{mandateId,targetId});
    await wakeAfterCompanyIdentityDecision(c,this.actor,{mandateId,requestKey,reviewId:current.reviewId});resolved++;
   }
   return{resolved};
  });
  console.info('research-pipeline',JSON.stringify({module:'company.identity',event:'exact_firmable_duplicates_reconciled',timestamp:new Date().toISOString(),mandateId,resolved:result.resolved}));
  return result;
 }
 async decide(mandateId:string,rawCommand:unknown):Promise<CompanyIdentityDecisionReceipt>{
 const command=companyIdentityDecisionSchema.parse(rawCommand),inputDigest=companyIdentityDigest(command);
 return this.transaction(true,async c=>{
 await ownedMandate(c,this.actor,mandateId,true);
 const prior=(await c.query('SELECT * FROM company_identity_decisions WHERE request_key=$1',[command.requestKey])).rows[0];
 if(prior){if(prior.organization_id!==this.actor.organizationId||prior.mandate_id!==mandateId||prior.decided_by!==this.actor.userId||prior.input_digest!==inputDigest)throw new CompanyIdentityReviewError('The decision request conflicts with its saved receipt.');await wakeAfterCompanyIdentityDecision(c,this.actor,{mandateId,requestKey:command.requestKey,reviewId:command.reviewId});return prior.receipt as CompanyIdentityDecisionReceipt;}
 const current=await preview(c,this.actor,command.reviewId,mandateId,true);
 if(current.revision!==command.expectedRevision||current.previewDigest!==command.previewDigest)throw new CompanyIdentityReviewError('The company identity changed. Review the current candidates.');
 let receipt:CompanyIdentityDecisionReceipt={reviewId:command.reviewId,status:'skipped'};
 if(command.decision==='adopt'){
 if(!canAdoptCompanyIdentityReview(current.reason)||!current.candidates.some(t=>t.targetId===command.selectedTargetId))throw new CompanyIdentityReviewError('This identity cannot be adopted. Review the source evidence.');
 await claim(c,this.actor,current.source,command.selectedTargetId,current.source.observationId);await attach(c,this.actor,mandateId,command.selectedTargetId);
 receipt={reviewId:command.reviewId,status:'adopted',targetId:command.selectedTargetId};
 }
 await c.query('INSERT INTO company_identity_decisions(request_key,review_id,organization_id,mandate_id,decided_by,input_digest,preview,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[command.requestKey,command.reviewId,this.actor.organizationId,mandateId,this.actor.userId,inputDigest,current,receipt]);
 await c.query('UPDATE company_identity_reviews SET state=$2,revision=revision+1 WHERE id=$1 AND state=\'pending\'',[command.reviewId,receipt.status]);
 if(receipt.status==='adopted'){await publishCompanyMembershipProjection(c,this.actor,{mandateId,targetId:receipt.targetId});await wakeAfterCompanyIdentityDecision(c,this.actor,{mandateId,requestKey:command.requestKey,reviewId:command.reviewId});}
 return receipt;
 });
 }
}
