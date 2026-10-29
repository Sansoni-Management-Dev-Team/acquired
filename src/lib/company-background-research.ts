import {completesWorkItems} from '@/domain/research-completion';
import {planCompanyWebFields,companyMandateScope} from '@/domain/company-web-research-policy';
import {lockResearchPersistence} from './research-persistence-lock';
import{companyTargetScope}from'@/db/company-target-scope';
import { createHash } from 'node:crypto';
import { and,eq } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs,targets,researchFindings,contacts,mandates } from '@/db/schema';
import { researchContactId } from '@/db/research-persistence-id';
import {companyResearchTarget} from '@/db/company-research-target';
import {companyIdentityDrizzleClient,persistResearchedCompany} from '@/db/company-identity-store';
import {publishCompanyMembershipProjection} from '@/db/company-membership-projection-store';
import { backgroundAccreditations } from '@/domain/company-background-projection';
import { saveAccreditationContact } from '@/db/accreditation-contacts';
import { normalizeFirmableProfile } from '@/domain/firmable-company-pipeline';
import { publicResearchUrl,terminalResearchStates,type ResearchConfig,type ResearchFinding } from '@/domain/research';
import type { TargetCandidate } from '@/domain/models';
import type { resolvePublicCompanyAbn } from '@/adapters/abn-identity-resolver';
import type { CompanyMissingField,CompanyMissingFieldFact,CompanyMissingFieldResearchResult } from '@/adapters/company-missing-field-research';

