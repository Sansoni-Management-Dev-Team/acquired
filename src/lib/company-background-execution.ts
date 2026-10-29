import{completesWorkItems,COMPANY_FIELD_ATTEMPT_MS}from'@/domain/research-completion';
import{availableCompanyFields,companyFieldRelevant,companyMandateScope}from'@/domain/company-web-research-policy';
import{and,eq}from'drizzle-orm';
import{companyTargetScope}from'@/db/company-target-scope';
import {requireDb} from '@/db/client';
import {researchJobs,targets,mandates} from '@/db/schema';
import {targetRecordToRankedTarget} from '@/db/target-record-mapper';
import {companyResearchTarget} from '@/db/company-research-target';
import {terminalResearchStates,type ResearchConfig} from '@/domain/research';
import {resolvePublicCompanyAbn} from '@/adapters/abn-identity-resolver';
import {researchCompanyMissingFields} from '@/adapters/company-missing-field-research';
import {persistCompanyBackgroundResult,type CompanyBackgroundResearchResult} from './company-background-research';
type Job=typeof researchJobs.$inferSelect;
export type CompanyBackgroundExecutionContext={
 deadline?:number;
 assertCurrent?:()=>Promise<void>;
 researchFields:typeof researchCompanyMissingFields;
 resolveAbn:typeof resolvePublicCompanyAbn;
 beforePersist?:Parameters<typeof persistCompanyBackgroundResult>[2];
};
/** One shared execution service for normal workspace and reviewed agent tools.
 * Entry-point adapters supply authority/accounting, not a different extractor. */
export async function executeCompanyBackground(job:Job,failed=false,execution?:CompanyBackgroundExecutionContext){
 const config=job.config as ResearchConfig,spec=config.companyBackgroundResearch;
 if(!spec||!config.targetId)throw Error('Missing durable background configuration');
 if(terminalResearchStates.includes(job.status))return {accepted:false,status:job.status};
 const [row]=await requireDb().select().from(targets).where(companyTargetScope(job.organizationId,job.mandateId,config.targetId));
 if(!row)throw Error('Background company is unavailable');
 if(config.nativeAgent&&!execution)throw Error('Native public-field execution requires its reviewed execution context');
 await execution?.assertCurrent?.();
 const source=await companyResearchTarget(requireDb(),{organizationId:job.organizationId,mandateId:job.mandateId},row,config.companyIdentityPolicyVersion);
 const target=targetRecordToRankedTarget(source.target,[]),deadline=Math.min(execution?.deadline??(completesWorkItems(config)?Infinity:config.automaticDeadline)??Infinity,Date.now()+COMPANY_FIELD_ATTEMPT_MS);
 let scope=spec.mandateScope;
 if(scope===undefined){
  const [mandate]=await requireDb().select({filters:mandates.filters}).from(mandates).where(and(eq(mandates.id,job.mandateId),eq(mandates.organizationId,job.organizationId)));
  if(!mandate)throw Error('Background research mandate unavailable');
  scope=companyMandateScope(mandate.filters,config.researchScope);
 }
 const provided=availableCompanyFields(target,scope),remaining=spec.fields.filter(field=>!provided.has(field)&&(config.nativeAgent||companyFieldRelevant(field,scope||'')));
 let result:CompanyBackgroundResearchResult={...(completesWorkItems(config)?{resumeRevision:config.companyBackgroundCheckpoint?.revision||0}:{}),...(config.companyBackgroundAbnLookup?{abnLookup:config.companyBackgroundAbnLookup}:{}),facts:config.companyBackgroundCheckpoint?.facts||[],fields:Object.fromEntries(spec.fields.map(field=>[field,provided.has(field)?{status:'already_available',reason:'Already available in company data; web research skipped'}:!remaining.includes(field)?{status:'not_required',reason:'This supplemental field is not required by the saved mandate'}:{status:'research_incomplete',reason:'Background acquisition failed or exhausted its execution budget'}])),attempts:config.companyBackgroundCheckpoint?.attempts||[],registryContacts:config.companyBackgroundCheckpoint?.registryContacts||[]};
 if(!failed&&Date.now()<deadline){
  if(spec.verifyAbn&&!target.abn&&!result.abnLookup)try{result.abnLookup=await(execution?.resolveAbn??resolvePublicCompanyAbn)({name:target.companyName,website:`https://${target.domain}/`,deadline:Math.min(deadline,Date.now()+25000)});}catch{/* Independent field reads still run. */}
  if(remaining.length)try{const fields=await(execution?.researchFields??researchCompanyMissingFields)({name:target.companyName,website:`https://${target.domain}/`,missingFields:remaining,deadline,resumable:completesWorkItems(config),resume:config.companyBackgroundCheckpoint,jobId:job.id,raw:target.sourceData?.firmable?.rawResponse,mandateScope:scope});result={...fields,...(completesWorkItems(config)?{resumeRevision:config.companyBackgroundCheckpoint?.revision||0}:{}),fields:{...result.fields,...fields.fields},abnLookup:result.abnLookup};}catch{/* Persist explicit operationally incomplete outcomes. */}
 }
 return persistCompanyBackgroundResult({organizationId:job.organizationId,jobId:job.id,result},undefined,execution?.beforePersist);
}
