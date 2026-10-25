import type {Pool,PoolClient} from 'pg';
import {agentActorSchema,type AgentActor} from './agent-store';
import {briefToMandate} from '@/domain/acquisition';
import {acquisitionWorkflowStartSchema,type AcquisitionWorkflowExecution,type AcquisitionWorkflowStart,type AcquisitionWorkflowState} from '@/domain/acquisition-workflow';
import {agentRecordDigest} from '@/lib/agent-record-digest';
import {selectWorkflowDemoSource,type WorkflowDemoSource} from '@/lib/workflow-demo-source';
import {z} from 'zod';

function execution(row:Record<string,unknown>):AcquisitionWorkflowExecution{
 return {id:String(row.id),mandateId:String(row.mandate_id),organizationId:String(row.organization_id),ownerUserId:String(row.owner_user_id),preset:row.preset as AcquisitionWorkflowExecution['preset'],presentation:row.presentation as AcquisitionWorkflowExecution['presentation'],state:row.state as AcquisitionWorkflowState,revision:Number(row.revision),errorCode:row.error_code as string|null};
}
/** A short database-only command. Never hold this connection while invoking a provider. */
export class AcquisitionWorkflowStore{
 private actor:AgentActor;
 constructor(private pool:Pick<Pool,'connect'>,actor:AgentActor){this.actor=agentActorSchema.parse(actor);}
 private async transaction<T>(write:boolean,work:(c:PoolClient)=>Promise<T>){
  const c=await this.pool.connect();
  try{
   await c.query(write?'BEGIN':'BEGIN READ ONLY');
   await c.query("SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='10s'");
   await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true),set_config('app.acquire_workflow_version','1',true)",[this.actor.organizationId,this.actor.userId]);
   const result=await work(c);await c.query('COMMIT');return result;
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async start(raw:AcquisitionWorkflowStart):Promise<AcquisitionWorkflowExecution>{
  const input=acquisitionWorkflowStartSchema.parse(raw);
  return this.transaction(true,async c=>{
   let mandateId=input.mandateId??null;
   let expectedMandateRevision=input.expectedMandateRevision??null;
   if(input.preset==='demo'){
    const inputDigest=agentRecordDigest(input),conflict=()=>Object.assign(new Error('This request conflicts with a saved demo source.'),{code:'23505'});
    const load=async()=>({existing:(await c.query('SELECT /* workflow-demo-existing */ id,organization_id,owner_user_id,mandate_id,preset,presentation FROM acquisition_workflow_executions WHERE id=$1',[input.requestId])).rows[0],receipt:(await c.query('SELECT /* workflow-demo-source-receipt */ organization_id,actor_id,action,entity_type,entity_id,metadata FROM audit_events WHERE id=$1',[input.requestId])).rows[0]});
    const savedSource=(saved:Awaited<ReturnType<typeof load>>):WorkflowDemoSource|null|undefined=>{
     const {existing,receipt}=saved;
     if(existing&&(existing.organization_id!==this.actor.organizationId||existing.owner_user_id!==this.actor.userId||existing.preset!==input.preset||existing.presentation!==input.presentation))throw conflict();
     if(!receipt)return existing?null:undefined; // Legacy SQL chose the source with null input args.
     const parsed=z.object({inputDigest:z.literal(inputDigest),mandateId:z.string().uuid(),mandateRevision:z.string().regex(/^\d{1,30}$/)}).strict().safeParse(receipt.metadata);
     if(receipt.organization_id!==this.actor.organizationId||receipt.actor_id!==this.actor.userId||receipt.action!=='workflow.demo_source_selected'||receipt.entity_type!=='acquisition_workflow'||receipt.entity_id!==input.requestId||!parsed.success||existing&&existing.mandate_id!==parsed.data.mandateId)throw conflict();
     return {mandateId:parsed.data.mandateId,mandateRevision:parsed.data.mandateRevision};
    };
    const previous=savedSource(await load());
    // This bounded read may reject unusable sources; it never holds the shared
    // policy fence or creates source records, contacts, research or authority.
    const hint=previous===undefined?await selectWorkflowDemoSource(c,this.actor):previous;
    await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');
    await c.query('SELECT public.communications_lock_send_gate($1)',[this.actor.organizationId]);
    if(!(await c.query('SELECT id FROM member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[this.actor.organizationId,this.actor.userId])).rowCount)throw Object.assign(new Error('Current organisation membership required.'),{code:'42501'});
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['acquisition-workflow-request:'+input.requestId]);
    let selected=savedSource(await load());
    if(selected===undefined){
     if(hint===undefined)throw Object.assign(new Error('No unused saved research has a usable contact.'),{code:'02000'});
     if(!hint)throw Object.assign(new Error('Saved demo request changed.'),{code:'40001'});
     selected=hint;
     await c.query("INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES($1::uuid,$2,$3,'workflow.demo_source_selected','acquisition_workflow',$1::text,$4)",[input.requestId,this.actor.organizationId,this.actor.userId,JSON.stringify({inputDigest,...selected})]);
    }
    // Original source/revision are part of the SQL kernel's input digest. A
    // replay never substitutes current xmin or reselects after a stale CAS.
    mandateId=selected?.mandateId??null;expectedMandateRevision=selected?.mandateRevision??null;
   }
   if(input.brief){
    // Creation and admission commit together. UUID replay cannot orphan or clone a mandate.
    await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');
    await c.query('SELECT public.communications_lock_send_gate($1)',[this.actor.organizationId]);
    const member=await c.query('SELECT id FROM member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[this.actor.organizationId,this.actor.userId]);
    if(!member.rowCount)throw Object.assign(new Error('Current organisation membership required.'),{code:'42501'});
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['acquisition-workflow-request:'+input.requestId]);
    const digest=agentRecordDigest(input);
    const receipt=(await c.query('SELECT organization_id,actor_id,action,entity_id,metadata FROM audit_events WHERE id=$1',[input.requestId])).rows[0];
    if(receipt){
     if(receipt.organization_id!==this.actor.organizationId||receipt.actor_id!==this.actor.userId||receipt.action!=='workflow.mandate_created'||receipt.entity_id!==input.requestId||receipt.metadata?.inputDigest!==digest)throw Object.assign(new Error('This request conflicts with a saved workflow.'),{code:'23505'});
    }else{
     const b=input.brief;
     await c.query(`INSERT INTO mandates(id,organization_id,created_by,natural_language,filters,confirmation,provenance)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[input.requestId,this.actor.organizationId,this.actor.userId,b.naturalLanguage,JSON.stringify({...briefToMandate(b),brief:b}),b.name,JSON.stringify({source:'Shared acquisition workflow',inputDigest:digest})]);
     await c.query("INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES($1::uuid,$2,$3,'workflow.mandate_created','mandate',$1::text,$4)",[input.requestId,this.actor.organizationId,this.actor.userId,JSON.stringify({inputDigest:digest})]);
    }
    mandateId=input.requestId;
   }
   await c.query('SET LOCAL ROLE acquire_agent_user');
   const previous=(await c.query('SELECT id FROM acquisition_workflow_executions WHERE id=$1',[input.requestId])).rows[0];
   const row=(await c.query('SELECT * FROM public.acquisition_workflow_start($1,$2,$3,$4,$5)',[input.requestId,input.preset,input.presentation,mandateId,expectedMandateRevision])).rows[0];
   return {...execution(row),replayed:Boolean(previous)};
  });
 }
 async read(id:string):Promise<AcquisitionWorkflowExecution|null>{
  return this.transaction(false,async c=>{
   await c.query('SET LOCAL ROLE acquire_agent_user');
   const row=(await c.query('SELECT * FROM acquisition_workflow_executions WHERE id=$1::uuid',[id])).rows[0];
   return row?execution(row):null;
  });
 }
 async transition(id:string,revision:number,state:AcquisitionWorkflowState,errorCode?:string):Promise<AcquisitionWorkflowExecution>{
  return this.transaction(true,async c=>{
   await c.query('SET LOCAL ROLE acquire_agent_user');
   const row=(await c.query('SELECT * FROM public.acquisition_workflow_transition($1,$2,$3,$4)',[id,revision,state,errorCode??null])).rows[0];
   return execution(row);
  });
 }
}
