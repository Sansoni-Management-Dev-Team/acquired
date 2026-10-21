import{randomUUID}from'node:crypto';import type{Pool,PoolClient}from'pg';import{z}from'zod';
import type{AgentBusinessTimeScope}from'../../src/lib/agent-business-time';import{briefSchema}from'../../src/domain/acquisition';import{createNativeAgentMandate}from'../../src/lib/agent-native-create';
const uuid=z.string().uuid();
export function validateCompletionDatabase(databaseUrl:string){let u:URL;try{u=new URL(databaseUrl);}catch{throw Error('Exact completion database required');}if(!['postgres:','postgresql:'].includes(u.protocol)||u.hostname!=='127.0.0.1'||u.port!=='5437'||u.pathname!=='/acquire_agent_mode'||u.username!=='project_acquire'||u.search||u.hash)throw Error('Exact completion database required');}
/** Insert-only fresh synthetic identity and trusted local run registration.
 * The mandate is created by the existing audited domain command; this helper
 * grants no review, budget, conversation, outcome or sending authority. */
export async function bootstrapCompletionIdentity(input:{pool:Pool;databaseUrl:string;scope:AgentBusinessTimeScope;runtimeId:string;mandateId:string;brief:unknown}){
 validateCompletionDatabase(input.databaseUrl);const scope={runId:z.string().regex(/^agent-deep-[a-z0-9][a-z0-9-]{0,36}$/).parse(input.scope.runId),organizationId:uuid.parse(input.scope.organizationId),userId:uuid.parse(input.scope.userId)},mandateId=uuid.parse(input.mandateId),brief=briefSchema.parse(input.brief);
 if(input.runtimeId!==scope.runId)throw Error('Completion runtime scope differs');
 async function transaction(work:(c:PoolClient)=>Promise<void>){const c=await input.pool.connect();let begun=false;
  try{
   const identity=(await c.query("SELECT current_database() database,shobj_description(d.oid,'pg_database') marker,(SELECT system_identifier::text FROM pg_control_system()) system,session_user login FROM pg_database d WHERE d.datname=current_database()")).rows[0];
   if(identity?.database!=='acquire_agent_mode'||identity?.marker!=='acquire-agent-mode-local-only'||identity?.system!=='7697400069962248225'||identity?.login!=='project_acquire')throw Error('Completion database identity differs');
   await c.query('BEGIN');begun=true;await work(c);await c.query('COMMIT');begun=false;
  }catch(error){if(begun)await c.query('ROLLBACK');throw error;}finally{c.release();}
 }
 await transaction(async c=>{
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$2,$3)',[scope.userId,'Synthetic local agent testing owner',scope.userId+'@'+scope.runId+'.acquire.test']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$2,$3)',[scope.organizationId,'Synthetic '+scope.runId,scope.runId]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),scope.organizationId,scope.userId]);
 });
 const created=await createNativeAgentMandate(input.pool,{organizationId:scope.organizationId,userId:scope.userId},{requestId:mandateId,brief,executionMode:'real'});
 if(created.replayed||created.id!==mandateId)throw Error('Fresh completion mandate required');
 await transaction(async c=>{await c.query('INSERT INTO local_simulator_business_runs(run_id,organization_id,owner_user_id,runtime_id) VALUES($1,$2,$3,$4)',[scope.runId,scope.organizationId,scope.userId,input.runtimeId]);});
 return{scope,runtimeId:input.runtimeId,mandateId,mandateRevision:created.revision};
}
