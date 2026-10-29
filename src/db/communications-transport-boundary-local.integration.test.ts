import {writeFile} from 'node:fs/promises';
import {afterAll,expect,it} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {JournalCodec} from '../../communications/packages/core/src/journal-codec';
import {createPostgresDispatchJournal} from '../../communications/packages/storage-postgres/src/dispatch-journal';
// Explicit opt-in, installed schema only. Every synthetic row is rolled back.
const enabled=process.env.RUN_TRANSPORT_BOUNDARY_LOCAL_INTEGRATION==='true';
const pool=new Pool({connectionString:process.env.AGENT_LOCAL_DATABASE_URL??'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode'});
afterAll(()=>pool.end());
it.runIf(enabled)('enforces real restricted transport boundaries and authenticated no-write proof without modifying prior work',async()=>{
 const c=await pool.connect();try{
 expect((await c.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
 expect((await c.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id).toBe('7697400069962248225');
 expect((await c.query("SELECT to_regclass('communications.dispatch_transport_boundaries') IS NOT NULL AS ready")).rows[0].ready).toBe(true);
 await c.query('BEGIN');await c.query("SET LOCAL lock_timeout='2s'");await c.query("SET LOCAL statement_timeout='5s'");await c.query('SET LOCAL ROLE communications_control');
 const id=randomUUID(),b={applicationId:'transport-fixture-'+id,tenantId:id,ownerId:id,connectionId:'connection-'+id,accountId:'account-'+id,generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'} as const;
 const codec=new JournalCodec({activeVersion:'fixture',keys:[{version:'fixture',encryptionKey:Buffer.alloc(32,101),digestKey:Buffer.alloc(32,102)}]}),recipient={kind:'phone',value:'+15550001111'} as const;
 await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at)VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[b.applicationId,b.tenantId,b.ownerId]);
 await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at)VALUES($1,'whatsapp',$2,$3,'fixture',clock_timestamp())",[b.accountId,id,'a'.repeat(64)]);
 await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active)VALUES($1,$2,$3,$4,$5,'whatsapp','whatsapp','unipile',1,'connected',true)",[b.connectionId,b.applicationId,b.tenantId,b.ownerId,b.accountId]);
 await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities)VALUES($1,1,$2,$3,$4,$5,'whatsapp','whatsapp','unipile','fixture','v1','fixture','service','{}')",[b.connectionId,b.applicationId,b.tenantId,b.ownerId,b.accountId]);
 await c.query("INSERT INTO communications.account_leases(account_id,owner_token,fencing_token,expires_at)VALUES($1,'worker',1,clock_timestamp()+interval '1 hour')",[b.accountId]);
 const revision=(await c.query('SELECT communications.lock_reply_barrier($1,$2)::text AS revision',[b.applicationId,b.tenantId])).rows[0].revision;
 async function claim(){const key=randomUUID(),snapshot={binding:b,key,operation:'message',payloadDigest:'b'.repeat(64)} as const,context={recipient};await c.query("INSERT INTO communications.operation_journal(id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,claim_token,claim_until,fencing_token,lease_owner_token)VALUES($1,$2,$3,$4,$1,$5,1,$6,'message',$7,$8,'message-v1','fixture',$9,'fixture',$10,'claim',clock_timestamp()+interval '60 seconds',1,'worker')",[key,b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,snapshot.payloadDigest,'c'.repeat(64),JSON.stringify(codec.encode(snapshot,'context',context)),codec.digest(snapshot,'context',context)]);return{key,snapshot};}
 async function boundary(key:string){await c.query("INSERT INTO communications.dispatch_transport_boundaries(journal_id,application_id,tenant_id,owner_id,claim_token,fencing_token,lease_owner_token,state)VALUES($1,$2,$3,$4,'claim',1,'worker','prewrite')",[key,b.applicationId,b.tenantId,b.ownerId]);}
 async function admit(key:string){await c.query("INSERT INTO communications.dispatch_admissions(id,journal_id,application_id,tenant_id,owner_id,connection_id,generation,account_id,operation_key,payload_digest,permit_id,intent_digest,claim_token,fencing_token,lease_owner_token,service_revision)VALUES($1,$1,$2,$3,$4,$5,1,$6,$1,$7,$1,$7,'claim',1,'worker',$8)",[key,b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,'b'.repeat(64),revision]);await c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true WHERE id=$1",[key]);}
 async function denied(work:()=>Promise<unknown>){await c.query('SAVEPOINT negative');let rejected=false;try{await work();}catch{rejected=true;}await c.query('ROLLBACK TO SAVEPOINT negative');expect(rejected).toBe(true);}
 // A boundary alone cannot commit, including a subtransaction insertion.
 const incomplete=await claim();await c.query('SAVEPOINT initialization');await boundary(incomplete.key);await denied(()=>c.query('SET CONSTRAINTS communications.communications_transport_boundary_admission IMMEDIATE'));await c.query('ROLLBACK TO SAVEPOINT initialization');
 const original=await claim();await c.query('SAVEPOINT admission_subtransaction');await boundary(original.key);await admit(original.key);await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('RELEASE SAVEPOINT admission_subtransaction');await c.query('SET CONSTRAINTS ALL DEFERRED');
 await denied(()=>c.query('DELETE FROM communications.dispatch_transport_boundaries WHERE journal_id=$1',[original.key]));
 await denied(()=>c.query("UPDATE communications.operation_journal SET state='claimed',quota_reserved=false WHERE id=$1",[original.key]));
 const legacy=await claim();await admit(legacy.key);await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('SET CONSTRAINTS ALL DEFERRED');await denied(()=>boundary(legacy.key));
 // Real repository calls use savepoints so the entire synthetic scenario rolls back.
 let seq=0;const driver={connect:async()=>{const sp='repo_'+ ++seq;return{release(){},async query(sql:string,args?:unknown[]){if(sql==='BEGIN')return c.query('SAVEPOINT '+sp);if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT '+sp);if(sql==='ROLLBACK')return c.query('ROLLBACK TO SAVEPOINT '+sp);return c.query(sql,args);}};}};
 const repo=createPostgresDispatchJournal({pool:driver as never,binding:b,integrationId:'fixture',providerConfigurationReference:'fixture',providerApiVersion:'v1',authority:'service',leaseOwnerToken:'worker',codec,recipientDigest:{keyVersion:'fixture',digest:()=> 'c'.repeat(64)}}),record={snapshot:original.snapshot,recipient,state:'dispatching'} as const;
 await repo.complete({token:'claim',record,outcome:{status:'review',code:'protocol'},closeBeforeWrite:true});
 const proof=await repo.proveNoSubmission(original.snapshot);expect(proof).toMatchObject({journalId:original.key,outcome:{status:'review',code:'protocol'}});expect(await repo.proveNoSubmission(original.snapshot)).toEqual(proof);await expect(repo.startTransportWrite!({token:'claim',record})).rejects.toThrow();
 expect((await c.query('SELECT quota_reserved FROM communications.operation_journal WHERE id=$1',[original.key])).rows[0].quota_reserved).toBe(true);
 await repo.complete({token:'claim',record:{snapshot:legacy.snapshot,recipient,state:'dispatching'},outcome:{status:'review',code:'protocol'}});expect(await repo.proveNoSubmission(legacy.snapshot)).toBeNull();
 const written=await claim();await boundary(written.key);await admit(written.key);await c.query('SET CONSTRAINTS ALL IMMEDIATE');await c.query('SET CONSTRAINTS ALL DEFERRED');const writtenRecord={snapshot:written.snapshot,recipient,state:'dispatching'} as const;await repo.startTransportWrite!({token:'claim',record:writtenRecord});await expect(repo.complete({token:'claim',record:writtenRecord,outcome:{status:'review',code:'protocol'},closeBeforeWrite:true})).rejects.toThrow();
 }finally{await c.query('ROLLBACK');c.release();}
});

it.runIf(enabled)('serializes real close-first and gate-first races across separate sessions with immutable synthetic history',async()=>{
 const c=await pool.connect();let revoke:undefined|(()=>Promise<unknown>);const evidence:Record<string,unknown>={};
 try{
 expect((await c.query("SELECT current_database() AS name,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]).toEqual({name:'acquire_agent_mode',marker:'acquire-agent-mode-local-only'});
 expect((await c.query('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0].id).toBe('7697400069962248225');
 await c.query('BEGIN');await c.query('SET LOCAL ROLE communications_control');
 const id=randomUUID(),b={applicationId:'transport-fixture-'+id,tenantId:id,ownerId:id,connectionId:'connection-'+id,accountId:'account-'+id,generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'} as const;
 const codec=new JournalCodec({activeVersion:'fixture',keys:[{version:'fixture',encryptionKey:Buffer.alloc(32,101),digestKey:Buffer.alloc(32,102)}]}),recipient={kind:'phone',value:'+15550001111'} as const;
 await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at)VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",[b.applicationId,b.tenantId,b.ownerId]);
 await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at)VALUES($1,'whatsapp',$2,$3,'fixture',clock_timestamp())",[b.accountId,id,'a'.repeat(64)]);
 await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active)VALUES($1,$2,$3,$4,$5,'whatsapp','whatsapp','unipile',1,'connected',true)",[b.connectionId,b.applicationId,b.tenantId,b.ownerId,b.accountId]);
 await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities)VALUES($1,1,$2,$3,$4,$5,'whatsapp','whatsapp','unipile','fixture','v1','fixture','service','{}')",[b.connectionId,b.applicationId,b.tenantId,b.ownerId,b.accountId]);
 await c.query("INSERT INTO communications.account_leases(account_id,owner_token,fencing_token,expires_at)VALUES($1,'worker',1,clock_timestamp()+interval '1 hour')",[b.accountId]);
 const revision=(await c.query('SELECT communications.lock_reply_barrier($1,$2)::text AS revision',[b.applicationId,b.tenantId])).rows[0].revision;
 async function claim(){const key=randomUUID(),snapshot={binding:b,key,operation:'message',payloadDigest:'b'.repeat(64)} as const,context={recipient};await c.query("INSERT INTO communications.operation_journal(id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,claim_token,claim_until,fencing_token,lease_owner_token)VALUES($1,$2,$3,$4,$1,$5,1,$6,'message',$7,$8,'message-v1','fixture',$9,'fixture',$10,'claim',clock_timestamp()+interval '60 seconds',1,'worker')",[key,b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,snapshot.payloadDigest,'c'.repeat(64),JSON.stringify(codec.encode(snapshot,'context',context)),codec.digest(snapshot,'context',context)]);return{key,snapshot};}
 async function boundary(key:string){await c.query("INSERT INTO communications.dispatch_transport_boundaries(journal_id,application_id,tenant_id,owner_id,claim_token,fencing_token,lease_owner_token,state)VALUES($1,$2,$3,$4,'claim',1,'worker','prewrite')",[key,b.applicationId,b.tenantId,b.ownerId]);}
 async function admit(key:string){await c.query("INSERT INTO communications.dispatch_admissions(id,journal_id,application_id,tenant_id,owner_id,connection_id,generation,account_id,operation_key,payload_digest,permit_id,intent_digest,claim_token,fencing_token,lease_owner_token,service_revision)VALUES($1,$1,$2,$3,$4,$5,1,$6,$1,$7,$1,$7,'claim',1,'worker',$8)",[key,b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,'b'.repeat(64),revision]);await c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true WHERE id=$1",[key]);}

 const closing=await claim();await boundary(closing.key);await admit(closing.key);
 const writing=await claim();await boundary(writing.key);await admit(writing.key);
 await c.query('COMMIT');
 evidence.applicationId=b.applicationId;evidence.accountId=b.accountId;evidence.operations=[closing.key,writing.key];
 revoke=async()=>{await c.query('BEGIN');await c.query('SET LOCAL ROLE communications_control');await c.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3',[b.applicationId,b.tenantId,b.ownerId]);await c.query('COMMIT');};
 function repo(heldState?:string,onHeld?:()=>Promise<void>,onPid?:(pid:number)=>void){return createPostgresDispatchJournal({pool:{connect:async()=>{const client=await pool.connect();onPid?.(Number((await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));return{release(error?:Error){client.release(error);},async query(sql:string,args?:unknown[]){const result=await client.query(sql,args);if(heldState&&sql.startsWith("UPDATE communications.dispatch_transport_boundaries SET state='"+heldState+"'"))await onHeld!();return result;}};}},binding:b,integrationId:'fixture',providerConfigurationReference:'fixture',providerApiVersion:'v1',authority:'service',leaseOwnerToken:'worker',codec,recipientDigest:{keyVersion:'fixture',digest:()=> 'c'.repeat(64)}});}
 for(const [mode,operation] of [['close-first',closing],['gate-first',writing]] as const){
  let unlock!:()=>void,held!:()=>void;const releaseGate=new Promise<void>(r=>{unlock=r;}),acquired=new Promise<void>(r=>{held=r;});let secondPid=0;
  const first=repo(mode==='close-first'?'closed_no_write':'write_started',async()=>{held();await releaseGate;}),second=repo(undefined,undefined,pid=>{secondPid=pid;}),record={snapshot:operation.snapshot,recipient,state:'dispatching'} as const;
  const input={token:'claim',record},complete={...input,outcome:{status:'review',code:'protocol'} as const,closeBeforeWrite:true as const};
  const firstWork=mode==='close-first'?first.complete(complete):first.startTransportWrite!(input);void firstWork.catch(()=>{});await acquired;
  const secondWork=mode==='close-first'?second.startTransportWrite!(input):second.complete(complete);const denied=secondWork.then(()=>false,()=>true);
  let blocked=false;try{for(let attempt=0;attempt<100;attempt++){if(secondPid){const state=(await c.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[secondPid])).rows[0];if(state?.wait_event_type==='Lock'){blocked=true;break;}}await new Promise(r=>setTimeout(r,5));}expect(blocked).toBe(true);}finally{unlock();}
  await firstWork;expect(await denied).toBe(true);
  const saved=(await c.query('SELECT t.state,j.quota_reserved FROM communications.dispatch_transport_boundaries t JOIN communications.operation_journal j ON j.id=t.journal_id WHERE t.journal_id=$1',[operation.key])).rows[0];expect(saved).toEqual({state:mode==='close-first'?'closed_no_write':'write_started',quota_reserved:true});
  if(mode==='close-first')expect(await repo().proveNoSubmission(operation.snapshot)).toMatchObject({journalId:operation.key});else expect(await repo().proveNoSubmission(operation.snapshot)).toBeNull();
  evidence[mode]={blocked,secondRejected:true,state:saved.state,quotaReserved:true};
 }
 await writeFile('.local-data/transport-boundary-race.private.json',JSON.stringify(evidence,null,2),{mode:0o600});
 }finally{await c.query('ROLLBACK');if(revoke)await revoke();c.release();}
});
