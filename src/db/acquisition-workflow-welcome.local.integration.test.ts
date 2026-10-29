import {it,expect} from 'vitest';
import pg,{type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {agentDatabaseConfig,assertAgentDatabaseIdentity} from '../../scripts/agent-mode-local-database.mjs';
import {AcquisitionWorkflowStore} from '@/db/acquisition-workflow-store';
import {AgentStore} from '@/db/agent-store';
import {emptyBrief} from '@/domain/acquisition';
import {savedAgentMessages} from '@/lib/agent-saved-messages';
// Real SQL/roles/constraints, with command transactions mapped to savepoints in
// an outer rollback. No synthetic execution is ever committed for a worker.
it.runIf(process.env.RUN_AGENT_LOCAL_INTEGRATION==='true')('uses the existing isolated schema and restricted role for atomic welcome persistence and rollback, then removes all synthetic rows',async()=>{
 const pool=new pg.Pool({connectionString:agentDatabaseConfig().url,max:1,connectionTimeoutMillis:3000});
 const c=await pool.connect(),org=randomUUID(),owner=randomUUID(),id=randomUUID(),failedId=randomUUID();
 let savepoint=0,inject=false;const scopes:Array<Record<string,unknown>>=[];
 const wrapped={connect:async()=>{
  const name=`welcome_command_${++savepoint}`;
  return{release:()=>{},query:async(sql:string,values?:unknown[])=>{
   if(sql.startsWith('BEGIN'))return c.query(`SAVEPOINT ${name}`);
   if(sql==='COMMIT'){const result=await c.query(`RELEASE SAVEPOINT ${name}`);await c.query('RESET ROLE');return result;}
   if(sql==='ROLLBACK'){await c.query(`ROLLBACK TO SAVEPOINT ${name}`);const result=await c.query(`RELEASE SAVEPOINT ${name}`);await c.query('RESET ROLE');return result;}
   if(sql.includes('INSERT INTO agent_messages')){
    scopes.push((await c.query("SELECT current_user AS role,current_setting('app.acquire_workflow_execution',true) AS execution,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0]);
    if(inject)throw Error('Synthetic append failure');
   }
   return c.query(sql,values);
  }} as unknown as PoolClient;
 }};
 const actor={organizationId:org,userId:owner};
 const description='Commercial laundry companies in Queensland.';
 const input={requestId:id,preset:'live-research-test' as const,presentation:'agent' as const,brief:{...emptyBrief(),naturalLanguage:description}};
 let evidence:Record<string,unknown>={};
 try{
  const identity=(await c.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0];assertAgentDatabaseIdentity(identity);
  await c.query('BEGIN');await c.query("SET LOCAL statement_timeout='8s';SET LOCAL lock_timeout='2s';SET LOCAL idle_in_transaction_session_timeout='30s'");
  // Fixture identity rows only; restore ordinary triggers before exercising admission.
  await c.query("SET LOCAL session_replication_role='replica'");
  await c.query('INSERT INTO "user"(id,name,email) VALUES($1,$1,$2)',[owner,owner+'@example.invalid']);
  await c.query('INSERT INTO organization(id,name,slug) VALUES($1,$1,$1)',[org]);
  await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),org,owner]);
  await c.query("SET LOCAL session_replication_role='origin'");
  const first=await new AcquisitionWorkflowStore(wrapped,actor).start(input);expect(first.replayed).toBe(false);
  const replay=await new AcquisitionWorkflowStore(wrapped,actor).start(input);expect(replay.replayed).toBe(true);
  const savedStore=new AgentStore(wrapped,actor,{workflowExecutionId:id});
  const thread=await savedStore.findThread(id);expect(thread).toBeDefined();
  const messages=await savedStore.messages(thread!.id),visible=savedAgentMessages(messages);
  expect(visible).toHaveLength(1);expect(visible[0]).toMatchObject({role:'assistant',noticeKind:'welcome'});expect(visible[0].content).toContain(description);
  const count=(await c.query('SELECT count(*)::int AS n FROM agent_messages WHERE organization_id=$1',[org])).rows[0].n;expect(count).toBe(1);
  expect(scopes[0]).toEqual({role:'acquire_agent_user',execution:id,rolsuper:false,rolbypassrls:false});
  inject=true;
  await expect(new AcquisitionWorkflowStore(wrapped,actor).start({...input,requestId:failedId})).rejects.toThrow('Synthetic append failure');
  const rollbackCounts=(await c.query(`SELECT (SELECT count(*)::int FROM mandates WHERE id=$1) AS mandates,(SELECT count(*)::int FROM acquisition_workflow_executions WHERE id=$1) AS executions,(SELECT count(*)::int FROM agent_threads WHERE mandate_id=$1) AS threads,(SELECT count(*)::int FROM agent_messages WHERE mandate_id=$1) AS messages`,[failedId])).rows[0];
  expect(rollbackCounts).toEqual({mandates:0,executions:0,threads:0,messages:0});
  const authority=(await c.query(`SELECT (SELECT count(*)::int FROM research_jobs WHERE organization_id=$1) AS research_jobs,(SELECT count(*)::int FROM agent_events WHERE organization_id=$1) AS events,(SELECT count(*)::int FROM agent_responsibilities WHERE organization_id=$1) AS responsibilities`,[org])).rows[0];
  expect(authority).toEqual({research_jobs:0,events:0,responsibilities:0});
  evidence={isolatedIdentityVerified:true,existingSchema:true,restrictedRoleVerified:true,originalExecutionBound:true,persistedMessages:count,replayDuplicateMessages:0,visibleWelcome:true,appendFailureRollback:rollbackCounts,noExecutionWorkCreated:authority,outerRollbackOnly:true,noMigrations:true};
 }finally{
  await c.query('ROLLBACK');
  const cleanup=(await c.query('SELECT count(*)::int AS n FROM organization WHERE id=$1',[org])).rows[0].n;
  evidence={...evidence,syntheticOrganizationRowsAfterRollback:cleanup};
  mkdirSync('.local-data/agent-welcome-schema',{recursive:true,mode:0o700});
  writeFileSync('.local-data/agent-welcome-schema/evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
  c.release();await pool.end();
 }
},30000);
