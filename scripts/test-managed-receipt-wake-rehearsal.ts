import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {queueAgentReceiptAssociation} from '../src/lib/agent-communications-receipt-wake';
const pool=new Pool({host:'127.0.0.1',port:5432,user:'postgres',database:'acquire_hosted_demo_rehearsal',max:1});
async function main(){const c=await pool.connect();try{
 await c.query("BEGIN;SET LOCAL statement_timeout='10s';SET LOCAL lock_timeout='2s'");
 const identity=(await c.query("SELECT current_database() db,shobj_description(oid,'pg_database') marker,(SELECT system_identifier::text FROM pg_control_system()) system FROM pg_database WHERE datname=current_database()")).rows[0];assert.deepEqual(identity,{db:'acquire_hosted_demo_rehearsal',marker:'acquire-hosted-demo-rehearsal-only',system:'7699248227334438947'});
 const r=(await c.query("SELECT r.*,v.contact_id,v.workflow_execution_id,b.application_id,b.service_connection_id,b.service_account_id,b.generation,b.platform,b.backend FROM agent_conversation_channels r JOIN agent_conversations v ON v.id=r.conversation_id JOIN communication_bindings b ON b.id=r.binding_id WHERE r.channel='email' AND v.workflow_execution_id IS NOT NULL ORDER BY v.created_at DESC LIMIT 1")).rows[0];assert.ok(r);
 const op=randomUUID(),intent=randomUUID(),key='acquire:agent:'+op+':1',payload='a'.repeat(64),evidence='e'.repeat(64);
 // Synthetic historical ledger only, rolled back. Never a sealed submission or
 // provider receipt. Restore all triggers before testing the real application path.
 await c.query("SET LOCAL session_replication_role='replica'");
 await c.query("INSERT INTO member(id,organization_id,user_id,role) VALUES($1,$2,$3,'member') ON CONFLICT DO NOTHING",[randomUUID(),r.organization_id,r.owner_user_id]);
 await c.query("INSERT INTO agent_operations(id,thread_id,organization_id,mandate_id,owner_user_id,request_key,name,input,input_digest,state,conversation_id,workflow_execution_id) VALUES($1::uuid,$2,$3,$4,$5,$1::text,'email.initial',$6,$7,'uncertain',$8,$9)",[op,r.thread_id,r.organization_id,r.mandate_id,r.owner_user_id,JSON.stringify({routeId:r.id,bindingDigest:r.binding_digest}),payload,r.conversation_id,r.workflow_execution_id]);
 await c.query("INSERT INTO communication_dispatch_intents(id,organization_id,owner_user_id,binding_id,source_kind,source_id,epoch,contact_id,operation_key,operation,payload_digest,intent_digest,encrypted_intent,intent_key_version,source_digest,required_since,coverage_scopes) VALUES($1,$2,$3,$4,'agent',$5,1,$6,$7,'message',$8,$8,'synthetic-ledger-only','fixture',$8,'1970-01-01','[{}]')",[intent,r.organization_id,r.owner_user_id,r.binding_id,op,r.contact_id,key,payload]);
 await c.query("SET LOCAL session_replication_role='origin';SET LOCAL ROLE acquire_campaign_user");
 await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true),set_config('app.acquire_workflow_version','',true),set_config('app.acquire_workflow_execution','',true)",[r.organization_id,r.owner_user_id]);await c.query('SELECT communications_lock_send_gate($1)',[r.organization_id]);
 await c.query('SAVEPOINT red');await assert.rejects(c.query('SELECT agent_communications_receipt_wake($1,$2,$3,$4,$5)',[r.binding_id,op,key,payload,evidence]),/Explicit workflow-capable writer required/);await c.query('ROLLBACK TO SAVEPOINT red');
 const proof={snapshot:{binding:{applicationId:r.application_id,tenantId:r.organization_id,ownerId:r.owner_user_id,connectionId:r.service_connection_id,accountId:r.service_account_id,generation:r.generation,channel:'email' as const,platform:r.platform,backend:r.backend},key,operation:'message' as const,payloadDigest:payload},evidenceDigest:evidence};
 assert.equal(await queueAgentReceiptAssociation(c,r.binding_id,proof),1);assert.equal(await queueAgentReceiptAssociation(c,r.binding_id,proof),0);
 await c.query('RESET ROLE');const saved=(await c.query("SELECT workflow_execution_id,kind,state,attempts,payload FROM agent_events WHERE thread_id=$1 AND event_key=$2",[r.thread_id,'provider-association:'+intent])).rows;assert.deepEqual(saved,[{workflow_execution_id:r.workflow_execution_id,kind:'email.reconcile',state:'pending',attempts:0,payload:{operationId:op,intentId:intent,associationEvidenceDigest:evidence}}]);
 assert.equal((await c.query('SELECT count(*)::int n FROM agent_authority_uses WHERE operation_id=$1',[op])).rows[0].n,0);assert.equal((await c.query('SELECT count(*)::int n FROM agent_budget_reservations WHERE operation_id=$1',[op])).rows[0].n,0);
 console.log(JSON.stringify({managedEmailWake:true,redMissingContext:true,greenOriginalExecution:true,replayed:0,events:1,newSendAuthority:false,transaction:'rollback-only'}));
 }finally{await c.query('ROLLBACK');c.release();await pool.end();}}
main().catch(error=>{console.error({code:error.code,message:error.message});process.exitCode=1;});
