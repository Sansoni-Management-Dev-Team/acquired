import 'server-only';
import type {ConfiguredUnipileV1Runtime,ConfiguredUnipileV1RuntimeOptions} from '../../communications/packages/adapter-unipile/src/v1-runtime';
import type {SqlPool} from '../../communications/packages/storage-postgres/src/webhook-repository';
import type {JournalCodec} from '../../communications/packages/core/src/journal-codec';
import type {DispatchQuotaPolicy} from '../../communications/packages/storage-postgres/src/send-admission';
import type {CommunicationsServerDependencies} from '../../communications/services/api/src/server';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createScopedServiceAuth} from '../../communications/packages/core/src/scoped-service-auth';
import {createDispatchCoordinator} from '../../communications/packages/core/src/dispatch';
import {EventCodec} from '../../communications/packages/core/src/event-codec';
import {WebhookCodec} from '../../communications/packages/core/src/webhook-codec';
import {HistoryCheckpointCodec} from '../../communications/packages/storage-postgres/src/history-checkpoint-codec';
import {createPostgresDispatchJournal} from '../../communications/packages/storage-postgres/src/dispatch-journal';
import {createPostgresOutboxRepository} from '../../communications/packages/storage-postgres/src/outbox-repository';
import {runtimeTransaction} from '../../communications/packages/storage-postgres/src/runtime-sql';
import {createConfiguredUnipileV1History} from '../../communications/packages/adapter-unipile/src/v1-history-runtime';
import {assertSameBinding,type AccessScope,type ConnectionBinding,type ConnectionRecord,type EventQuery,type MessagingAdapter} from '../../communications/packages/contracts/src';
import {createAcquireSendAdmission} from './campaign-send-admission';
import {createCommunicationReplyDeliveryWorker} from './communications-reply-delivery';
import {createRecordedReplyIdentityResolver} from './communications-reply-identity';
import {createAcquireCoverageProjector} from './communications-coverage-projector';
import {createPostgresWebhookRepository} from '../../communications/packages/storage-postgres/src/webhook-repository';
import {createPostgresReplyBarrier} from '../../communications/packages/storage-postgres/src/reply-barrier';
import {createRecordedUnrelatedReplyResolver} from './communications-unrelated-reply';
export interface AcquireCommunicationsRuntimeOptions {
 unipile:ConfiguredUnipileV1Runtime;serviceOptions:ConfiguredUnipileV1RuntimeOptions;applicationPool:SqlPool;applicationCodec:JournalCodec;scopedAuthKey:Uint8Array;subscriberId:string;quota:DispatchQuotaPolicy;applicationReadTimeoutMs?:number;
}
/** Acquire owns this composition. The reusable service packages never import app tables,
 * sessions, Drizzle or framework code. Both SQL pools are explicit and independent. */
