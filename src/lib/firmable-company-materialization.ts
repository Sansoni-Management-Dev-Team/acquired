import {and,eq} from 'drizzle-orm';
import {requireDb} from '@/db/client';
import {firmableCompanies,researchFindings,researchJobs} from '@/db/schema';
import {companyIdentityDrizzleClient,getRecordedCompanyPersistence,persistResearchedCompany,type CompanyIdentityPersistenceResult} from '@/db/company-identity-store';
import {publishCompanyMembershipProjection} from '@/db/company-membership-projection-store';
import {mapFirmableProfile} from '@/adapters/firmable-company-mapper';
import {normalizeFirmableProfile,originalRevenueRange} from '@/domain/firmable-company-pipeline';
import {FirmableError} from '@/adapters/firmable-client';
import {screenCompanyCandidate} from '@/domain/company-screening';
import {rankTarget} from '@/domain/scoring';
import type {Mandate} from '@/domain/models';
import type {ResearchConfig} from '@/domain/research';
import {assertNativeResearchPersistence} from './agent-research-context';
import {queueCompanyBackgroundResearch} from './company-background-research';

type Job=typeof researchJobs.$inferSelect;
type Database=ReturnType<typeof requireDb>;
type Source={raw:Record<string,unknown>;matched:boolean;matchStatus:string};
type Materialization={companyIdentityObservationId:string;firmableMatch:string;firmableProfile:ReturnType<typeof normalizeFirmableProfile>|null;companyDomain:string;screening:ReturnType<typeof screenCompanyCandidate>;abnLookup:Record<string,unknown>;websiteResearch:unknown;sourceFirmographics:Record<string,unknown>;sourceIdentifiers:Record<string,unknown>};
/** Shared company identity service for new normal and native research roots.
 * Saved source decisions are read before provider I/O. Replays materialize the
 * original identity result; neither adoption nor retry copies personal data. */
