import type {Pool} from 'pg';
import {resumeAcquisitionWorkflow} from './acquisition-workflow';
import {backgroundRemaining} from './background-workload';
/** Runs inside the existing scheduled pass; no additional queue or timer.
 * Round-robin selection prevents one temporarily unavailable provider starving
 * accepted requests after a response/after() callback was lost. */
export async function recoverAcquisitionWorkflows(pool:Pool,now=Date.now(),resume=resumeAcquisitionWorkflow){
 if(process.env.ACQUISITION_WORKFLOW_ENABLED!=='true'&&process.env.ACQUISITION_WORKFLOW_SCHEMA_READY!=='true')return 0;
 const rows=(await pool.query(`WITH pending AS (
 SELECT w.id,w.organization_id,w.owner_user_id,row_number() OVER(ORDER BY w.created_at,w.id)-1 AS position,count(*) OVER() AS total
 FROM acquisition_workflow_executions w JOIN member m ON m.organization_id=w.organization_id AND m.user_id=w.owner_user_id
 WHERE w.state IN('accepted','researching'))
 SELECT id,organization_id,owner_user_id FROM pending
 ORDER BY (position-($1::bigint%total)+total)%total LIMIT 2`,[Math.floor(now/60000)])).rows;
 let recovered=0;
 for(const row of rows){
  if(backgroundRemaining()<1000)break;
  try{await resume(pool,{organizationId:row.organization_id,userId:row.owner_user_id},row.id);recovered++;}
  catch{console.info('workflow-recovery-deferred');}
 }
 return recovered;
}
