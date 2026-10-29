import type {Pool} from 'pg';
import {reconcileWorkflowPeopleSnapshots} from './acquisition-workflow-people-snapshots';
import {agentActorSchema,type AgentActor} from '@/db/agent-store';
import {AcquisitionWorkflowStore} from '@/db/acquisition-workflow-store';
import type {AcquisitionWorkflowExecution,AcquisitionWorkflowState} from '@/domain/acquisition-workflow';
import type {InitialMandateResearchView} from '@/domain/agent-mode';
import type {ResearchConfig} from '@/domain/research';
import {initialResearchOutcome} from '@/domain/initial-research-outcome';
import {initialResearchStatus,initialResearchSummarySql} from './initial-research-status';
import {startMandateResearch} from './start-mandate-research';
import {withAcquisitionWorkflowContext} from './acquisition-workflow-context';

export type WorkflowResearchView=InitialMandateResearchView;
/** Only persisted source/job association can establish workflow research identity. */
async function context(pool:Pool,rawActor:AgentActor,execution:AcquisitionWorkflowExecution){
 const actor=agentActorSchema.parse(rawActor);
 if(execution.organizationId!==actor.organizationId||execution.ownerUserId!==actor.userId)throw Error('Owned workflow unavailable');
 const row=(await pool.query(`SELECT w.*,m.xmin::text AS mandate_revision,
  j.id AS job_id,j.workflow_execution_id AS job_workflow_execution_id,j.status AS job_status,j.config AS job_config,
  ${initialResearchSummarySql},
  EXISTS(SELECT 1 FROM research_jobs child WHERE child.workflow_execution_id=w.id AND child.organization_id=w.organization_id AND child.mandate_id=w.mandate_id AND child.created_by=w.owner_user_id AND child.id<>w.id AND child.config->>'researchRunId'=w.id::text AND child.status IN('complete','partial','cancelled') AND child.config->'nativeAgent' IS NULL AND child.config->'companyPeopleProgress'->>'settled'='false') AS pending_child_people,
  (SELECT count(*)::int FROM mandate_targets mt WHERE mt.mandate_id=m.id AND mt.organization_id=m.organization_id) AS company_count,
  (SELECT count(DISTINCT c.id)::int FROM contacts c JOIN mandate_targets mt ON mt.target_id=c.target_id AND mt.organization_id=c.organization_id WHERE mt.mandate_id=m.id AND mt.organization_id=m.organization_id) AS people_count
  FROM acquisition_workflow_executions w JOIN mandates m ON m.id=w.mandate_id AND m.organization_id=w.organization_id AND m.created_by=w.owner_user_id
  JOIN member member ON member.organization_id=w.organization_id AND member.user_id=w.owner_user_id
  LEFT JOIN research_jobs j ON j.id=w.id AND j.organization_id=w.organization_id AND j.mandate_id=w.mandate_id AND j.created_by=w.owner_user_id
  WHERE w.id=$1 AND w.mandate_id=$2 AND w.organization_id=$3 AND w.owner_user_id=$4`,[execution.id,execution.mandateId,actor.organizationId,actor.userId])).rows[0];
 if(!row||row.id!==execution.id||row.mandate_id!==execution.mandateId||row.organization_id!==actor.organizationId||row.owner_user_id!==actor.userId||row.preset!==execution.preset||row.presentation!==execution.presentation)throw Error('Owned workflow unavailable');
 if(row.job_id&&row.job_workflow_execution_id!==execution.id)throw Error('Research job does not belong to its original execution');
 return row;
}
function project(row:Record<string,unknown>):WorkflowResearchView{
 const requestId=String(row.id),companies=Number(row.company_count??0),people=Number(row.people_count??0);
 const source=row.preset==='demo'?'cached':'live';
 if(['failed','cancelled','uncertain'].includes(String(row.state)))return {requestId,source,status:String(row.state),companies,people,...(row.job_id?{jobId:String(row.job_id)}:{})};
 if(source==='cached')return {requestId,source,status:companies>0&&people>0?'complete':'conflict',candidates:companies,companies,people};
 if(!row.job_id)return {requestId,source,status:'awaiting_start',companies,people};
 const config=(row.job_config??{}) as ResearchConfig;
 const status=initialResearchStatus(String(row.job_status),config,row.research_summary as Parameters<typeof initialResearchStatus>[2]);
 return {requestId,source,jobId:String(row.job_id),status,...initialResearchOutcome({status,config,companies,people})};
}
export async function readWorkflowResearch(pool:Pool,actor:AgentActor,execution:AcquisitionWorkflowExecution):Promise<WorkflowResearchView>{return project(await context(pool,actor,execution));}
export type WorkflowResearchPorts={start?:typeof startMandateResearch;transition?:AcquisitionWorkflowStore['transition']};
/** Same research action for real and research-only work; saved mode is read-only
 * reference loading. No outreach/provisioning port exists at this boundary. */