type Database=ReturnType<typeof requireDb>;
type Job=typeof researchJobs.$inferSelect;
export type CompanyBackgroundResearchConfig={version:1;fields:CompanyMissingField[];sourceRootId:string;profileCapturedAt:string;verifyAbn:boolean;mandateScope?:string};
export type CompanyBackgroundConfig=CompanyBackgroundResearchConfig;
export type CompanyBackgroundResearchResult=CompanyMissingFieldResearchResult & {abnLookup?:Awaited<ReturnType<typeof resolvePublicCompanyAbn>>};
export const COMPANY_BACKGROUND_BUDGET={maxPages:8,maxSearchQueries:4,maxDurationMs:120_000} as const;
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const known=(value:unknown)=>value!==null&&value!==undefined&&value!==''&&(!Array.isArray(value)||value.length>0)&&!(typeof value==='string'&&/^(unknown|unclassified|no data available|n\/a)$/i.test(value.trim()));
export function companyBackgroundJobId(rootId:string,targetId:string){const h=createHash('sha256').update(`${rootId}:company-background-v1:${targetId}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
/** Company fields only: published corporate channels do not imply an employee email or a decision maker. */
export function planCompanyMissingFields(target:TargetCandidate,scope=''):CompanyMissingField[]{return planCompanyWebFields(target,scope);}
export function planCompanyBackgroundScope(target:TargetCandidate,scope=''){
 const reportedAbn=target.sourceData?.firmable?.firmableId&&target.sourceData.firmable.rawResponse?normalizeFirmableProfile(target.sourceData.firmable.rawResponse).abn:null;
 return{fields:planCompanyMissingFields(target,scope),verifyAbn:!reportedAbn&&target.sourceData?.abnVerification?.status!=='matched'};
}
export async function queueCompanyBackgroundResearch(parent:Job,target:TargetCandidate,database?:Database):Promise<{jobId:string|null;fields:CompanyMissingField[];created:boolean}>{
 if(!database)return requireDb().transaction(db=>queueCompanyBackgroundResearch(parent,target,db));
 const db=database || requireDb();
 const [mandate]=await db.select({filters:mandates.filters}).from(mandates).where(and(eq(mandates.id,parent.mandateId),eq(mandates.organizationId,parent.organizationId)));
 if(!mandate)throw Error('Background research mandate unavailable');
 const mandateScope=companyMandateScope(mandate.filters,(parent.config as ResearchConfig).researchScope);
 const {fields,verifyAbn}=planCompanyBackgroundScope(target,mandateScope);
 const website=publicResearchUrl(`https://${target.domain}/`);if(!website||(!fields.length&&!verifyAbn))return{jobId:null,fields,created:false};
 await lockResearchPersistence(db,parent.organizationId);
 const [root]=await db.select().from(researchJobs).where(and(eq(researchJobs.id,parent.id),eq(researchJobs.organizationId,parent.organizationId))).for('share').limit(1);
 if(!root||root.status==='cancelled')return{jobId:null,fields,created:false};
 const [savedTarget]=await db.select().from(targets).where(companyTargetScope(parent.organizationId,parent.mandateId,target.id)).for('update').limit(1);
 if(!savedTarget)throw Error('Background research requires a persisted company in this mandate');
 const jobId=companyBackgroundJobId(parent.id,target.id),source=parent.config as ResearchConfig;
 const companyBackgroundResearch:CompanyBackgroundResearchConfig={version:1,fields,sourceRootId:parent.id,verifyAbn,mandateScope,profileCapturedAt:target.sourceData?.firmable?.capturedAt || target.headcount.provenance.capturedAt};
 const config:ResearchConfig & {companyBackgroundResearch:CompanyBackgroundResearchConfig}={...(source.completionPolicy?{completionPolicy:source.completionPolicy}:{}),...(source.companyIdentityPolicyVersion===1?{companyIdentityPolicyVersion:1}:{}),workflow:'business',mode:'automatic',approved:true,geography:source.geography,searchTerms:source.searchTerms,researchScope:source.researchScope,findPeople:false,discover:false,strategy:'investigate',seeds:[website],researchTask:'field',purpose:'firmographics',parentJobId:parent.id,researchRunId:parent.id,targetId:target.id,companyName:target.companyName,companyDomain:target.domain,parallelBusinessResearch:false,automaticDeadline:completesWorkItems(source)?undefined:Date.now()+COMPANY_BACKGROUND_BUDGET.maxDurationMs,executionSlot:`company-background:${jobId}`,budget:{maxPages:8,maxDomains:8,maxModelCalls:0,maxMinutes:2},companyBackgroundResearch};
 const inserted=await db.insert(researchJobs).values({id:jobId,organizationId:parent.organizationId,mandateId:parent.mandateId,createdBy:parent.createdBy,config,seeds:[website],status:'queued',message:'Company saved; missing public fields queued independently'}).onConflictDoNothing().returning({id:researchJobs.id});
 if(inserted.length&&source.companyIdentityPolicyVersion!==1){const firmographics=object(savedTarget.firmographics),previous=object(firmographics.backgroundResearch);const previousFields=object(previous.fields) as Partial<Record<CompanyMissingField,BackgroundFieldState>>;const queuedFields=Object.fromEntries(fields.map(field=>{const observations=previousFields[field]?.observations || [];return[field,{status:observations.length?'reported':'queued',observations} as BackgroundFieldState];}));await db.update(targets).set({firmographics:{...firmographics,backgroundResearch:{version:1,jobId,fields:{...object(previous.fields),...queuedFields},updatedAt:new Date().toISOString(),attempts:[],registryContactsSaved:typeof previous.registryContactsSaved==='number'?previous.registryContactsSaved:0}},updatedAt:new Date()}).where(companyTargetScope(parent.organizationId,parent.mandateId,target.id));}
 return{jobId,fields,created:inserted.length>0};
}

export type BackgroundFieldState={status:'queued'|'reported'|'unavailable'|'failed'|'already_available'|'not_required';observations:CompanyMissingFieldFact[];missingReason?:string};
export type CompanyBackgroundState={version:1;jobId:string;fields:Partial<Record<CompanyMissingField,BackgroundFieldState>>;updatedAt:string;attempts:CompanyMissingFieldResearchResult['attempts'];registryContactsSaved:number;relatedDomains?:CompanyMissingFieldResearchResult['relatedDomains']};
function fieldEvidence(fact:CompanyMissingFieldFact,website:string):ResearchFinding & {companyFieldObservation:CompanyMissingFieldFact}{
 const kinds:Record<CompanyMissingField,ResearchFinding['kind']>={description:'capability',company_emails:'company_contact',company_phones:'company_contact',year_founded:'founded_year',acn:'identifier',website_address:'location',employee_count:'headcount',revenue:'revenue',accreditation_contacts:'company_contact',team_members:'person',accreditations:'accreditation'};
 const value=typeof fact.value==='string'?fact.value:typeof fact.value==='number'?String(fact.value):JSON.stringify(fact.value);
 return{kind:kinds[fact.field],name:fact.field==='acn'?'ACN':fact.field.replaceAll('_',' '),value:value.slice(0,500),quote:fact.quote.slice(0,800),website,relevance:'unclear',factMetadata:{sourceKind:fact.field==='accreditation_contacts'?'third_party_directory':'company_website',basis:'reported',scope:fact.scope==='group'?'group':'unspecified',currency:fact.currency || null,period:fact.period || null,identityNote:null},companyFieldObservation:fact};
}
/** Append evidence without editing the paid provider payload or inventing personal contacts. */
export function mergeCompanyBackgroundEvidence(firmographics:Record<string,unknown>,jobId:string,fields:CompanyMissingField[],result:CompanyMissingFieldResearchResult,now=new Date().toISOString()):Record<string,unknown> & {backgroundResearch:CompanyBackgroundState}{
 const previous=object(firmographics.backgroundResearch);
 const fieldStates={...object(previous.fields)} as Partial<Record<CompanyMissingField,BackgroundFieldState>>;
 for(const field of fields){
  const retained=fieldStates[field]?.observations || [];
  const fresh=result.facts.filter(f=>f.field===field && publicResearchUrl(f.sourceUrl) && f.quote.trim() && Number.isFinite(Date.parse(f.capturedAt)) && known(f.value));
  const observations=[...new Map([...fresh,...retained].map(f=>[JSON.stringify([f.field,f.sourceUrl,f.value,f.capturedAt]),f])).values()];
  const state=result.fields[field];
  fieldStates[field]={status:observations.length?'reported':state?.status==='already_available'||state?.status==='not_required'?state.status:state?.status==='research_incomplete'?'failed':'unavailable',observations,missingReason:observations.length?undefined:state?.reason || (state?.status==='research_incomplete'?'Public research could not read sufficient evidence':'Public sources did not disclose this field')};
 }
 const relatedDomains=[...(result.relatedDomains||[]),...(Array.isArray(previous.relatedDomains)?previous.relatedDomains:[])].filter(a=>a&&publicResearchUrl(a.sourceUrl)&&a.quote?.trim()&&Number.isFinite(Date.parse(a.capturedAt)));
 const backgroundResearch:CompanyBackgroundState={version:1,jobId,fields:fieldStates,updatedAt:now,attempts:result.attempts,registryContactsSaved:result.registryContacts.length,relatedDomains:[...new Map(relatedDomains.map(a=>[JSON.stringify([a.domain,a.sourceUrl,a.basis]),a])).values()]};
 return{...firmographics,backgroundResearch};
}
export async function persistCompanyBackgroundResult(input:{organizationId:string;jobId:string;result:CompanyBackgroundResearchResult},database?:Database,beforePersist?:(db:Database,job:Job)=>Promise<void>){
 const execute=async(db:Database)=>{
  await lockResearchPersistence(db,input.organizationId);
  const [job]=await db.select().from(researchJobs).where(and(eq(researchJobs.id,input.jobId),eq(researchJobs.organizationId,input.organizationId))).for('update');
  const config=job?.config as (ResearchConfig & {companyBackgroundResearch?:CompanyBackgroundResearchConfig})|undefined;
  const spec=config?.companyBackgroundResearch;
  if(!job||!spec||!config?.targetId)return{accepted:false,status:'missing',written:0,registryContacts:0};
  if(terminalResearchStates.includes(job.status))return{accepted:false,status:job.status,written:0,registryContacts:0};
  const [root]=await db.select({status:researchJobs.status}).from(researchJobs).where(and(eq(researchJobs.id,spec.sourceRootId),eq(researchJobs.organizationId,input.organizationId))).for('share');
  if(!root || root.status==='cancelled'){
   await db.update(researchJobs).set({status:'cancelled',message:'Parent company research cancelled; late background result rejected',updatedAt:new Date()}).where(eq(researchJobs.id,job.id));
   return{accepted:false,status:'cancelled',written:0,registryContacts:0};
  }
  const [target]=await db.select().from(targets).where(companyTargetScope(input.organizationId,job.mandateId,config.targetId)).for('update');
  if(!target)throw Error('Background result target is outside this organization or mandate');
  if(config.nativeAgent&&!beforePersist)throw Error('Native public-field persistence requires its reviewed execution context');
  await beforePersist?.(db,job);
  if(completesWorkItems(config)&&(config.companyBackgroundCheckpoint?.revision||0)!==(input.result.resumeRevision||0))return{accepted:false,deferred:true,retryAfterMs:1000,status:job.status,written:0,registryContacts:0};
  if(completesWorkItems(config)&&input.result.continuation){
   await db.update(researchJobs).set({status:'extracting',updatedAt:new Date(),message:'Company research checkpoint saved; remaining fields continue',config:{...config,companyBackgroundCheckpoint:input.result.continuation,companyBackgroundAbnLookup:input.result.abnLookup,companyBackgroundResult:{fields:Object.fromEntries(Object.entries(input.result.fields).map(([field,value])=>[field,{...value,status:value?.status==='research_incomplete'?'queued':value?.status}])),attempts:input.result.attempts,written:0,registryContacts:0}}}).where(eq(researchJobs.id,job.id));
   return{accepted:true,deferred:true,retryAfterMs:input.result.retryAfterMs||1000,status:'extracting',written:0,registryContacts:0};
  }
  const source=await companyResearchTarget(db,{organizationId:input.organizationId,mandateId:job.mandateId},target,config.companyIdentityPolicyVersion);
  let merged=mergeCompanyBackgroundEvidence(object(source.target.firmographics),job.id,spec.fields,input.result);
  const background=merged.backgroundResearch as CompanyBackgroundState,website=`https://${target.domain}/`;
  const pendingFindings:(typeof researchFindings.$inferInsert)[]=[];const receivedFacts=new Set(input.result.facts.map(f=>JSON.stringify(f)));
  for(const [field,state] of Object.entries(background.fields))for(const fact of state!.observations){
   if(!spec.fields.includes(field as CompanyMissingField) || !receivedFacts.has(JSON.stringify(fact)))continue;
   const key=createHash('sha256').update(JSON.stringify([field,fact.sourceUrl,fact.value])).digest('hex');
   pendingFindings.push({jobId:job.id,organizationId:input.organizationId,mandateId:job.mandateId,targetId:target.id,evidenceKey:`company-background:${key}`,sourceUrl:fact.sourceUrl,observedAt:new Date(fact.capturedAt),confidence:.7,evidence:fieldEvidence(fact,website)});
  }
  const lookup=input.result.abnLookup,existingVerification=object(merged.abnVerification);
  const identifiers={...object(source.target.identifiers)};
  if(spec.verifyAbn && lookup && existingVerification.status!=='matched' && object(identifiers.abnSource).source!=='Firmable' && !(identifiers.abn && Object.keys(object(identifiers.identityEvidence)).length)){
   merged={...merged,abnVerification:{status:lookup.status,operationalStatus:lookup.operationalStatus,missingReason:lookup.missingReason,errors:lookup.errors}};
   if(lookup.status==='matched' && lookup.abn && lookup.record){
    identifiers.abn=lookup.abn;
    pendingFindings.push({jobId:job.id,organizationId:input.organizationId,mandateId:job.mandateId,targetId:target.id,evidenceKey:'company-background:verified-abn',sourceUrl:`https://abr.business.gov.au/ABN/View?abn=${lookup.abn}`,observedAt:new Date(),confidence:.9,evidence:{kind:'identifier',name:'ABN',value:lookup.abn,quote:lookup.record.quote || lookup.record.entityName || 'Verified registry identity',relevance:'unclear'}});
   }
  }
  // Resolve company identity before attaching ANY new evidence or people to
  // the canonical target. Workflow counts are recorded on the job after writes,
  // not pre-claimed by an immutable company-fact observation.
  if(!known(merged.accreditations) && spec.fields.includes('accreditations'))merged.accreditations=backgroundAccreditations(background.fields.accreditations?.observations||[]);
  let identityReviewId:string|undefined;
  if(source.observation){
   const firmableId=source.observation.sourceFacts.firmableCompanyId,abn=typeof identifiers.abn==='string'?identifiers.abn:undefined;
   const sourceBackground={...background};delete(sourceBackground as Partial<CompanyBackgroundState>).registryContactsSaved;
   const sourceFacts={firmographics:{...merged,backgroundResearch:sourceBackground},identifiers,...(firmableId?{firmableCompanyId:firmableId}:{})};
   const identity=await persistResearchedCompany(companyIdentityDrizzleClient(db),{organizationId:input.organizationId,userId:job.createdBy},{requestKey:job.id,jobId:job.id,companyName:target.companyName,domain:target.domain!,...(firmableId?{firmableId}:{}),...(abn?{abn}:{}),observedAt:new Date().toISOString(),sourceUrl:website,sourceFacts});
   if(identity.status==='persisted'){
    if(identity.targetId!==target.id)throw Error('Public company evidence resolved to a different canonical identity');
   }else identityReviewId=identity.reviewId;
  }
  let written=0;const contactIds=new Set<string>();
  if(!identityReviewId){
   for(const finding of pendingFindings){const inserted=await db.insert(researchFindings).values(finding).onConflictDoNothing().returning({id:researchFindings.id});written+=inserted.length;}
  if(spec.fields.includes('accreditation_contacts'))for(const contact of input.result.registryContacts){
   if(contact.role!=='Accreditation contact' || contact.registry!=='NATA' || !/^https:\/\/(?:www\.)?nata\.com\.au\/accredited-organisation\//i.test(contact.sourceUrl))continue;
   contactIds.add(await saveAccreditationContact(db,input.organizationId,target.id,contact));
  }
  (merged.backgroundResearch as CompanyBackgroundState).registryContactsSaved=contactIds.size;
  if(spec.fields.includes('team_members'))for(const member of input.result.teamMembers||[]){
   const backed=background.fields.team_members?.observations.some(f=>JSON.stringify(f.value)===JSON.stringify(member));
   if(!backed || member.employmentStatus!=='published_team_member' || !member.name.trim())continue;
   const id=researchContactId(input.organizationId,target.id,`published-team:${member.name}`);
   await db.insert(contacts).values({id,organizationId:input.organizationId,targetId:target.id,displayName:member.name,role:member.role,fictionalised:false,personalData:{...(member.email?{email:member.email,emailSaved:true,emailLookupStatus:'reported'}:{}),...(member.phone?{phone:member.phone,phoneSaved:true,phoneLookupStatus:'reported'}:{}),doNotContact:false,contactType:'published_team_member'},provenance:{source:'Company website published team',sourceUrl:member.sourceUrl,capturedAt:member.capturedAt,quote:member.quote,reader:member.reader,employmentStatus:member.employmentStatus,roleStatus:member.role?'published':'not_disclosed'}}).onConflictDoNothing({target:contacts.id});
  }
   if(source.observation)await publishCompanyMembershipProjection(companyIdentityDrizzleClient(db),{organizationId:input.organizationId,userId:job.createdBy},{mandateId:job.mandateId,targetId:target.id});
   else await db.update(targets).set({firmographics:merged,identifiers,updatedAt:new Date()}).where(and(eq(targets.id,target.id),eq(targets.organizationId,input.organizationId)));
  }
  const failures=Object.values(background.fields).filter(state=>state?.status==='failed').length + Number(Boolean(spec.verifyAbn && lookup && lookup.operationalStatus!=='complete'));
  const evidenceAvailable=written>0 || contactIds.size>0 || input.result.attempts.some(a=>a.status==='succeeded');
  const status=identityReviewId||input.result.budgetExhausted?'partial':failures?evidenceAvailable?'partial':'failed':'complete';
  await db.update(researchJobs).set({status,updatedAt:new Date(),pages:input.result.attempts.filter(a=>a.kind==='page'||a.kind==='document').length,message:identityReviewId?'Public evidence retained; review the conflicting company identity':input.result.budgetExhausted?'Company research reached its retrieval budget; unfinished work retained':failures?'Background public fields researched with operational gaps':input.result.attempts.length?'Background public field research settled; undisclosed fields remain unavailable':'Company data checked; no additional public field research required',config:{...config,companyBackgroundCheckpoint:input.result.checkpoint,companyBackgroundAbnLookup:input.result.checkpoint?input.result.abnLookup:undefined,...(identityReviewId?{companyIdentityReviewId:identityReviewId}:{}),companyBackgroundResult:{retrievalUsage:input.result.usage,...(input.result.budgetExhausted?{waitingReason:'retrieval_budget'}:{}),fields:background.fields,written,registryContacts:contactIds.size,attempts:input.result.attempts,abnStatus:lookup?.status}}}).where(eq(researchJobs.id,job.id));
  return{accepted:true,status,written,registryContacts:contactIds.size};
 };
 return database?execute(database):requireDb().transaction(execute);
}
