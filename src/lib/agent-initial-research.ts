import {findMandateWorkflow,readWorkflowResearch,ensureWorkflowResearch} from './acquisition-workflow-research';
import type {Pool} from 'pg';
import {z} from 'zod';
import {agentActorSchema,type AgentActor} from '@/db/agent-store';
import {briefSchema,criterion} from '@/domain/acquisition';
import {readableStoredBrief} from '@/domain/stored-brief';
import type {InitialMandateResearchView} from '@/domain/agent-mode';
import {agentStore} from './agent-runtime';
import {startMandateResearch} from './start-mandate-research';
import {attachCachedDemoResearch,cachedDemoResearchSelectionSchema} from './cached-demo-research';
import {initialResearchOutcome} from '@/domain/initial-research-outcome';
import type {ResearchConfig} from '@/domain/research';

const intentSchema=z.object({version:z.literal(1),requestId:z.string().uuid(),creationRevision:z.string().regex(/^\d{1,30}$/),source:z.enum(['cached','live']).optional(),startOn:z.literal('chat').optional(),presentation:z.enum(['agent','workspace']).optional(),cachedDemo:z.object({selection:cachedDemoResearchSelectionSchema}).strict().optional()}).strict().refine(value=>value.source!=='cached'||Boolean(value.cachedDemo));
/** This association comes only from an immutable creation receipt, never a URL,
 * a browser flag, brief prose or a caller-supplied job/thread ID. */
async function initialContext(pool:Pool,rawActor:AgentActor,mandateId:string){
 const actor=agentActorSchema.parse(rawActor);z.string().uuid().parse(mandateId);
 const row=(await pool.query(`SELECT m.filters,m.xmin::text AS revision,a.metadata,
   t.id AS thread_id,r.state AS responsibility_state,r.mandate_revision,
   j.id AS job_id,j.status AS job_status,j.created_by AS job_created_by,(j.config ? 'nativeAgent') AS native_root,j.config AS job_config,
   (SELECT count(*)::int FROM mandate_targets mt WHERE mt.mandate_id=m.id AND mt.organization_id=m.organization_id) AS company_count,
   (SELECT count(*)::int FROM mandate_targets mt WHERE mt.mandate_id=m.id AND mt.organization_id=m.organization_id AND mt.target_id::text IN (SELECT jsonb_array_elements_text(coalesce(a.metadata->'initialResearch'->'cachedDemo'->'selection'->'targetIds','[]'::jsonb)))) AS cached_company_count,
   (SELECT count(DISTINCT p.id)::int FROM contacts p JOIN mandate_targets mt ON mt.target_id=p.target_id AND mt.organization_id=p.organization_id WHERE mt.mandate_id=m.id AND mt.organization_id=m.organization_id) AS people_count
  FROM mandates m JOIN audit_events a ON a.id=m.id AND a.entity_id=m.id::text
   AND a.organization_id=m.organization_id AND a.actor_id=m.created_by
   AND a.action='agent.mandate_created' AND a.entity_type='mandate'
  JOIN member member ON member.organization_id=m.organization_id AND member.user_id=$3
  LEFT JOIN agent_threads t ON t.organization_id=m.organization_id AND t.mandate_id=m.id AND t.owner_user_id=$3
  LEFT JOIN agent_responsibilities r ON r.thread_id=t.id
  LEFT JOIN research_jobs j ON j.id=m.id AND j.organization_id=m.organization_id AND j.mandate_id=m.id
  WHERE m.id=$1 AND m.organization_id=$2 AND m.created_by=$3`,[mandateId,actor.organizationId,actor.userId])).rows[0];
 if(!row)return;
 const parsed=intentSchema.safeParse(row.metadata?.initialResearch);
 if(!parsed.success||parsed.data.requestId!==mandateId||parsed.data.creationRevision!==row.metadata.creationRevision)return;
 return {actor,row,intent:parsed.data};
}
function view(context:NonNullable<Awaited<ReturnType<typeof initialContext>>>):InitialMandateResearchView{
 const {row,intent,actor}=context;
 const companies=Number(row.company_count??0),people=Number(row.people_count??0);
 if(intent.source==='cached'&&intent.cachedDemo)return {requestId:intent.requestId,source:'cached',status:Number(row.cached_company_count??0)>=intent.cachedDemo.selection.companyCount?'complete':'queued',candidates:intent.cachedDemo.selection.companyCount,companies,people};
 if(intent.startOn==='chat'&&!row.job_id&&!row.responsibility_state)return {requestId:intent.requestId,source:'live',status:'awaiting_start'};
 if(row.job_id&&(row.job_created_by!==actor.userId||row.native_root))return {requestId:intent.requestId,status:'conflict'};
 return {requestId:intent.requestId,status:row.job_status??(row.responsibility_state&&!['ready','waiting'].includes(row.responsibility_state)?row.responsibility_state==='paused'?'paused':'cancelled':row.revision!==intent.creationRevision?'brief_changed':'queued'),...(row.job_id?{jobId:row.job_id,source:'live' as const,...initialResearchOutcome({status:row.job_status,config:(row.job_config??{}) as ResearchConfig,companies,people})}:{})};
}
/** Read-only projection. Displaying the chat must never schedule research. */
export async function readInitialMandateResearch(pool:Pool,actor:AgentActor,mandateId:string):Promise<InitialMandateResearchView|undefined>{
 const workflow=await findMandateWorkflow(pool,actor,mandateId);if(workflow)return readWorkflowResearch(pool,actor,workflow);
 const context=await initialContext(pool,actor,mandateId);return context?view(context):undefined;
}
type InitialStore=Pick<ReturnType<typeof agentStore>,'openThread'|'appendMessage'|'executionState'|'controlResponsibility'>;
export type InitialResearchPorts={store?:(actor:AgentActor)=>InitialStore;start?:typeof startMandateResearch;attachCached?:typeof attachCachedDemoResearch};
/** Submission and the existing worker both recover the SAME saved intent.
 * New user-submitted research deliberately has normal GUI limits, not native
 * phase escrow. Existing native roots/receipts are never converted or resumed. */
