import{randomUUID}from'node:crypto';import type{Pool}from'pg';import{z}from'zod';
import type{AgentBusinessTimeScope}from'../../src/lib/agent-business-time';import{buyerProfileSchema,metadataWithBuyerProfile,organizationMetadata}from'../../src/domain/buyer-profile';import{validateCompletionDatabase}from'./fixture';
/** Local source fixture only: normal Settings profile schema/metadata/audit,
 * restricted to its registered synthetic actor and a previously absent profile.
 * No review, delegation, send, receipt, operation or budget authority is created. */
export async function saveCompletionBuyerProfile(input:{pool:Pick<Pool,'connect'>;databaseUrl:string;scope:AgentBusinessTimeScope;runtimeId:string;mandateId:string;profile:unknown}){
 validateCompletionDatabase(input.databaseUrl);const scope=z.object({runId:z.string().regex(/^agent-deep-[a-z0-9][a-z0-9-]{0,36}$/),organizationId:z.string().uuid(),userId:z.string().uuid()}).strict().parse(input.scope),mandateId=z.string().uuid().parse(input.mandateId),profile=buyerProfileSchema.strict().parse(input.profile);
 if(input.runtimeId!==scope.runId)throw Error('Completion runtime scope differs');if(profile.publicProfileApproved!==true)throw Error('Explicit public source profile approval required');
 const c=await input.pool.connect();let begun=false;
 try{
  await c.query('BEGIN');begun=true;const identity=(await c.query("SELECT current_database() database,shobj_description(d.oid,'pg_database') marker,(SELECT system_identifier::text FROM pg_control_system()) system,session_user login FROM pg_database d WHERE d.datname=current_database()")).rows[0];
  if(identity?.database!=='acquire_agent_mode'||identity?.marker!=='acquire-agent-mode-local-only'||identity?.system!=='7697400069962248225'||identity?.login!=='project_acquire')throw Error('Completion database identity differs');
  // Same established policy-writer-before-organisation-gate ordering as normal
  // audited mandate creation. All installed row/statement triggers remain live.
  await c.query('SELECT pg_advisory_xact_lock(7426619361492031::bigint)');await c.query('SELECT communications_lock_send_gate($1)',[scope.organizationId]);
  const rows=await c.query("SELECT o.metadata FROM organization o JOIN member m ON m.organization_id=o.id AND m.user_id=$2 AND m.role IN('owner','admin') JOIN local_simulator_business_runs b ON b.organization_id=o.id AND b.owner_user_id=m.user_id AND b.run_id=$3 AND b.runtime_id=$3 AND b.enabled JOIN mandates n ON n.organization_id=o.id AND n.created_by=m.user_id AND n.id=$4 WHERE o.id=$1 FOR UPDATE OF o FOR SHARE OF m,b,n",[scope.organizationId,scope.userId,scope.runId,mandateId]);
  if(rows.rows.length!==1)throw Error('Exact registered completion owner required');const metadata=rows.rows[0].metadata as string|null;
  if(metadata!==null){let raw:unknown;try{raw=JSON.parse(metadata);}catch{throw Error('Completion metadata unavailable');}if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Completion metadata unavailable');}
  if(Object.hasOwn(organizationMetadata(metadata),'buyerProfile'))throw Error('Completion buyer profile already exists');
  const blocked=await c.query("SELECT EXISTS(SELECT 1 FROM agent_operations WHERE organization_id=$1 AND name IN('email.initial','email.reply','email.follow_up','whatsapp.initial','whatsapp.reply','whatsapp.follow_up','linkedin.initial','linkedin.reply','linkedin.follow_up','linkedin.invitation') AND state IN('proposed','approved','running','uncertain')) AS blocked",[scope.organizationId]);
  if(blocked.rows.length!==1||blocked.rows[0].blocked!==false)throw Error('Original pending outbound authority must be resolved before source profile');
  const changed=await c.query('UPDATE organization SET metadata=$2 WHERE id=$1 AND metadata IS NOT DISTINCT FROM $3 RETURNING id',[scope.organizationId,metadataWithBuyerProfile(metadata,profile),metadata]);if(changed.rows.length!==1||changed.rows[0].id!==scope.organizationId)throw Error('Completion buyer profile changed');
  const storedFields=Object.keys(profile);await c.query("INSERT INTO audit_events(id,organization_id,actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,'outreach.buyer_profile_updated','organization',$2,$4)",[randomUUID(),scope.organizationId,scope.userId,JSON.stringify({storedFields})]);
  await c.query('COMMIT');begun=false;return{status:'saved',organizationId:scope.organizationId,storedFields};
 }catch(error){if(begun)await c.query('ROLLBACK');throw error;}finally{c.release();}
}
