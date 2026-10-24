import {AcquisitionWorkflowStore} from '@/db/acquisition-workflow-store';
import {ensureWorkflowResearch} from './acquisition-workflow-research';
import {backgroundRemaining} from './background-workload';
import {z} from 'zod';
import type {ResearchConfig} from '@/domain/research';
import {terminalResearchStates} from '@/domain/research';
import {initialResearchOutcome} from '@/domain/initial-research-outcome';
import {ensureInitialMandateResearch} from './agent-initial-research';
import {agentPool,agentStore,durableAgentEnabled} from './agent-runtime';

const uuid=z.string().uuid();
const intent=z.object({version:z.literal(1),requestId:uuid,creationRevision:z.string().regex(/^\d{1,30}$/),startOn:z.literal('chat').optional()}).strict();
type Job={workflowExecutionId?:string|null;id:string;organizationId:string;mandateId:string;createdBy:string;config:unknown};
function diagnostic(event:string,scope:{jobId?:string;mandateId?:string}={},details:Record<string,string|number>={}){console.info('agent-initial-research',JSON.stringify({module:'agent-initial-research.observer',event,...scope,...details,timestamp:new Date().toISOString()}));}
const growthThresholds=[1,5,10,20,50,100,200,400,800];
function growthBucket(value:number,people=false){return [...growthThresholds,...(people?[1200,1600,2400]:[])].filter(threshold=>threshold<=value).at(-1);}

/** Observes only an immutable initial-creation association. It neither starts
 * supervision nor creates approvals, native operations or outreach events. */
export async function observeInitialResearchProgress(job:Job):Promise<{messages:number}>{
 if(job.workflowExecutionId){
  const actor={organizationId:job.organizationId,userId:job.createdBy},pool=agentPool();
  try{
   const execution=await new AcquisitionWorkflowStore(pool,actor).read(job.workflowExecutionId);
   if(!execution||execution.mandateId!==job.mandateId)throw Error('Research execution mandate mismatch');
   await ensureWorkflowResearch(pool,actor,execution);
  }catch{diagnostic('workflow_progress_deferred',{jobId:job.id,mandateId:job.mandateId});}
  return{messages:0};
 }
 if(!durableAgentEnabled()||(job.config as ResearchConfig)?.nativeAgent)return{messages:0};
 const config=job.config as ResearchConfig,root=uuid.safeParse(config?.researchRunId??config?.parentJobId??job.id);
 if(!root.success)return{messages:0};
 let messages=0;
 try{
  const pool=agentPool(),row=(await pool.query(`SELECT j.id AS job_id,j.status,j.config,a.metadata->'initialResearch' AS initial_research,
   a.metadata->>'creationRevision' AS creation_revision,t.id AS thread_id,t.organization_id,t.mandate_id,t.owner_user_id,
   cardinality(companies.ids)::int AS companies,
   (SELECT count(*)::int FROM contacts p WHERE p.organization_id=j.organization_id AND p.target_id=ANY(companies.ids)) AS people
  FROM research_jobs j JOIN mandates m ON m.id=j.mandate_id AND m.organization_id=j.organization_id
  JOIN audit_events a ON a.id=m.id AND a.entity_id=m.id::text AND a.organization_id=m.organization_id
   AND a.actor_id=m.created_by AND j.created_by=a.actor_id AND a.action='agent.mandate_created' AND a.entity_type='mandate'
  JOIN member member ON member.organization_id=a.organization_id AND member.user_id=a.actor_id
  JOIN agent_threads t ON t.organization_id=a.organization_id AND t.mandate_id=m.id AND t.owner_user_id=a.actor_id
  CROSS JOIN LATERAL(SELECT coalesce(array_agg(DISTINCT mt.target_id),'{}'::uuid[]) AS ids FROM mandate_targets mt
   WHERE mt.organization_id=j.organization_id AND mt.mandate_id=j.mandate_id AND EXISTS(
    SELECT 1 FROM research_jobs source WHERE source.organization_id=j.organization_id AND source.mandate_id=j.mandate_id AND source.created_by=j.created_by
     AND (source.id=j.id OR source.config->>'researchRunId'=j.id::text OR source.config->>'parentJobId'=j.id::text)
     AND (source.config->>'targetId'=mt.target_id::text OR coalesce(source.config->'newBusinessIds','[]'::jsonb)?mt.target_id::text))) companies
  WHERE j.id=$1 AND j.organization_id=$2 AND j.mandate_id=$3 AND j.created_by=$4 AND j.config->'nativeAgent' IS NULL
   AND a.metadata->'initialResearch'->>'requestId'=j.id::text`,[root.data,job.organizationId,job.mandateId,job.createdBy])).rows[0];
  if(!row)return{messages:0};
  const marker=intent.safeParse(row.initial_research);
  if(!marker.success||marker.data.requestId!==row.job_id||marker.data.creationRevision!==row.creation_revision||row.organization_id!==job.organizationId||row.mandate_id!==job.mandateId||row.owner_user_id!==job.createdBy)return{messages:0};
  const count=z.number().int().nonnegative().safe(),companies=count.parse(row.companies),people=count.parse(row.people);
  const status=z.enum(['queued','discovering','crawling','extracting','complete','partial','failed','cancelled']).parse(row.status);
  const outcome=initialResearchOutcome({status,config:row.config as ResearchConfig,companies,people}),{candidates,blocker}=outcome;
  const notices:Array<{stage:string;text:string}>=[],rootConfig=row.config as ResearchConfig;
  const final=terminalResearchStates.includes(status)&&!(rootConfig.includeCompanyPeople===true&&rootConfig.companyPeopleProgress?.settled===false);
  if(final)notices.push({stage:'terminal:v2:'+status,text:`Company research finished with status ${status}: ${candidates} candidate companies were discovered; ${companies} companies and ${people} people are currently available.${blocker?' '+blocker.message:''} Review the results before outreach.`});
  else if(status==='queued')notices.push({stage:'queued',text:'The initial research job is saved and queued. Results will appear after execution.'});
  else{
   const discovered=growthBucket(candidates),companyCount=growthBucket(companies),peopleCount=growthBucket(people,true);
   if(discovered)notices.push({stage:'candidates:'+discovered,text:`Discovery has recorded ${candidates} candidate companies. Company profiles are being checked before they appear in Companies.`});
   if(companyCount)notices.push({stage:'companies:'+companyCount,text:`${companies} company profiles are currently available in Companies.`});
   if(peopleCount)notices.push({stage:'people:'+peopleCount,text:`${people} people profiles are currently available in People. Phone reveals and outreach remain separate actions.`});
   if(['discovering','crawling','extracting'].includes(status)&&!notices.length)notices.push({stage:'discovery',text:'Company discovery is running. Results will appear in Companies as they are saved.'});
  }
  const store=agentStore({organizationId:job.organizationId,userId:job.createdBy});
  for(const notice of notices){
   const key=`initial-research:${row.job_id}:${notice.stage}`;
   if((await pool.query('SELECT content FROM agent_messages WHERE thread_id=$1 AND request_key=$2',[row.thread_id,key])).rows.length)continue;
   await store.appendMessage(row.thread_id,key,'assistant',{text:notice.text,details:{researchJobId:row.job_id,status,companies,people,candidates,...(blocker?{blocker}:{}),stage:notice.stage,observedAt:new Date().toISOString()}});messages++;diagnostic('progress_observed',{jobId:row.job_id,mandateId:job.mandateId},{stage:notice.stage,status,companies,people,candidates});
  }
  return{messages};
 }catch{diagnostic('progress_observation_deferred',{jobId:root.data,mandateId:job.mandateId});return{messages};}
}

