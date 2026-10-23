import{companyTargetScope}from'@/db/company-target-scope';
import {requireDb} from '@/db/client';
import {researchJobs,targets} from '@/db/schema';
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
 const target=targetRecordToRankedTarget(source.target,[]),deadline=Math.min(execution?.deadline??config.automaticDeadline??Infinity,Date.now()+95000);
 let result:CompanyBackgroundResearchResult={facts:[],fields:Object.fromEntries(spec.fields.map(field=>[field,{status:'research_incomplete',reason:'Background acquisition failed or exhausted its execution budget'}])),attempts:[],registryContacts:[]};
 if(!failed&&Date.now()<deadline){
  if(spec.verifyAbn&&!target.abn)try{result.abnLookup=await(execution?.resolveAbn??resolvePublicCompanyAbn)({name:target.companyName,website:`https://${target.domain}/`,deadline:Math.min(deadline,Date.now()+25000)});}catch{/* Independent field reads still run. */}
  try{const fields=await(execution?.researchFields??researchCompanyMissingFields)({name:target.companyName,website:`https://${target.domain}/`,missingFields:spec.fields,deadline,jobId:job.id,raw:target.sourceData?.firmable?.rawResponse});result={...fields,abnLookup:result.abnLookup};}catch{/* Persist explicit operationally incomplete outcomes. */}
 }
 return persistCompanyBackgroundResult({organizationId:job.organizationId,jobId:job.id,result},undefined,execution?.beforePersist);
}