export async function ensureInitialMandateResearch(pool:Pool,actor:AgentActor,mandateId:string,ports:InitialResearchPorts={}):Promise<InitialMandateResearchView|undefined>{
 const workflow=await findMandateWorkflow(pool,actor,mandateId);if(workflow)return ensureWorkflowResearch(pool,actor,workflow,{start:ports.start});
 const context=await initialContext(pool,actor,mandateId);if(!context)return;
 const {row,intent}=context;
 if(intent.startOn==='chat'&&!row.job_id&&!row.responsibility_state)return view(context);
 if(intent.source==='cached'&&intent.cachedDemo){
  if(row.job_id)throw Error('Saved-data demo conflicts with existing live research');
  if(row.revision!==intent.creationRevision||row.responsibility_state&&!['ready','waiting'].includes(row.responsibility_state))return view(context);
  const loaded=await (ports.attachCached??attachCachedDemoResearch)(pool,actor,mandateId,intent.cachedDemo.selection);
  const projection=await readInitialMandateResearch(pool,actor,mandateId);
  if(projection?.status!=='complete')throw Error('Saved demo memberships are not complete');
  const availableCompanies=projection.companies??loaded.companyCount,availablePeople=projection.people??loaded.peopleCount;
  if(intent.presentation!=='workspace'){
   const store=(ports.store??agentStore)(actor),thread=await store.openThread(mandateId),state=await store.executionState(thread.id);
   if(!state.responsibility)await store.controlResponsibility(thread.id,'initial-research-start:'+intent.requestId,{action:'start',expectedRevision:0,mandateRevision:intent.creationRevision});
   await store.appendMessage(thread.id,'initial-cached-demo-ready:v2:'+intent.requestId,'assistant',{text:`Your demo is ready with ${availableCompanies} saved companies and ${availablePeople} people profiles. Open Companies or People to explore the results. This demo uses saved data; no Firmable or live research request was made.`,details:{source:'cached',sourceMandateId:loaded.sourceMandateId,companies:availableCompanies,people:availablePeople}});
  }
  console.info('agent-initial-research',JSON.stringify({module:'agent-initial-research',stage:'cached_demo_ready',mandateId,sourceMandateId:loaded.sourceMandateId,companies:availableCompanies,people:availablePeople,timestamp:new Date().toISOString()}));
  return {requestId:intent.requestId,status:'complete',source:'cached',candidates:loaded.companyCount,companies:availableCompanies,people:availablePeople};
 }
 if(row.job_id){
  if(row.job_created_by!==actor.userId||row.native_root)throw Error('Initial research handle conflicts with existing saved work');
  return view(context); // Ordinary worker recovery owns saved roots.
 }
 if(row.revision!==intent.creationRevision||row.responsibility_state&&!['ready','waiting'].includes(row.responsibility_state))return view(context);
 const store=(ports.store??agentStore)(actor),thread=await store.openThread(mandateId),brief=briefSchema.parse(readableStoredBrief(row.filters?.brief));
 const scope=criterion(brief,'subsectors').value.trim().slice(0,500),geography=criterion(brief,'geography').value.trim().slice(0,180);
 await store.appendMessage(thread.id,'initial-research-summary:'+intent.requestId,'assistant',{text:`I’m going to research ${scope||'businesses matching your mandate'}${geography?` in ${geography}`:''}. I’ll enrich the company data and load available people profiles, and keep you updated here. Results will appear in Companies and People.`});
 const state=await store.executionState(thread.id);
 let responsibility=state.responsibility;
 if(!responsibility){const started=await store.controlResponsibility(thread.id,'initial-research-start:'+intent.requestId,{action:'start',expectedRevision:0,mandateRevision:intent.creationRevision});responsibility={id:started.id,revision:started.revision,state:started.status};}
 else if(!['ready','waiting'].includes(responsibility.state)||state.mandateRevision!==intent.creationRevision)return {requestId:intent.requestId,status:responsibility.state==='paused'?'paused':'brief_changed'};
 console.info('agent-initial-research',JSON.stringify({module:'agent-initial-research',stage:'launch_requested',mandateId,jobId:intent.requestId,timestamp:new Date().toISOString()}));
 const result=await (ports.start??startMandateResearch)(actor,mandateId,{requestId:intent.requestId,fromBrief:true},{expectedMandateRevision:intent.creationRevision,initialResponsibility:{id:responsibility.id,revision:responsibility.revision,threadId:thread.id}});
 if(result.status!==202){
  // A durable event or the original submission retry can reconcile transient
  // failures. Never claim a provider request or a completed result here.
  console.info('agent-initial-research',JSON.stringify({module:'agent-initial-research',stage:'launch_waiting',mandateId,jobId:intent.requestId,status:result.status,timestamp:new Date().toISOString()}));
  throw new Error('Initial research launch is waiting for its saved request to be reconciled');
 }
 return {requestId:intent.requestId,jobId:result.body.jobId,status:'queued'};
}
/** Called only from the fenced supervisor, before legacy plan generation. */
export async function superviseInitialMandateResearch(pool:Pool,actor:AgentActor,threadId:string){
 const row=(await pool.query(`SELECT t.mandate_id FROM agent_threads t JOIN member m ON m.organization_id=t.organization_id AND m.user_id=t.owner_user_id WHERE t.id=$1 AND t.organization_id=$2 AND t.owner_user_id=$3`,[threadId,actor.organizationId,actor.userId])).rows[0];
 return row?Boolean(await ensureInitialMandateResearch(pool,actor,row.mandate_id)):false;
}
