import {and,eq} from 'drizzle-orm';
import {requireDb} from '@/db/client';
import {researchJobs,targets} from '@/db/schema';
import {targetRecordToRankedTarget} from '@/db/target-record-mapper';
import {terminalResearchStates,type ResearchConfig} from '@/domain/research';
import {resolvePublicCompanyAbn} from '@/adapters/abn-identity-resolver';
import {researchCompanyMissingFields} from '@/adapters/company-missing-field-research';
import {persistCompanyBackgroundResult,type CompanyBackgroundResearchResult} from './company-background-research';
type Job=typeof researchJobs.$inferSelect;
export async function executeCompanyBackground(job:Job,failed=false){
 const config=job.config as ResearchConfig,spec=config.companyBackgroundResearch;
 if(!spec||!config.targetId)throw Error('Missing durable background configuration');
 if(terminalResearchStates.includes(job.status))return {accepted:false,status:job.status};
 const [row]=await requireDb().select().from(targets).where(and(eq(targets.id,config.targetId),eq(targets.organizationId,job.organizationId),eq(targets.mandateId,job.mandateId)));
 if(!row)throw Error('Background company is unavailable');
 const target=targetRecordToRankedTarget(row,[]),deadline=Math.min(config.automaticDeadline||Infinity,Date.now()+95000);
 let result:CompanyBackgroundResearchResult={facts:[],fields:Object.fromEntries(spec.fields.map(field=>[field,{status:'research_incomplete',reason:'Background acquisition failed or exhausted its execution budget'}])),attempts:[],registryContacts:[]};
 if(!failed&&Date.now()<deadline){
  if(spec.verifyAbn&&!target.abn)try{result.abnLookup=await resolvePublicCompanyAbn({name:target.companyName,website:`https://${target.domain}/`,deadline:Math.min(deadline,Date.now()+25000)});}catch{/* Independent field reads still run. */}
  try{const fields=await researchCompanyMissingFields({name:target.companyName,website:`https://${target.domain}/`,missingFields:spec.fields,deadline,jobId:job.id,raw:target.sourceData?.firmable?.rawResponse});result={...fields,abnLookup:result.abnLookup};}catch{/* Persist explicit operationally incomplete outcomes. */}
 }
 return persistCompanyBackgroundResult({organizationId:job.organizationId,jobId:job.id,result});
}
