import {executeFirmablePeopleProfiles} from './firmable-refresh';
import {createHash} from 'node:crypto';
import {eq,and} from 'drizzle-orm';
import {requireDb} from '@/db/client';
import {researchJobs} from '@/db/schema';
import type {ResearchConfig} from '@/domain/research';
import {selectCompanyContacts} from '@/domain/company-contact-policy';
import {agentStore} from './agent-runtime';
import {createNativeFirmableTransport} from './agent-research-firmable';
import {assertNativeResearchPersistence} from './agent-research-context';
import {researchTraceContext} from './research-request-observability';
import {safeResearchFailure} from '@/domain/research-trace-context';
function childId(job:string,target:string){const h=createHash('sha256').update(`native-people:${job}:${target}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
export async function executeNativePeopleResearch(job:typeof researchJobs.$inferSelect,options?:{targetId:string}){
 const metadata=(job.config as ResearchConfig).nativeAgent;if(metadata?.providerAdmission!=='firmable-people-v1')throw new Error('Supported native people job required');
 const store=agentStore({organizationId:job.organizationId,userId:job.createdBy}),plan=await store.nativePeoplePlan(metadata.threadId,metadata.operationId),db=requireDb();let saved=0,failed=0;
 const selected=options?plan.selected.filter(c=>c.targetId===options.targetId):plan.selected;if(!selected.length)throw new Error('Company is outside the exact reviewed people plan');
 await db.transaction(async tx=>{await assertNativeResearchPersistence(tx,job);await tx.update(researchJobs).set({status:'extracting',message:'Enriching email contacts for the reviewed companies',updatedAt:new Date()}).where(and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,job.organizationId)));});
 for(const company of selected){
  const id=childId(job.id,company.targetId),previous=(await db.select().from(researchJobs).where(and(eq(researchJobs.id,id),eq(researchJobs.organizationId,job.organizationId))).limit(1))[0];
  if(previous){saved+=previous.status==='complete'?1:0;failed+=previous.status==='complete'?0:1;continue;}
  let contacts=0,partial=false;
  try{
   if(Date.now()>=(job.config as ResearchConfig).automaticDeadline!)throw new Error('Contact research deadline reached');
   const client=createNativeFirmableTransport({jobId:job.id,targetId:company.targetId,stepKey:'people:'+company.targetId}),fresh=(await db.select().from(researchJobs).where(eq(researchJobs.id,job.id)).limit(1))[0],cached=(fresh.config as Record<string,unknown>).nativePeopleCandidates as Record<string,string[]>|undefined;
   let ids=cached?.[company.targetId];
   if(!ids){const page=await client.searchPeoplePage(company.firmableId,{max:50});ids=selectCompanyContacts(page.records).slice(0,plan.maxContactsPerCompany).map(p=>p.id);await store.recordPeopleCandidates(metadata.threadId,metadata.operationId,company.targetId,ids);}
   const result=await executeFirmablePeopleProfiles({
    candidates:ids.map(id=>({id,emailAvailable:false,phoneAvailable:false})),includePhones:false,concurrency:'serial',
    recorded:async candidate=>{const previous=await store.peopleProfileOutcome(metadata.threadId,metadata.operationId,company.targetId,candidate.id);return previous?{kind:'saved',saved:Boolean(previous.contactId)}:undefined;},
    admissible:async candidate=>!await store.peopleIdentityNeedsReview(metadata.threadId,company.targetId,candidate.id),
    enrich:(identifier,options)=>client.enrichPerson(identifier,options),
    persist:async person=>Boolean(await store.savePeopleProfile(metadata.threadId,metadata.operationId,company.targetId,person)),
    failure:()=>{},
   });
   contacts=result.saved;partial=result.needsReview>0;
   if(!contacts)partial=true;
  }catch{partial=true;}
  await db.transaction(async tx=>{await assertNativeResearchPersistence(tx,job);await tx.insert(researchJobs).values({id,organizationId:job.organizationId,mandateId:job.mandateId,createdBy:job.createdBy,status:partial?'partial':'complete',config:{...job.config as ResearchConfig,parentJobId:job.id,targetId:company.targetId,purpose:'people',nativePeopleContactCount:contacts} as ResearchConfig,seeds:[],message:partial?'Email contact enrichment needs review':'Bounded email contact enrichment saved'}).onConflictDoNothing();});
  if(partial)failed++;else saved++;
 }
 if(options)return {savedCompanies:saved,failedCompanies:failed};
 return finishNativePeopleResearch(job);
}
export async function finishNativePeopleResearch(job:typeof researchJobs.$inferSelect){
 const metadata=(job.config as ResearchConfig).nativeAgent;if(metadata?.providerAdmission!=='firmable-people-v1')throw new Error('Supported native people job required');const store=agentStore({organizationId:job.organizationId,userId:job.createdBy}),plan=await store.nativePeoplePlan(metadata.threadId,metadata.operationId),db=requireDb();let failed=0,saved=0;
 for(const company of plan.selected){const existing=(await db.select().from(researchJobs).where(and(eq(researchJobs.id,childId(job.id,company.targetId)),eq(researchJobs.organizationId,job.organizationId))).limit(1))[0];if(existing?.status==='complete')saved++;else failed++;}
 await db.transaction(async tx=>{await assertNativeResearchPersistence(tx,job);await tx.update(researchJobs).set({status:failed?'partial':'complete',message:failed?'Contact enrichment completed with review required':'Contact enrichment complete; exact contact selection and email approval still required',updatedAt:new Date()}).where(and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,job.organizationId)));});
 const result=await store.finishNativeResearchJob(metadata.threadId,metadata.operationId);return {savedCompanies:saved,failedCompanies:failed,...result};
}

/** The initial V5 research review covers this bounded non-phone action. Company
 * persistence has already committed; unavailable People never discard it. Each
 * physical request still uses the original operation's current admission. */
export async function executeNativeAutomaticCompanyPeople(job:typeof researchJobs.$inferSelect,company:{targetId:string;firmableId:string}){
 const config=job.config as ResearchConfig,metadata=config.nativeAgent,policy=config.companyDiscoveryPolicy;
 if(!metadata||policy?.version!==5||config.includeCompanyPeople!==true||config.includePhones!==false||config.findPeople!==false)throw Error('Approved V5 automatic People scope required');
 const store=agentStore({organizationId:job.organizationId,userId:job.createdBy});
 try{
  if(Date.now()>=(config.automaticDeadline??0))return {status:'partial' as const,saved:0,needsReview:1};
  const current=await store.nativeAutomaticPeopleContext(metadata.threadId,metadata.operationId,company.targetId,company.firmableId);
  const client=createNativeFirmableTransport({jobId:job.id,targetId:company.targetId,stepKey:'automatic-people:'+company.targetId});
  let ids=current.candidates;
  if(!ids){const page=await client.searchPeoplePage(company.firmableId,{max:policy.automaticPeople.searchPageSize});ids=selectCompanyContacts(page.records).slice(0,current.maxContactsPerCompany).map(person=>person.id);await store.recordAutomaticPeopleCandidates(metadata.threadId,metadata.operationId,company.targetId,ids);}
  const result=await executeFirmablePeopleProfiles({candidates:ids.map(id=>({id,emailAvailable:false,phoneAvailable:false})),includePhones:false,concurrency:'serial',
   recorded:async candidate=>{const outcome=current.outcomes?.[candidate.id];return outcome?{kind:'saved' as const,saved:Boolean(outcome.contactId)}:undefined;},
   admissible:async candidate=>!await store.peopleIdentityNeedsReview(metadata.threadId,company.targetId,candidate.id),
   enrich:(identifier,options)=>client.enrichPerson(identifier,options),
   persist:async person=>Boolean(await store.saveAutomaticPeopleProfile(metadata.threadId,metadata.operationId,company.targetId,person)),failure:()=>{},
  });
  return {status:result.needsReview?'partial' as const:'complete' as const,saved:result.saved,needsReview:result.needsReview};
 }catch(error){console.info('research-pipeline',JSON.stringify({module:'people.automatic',event:'people_automatic_incomplete',timestamp:new Date().toISOString(),...researchTraceContext(),...safeResearchFailure(error)}));return {status:'partial' as const,saved:0,needsReview:1};}
}
