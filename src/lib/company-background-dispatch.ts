import {and,eq,notInArray,sql} from 'drizzle-orm';
import {requireDb} from '@/db/client';
import {researchJobs} from '@/db/schema';
import {terminalResearchStates,type ResearchConfig} from '@/domain/research';
import {researchWorker} from './research-service';
import {COMPANY_BACKGROUND_BUDGET,persistCompanyBackgroundResult} from './company-background-research';
/** Durable outbox: only dispatch happens after responses; provider reads live in Workflows. */
export async function dispatchCompanyBackground(organizationId:string,mandateId:string){
 const db=requireDb();
 const claimed=await db.transaction(async tx=>{
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`company-background:${organizationId}`}))`);
  const active=await tx.select({id:researchJobs.id}).from(researchJobs).where(and(eq(researchJobs.organizationId,organizationId),sql`${researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`,sql`${researchJobs.status} NOT IN ('queued','complete','partial','failed','cancelled')`));
  const slots=Math.max(0,2-active.length);if(!slots)return[];
  const queued=await tx.select().from(researchJobs).where(and(eq(researchJobs.organizationId,organizationId),eq(researchJobs.mandateId,mandateId),eq(researchJobs.status,'queued'),sql`${researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`,sql`COALESCE((${researchJobs.config}->'companyBackgroundDispatch'->>'nextAttemptAt')::bigint,0) <= ${Date.now()}`)).orderBy(researchJobs.createdAt).limit(slots).for('update',{skipLocked:true});
  const result=[];
  for(const job of queued){
   const config=job.config as ResearchConfig;
   const [root]=await tx.select({status:researchJobs.status}).from(researchJobs).where(and(eq(researchJobs.id,config.companyBackgroundResearch!.sourceRootId),eq(researchJobs.organizationId,organizationId))).for('share');
   if(!root||root.status==='cancelled'){await tx.update(researchJobs).set({status:'cancelled',updatedAt:new Date(),message:'Background research cancelled with parent'}).where(eq(researchJobs.id,job.id));continue;}
   const attempts=(config.companyBackgroundDispatch?.attempts||0)+1,startedAt=config.companyBackgroundDispatch?.startedAt||Date.now();
   const deadline=startedAt+COMPANY_BACKGROUND_BUDGET.maxDurationMs;
   if(attempts>3||Date.now()>=deadline){await persistCompanyBackgroundResult({organizationId,jobId:job.id,result:{facts:[],fields:Object.fromEntries(config.companyBackgroundResearch!.fields.map(field=>[field,{status:'research_incomplete',reason:'Background dispatch budget exhausted'}])),attempts:[],registryContacts:[]}},tx);continue;}
   await tx.update(researchJobs).set({status:'discovering',updatedAt:new Date(),message:'Background missing-field research starting',config:{...config,automaticDeadline:deadline,companyBackgroundDispatch:{attempts,startedAt}}}).where(eq(researchJobs.id,job.id));
   result.push({id:job.id,attempts,startedAt});
  }
  return result;
 });
 for(const job of claimed){
  try{await researchWorker(`/jobs/${job.id}`,'POST',undefined,4000);}
  catch{await db.update(researchJobs).set({status:'queued',updatedAt:new Date(),message:'Background dispatch pending; company results available',config:sql`${researchJobs.config} || ${JSON.stringify({companyBackgroundDispatch:{...job,nextAttemptAt:Date.now()+Math.min(30000,1000*2**job.attempts)}})}::jsonb`}).where(and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,organizationId),eq(researchJobs.status,'discovering')));}
 }
 return claimed.length;
}
/** Unattended retries and refills are driven by the existing Worker's periodic recovery. */
export async function recoverCompanyBackground(){
 const db=requireDb();
 const stalled=await db.select().from(researchJobs).where(and(sql`${researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`,notInArray(researchJobs.status,terminalResearchStates),sql`${researchJobs.status} <> 'queued'`,sql`${researchJobs.updatedAt} < NOW() - INTERVAL '150 seconds'`)).limit(50);
 for(const job of stalled)await persistCompanyBackgroundResult({organizationId:job.organizationId,jobId:job.id,result:{facts:[],fields:Object.fromEntries((job.config as ResearchConfig).companyBackgroundResearch!.fields.map(field=>[field,{status:'research_incomplete',reason:'Background execution stopped; prior evidence retained'}])),attempts:[],registryContacts:[]}});
 const pending=await db.selectDistinct({organizationId:researchJobs.organizationId,mandateId:researchJobs.mandateId}).from(researchJobs).where(and(eq(researchJobs.status,'queued'),sql`${researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`)).limit(50);
 for(const item of pending)await dispatchCompanyBackground(item.organizationId,item.mandateId);
 return pending.length;
}