export async function materializeFirmableCompany(input:{job:Job;childId:string;childConfig:ResearchConfig;existingConfig:ResearchConfig;mandate:Mandate;row:Record<string,unknown>;expectedDomain?:unknown;fetchProfile:()=>Promise<Source>}){
 const db=requireDb(),{job,childId}=input,actor={organizationId:job.organizationId,userId:job.createdBy};
 async function current(tx:Database){
  await assertNativeResearchPersistence(tx,job);
  const [root]=await tx.select({status:researchJobs.status}).from(researchJobs).where(and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,job.organizationId))).for('share');
  if(!root||root.status==='cancelled'||root.status==='failed')throw Error('Company research source was stopped');
 }
 async function finish(tx:Database,result:CompanyIdentityPersistenceResult,source:Materialization){
  if(source.companyIdentityObservationId!==result.observationId)throw Error('Saved company source does not match its original observation');
  let backgroundJobId:string|null=null;
  if(result.status==='persisted'){
   const abn=source.sourceIdentifiers.abn;
   if(typeof abn==='string'&&abn)await tx.insert(researchFindings).values({jobId:childId,organizationId:job.organizationId,mandateId:job.mandateId,targetId:result.targetId,evidenceKey:'firmable-abn',sourceUrl:typeof(source.sourceIdentifiers.abnSource as {sourceUrl?:string}|undefined)?.sourceUrl==='string'?(source.sourceIdentifiers.abnSource as {sourceUrl:string}).sourceUrl:`https://abr.business.gov.au/ABN/View?abn=${abn}`,observedAt:new Date(source.firmableProfile?.retrievedAt??job.createdAt),confidence:.7,evidence:{kind:'identifier',name:'ABN',value:abn,quote:`Firmable company profile reports ABN ${abn}`,relevance:'unclear'}}).onConflictDoNothing();
   await publishCompanyMembershipProjection(companyIdentityDrizzleClient(tx),actor,{mandateId:job.mandateId,targetId:result.targetId});
   if(!(job.config as ResearchConfig).nativeAgent){
    const raw=source.firmableProfile?.rawResponse;
    if(raw){const target=mapFirmableProfile(raw,input.mandate,job.organizationId);backgroundJobId=(await queueCompanyBackgroundResearch(job,{...target,id:result.targetId,sourceData:{...target.sourceData,abnVerification:source.abnLookup as unknown as NonNullable<typeof target.sourceData>['abnVerification']}},tx)).jobId;}
   }
  }
  const saved=result.status==='persisted',partial=!saved||(!source.firmableProfile&&['failed','partial'].includes(String((source.websiteResearch as {status?:string}|undefined)?.status)));
  const config={...input.childConfig,...source,...(saved?{targetId:result.targetId}:{}),companyIdentity:{status:result.status,observationId:result.observationId,...('reviewId'in result?{reviewId:result.reviewId}:{})},newBusinessIds:saved&&['headcount','revenue','geography','sector'].every(key=>source.screening[key as 'headcount']==='supported')?[result.targetId]:[]};
  await tx.update(researchJobs).set({status:partial?'partial':'complete',pages:1,updatedAt:new Date(),message:result.status==='review_required'?'Company source saved; review the existing company identity before adoption':result.status==='skipped'?'Company identity skipped by human review':'Company source saved to its canonical mandate membership',config}).where(and(eq(researchJobs.id,childId),eq(researchJobs.organizationId,job.organizationId)));
  return{ok:true,saved,matched:source.firmableMatch==='matched',...(saved?{targetId:result.targetId,backgroundJobId}:{reviewId:result.reviewId}),...(result.status==='review_required'?{identityReviewRequired:true}:{}),...(result.status==='skipped'?{skipped:true}:{}),firmableId:source.firmableProfile?.firmableId};
 }
 const prior=await db.transaction(async tx=>{await current(tx);const original=await getRecordedCompanyPersistence(companyIdentityDrizzleClient(tx),actor,{jobId:childId,requestKey:childId});if(!original)return null;return finish(tx,original,input.existingConfig as ResearchConfig&Materialization);});
 if(prior)return prior;
 const incomplete=(input.existingConfig as ResearchConfig&{identityIncomplete?:{firmableId:string}}).identityIncomplete;
 if([4,5].includes((job.config as ResearchConfig).companyDiscoveryPolicy?.version??0)){
  const failure=(input.existingConfig as ResearchConfig&{companyProfileFailure?:{firmableId:string;httpStatus:number}}).companyProfileFailure;
  if(incomplete&&incomplete.firmableId===input.row.id)return {ok:false,saved:false,firmableId:incomplete.firmableId};
  if(failure?.firmableId===input.row.id&&failure?.httpStatus===404)return {ok:false,saved:false,firmableId:failure.firmableId};
 }
 let fetched:Source;
 try{fetched=await input.fetchProfile();}
 catch(error){
  // A known provider failure produced no company evidence. Record it under the
  // same current-source fence before propagating it to the shared executor.
  // Never downgrade an already materialized/cancelled child on a late failure.
  if(error instanceof FirmableError){
   if(error.status===404&&[4,5].includes((job.config as ResearchConfig).companyDiscoveryPolicy?.version??0)&&/^f[0-9]+$/.test(String(input.row.id))){
    await db.transaction(async tx=>{await current(tx);await tx.update(researchJobs).set({status:'partial',updatedAt:new Date(),message:'Discovered Firmable company profile was not found; discovery evidence retained',config:{...input.childConfig,companyProfileFailure:{firmableId:String(input.row.id),httpStatus:404}}}).where(and(eq(researchJobs.id,childId),eq(researchJobs.organizationId,job.organizationId)));});
    return {ok:false,saved:false,firmableId:String(input.row.id)};
   }
   await db.transaction(async tx=>{
    await current(tx);
    await tx.update(researchJobs).set({status:'failed',updatedAt:new Date(),message:error.status===429?'Firmable rate limit (HTTP 429); no company profile was saved.':`Firmable company profile request failed (HTTP ${error.status}); no company profile was saved.`}).where(and(eq(researchJobs.id,childId),eq(researchJobs.organizationId,job.organizationId),eq(researchJobs.status,'extracting')));
   });
  }
  throw error;
 }
 const {raw,matched,matchStatus}=fetched,profile=normalizeFirmableProfile(raw);
 if(!profile.companyName)throw Error('Profile has no company identity');
 if(!profile.domain){
  if(![4,5].includes((job.config as ResearchConfig).companyDiscoveryPolicy?.version??0)||!matched||!/^f[0-9]+$/.test(profile.firmableId)||profile.firmableId!==input.row.id)throw Error('Profile has no company identity');
  await db.transaction(async tx=>{await current(tx);await tx.update(researchJobs).set({status:'partial',pages:1,updatedAt:new Date(),message:'Company profile retained; public website identity requires review',config:{...input.childConfig,identityIncomplete:{reason:'public_domain_missing',firmableId:profile.firmableId,sourceUrl:`https://app.firmable.com/dashboard/company/${profile.firmableId}`,observedAt:profile.retrievedAt,profile:raw}}}).where(and(eq(researchJobs.id,childId),eq(researchJobs.organizationId,job.organizationId)));});
  return {ok:false,saved:false,firmableId:profile.firmableId};
 }
 if(matched&&/^f[0-9]+$/.test(String(input.row.id))&&profile.firmableId!==input.row.id)throw Error('Company profile differs from the requested Firmable identity');
 if(input.expectedDomain!==undefined&&profile.domain!==input.expectedDomain)throw Error('Hybrid company profile domain mismatch');
 const candidate=mapFirmableProfile(raw,input.mandate,job.organizationId),ranked=rankTarget(candidate,input.mandate),brief=(input.mandate as Mandate&{brief?:{criteria?:{key:string;value?:string}[]}}).brief;
 const screening=screenCompanyCandidate(candidate,{...input.mandate,revenue:originalRevenueRange(brief?.criteria,input.mandate.revenue)||input.mandate.revenue});
 const abn=matched?profile.abn:null,abnSource=abn?{source:'Firmable',sourceUrl:`https://app.firmable.com/dashboard/company/${profile.firmableId}`,capturedAt:profile.retrievedAt}:undefined;
 const abnLookup={status:abn?'provider_reported':'pending',operationalStatus:'complete',missingReason:null,errors:[]};
 const sourceIdentifiers={...(matched?{firmableId:profile.firmableId}:{}),...(abn?{abn,abnSource}:{})};
 const sourceFirmographics={abnVerification:abnLookup,suburb:ranked.suburb,state:ranked.state,sector:ranked.sector,revenue:ranked.revenue,ebitda:ranked.ebitda,headcount:ranked.headcount,headcountBand:candidate.headcountBand,establishedYear:ranked.establishedYear,...(matched?{firmable:{...ranked.sourceData?.firmable,rawResponse:raw}}:{webDiscovery:input.row,firmableMatch:matchStatus,websiteResearch:raw.websiteResearch,websiteProfile:ranked.sourceData?.firmable})};
 return db.transaction(async tx=>{
  await current(tx);
  if(matched)await tx.insert(firmableCompanies).values({id:profile.firmableId,name:profile.companyName,domain:profile.domain,abn}).onConflictDoNothing();
  const result=await persistResearchedCompany(companyIdentityDrizzleClient(tx),actor,{requestKey:childId,jobId:childId,companyName:profile.companyName,domain:profile.domain,...(matched?{firmableId:profile.firmableId}:{}),...(abn?{abn}:{}),observedAt:profile.retrievedAt,sourceUrl:matched?`https://app.firmable.com/dashboard/company/${profile.firmableId}`:`https://${profile.domain}/`,sourceFacts:{firmographics:sourceFirmographics,identifiers:sourceIdentifiers,...(matched?{firmableCompanyId:profile.firmableId}:{})}});
  return finish(tx,result,{companyIdentityObservationId:result.observationId,firmableMatch:matchStatus,firmableProfile:matched?profile:null,companyDomain:profile.domain,screening,abnLookup,websiteResearch:raw.websiteResearch,sourceFirmographics,sourceIdentifiers});
 });
}
