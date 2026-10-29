/** Only persisted source identity is needed; no execution fence is inferred here. */
type WorkflowSource = {kind:'agent';operationId:string}|{kind:'campaign';attemptId:string;enrolmentId:string}|{kind:'draft';messageId:string};
type Transaction={query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[]}>};
/** Bind only the persisted original effect. No ambient execution, latest mandate
 * lookup, request argument or simulator mode can substitute another workflow. */
export async function bindCommunicationsWorkflowContext(tx:Transaction,actor:{organizationId:string;userId:string},source:WorkflowSource){
 const installed=(await tx.query("SELECT to_regclass('public.acquisition_workflow_executions') IS NOT NULL AS installed")).rows;
 if(installed.length!==1||typeof installed[0].installed!=='boolean')throw Error('Workflow schema unavailable');
 let execution='';
 if(installed[0].installed){
  const sourceId=source.kind==='agent'?source.operationId:source.kind==='campaign'?source.attemptId:source.messageId;
  const rows=(await tx.query('SELECT public.communications_original_workflow($1::text,$2::uuid,$3::uuid) AS execution_id',[source.kind,sourceId,source.kind==='campaign'?source.enrolmentId:null])).rows;
  if(rows.length!==1||rows[0].execution_id!==null&&(typeof rows[0].execution_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(rows[0].execution_id as string)))throw Error('Original workflow scope unavailable');
  execution=rows[0].execution_id as string|null??'';
 }
 await tx.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true),set_config('app.acquire_workflow_version','1',true),set_config('app.acquire_workflow_execution',$3,true)",[actor.organizationId,actor.userId,execution]);
}