export function createAcquireCommunicationsRuntime(options:AcquireCommunicationsRuntimeOptions){
 const runtime=options.unipile,service=options.serviceOptions,applicationPool=options.applicationPool,appCodec=options.applicationCodec;
 const applicationId=service.applicationId,subscriberId=options.subscriberId,quota=structuredClone(options.quota);
 if(applicationId!=='acquire'||!subscriberId||subscriberId.length>200)throw Error('Invalid Acquire communications host');
 const keyring={activeVersion:service.vault.activeVersion,keys:service.vault.keys};
 const historyCodec=new HistoryCheckpointCodec(keyring),eventCodec=new EventCodec(keyring),captureCodec=new WebhookCodec(keyring);
 const identity=(b:ConnectionBinding)=>JSON.stringify([b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,b.generation,b.channel,b.platform,b.backend]);
 const histories=new Map<string,Awaited<ReturnType<typeof createConfiguredUnipileV1History>>>();
 const channels=new Map<string,Promise<Awaited<ReturnType<typeof compose>>>>();
 const readTimeout=options.applicationReadTimeoutMs??5000;if(!Number.isSafeInteger(readTimeout)||readTimeout<1||readTimeout>5000)throw Error('Invalid application read deadline');
 async function appRead<T>(scope:AccessScope,work:(client:import('../../communications/packages/storage-postgres/src/webhook-repository').SqlClient)=>Promise<T>):Promise<T>{
  let physical:Awaited<ReturnType<SqlPool['connect']>>|undefined,closed=false,inFlight=false;const deadline=performance.now()+readTimeout;
  const retired=()=>Error('Application authority session retired');
  const dispose=(error?:Error)=>{if(closed)return;closed=true;physical?.release(error);};
  const live=()=>{if(closed||performance.now()>=deadline){dispose(retired());throw Error('Application authority unavailable');}};
  let timer:ReturnType<typeof setTimeout>;const stopped=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{dispose(retired());reject(Error('Application authority unavailable'));},readTimeout);});
  const run=(async()=>{try{
   const acquired=await applicationPool.connect();if(closed||performance.now()>=deadline){acquired.release(retired());throw Error('Application authority unavailable');}physical=acquired;
   const query=Function.prototype.bind.call(acquired.query,acquired) as import('../../communications/packages/storage-postgres/src/webhook-repository').SqlClient['query'];
   const client:import('../../communications/packages/storage-postgres/src/webhook-repository').SqlClient={async query<Row>(sql:string,values?:unknown[]){live();if(inFlight)throw Error('Concurrent authority query');inFlight=true;try{const result=await query<Row>(sql,values);live();return result;}finally{inFlight=false;}},release(){throw Error('Private authority session');}};
   await client.query('BEGIN');await client.query('SET LOCAL ROLE acquire_campaign_user');
   const role=await client.query('SELECT current_user AS active_role,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
   if(role.rows.length!==1||role.rows[0].active_role!=='acquire_campaign_user'||role.rows[0].rolsuper!==false||role.rows[0].rolbypassrls!==false)throw Error('Application authority unavailable');
   await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true),set_config('statement_timeout','5000ms',true),set_config('lock_timeout','1000ms',true)",[scope.tenantId,scope.ownerId]);
   const member=await client.query('SELECT true AS allowed FROM public.member WHERE organization_id=$1 AND user_id=$2 LIMIT 1',[scope.tenantId,scope.ownerId]);
   if(scope.applicationId!==applicationId||member.rows.length!==1||member.rows[0].allowed!==true)throw Error('Application authority unavailable');
   const result=await work(client);live();await client.query('COMMIT');dispose();return result;
  }catch{dispose(retired());throw Error('Application authority unavailable');}})();
  void run.catch(()=>undefined);try{return await Promise.race([run,stopped]);}finally{clearTimeout(timer!);}
 }
 const auth=createScopedServiceAuth({key:Buffer.from(options.scopedAuthKey),applicationId,audience:'communications',async authorize(scope,proof){
  await appRead(scope,async()=>undefined);return runtime.authorizeSignedScope(scope,proof);
 }});
 async function localBinding(b:ConnectionBinding):Promise<string>{
  assertSameBinding(b,b);return appRead(b,async c=>{
   const found=await c.query('SELECT id FROM public.communication_bindings WHERE application_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND service_connection_id=$4 AND service_account_id=$5 AND generation=$6 AND channel=$7 AND platform=$8 AND backend=$9 AND authority=\'service\'',[b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,b.generation,b.channel,b.platform,b.backend]);
   if(found.rows.length!==1||typeof found.rows[0].id!=='string')throw Error('Original application binding unavailable');return found.rows[0].id;
  });
 }
 async function connection(scope:AccessScope,id:string,generation:number):Promise<ConnectionRecord|null>{
  await runtime.store.requireGrant(scope);
  const b=await runtimeTransaction(service.pool,5000,async c=>{
   const rows=await c.query(`SELECT g.account_id,g.channel,g.platform,g.backend FROM communications.connection_generations g WHERE g.application_id=$1 AND g.tenant_id=$2 AND g.owner_id=$3 AND g.connection_id=$4 AND g.generation=$5 AND g.authority='service' AND g.integration_id=$6 AND g.provider_configuration_reference=$7 AND g.provider_api_version='v1'`,[scope.applicationId,scope.tenantId,scope.ownerId,id,generation,service.integrationId,service.providerConfigurationReference]);
   if(rows.rows.length===0)return null;if(rows.rows.length!==1)throw Error('Ambiguous connection');const r=rows.rows[0];return {...scope,connectionId:id,generation,accountId:r.account_id,channel:r.channel,platform:r.platform,backend:r.backend} as ConnectionBinding;
  });
  if(!b)return null;assertSameBinding(b,b);const record=await runtime.store.resolve(b,false);if(!record)return null;assertSameBinding(record.binding,b);
  return {binding:b,status:record.active?record.status:'disconnected',capabilities:structuredClone(record.owner.capabilities)};
 }
 async function history(b:ConnectionBinding){
  const k=identity(b),saved=histories.get(k);if(saved)return saved;
  const result=await createConfiguredUnipileV1History({binding:b,runtime,pool:service.pool,provider:service.provider,integrationId:service.integrationId,providerConfigurationReference:service.providerConfigurationReference,subscriberId,codec:historyCodec,eventCodec,captureCodec,...(b.channel==='linkedin'?{expectedSyncProduct:'classic'}:{}),async dispatchInvitation(input,signal){if(signal.aborted)throw Error('Invitation cancelled');return (await channel(b)).adapter.submit(input);}});
  histories.set(k,result);return result;
 }
 async function compose(b:ConnectionBinding){
  const binding=structuredClone(b),bindingId=await localBinding(binding),original=await runtime.store.resolve(binding,false),lookupOnly=!original?.active,ports=await runtime.dispatchOptions(binding,{historical:true});
  const admission=createAcquireSendAdmission({pool:applicationPool,binding,bindingId,codec:appCodec,
   async verifyServiceAdmission(receipt,signal){return !signal.aborted&&isDeepStrictEqual(await journal.readAdmission(receipt.snapshot),receipt)&&!signal.aborted;},
   async proveNoSubmission(snapshot,signal){return signal.aborted?null:journal.proveNoSubmission(snapshot);}
  });
  const journal:ReturnType<typeof createPostgresDispatchJournal>=createPostgresDispatchJournal({...ports,pool:service.pool,binding,leaseOwnerToken:randomUUID(),admission:{application:admission,quota,coverage:{async assertCoverage(client,input){
   const source=histories.get(identity(input.binding));if(!source)throw Error('History authority unavailable');await source.repository.assertCoverage(client,input);
  }}}});
  const raw=await runtime.providerFactory(binding,{lookupOnly}),coordinator=createDispatchCoordinator(binding,raw,journal,{recoverUnknownEmail:(record,signal)=>runtime.recoverUnknownEmail(record,signal)});
  const adapter:MessagingAdapter={
   async ready(requested){assertSameBinding(binding,requested);const active=await runtime.store.resolve(binding);if(!active||!active.active||active.status!=='connected')return {status:'review',code:'reconnect'};
    const proof=await (await history(binding)).repository.coverage({binding,scope:'account',since:new Date(Date.now()-300000).toISOString(),cursor:null,refresh:true});
    return proof?.complete&&proof.initialSyncComplete&&!proof.invalidated?coordinator.ready(binding):{status:'waiting',code:'incomplete'};
   },
   async submit(input){assertSameBinding(binding,input.snapshot.binding);
    if(lookupOnly)return {status:'review',code:'reconnect'};
    // Create repositories BEFORE the service's held transaction. Coverage verification inside
    // admission uses that existing session and makes no provider calls or nested transactions.
    for(const captured of await admission.getPreparedCoverage(input.snapshot))await history(captured.binding);
    return coordinator.submit(input);
   },lookup(input){return coordinator.lookup(input);}
  };
  return {bindingId,binding,admission,journal,adapter};
 }
 function channel(b:ConnectionBinding){const k=identity(b);let saved=channels.get(k);if(!saved){saved=compose(b).catch(error=>{channels.delete(k);throw error;});channels.set(k,saved);}return saved;}
 const serverDependencies:CommunicationsServerDependencies={
  authorize(request){const h=request.headers.authorization;return auth.verify(typeof h==='string'?h:undefined);},connections:{get:connection},management:runtime,
  async resolveAdapter(record){return (await channel(record.binding)).adapter;},
  async lookupDetails(record,_scope,input){const journal=(await channel(record.binding)).journal,original=await journal.get(input.snapshot);if(!original||original.state!=='completed'||original.outcome.status!=='submitted')return null;return runtime.receiptDetails(record.binding,input,original.outcome.receipt);},
  async inspectRelationship(record,_scope,input){const relationships=(await history(record.binding)).relationships;if(!relationships)throw Error('Unsupported channel');return relationships.inspect({binding:record.binding,...input});}
 };
 async function consumePending(b:ConnectionBinding,maxDeliveries=100){
  if(!Number.isSafeInteger(maxDeliveries)||maxDeliveries<1||maxDeliveries>1000)throw Error('Invalid delivery bound');
  const bindingId=await localBinding(b),actor={organizationId:b.tenantId,userId:b.ownerId},outbox=createPostgresOutboxRepository({pool:service.pool,binding:b,subscriberId,codec:eventCodec,replyBarrier:{async lock(client,applicationId,tenantId){await client.query('SELECT communications.lock_reply_barrier($1,$2)',[applicationId,tenantId]);}}});
  const worker=createCommunicationReplyDeliveryWorker({pool:applicationPool,binding:b,bindingId,actor,subscriberId,outbox,resolveIdentity:createRecordedReplyIdentityResolver({binding:b,bindingId,actor}),resolveUnrelated:createRecordedUnrelatedReplyResolver({binding:b,bindingId,actor}),async authenticateDelivery(delivery,signal){if(signal?.aborted)return false;assertSameBinding(b,delivery.binding);return delivery.bindingId===bindingId&&delivery.subscriberId===subscriberId;}});
  const deliveries=[];for(let i=0;i<maxDeliveries;i++){const r=await worker.run();deliveries.push(r);if(!['delivered','duplicate'].includes(r.status))break;}
  return {bindingId,deliveries};
 }
 return {serverDependencies,admission:async(b:ConnectionBinding)=>(await channel(b)).admission,history,consumePending,
  async renewScope(scope:AccessScope){try{return await auth.verify('Bearer '+auth.issue(scope))!==null;}catch{return false;}},
  async currentSubjects(limit=100){if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid subject bound');return runtimeTransaction(service.pool,5000,async c=>{const rows=await c.query<{application_id:string;tenant_id:string;owner_id:string}>(`SELECT DISTINCT application_id,tenant_id,owner_id FROM communications.connections WHERE application_id=$1 AND backend='unipile' AND active ORDER BY tenant_id,owner_id LIMIT $2`,[applicationId,limit]);return rows.rows.map(r=>({applicationId:r.application_id,tenantId:r.tenant_id,ownerId:r.owner_id}));});},
  createWebhooks(){return runtime.createWebhookRuntime({captureCodec,journal:async(binding:ConnectionBinding)=>createPostgresWebhookRepository({pool:service.pool,binding,integrationId:service.integrationId,providerConfigurationReference:service.providerConfigurationReference,subscriberId,codec:captureCodec,eventCodec,replyBarrier:createPostgresReplyBarrier({binding,integrationId:service.integrationId,codec:captureCodec,eventCodec})}),history});},
  async refreshAndConsume(query:EventQuery,maxDeliveries=100){
   if(!Number.isSafeInteger(maxDeliveries)||maxDeliveries<1||maxDeliveries>1000)throw Error('Invalid delivery bound');
   const b=structuredClone(query.binding),scope={applicationId:b.applicationId,tenantId:b.tenantId,ownerId:b.ownerId};
   await appRead(scope,async()=>undefined);await runtime.store.requireGrant(scope);const source=await history(b),result=await source.refresh(query);
   const {bindingId,deliveries}=await consumePending(b,maxDeliveries);
   const projector=createAcquireCoverageProjector({pool:applicationPool,binding:b,bindingId,subscriberId,codec:appCodec,withCoverage:source.repository.withCoverage.bind(source.repository)});
   await projector.project(query);
   return {result,deliveries};
  }
 };
}
