import {z} from 'zod';
import type {Pool} from 'pg';
import {briefSchema,briefToMandate} from '@/domain/acquisition';
import {agentActorSchema,agentRecordDigest,type AgentActor} from '@/db/agent-store';
export const nativeMandateCreateSchema=z.object({requestId:z.string().uuid(),brief:briefSchema}).strict();
export class NativeMandateCreateError extends Error{constructor(message:string,readonly status:number){super(message);}}
/** Idempotency lives in an existing immutable audit receipt. Its original row
 * revision is deliberately returned even if another human later edits the brief. */
export async function createNativeAgentMandate(pool:Pool,rawActor:AgentActor,raw:unknown){
 const actor=agentActorSchema.parse(rawActor),input=nativeMandateCreateSchema.parse(raw),inputDigest=agentRecordDigest(input),c=await pool.connect();
 try{
  await c.query('BEGIN');
  // Creating a mandate is a policy write: take the policy writer fence before
  // its shared send gate, avoiding a shared-to-exclusive lock upgrade.
  await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');
  await c.query('SELECT communications_lock_send_gate($1)',[actor.organizationId]);
  const membership=(await c.query('SELECT id FROM member WHERE organization_id=$1 AND user_id=$2 FOR SHARE',[actor.organizationId,actor.userId])).rows[0];
  if(!membership)throw new NativeMandateCreateError('Current organisation membership required.',403);
  // Serialises the improbable cross-tenant UUID collision as well as retries.
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['native-mandate-create:'+input.requestId]);
  const receipt=(await c.query('SELECT * FROM audit_events WHERE id=$1 FOR SHARE',[input.requestId])).rows[0];
  if(receipt){
   const owned=(await c.query('SELECT id,created_by FROM mandates WHERE id=$1 AND organization_id=$2 FOR SHARE',[input.requestId,actor.organizationId])).rows[0];
   if(receipt.organization_id!==actor.organizationId||receipt.actor_id!==actor.userId||receipt.action!=='agent.mandate_created'||receipt.entity_type!=='mandate'||receipt.entity_id!==input.requestId||receipt.metadata?.inputDigest!==inputDigest||owned?.created_by!==actor.userId||!/^\d{1,30}$/.test(receipt.metadata?.creationRevision??''))throw new NativeMandateCreateError('This creation request conflicts with a saved request. Review the saved mandate.',409);
   await c.query('COMMIT');return {id:input.requestId,revision:String(receipt.metadata.creationRevision),replayed:true};
  }
  if((await c.query('SELECT id FROM mandates WHERE id=$1',[input.requestId])).rowCount)throw new NativeMandateCreateError('This creation request conflicts with a saved request. Review the saved mandate.',409);
  const b=input.brief,row=(await c.query(`INSERT INTO mandates(id,organization_id,natural_language,filters,confirmation,provenance,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,xmin::text AS revision`,[input.requestId,actor.organizationId,b.naturalLanguage,JSON.stringify({...briefToMandate(b),brief:b}),b.name,JSON.stringify({source:'Reviewed native agent brief',inputDigest}),actor.userId])).rows[0];
  await c.query("INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES($1::uuid,$2,$3,'agent.mandate_created','mandate',$1::text,$4)",[input.requestId,actor.organizationId,actor.userId,JSON.stringify({inputDigest,creationRevision:row.revision})]);
  await c.query('COMMIT');return {id:row.id as string,revision:row.revision as string,replayed:false};
 }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
}