/** Existing service POST invokes this bounded recovery/observation pass. Old
 * audit receipts without the immutable marker and paused gaps are excluded. */
export async function observeScheduledInitialResearch():Promise<{checked:number;recovered:number;messages:number}>{
 const result={checked:0,recovered:0,messages:0};if(!durableAgentEnabled())return result;
 try{
  const pool=agentPool(),scopes=(await pool.query(`WITH eligible AS (
   SELECT a.organization_id,a.actor_id AS owner_user_id,m.id AS mandate_id,j.id AS job_id,a.created_at
   FROM audit_events a JOIN mandates m ON a.id=m.id AND a.organization_id=m.organization_id AND a.actor_id=m.created_by AND a.entity_id=m.id::text
   JOIN member member ON member.organization_id=a.organization_id AND member.user_id=a.actor_id
   LEFT JOIN agent_threads t ON t.organization_id=a.organization_id AND t.mandate_id=m.id AND t.owner_user_id=a.actor_id
   LEFT JOIN agent_responsibilities r ON r.thread_id=t.id
   LEFT JOIN research_jobs j ON j.id::text=a.metadata->'initialResearch'->>'requestId' AND j.organization_id=a.organization_id AND j.mandate_id=m.id AND j.created_by=a.actor_id
   WHERE a.action='agent.mandate_created' AND a.entity_type='mandate' AND a.metadata->'initialResearch'->>'version'='1'
    AND (a.metadata->'initialResearch'->>'source' IS DISTINCT FROM 'cached' OR (a.metadata->'initialResearch'->>'presentation'='agent' AND NOT EXISTS(SELECT 1 FROM agent_messages loaded WHERE loaded.thread_id=t.id AND loaded.request_key='initial-cached-demo-ready:v2:'||m.id::text)))
    AND a.metadata->'initialResearch'->>'requestId'=m.id::text AND a.metadata->'initialResearch'->>'creationRevision'=a.metadata->>'creationRevision'
    AND ((j.id IS NULL AND m.xmin::text=a.metadata->>'creationRevision' AND (r.state IS NULL OR r.state IN('ready','waiting')))
     OR (j.id IS NOT NULL AND j.config->'nativeAgent' IS NULL AND (j.status NOT IN('complete','partial','failed','cancelled')
      OR NOT EXISTS(SELECT 1 FROM agent_messages msg WHERE msg.thread_id=t.id AND msg.request_key='initial-research:'||j.id::text||':terminal:v2:'||j.status::text)
      OR (j.config->>'includeCompanyPeople'='true' AND j.config->'companyPeopleProgress'->>'settled'='false'))))
   ),ordered AS (SELECT *,row_number() OVER(ORDER BY created_at,organization_id,mandate_id)-1 AS position,count(*) OVER() AS total FROM eligible)
   SELECT organization_id,owner_user_id,mandate_id,job_id FROM ordered ORDER BY (position-($1::bigint%total)+total)%total LIMIT 10`,[Math.floor(Date.now()/60000)])).rows;
  for(const scope of scopes){
   backgroundRemaining();
   result.checked++;
   try{
    const actor={organizationId:scope.organization_id,userId:scope.owner_user_id},current=await ensureInitialMandateResearch(pool,actor,scope.mandate_id);
    if(!current?.jobId)continue;
    if(!scope.job_id)result.recovered++;
    const observed=await observeInitialResearchProgress({id:current.jobId,organizationId:actor.organizationId,mandateId:scope.mandate_id,createdBy:actor.userId,config:{}});result.messages+=observed.messages;
   }catch{diagnostic('initial_scope_observation_deferred',{mandateId:scope.mandate_id});}
  }
 }catch{diagnostic('initial_scopes_unavailable');}
 return result;
}
