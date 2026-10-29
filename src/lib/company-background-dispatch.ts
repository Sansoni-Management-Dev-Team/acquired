import {safeResearchFailure} from '@/domain/research-trace-context';
import {completesWorkItems} from '@/domain/research-completion';
import {withResearchJobWorkflow} from './acquisition-workflow-context';
import {lockResearchPersistence} from './research-persistence-lock';
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
  await lockResearchPersistence(tx,organizationId);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`company-background:${organizationId}`}))`);
  const active=await tx.select({id:researchJobs.id}).from(researchJobs).where(and(eq(researchJobs.organizationId,organizationId),sql`${researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`,sql`${researchJobs.config}->'nativeAgent' IS NULL`,sql`${researchJobs.status} NOT IN ('queued','complete','partial','failed','cancelled')`));
  const slots=Math.max(0,2-active.length);if(!slots)return[];
  const queued=await tx.select().from(researchJobs).where(and(eq(researchJobs.organizationId,organizationId),eq(researchJobs.mandateId,mandateId),eq(researchJobs.status,'queued'),sql`${researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`,sql`${researchJobs.config}->'nativeAgent' IS NULL`,sql`COALESCE((${researchJobs.config}->'companyBackgroundDispatch'->>'nextAttemptAt')::bigint,0) <= ${Date.now()}`)).orderBy(researchJobs.createdAt).limit(slots).for('update',{skipLocked:true});
  const result=[];
  for(const job of queued){
   // This batch may contain different original executions. Scope the checked-out
   // transaction from each persisted row before any managed write.
   await tx.execute(sql`SELECT set_config('app.acquire_workflow_version',${job.workflowExecutionId?'1':''},true),set_config('app.acquire_workflow_execution',${job.workflowExecutionId??''},true),set_config('app.acquire_org',${job.organizationId},true),set_config('app.acquire_user',${job.createdBy},true)`);
   const config=job.config as ResearchConfig;
   const [root]=await tx.select({status:researchJobs.status}).from(researchJobs).where(and(eq(researchJobs.id,config.companyBackgroundResearch!.sourceRootId),eq(researchJobs.organizationId,organizationId))).for('share');
   if(!root||root.status==='cancelled'){await tx.update(researchJobs).set({status:'cancelled',updatedAt:new Date(),message:'Background research cancelled with parent'}).where(eq(researchJobs.id,job.id));continue;}
   const attempts=(config.companyBackgroundDispatch?.attempts||0)+1,startedAt=config.companyBackgroundDispatch?.startedAt||Date.now();
   const deadline=startedAt+COMPANY_BACKGROUND_BUDGET.maxDurationMs;
   if(!completesWorkItems(config)&&(attempts>3||Date.now()>=deadline)){await persistCompanyBackgroundResult({organizationId,jobId:job.id,result:{facts:[],fields:Object.fromEntries(config.companyBackgroundResearch!.fields.map(field=>[field,{status:'research_incomplete',reason:'Background dispatch budget exhausted'}])),attempts:[],registryContacts:[]}},tx);continue;}
   await tx.update(researchJobs).set({status:'discovering',updatedAt:new Date(),message:'Background missing-field research starting',config:{...config,automaticDeadline:completesWorkItems(config)?undefined:deadline,companyBackgroundDispatch:{attempts,startedAt}}}).where(eq(researchJobs.id,job.id));
   result.push({...job,attempts,startedAt});
  }
  return result;
 });
 for(const job of claimed){
  try{await researchWorker(`/jobs/${job.id}`,'POST',undefined,4000);}
  catch{await withResearchJobWorkflow(job,()=>db.update(researchJobs).set({status:'queued',updatedAt:new Date(),message:'Background dispatch pending; company results available',config:sql`${researchJobs.config} || ${JSON.stringify({companyBackgroundDispatch:{id:job.id,attempts:job.attempts,startedAt:job.startedAt,nextAttemptAt:Date.now()+Math.min(30000,1000*2**job.attempts)}})}::jsonb`}).where(and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,organizationId),eq(researchJobs.status,'discovering'))));}
 }
 return claimed.length;
}
/** Unattended retries and refills are driven by the existing Worker's periodic recovery. */
export async function recoverCompanyBackground(deadline=Infinity){
 let stage='stalled_scan';const started=performance.now();let scope:{organizationId?:string;mandateId?:string;jobId?:string}={};
 try{
 const db=requireDb();
 // Snapshot both bounded read sets in one admission. Persistence and provider
 // dispatch remain outside this read-only transaction; claims recheck live state.
 const {stalled,pending}=await db.transaction(async tx=>{
 const stalled=await tx.select().from(researchJobs).where(and(sql`${researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`,sql`${researchJobs.config}->'nativeAgent' IS NULL`,notInArray(researchJobs.status,terminalResearchStates),sql`${researchJobs.status} <> 'queued'`,sql`${researchJobs.updatedAt} < NOW() - INTERVAL '150 seconds'`)).limit(50);
 stage='queued_scan';scope={};
 const pending=await tx.selectDistinct({organizationId:researchJobs.organizationId,mandateId:researchJobs.mandateId}).from(researchJobs).where(and(eq(researchJobs.status,'queued'),sql`${researchJobs.config}->'companyBackgroundResearch' IS NOT NULL`,sql`${researchJobs.config}->'nativeAgent' IS NULL`)).limit(50);
 return{stalled,pending};
 },{accessMode:'read only'});
 for(const job of stalled){
  if(performance.now()>=deadline)break;
  stage='worker_status';scope={organizationId:job.organizationId,mandateId:job.mandateId,jobId:job.id};
  let worker:{status?:string;recoverable?:boolean};try{worker=await researchWorker(`/jobs/${job.id}`,'GET',undefined,4000) as {status?:string;recoverable?:boolean};}catch{continue;}
  if(completesWorkItems(job.config)&&worker.recoverable){try{await researchWorker(`/jobs/${job.id}`,'POST',{action:'resume'},4000);}catch{/* Preserve the checkpoint for the next recovery pass. */}continue;}
  if(!['complete','errored','terminated'].includes(worker.status||''))continue;
  stage='stalled_persistence';
  await withResearchJobWorkflow(job,()=>persistCompanyBackgroundResult({organizationId:job.organizationId,jobId:job.id,result:{facts:[],fields:Object.fromEntries((job.config as ResearchConfig).companyBackgroundResearch!.fields.map(field=>[field,{status:'research_incomplete',reason:'Background execution stopped; prior evidence retained'}])),attempts:[],registryContacts:[]}}));
 }
 let dispatched=0;
 for(const item of pending){if(performance.now()>=deadline)break;stage='queued_dispatch';scope={organizationId:item.organizationId,mandateId:item.mandateId};await dispatchCompanyBackground(item.organizationId,item.mandateId);dispatched++;}
 return dispatched;
 }catch(error){
  console.info('research-maintenance',JSON.stringify({event:'background_recovery_failed',module:'research.maintenance',stage,...scope,durationMs:Math.round(performance.now()-started),timestamp:new Date().toISOString(),...safeResearchFailure(error)}));
  throw error;
 }
}
