import {z} from 'zod';
type Actor={organizationId:string;userId:string};
type Client={query:(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>};
const uuid=z.string().uuid();
/** Bind an original persisted execution. Null is an explicit legacy identity,
 * never a request to adopt the most recently created execution. */
export async function bindAgentWorkflowContext(client:Client,actor:Actor,id:string|null,mandateId?:string){
 if(id!==null){
  uuid.parse(id);if(mandateId)uuid.parse(mandateId);
  const row=(await client.query(`SELECT id,organization_id,owner_user_id,mandate_id,preset FROM public.acquisition_workflow_executions
   WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND ($4::uuid IS NULL OR mandate_id=$4::uuid)`,[id,actor.organizationId,actor.userId,mandateId??null])).rows[0];
  if(!row||row.id!==id||row.organization_id!==actor.organizationId||row.owner_user_id!==actor.userId||(mandateId&&row.mandate_id!==mandateId))throw Error('Original workflow execution unavailable');
 }
 await client.query("SELECT set_config('app.acquire_workflow_version','1',true),set_config('app.acquire_workflow_execution',$1,true)",[id??'']);
}
/** Used only for a new user command with no original effect identity. Reads
 * current owned execution; database triggers still fence every later write. */
export async function resolveAgentWorkflowContext(client:Client,actor:Actor,mandateId:string):Promise<string|null>{
 const installed=(await client.query("SELECT to_regclass('public.acquisition_workflow_executions') IS NOT NULL AS installed")).rows[0]?.installed===true;
 if(!installed)return null;
 const row=(await client.query(`SELECT id FROM public.acquisition_workflow_executions WHERE mandate_id=$1 AND organization_id=$2 AND owner_user_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1`,[uuid.parse(mandateId),actor.organizationId,actor.userId])).rows[0];
 const id=row?uuid.parse(row.id):null;await bindAgentWorkflowContext(client,actor,id,mandateId);return id;
}
