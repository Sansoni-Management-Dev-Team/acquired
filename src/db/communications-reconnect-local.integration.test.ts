import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {Pool} from 'pg';
import {randomUUID} from 'node:crypto';
import {createServer,type Server} from 'node:http';
import type {AddressInfo} from 'node:net';
import {setTimeout as wait} from 'node:timers/promises';
import {createConfiguredUnipileV1Runtime} from '../../communications/packages/adapter-unipile/src/v1-runtime';
import {createConfiguredUnipileV1History} from '../../communications/packages/adapter-unipile/src/v1-history-runtime';
import {createPostgresWebhookRepository} from '../../communications/packages/storage-postgres/src/webhook-repository';
import {createPostgresReplyBarrier} from '../../communications/packages/storage-postgres/src/reply-barrier';
import {createPostgresDispatchJournal} from '../../communications/packages/storage-postgres/src/dispatch-journal';
import {messageDigest} from '../../communications/packages/core/src/message-digest';
import {createPostgresAuthStateRepository} from '../../communications/packages/storage-postgres/src/auth-state-repository';
import {createConnectionSetupCoordinator} from '../../communications/packages/core/src/connection-setup';
import {UnipileV1HostedAuth} from '../../communications/packages/adapter-unipile/src/v1-hosted-auth';
import {HistoryCheckpointCodec} from '../../communications/packages/storage-postgres/src/history-checkpoint-codec';
import {EventCodec} from '../../communications/packages/core/src/event-codec';
import {WebhookCodec} from '../../communications/packages/core/src/webhook-codec';
import type {SqlPool} from '../../communications/packages/storage-postgres/src/webhook-repository';
import type {ConnectionBinding} from '../../communications/packages/contracts/src';

// Actual restricted-role PostgreSQL + owned ephemeral HTTP provider. No external
// account, messaging/model call, schema changes, worker registration or live app.
// Same-account repeated sync bytes deliberately remain unsupported across epochs;
// normal initial sync of a fresh provider account is the positive social proof.
const enabled=process.env.RUN_SIM29_LOCAL_ACCEPTANCE==='true';
const pool=new Pool({connectionString:'postgresql://project_acquire:agent-local-only@127.0.0.1:5437/acquire_agent_mode',max:5,connectionTimeoutMillis:3000});
const run=randomUUID(),application='sim29-'+run,tenant=randomUUID(),owner=randomUUID(),scope={applicationId:application,tenantId:tenant,ownerId:owner};
const integrations:string[]=[],servers:Server[]=[];let attested=false;
const databaseErrors:{code:string;statement:string;message:string}[]=[];
const driver:SqlPool={async connect(){const c=await pool.connect();return{async query<Row>(sql:string,values?:unknown[]){try{return await c.query(sql,values) as unknown as {rows:Row[];rowCount:number|null};}catch(error){const e=error as {code?:string;message?:string};databaseErrors.push({code:e.code??'unknown',statement:sql.slice(0,160),message:e.message??''});throw error;}},release(error){c.release(error);}};}};
const keyring={activeVersion:'sim29-fixture',keys:[{version:'sim29-fixture',encryptionKey:Buffer.alloc(32,231),digestKey:Buffer.alloc(32,232)}]};
const vault={...keyring,identityKey:Buffer.alloc(32,233),identityKeyVersion:'sim29-fixture'};
const captureCodec=new WebhookCodec(keyring),eventCodec=new EventCodec(keyring),codec=new HistoryCheckpointCodec(keyring);