export async function ensureWorkflowResearch(pool:Pool,actor:AgentActor,execution:AcquisitionWorkflowExecution,ports:WorkflowResearchPorts={}):Promise<WorkflowResearchView>{
 const row=await context(pool,actor,execution),view=project(row);
 if(['complete','failed','cancelled','uncertain','outreach'].includes(String(row.state)))return view;
 const store=new AcquisitionWorkflowStore(pool,actor),transition=ports.transition??store.transition.bind(store);
 const advance=async(state:AcquisitionWorkflowState)=>{if(row.state!==state)await transition(execution.id,Number(row.revision),state);};
 if(execution.preset==='demo'){
  if(view.status!=='complete')throw Error('Saved research is no longer available. No live research was started.');
  await advance('ready');return view;
 }
 if(view.jobId){
  if(['complete','partial'].includes(view.status)){
   if(row.pending_child_people)await reconcileWorkflowPeopleSnapshots(pool,actor,execution);
   await advance(execution.preset==='live-research-test'?'complete':'ready');
  }
  else if(['failed','cancelled'].includes(view.status)){if(row.pending_child_people)await reconcileWorkflowPeopleSnapshots(pool,actor,execution);await advance(view.status as 'failed'|'cancelled');}
  else await advance('researching');
  return view;
 }
 const result=await withAcquisitionWorkflowContext({id:execution.id,organizationId:actor.organizationId,ownerUserId:actor.userId},()=>
  (ports.start??startMandateResearch)(actor,execution.mandateId,{requestId:execution.id,fromBrief:true},{expectedMandateRevision:String(row.mandate_revision)}));
 if(result.status!==202)throw Error('Workflow research launch is waiting for its saved request to be reconciled');
 if(result.body.jobId!==execution.id)throw Error('Research launch returned a different execution identity');
 await advance('researching');return {...view,jobId:execution.id,status:'queued'};
}
/** Compatibility readers may resolve current work for display/new commands.
 * Existing jobs/events must always pass their original execution ID instead. */
export async function findMandateWorkflow(pool:Pool,actor:AgentActor,mandateId:string):Promise<AcquisitionWorkflowExecution|undefined>{
 if(process.env.ACQUISITION_WORKFLOW_ENABLED!=='true'&&process.env.ACQUISITION_WORKFLOW_SCHEMA_READY!=='true')return;
 const row=(await pool.query(`SELECT w.* FROM acquisition_workflow_executions w JOIN member m ON m.organization_id=w.organization_id AND m.user_id=w.owner_user_id WHERE w.mandate_id=$1 AND w.organization_id=$2 AND w.owner_user_id=$3 ORDER BY w.created_at DESC,w.id DESC LIMIT 1`,[mandateId,actor.organizationId,actor.userId])).rows[0];
 if(!row)return;
 return {id:row.id,mandateId:row.mandate_id,organizationId:row.organization_id,ownerUserId:row.owner_user_id,preset:row.preset,presentation:row.presentation,state:row.state,revision:Number(row.revision),errorCode:row.error_code};
}
