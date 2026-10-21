import {it,expect,vi,afterAll} from 'vitest';import{Pool}from'pg';import{randomUUID}from'node:crypto';
vi.mock('server-only',()=>({}));
import{createAcquireSendAdmission}from'@/lib/campaign-send-admission';
import{JournalCodec}from'../../communications/packages/core/src/journal-codec';
import type{SqlClient,SqlResult}from'../../communications/packages/storage-postgres/src/webhook-repository';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});afterAll(()=>pool.end());
it.runIf(process.env.RUN_AGENT_EXECUTION_LOCAL_INTEGRATION==='true')('composes native SQL microsecond timestamp through source parsing and intent preparation/replay',async()=>{
 expect((await pool.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
 const binding={applicationId:'acquire',tenantId:'synthetic-time-org',ownerId:'synthetic-time-owner',connectionId:'synthetic-time-connection',accountId:'synthetic-time-account',generation:1,channel:'email',platform:'gmail',backend:'unipile'}as const;
 const source={kind:'agent',operationId:randomUUID(),conversationId:randomUUID(),epoch:1,fence:'1'}as const,contact=randomUUID(),bindingId=randomUUID(),requiredSince=(await pool.query(`SELECT to_char('1970-01-01T00:00:00Z'::timestamptz AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value`)).rows[0].value;
 expect(requiredSince).toBe('1970-01-01T00:00:00.000000Z');
 let intent:Record<string,unknown>|undefined;
 // Authority is scripted; only date serialization/pg timestamptz roundtrip is
 // the real PG boundary. This never admits a live operation or writes app rows.
 const query=async(sql:string,values:unknown[]=[]):Promise<SqlResult>=>{
  if(sql.includes('pg_roles'))return{rows:[{role_name:'acquire_campaign_user',rolsuper:false,rolbypassrls:false}]};
  if(sql.includes('to_regprocedure'))return{rows:[{installed:true}]};
  if(sql.includes('communications_lock_send_gate'))return{rows:[{revision:'1'}]};
  if(sql.includes('communications_lock_send_member'))return{rows:[{allowed:true}]};
  if(sql.includes('communication_bindings'))return{rows:[{id:bindingId,application_id:'acquire',organization_id:binding.tenantId,owner_user_id:binding.ownerId,service_connection_id:binding.connectionId,service_account_id:binding.accountId,generation:1,channel:'email',platform:'gmail',backend:'unipile',authority:'service'}]};
  if(sql.includes('agent_communications_source_kind'))return{rows:[{kind:'legacy_email'}]};
  if(sql.includes('agent_communications_source'))return{rows:[{source:{contactId:contact,recipient:'synthetic@example.invalid',subject:'Synthetic',body:'Synthetic',contextDigest:'a'.repeat(64),requiredSince,replyParent:null}}]};
  if(sql.startsWith('INSERT INTO public.communication_dispatch_intents')){const timestamp=(await pool.query('SELECT $1::timestamptz AS value',[values[15]])).rows[0].value;intent={id:values[0],organization_id:binding.tenantId,owner_user_id:binding.ownerId,binding_id:bindingId,source_kind:values[4],source_id:values[5],epoch:values[6],operation_key:values[8],operation:values[9],payload_digest:values[10],intent_digest:values[11],encrypted_intent:values[12],intent_key_version:values[13],source_digest:values[14],required_since:timestamp,coverage_scopes:values[16],contact_id:contact};return{rows:[intent]};}
  if(sql.includes('FROM public.communication_dispatch_intents'))return{rows:intent?[intent]:[]};
  return{rows:[]};
 };
 const repo=createAcquireSendAdmission({pool:{connect:async()=>({query,release(){}}as SqlClient)},binding,bindingId,codec:new JournalCodec({activeVersion:'synthetic-time',keys:[{version:'synthetic-time',encryptionKey:Buffer.alloc(32,91),digestKey:Buffer.alloc(32,92)}]}),verifyServiceAdmission:async()=>false});
 const prepared=await repo.prepare({source,message:{recipient:{kind:'email',value:'synthetic@example.invalid'},subject:'Synthetic',text:'Synthetic'},coverageScopes:[{bindingId,scopeDigest:'b'.repeat(64)}]});
 expect(prepared.epoch).toBe(1);expect(await repo.getPreparedIntent({sourceKind:'agent',sourceId:source.operationId})).toEqual(prepared);
});