describe.runIf(enabled)('SIM29 marked local reconnect, immutable sync epochs and retired controls',()=>{
 beforeAll(async()=>{
  const row=(await pool.query("SELECT current_database() database,shobj_description(d.oid,'pg_database') marker,(SELECT system_identifier::text FROM pg_control_system()) system FROM pg_database d WHERE d.datname=current_database()")).rows[0];
  expect(row).toEqual({database:'acquire_agent_mode',marker:'acquire-agent-mode-local-only',system:'7697400069962248225'});attested=true;
  for(const table of ['account_runtime_metadata','auth_states','setup_notification_inbox','connection_generations','provider_webhook_spool','webhook_receipt_routes','history_initial_sync','history_refreshes','event_cursors','connection_retirements'])expect((await pool.query('SELECT to_regclass($1) IS NOT NULL present',['communications.'+table])).rows[0].present).toBe(true);
 });
 afterAll(async()=>{
  for(const server of servers){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  if(attested){const c=await pool.connect();try{
   await c.query('BEGIN');await c.query("SET LOCAL session_replication_role='replica'");
   const own=(await c.query('SELECT id,account_id FROM communications.connections WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3',[application,tenant,owner])).rows;
   const ids=own.map(r=>r.id),accounts=own.map(r=>r.account_id);
   const tables=(await c.query("SELECT table_name,array_agg(column_name::text) columns FROM information_schema.columns WHERE table_schema='communications' AND table_name IN(SELECT table_name FROM information_schema.tables WHERE table_schema='communications' AND table_type='BASE TABLE') GROUP BY table_name")).rows;
   for(const table of tables){if(!/^[a-z_]+$/.test(table.table_name))throw Error('Invalid fixture table');const columns=table.columns as string[];
    if(columns.includes('tenant_id'))await c.query('DELETE FROM communications.'+table.table_name+' WHERE tenant_id=$1',[tenant]);
    else if(columns.includes('connection_id'))await c.query('DELETE FROM communications.'+table.table_name+' WHERE connection_id=ANY($1::text[])',[ids]);
    else if(columns.includes('account_id'))await c.query('DELETE FROM communications.'+table.table_name+' WHERE account_id=ANY($1::text[])',[accounts]);
   }
   await c.query('DELETE FROM communications.provider_webhook_spool WHERE integration_id=ANY($1::text[])',[integrations]);
   await c.query('DELETE FROM communications.physical_accounts WHERE id=ANY($1::text[])',[accounts]);
   await c.query('COMMIT');
   expect((await c.query('SELECT count(*)::int n FROM communications.connections WHERE tenant_id=$1',[tenant])).rows[0].n).toBe(0);
  }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}
  await pool.end();
 });
 async function fixture(channel:'email'|'whatsapp'|'linkedin'){
  const id=randomUUID(),integration='sim29-'+id,configuration='sim29-config',accountId='sim29-provider-'+id,providerOwner='sim29-owner-'+id,platform=channel==='email'?'gmail':channel,mail='sim29-'+id+'@example.test';integrations.push(integration);
  let status='OK',callback:{nonce:string;capability:string}|undefined;
  const requests:{method:string;path:string}[]=[];
  const account=()=>({object:'Account',id:accountId,type:channel==='email'?'GOOGLE_OAUTH':channel.toUpperCase(),sources:[{id:channel==='email'?'mail':'im',status}],connection_params:channel==='email'?{mail:{id:providerOwner}}:{im:channel==='whatsapp'?{phone_number:'+1'+BigInt('0x'+id.replaceAll('-','').slice(0,9)).toString().padStart(11,'0')}:{id:providerOwner}}});
  const server=createServer(async(req,res)=>{
   const url=new URL(req.url!,'http://127.0.0.1'),method=req.method??'GET';requests.push({method,path:url.pathname});
   const json=(value:unknown,code=200)=>{res.writeHead(code,{'content-type':'application/json'});res.end(JSON.stringify(value));};
   if(req.headers['x-api-key']!=='sim29-private-fixture')return json({error:'unauthorized'},401);
   if(method==='POST'&&url.pathname==='/api/v1/hosted/accounts/link'){
    const chunks:Buffer[]=[];for await(const part of req)chunks.push(Buffer.from(part));const payload=JSON.parse(Buffer.concat(chunks).toString());
    callback={nonce:payload.name,capability:new URL(payload.notify_url).searchParams.get('capability')!};return json({object:'HostedAuthURL',url:'https://account.unipile.com/hosted/'+payload.name});
   }
   if(url.pathname==='/api/v1/accounts/'+accountId){if(method==='DELETE'){status='STOPPED';return json({object:'AccountDeleted'});}return json(account());}
   if(url.pathname==='/api/v1/users/me')return json(channel==='email'?{object:'AccountOwnerProfile',provider:'GMAIL',email:mail,aliases:[]}:{object:'AccountOwnerProfile',provider:'LINKEDIN',provider_id:providerOwner,public_identifier:'sim29-'+id});
   if(url.pathname==='/api/v1/messages'||url.pathname==='/api/v1/emails')return json({object:channel==='email'?'EmailList':'MessageList',items:[],cursor:null});
   return json({error:'unsupported_fixture_request'},404);
  });servers.push(server);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const provider={apiVersion:'v1' as const,baseUrl:'http://127.0.0.1:'+(server.address() as AddressInfo).port+'/api/v1',apiKey:'sim29-private-fixture',allowLoopbackHttp:true};
  const histories=new Map<string,Awaited<ReturnType<typeof createConfiguredUnipileV1History>>>();
  const history=async(binding:ConnectionBinding)=>{const key=JSON.stringify(binding);let value=histories.get(key);if(!value){value=await createConfiguredUnipileV1History({binding,runtime,pool:driver,provider,integrationId:integration,providerConfigurationReference:configuration,subscriberId:'sim29',codec,eventCodec,captureCodec,...(channel==='linkedin'?{expectedSyncProduct:'classic'}:{})});histories.set(key,value);}return value;};
  const query=(binding:ConnectionBinding)=>({binding,scope:'account',since:new Date(Date.now()-60000).toISOString(),cursor:null,refresh:true});
  const runtime=createConfiguredUnipileV1Runtime({pool:driver,provider,applicationId:application,integrationId:integration,providerConfigurationReference:configuration,vault,callbackKey:Buffer.alloc(32,234),webhookSecret:'sim29-private-webhook-fixture',redirectOrigin:'https://app.example.test',successPath:'/returned',failurePath:'/failed',notifyUrl:'https://callback.example.test/v1/setup/notify',async readiness(binding){const proof=await(await history(binding)).repository.coverage(query(binding));return proof?.complete&&proof.initialSyncComplete&&!proof.invalidated?{status:'ready'}:{status:'waiting',code:'incomplete'};}});
  const webhooks=runtime.createWebhookRuntime({captureCodec,journal:async binding=>createPostgresWebhookRepository({pool:driver,binding,integrationId:integration,providerConfigurationReference:configuration,subscriberId:'sim29',codec:captureCodec,eventCodec,replyBarrier:createPostgresReplyBarrier({binding,integrationId:integration,codec:captureCodec,eventCodec})}),history});
  expect(await runtime.authorizeSignedScope(scope,{expiresAt:new Date(Date.now()+55000).toISOString()})).toBe(true);
  async function queue(reconnectBinding?:ConnectionBinding){
   expect((await runtime.setup(scope,{channel,platform,...(reconnectBinding?{reconnectBinding}:{})})).status).toBe('redirect');
   if(!callback)throw Error('Fixture callback not issued');status='OK';
   expect(await runtime.completeSetupNotification({rawBody:Buffer.from(JSON.stringify({status:reconnectBinding?'RECONNECTED':'CREATION_SUCCESS',name:callback.nonce,account_id:accountId})),capability:callback.capability})).toEqual({status:'queued'});
  }
  async function connect(reconnectBinding?:ConnectionBinding){
   await queue(reconnectBinding);
   let snapshot;try{snapshot=await runtime.list(scope);}catch{throw Error('Fixture runtime binding failure: '+JSON.stringify(databaseErrors));}const current=snapshot.connections.find(c=>c.binding.connectionId===(reconnectBinding?.connectionId??c.binding.connectionId)&&c.binding.channel===channel&&c.binding.generation===(reconnectBinding?reconnectBinding.generation+1:1));if(!current)throw Error('Normal fixture binding missing');return current.binding;
  }
  return {runtime,webhooks,history,query,connect,queue,requests,integration,accountId,setStopped(){status='STOPPED';},syncBody:Buffer.from(JSON.stringify({AccountStatus:{account_id:accountId,account_type:channel.toUpperCase(),message:'SYNC_SUCCESS',...(channel==='linkedin'?{product:'classic'}:{})}}))};
 }
 it.each(['email','whatsapp','linkedin'] as const)('normal %s setup/reconnect retains original epoch and retirement is read-only',async channel=>{
  const f=await fixture(channel),first=await f.connect();expect((await f.runtime.status(scope,first)).active).toBe(true);
  if(channel!=='email'){
   expect(await f.webhooks.ingress.capture({rawHeaders:['unipile-auth','incorrect'],rawBody:f.syncBody})).toEqual({status:'rejected',code:'unauthorized'});
   expect(await f.webhooks.ingress.capture({rawHeaders:['unipile-auth','sim29-private-webhook-fixture'],rawBody:f.syncBody})).toEqual({status:'accepted'});expect(await f.webhooks.runOne()).toEqual({status:'processed'});
  }
  expect((await(await f.history(first)).refresh(f.query(first))).status).toBe('complete');expect((await f.runtime.status(scope,first)).readiness).toEqual({status:'ready'});
  const original=(await pool.query('SELECT * FROM communications.provider_webhook_spool WHERE integration_id=$1',[f.integration])).rows;
  f.setStopped();expect(await f.runtime.status(scope,first)).toMatchObject({active:true,status:'disconnected'});
  const next=await f.connect(first);expect(next).toEqual({...first,generation:2});
  expect(await f.runtime.status(scope,first)).toMatchObject({active:false,binding:first,status:'disconnected'});
  if(channel!=='email'){
   expect(await f.webhooks.ingress.capture({rawHeaders:['unipile-auth','sim29-private-webhook-fixture'],rawBody:f.syncBody})).toEqual({status:'duplicate'});expect(await f.webhooks.runOne()).toEqual({status:'idle'});
   expect((await pool.query('SELECT * FROM communications.provider_webhook_spool WHERE integration_id=$1',[f.integration])).rows).toEqual(original);
   expect(await(await f.history(next)).repository.initialSync()).toBeNull();expect((await(await f.history(next)).refresh(f.query(next))).status).toBe('pending');
   expect((await f.runtime.status(scope,next)).readiness).toEqual({status:'waiting',code:'incomplete'});
  }else{expect((await(await f.history(next)).refresh(f.query(next))).status).toBe('complete');expect((await f.runtime.status(scope,next)).readiness).toEqual({status:'ready'});}
  const key='sim29-'+randomUUID();expect(await f.runtime.disconnect(scope,{binding:next,key})).toEqual({status:'disconnected'});
  const reads=f.requests.length,retired=await f.runtime.status(scope,next);expect(retired).toMatchObject({active:false,status:'disconnected'});expect(f.requests).toHaveLength(reads);
  const posts=f.requests.filter(r=>r.method==='POST').length;expect((await f.runtime.setup(scope,{channel,platform:next.platform,reconnectBinding:next})).status).toBe('unavailable');expect(f.requests.filter(r=>r.method==='POST')).toHaveLength(posts);
  expect(f.requests.filter(r=>r.method==='POST'&&!r.path.endsWith('/hosted/accounts/link'))).toEqual([]);
 });
 it('reconnect never rewrites an original unknown operation or steals its live physical lease',async()=>{
  const f=await fixture('email'),first=await f.connect();expect((await(await f.history(first)).refresh(f.query(first))).status).toBe('complete');
  const recipient={kind:'email' as const,value:'synthetic-peer@example.test'},snapshot={binding:first,key:'sim29-unknown-'+randomUUID(),operation:'message' as const,payloadDigest:messageDigest('message',{recipient,text:'Synthetic unregistered uncertainty fixture'})};
  const journal=createPostgresDispatchJournal({...await f.runtime.dispatchOptions(first),pool:driver,binding:first,leaseOwnerToken:'sim29-lease-'+randomUUID()});
  const claim=await journal.claim({snapshot,recipient});expect(claim.kind).toBe('claimed');if(claim.kind!=='claimed')throw Error('Missing original claim');
  expect((await journal.complete({token:claim.token,record:claim.record,outcome:{status:'unknown'}})).state).toBe('unknown');
  const original=(await pool.query('SELECT * FROM communications.operation_journal WHERE connection_id=$1',[first.connectionId])).rows;
  const lease=(await pool.query('SELECT * FROM communications.account_leases WHERE account_id=$1',[first.accountId])).rows;
  expect(lease).toHaveLength(1);expect(Date.parse(lease[0].expires_at)).toBeGreaterThan(Date.now());
  expect(await f.connect(first)).toEqual({...first,generation:2});
  expect((await pool.query('SELECT * FROM communications.operation_journal WHERE connection_id=$1',[first.connectionId])).rows).toEqual(original);
  expect((await pool.query('SELECT * FROM communications.account_leases WHERE account_id=$1',[first.accountId])).rows).toEqual(lease);
  expect(await journal.get(snapshot)).toMatchObject({state:'unknown',snapshot});
  expect(f.requests.filter(r=>r.method==='POST'&&!r.path.endsWith('/hosted/accounts/link'))).toEqual([]);
 });
 it('abandoned single-use setup expires by actual elapsed time without rewriting a lease or generation',async()=>{
  await fixture('email');const hosted=new UnipileV1HostedAuth({apiVersion:'v1',baseUrl:'http://127.0.0.1:'+(servers.at(-1)!.address() as AddressInfo).port+'/api/v1',apiKey:'sim29-private-fixture',allowLoopbackHttp:true,redirectOrigins:['https://app.example.test'],notifyOrigins:['https://callback.example.test']});
  let bound=false;const states=createPostgresAuthStateRepository({pool:driver,scope,channel:'email',platform:'gmail',backend:'unipile',redirectOrigin:'https://app.example.test',ttlSeconds:1,authenticateNotification:async()=>true,bindNotification:async()=>{bound=true;throw Error('Expired fixture must not bind');}});
  let issued:Awaited<ReturnType<typeof states.issue>>|undefined;const original=states.issue.bind(states);states.issue=async input=>{issued=await original(input);return issued;};
  // Construct after wrapping the durable issuer; the coordinator captures ports.
  const expiring=createConnectionSetupCoordinator({...{scope,channel:'email' as const,platform:'gmail' as const,backend:'unipile' as const,redirectOrigin:'https://app.example.test',successPath:'/returned',failurePath:'/failed',notifyUrl:'https://callback.example.test/v1/setup/notify',states,hostedAuth:hosted,resolveReconnect:async()=>{throw Error('Not reconnecting');}}});
  expect((await expiring.begin()).status).toBe('redirect');if(!issued)throw Error('No durable expiry');
  const before=(await pool.query('SELECT current_generation FROM communications.connections WHERE tenant_id=$1',[tenant])).rows;
  await wait(Math.max(1,Date.parse(issued.expiresAt)-Date.now()+50));
  expect(await expiring.complete({nonce:issued.nonce,notification:{}})).toEqual({status:'rejected',code:'expired'});expect(bound).toBe(false);
  expect((await pool.query('SELECT current_generation FROM communications.connections WHERE tenant_id=$1',[tenant])).rows).toEqual(before);
 });
 it('a revoked queued reconnect cannot advance the generation or invalidate its original coverage',async()=>{
  const f=await fixture('email'),first=await f.connect();expect((await(await f.history(first)).refresh(f.query(first))).status).toBe('complete');
  await f.queue(first);
  const before=(await pool.query('SELECT * FROM communications.event_cursors WHERE connection_id=$1',[first.connectionId])).rows;
  await pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3',[application,tenant,owner]);
  await expect(f.runtime.list(scope)).rejects.toThrow();
  expect((await pool.query('SELECT current_generation FROM communications.connections WHERE id=$1',[first.connectionId])).rows[0].current_generation).toBe(1);
  expect((await pool.query('SELECT * FROM communications.event_cursors WHERE connection_id=$1',[first.connectionId])).rows).toEqual(before);
 });

});
