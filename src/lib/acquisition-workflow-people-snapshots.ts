import type {Pool} from 'pg';
import type {AgentActor} from '@/db/agent-store';
import type {AcquisitionWorkflowExecution} from '@/domain/acquisition-workflow';
import {companyPeopleProgress,type CompanyPeopleRun} from '@/domain/company-people-progress';
/** Refresh copied terminal-child aggregates from their exact original run IDs.
 * No provider work or lifecycle change: active/missing/mismatched work stays blocked. */
export async function reconcileWorkflowPeopleSnapshots(pool:Pool,actor:AgentActor,execution:AcquisitionWorkflowExecution){
 if(actor.organizationId!==execution.organizationId||actor.userId!==execution.ownerUserId)throw Error('Owned workflow unavailable');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  await c.query("SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='10s'");
  await c.query("SELECT set_config('app.acquire_workflow_version','1',true),set_config('app.acquire_workflow_execution',$1,true),set_config('app.acquire_org',$2,true),set_config('app.acquire_user',$3,true)",[execution.id,actor.organizationId,actor.userId]);
  const root=(await c.query(`SELECT config,status FROM research_jobs WHERE id=$1 AND workflow_execution_id=$1 AND organization_id=$2 AND mandate_id=$3 AND created_by=$4 AND status IN('complete','partial','cancelled') AND config->'nativeAgent' IS NULL AND config->'companyPeopleProgress'->>'settled'='true' FOR SHARE`,[execution.id,actor.organizationId,execution.mandateId,actor.userId])).rows[0];
  if(root?.status==='cancelled'&&(await c.query(`SELECT 1 FROM research_jobs WHERE workflow_execution_id=$1 AND organization_id=$2 AND mandate_id=$3 AND created_by=$4 AND status NOT IN('complete','partial','failed','cancelled') LIMIT 1 FOR SHARE`,[execution.id,actor.organizationId,execution.mandateId,actor.userId])).rows.length){await c.query('COMMIT');return 0;}
  const rootIds=root?.config?.companyPeopleRunIds;
  if(!Array.isArray(rootIds)){await c.query('COMMIT');return 0;}
  const children=(await c.query(`SELECT id,config FROM research_jobs WHERE workflow_execution_id=$1 AND organization_id=$2 AND mandate_id=$3 AND created_by=$4 AND id<>$1 AND config->>'researchRunId'=$1::text AND config->'nativeAgent' IS NULL AND status IN('complete','partial','cancelled') AND config->'companyPeopleProgress'->>'settled'='false' ORDER BY id LIMIT 50 FOR UPDATE`,[execution.id,actor.organizationId,execution.mandateId,actor.userId])).rows;
  let updated=0;
  for(const child of children){
   const ids=child.config?.companyPeopleRunIds;
   if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!rootIds.includes(id))||new Set(ids).size!==ids.length)continue;
   const runs=(await c.query(`SELECT status,profiles_found AS "profilesFound",profiles_saved AS "profilesSaved",profiles_failed AS "profilesFailed",error FROM firmable_sync_runs WHERE organization_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`,[actor.organizationId,ids])).rows as CompanyPeopleRun[];
   if(runs.length!==ids.length||runs.some(run=>!['complete','partial','failed','cancelled'].includes(run.status)))continue;
   const progress=companyPeopleProgress(runs);
   if(!progress.settled)continue;
   await c.query(`UPDATE research_jobs SET config=jsonb_set(config,'{companyPeopleProgress}',$2::jsonb) WHERE id=$1`,[child.id,JSON.stringify({...progress,...(root.status==='cancelled'?{settlementReason:'cancelled'}:{})})]);updated++;
  }
  await c.query('COMMIT');return updated;
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}
