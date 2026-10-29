import{verifyUntrackedSentEmail}from'./communications-untracked-outbound';
import{UnipileV1Transport}from'../../communications/packages/adapter-unipile/src/v1-http';
import{UnipileV1OwnerReader}from'../../communications/packages/adapter-unipile/src/v1-owner';
import {supportsTransportBoundaryAdapter} from '../../communications/packages/core/src/transport-boundary';
import {localHistoryTurn} from '../../communications/packages/storage-postgres/src/local-history-turn';
import {businessNow} from '../../communications/packages/core/src/business-clock';
import {isHistoryRefreshBusyError} from '../../communications/packages/core/src/history-refresh-busy';
import 'server-only';
import{AccountRuntimeVault}from'../../communications/packages/storage-postgres/src/account-vault';
import{createRetainedOutboundReview}from'./communications-retained-outbound';
import {queueAgentReceiptAssociation} from './agent-communications-receipt-wake';
import {lockAcquireSendGate} from './campaign-send-gate';
import type {DispatchDiagnosticPort} from '../../communications/packages/core/src/dispatch-diagnostic';
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
import {assertSameBinding,type CanonicalIdentity,type AccessScope,type ConnectionBinding,type ConnectionRecord,type EventQuery,type MessagingAdapter} from '../../communications/packages/contracts/src';
import{communicationsExecutionContextLoader}from'./communications-execution-context';
import {createAcquireSendAdmission} from './campaign-send-admission';
import {createCommunicationReplyDeliveryWorker} from './communications-reply-delivery';
import {createRecordedReplyIdentityResolver} from './communications-reply-identity';
import {createAcquireCoverageProjector} from './communications-coverage-projector';
import {createPostgresWebhookRepository} from '../../communications/packages/storage-postgres/src/webhook-repository';
import {createPostgresReplyBarrier} from '../../communications/packages/storage-postgres/src/reply-barrier';
import {createRecordedUnrelatedReplyResolver} from './communications-unrelated-reply';
export interface AcquireCommunicationsRuntimeOptions {
 diagnostic?:DispatchDiagnosticPort;unipile:ConfiguredUnipileV1Runtime;serviceOptions:ConfiguredUnipileV1RuntimeOptions;applicationPool:SqlPool;applicationCodec:JournalCodec;scopedAuthKey:Uint8Array;subscriberId:string;quota:DispatchQuotaPolicy;applicationReadTimeoutMs?:number;
}
/** Acquire owns this composition. The reusable service packages never import app tables,
 * sessions, Drizzle or framework code. Both SQL pools are explicit and independent. */
export function createAcquireCommunicationsRuntime(options:AcquireCommunicationsRuntimeOptions){
 const runtime=options.unipile,service=options.serviceOptions,applicationPool=options.applicationPool,appCodec=options.applicationCodec;
 const applicationId=service.applicationId,subscriberId=options.subscriberId,quota=structuredClone(options.quota);
 if(applicationId!=='acquire'||!subscriberId||subscriberId.length>200)throw Error('Invalid Acquire communications host');
 const keyring={activeVersion:service.vault.activeVersion,keys:service.vault.keys};
 const historyCodec=new HistoryCheckpointCodec(keyring),eventCodec=new EventCodec(keyring),captureCodec=new WebhookCodec(keyring);
 const retainedVault = () => new AccountRuntimeVault(service.vault);
 const retainedOutbound = createRetainedOutboundReview({
   pool: service.pool, captureCodec, eventCodec, subscriberId,
   externalSent: {
     recipientIdentity(raw) {
       const vault = retainedVault();
       const recipient = (raw.to_attendees as Array<{ identifier: string }>)[0].identifier.toLowerCase();
       return { keyVersion: vault.identityKeyVersion, digest: vault.physicalIdentityDigest({ namespace: 'email', value: recipient }) };
     },
     trackingDigests(row, raw) {
       const vault = retainedVault();
       return vault.versions().map(version => vault.trackingDigest({
         integrationId: row.integration_id as string,
         providerConfigurationReference: row.provider_configuration_reference as string,
         providerAccountId: raw.account_id as string, trackingId: raw.tracking_id as string,
       }, version));
     },
     verify(binding, raw, signal) {
       return verifyUntrackedSentEmail(binding, raw, async (binding, emailId, signal) => {
         const current = await runtime.store.resolve(binding, true);
         if (!current) return null;
         const owner = await new UnipileV1OwnerReader(service.provider).verify({
           platform: binding.platform, providerAccountId: current.owner.providerAccountId, sourceId: current.owner.sourceId,
         }, signal);
         if (owner.kind !== 'verified' || !isDeepStrictEqual(owner.owner.physicalOwner, current.owner.physicalOwner)
           || !isDeepStrictEqual(owner.owner.providerOwner, current.owner.providerOwner)
           || !isDeepStrictEqual(owner.owner.aliases, current.owner.aliases)) return null;
         const message = await new UnipileV1Transport(service.provider).getEmail(current.owner.providerAccountId, emailId, { signal });
         await runtime.store.requireGrant({ applicationId: binding.applicationId, tenantId: binding.tenantId, ownerId: binding.ownerId });
         return message.kind === 'success' && message.status === 200 ? {
           binding, providerAccountId: current.owner.providerAccountId,
           ownerAddresses: current.owner.aliases.filter(a => a.kind === 'email').map(a => a.value), raw: message.data,
         } : null;
       }, signal);
     },
   },
   providerDigest: (value, version) => retainedVault().providerAccountDigest(value, version),
   providerAccount: (binding, encrypted, version) => (retainedVault().open(binding, 'provider', { encrypted, keyVersion: version, digest: '' }) as { providerAccountId: string }).providerAccountId,
   async authorize(scope) { await appRead(scope, async () => undefined); await runtime.store.requireGrant(scope); },
   async withAuthority(scope, work) {
     return appRead(scope, async c => {
       await lockAcquireSendGate(c, scope.tenantId, { required: true });
       const member = await c.query('SELECT public.communications_lock_reply_member($1,$2) AS allowed', [scope.tenantId, scope.ownerId]);
       if (member.rows[0]?.allowed !== true) throw Error('Current member required');
       return work();
     });
   },
 });
 const identity=(b:ConnectionBinding)=>JSON.stringify([b.applicationId,b.tenantId,b.ownerId,b.connectionId,b.accountId,b.generation,b.channel,b.platform,b.backend]);
 const histories=new Map<string,Awaited<ReturnType<typeof createConfiguredUnipileV1History>>>();
 const historyTurn=<T>(binding:ConnectionBinding,work:()=>Promise<T>,signal?:AbortSignal)=>service.localSimulatorOrigin?localHistoryTurn(service.pool,binding,work,signal):work();
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
  const result=await createConfiguredUnipileV1History({businessClock:service.businessClock,...(service.localSimulatorOrigin?{historyTurn:<T>(work:()=>Promise<T>,signal?:AbortSignal)=>historyTurn(b,work,signal)}:{}),binding:b,runtime,pool:service.pool,provider:service.provider,integrationId:service.integrationId,providerConfigurationReference:service.providerConfigurationReference,subscriberId,codec:historyCodec,eventCodec,captureCodec,...(b.channel==='linkedin'?{expectedSyncProduct:'classic'}:{}),async dispatchInvitation(input,signal){if(signal.aborted)throw Error('Invitation cancelled');return (await channel(b)).adapter.submit(input);}});
  histories.set(k,result);return result;
 }
 async function compose(b:ConnectionBinding){
  const binding=structuredClone(b),bindingId=await localBinding(binding),original=await runtime.store.resolve(binding,false),lookupOnly=!original?.active,ports=await runtime.dispatchOptions(binding,{historical:true});
  const admission=createAcquireSendAdmission({businessClock:service.businessClock,diagnostic:options.diagnostic,pool:applicationPool,binding,bindingId,codec:appCodec,loadExecutionContext:communicationsExecutionContextLoader({organizationId:binding.tenantId,userId:binding.ownerId}),
   async verifyServiceAdmission(receipt,signal){return !signal.aborted&&isDeepStrictEqual(await journal.readAdmission(receipt.snapshot),receipt)&&!signal.aborted;},
   async proveNoSubmission(snapshot,signal){return signal.aborted?null:journal.proveNoSubmission(snapshot);}
  });
  const journal:ReturnType<typeof createPostgresDispatchJournal>=createPostgresDispatchJournal({...ports,businessClock:service.businessClock,diagnostic:options.diagnostic,pool:service.pool,binding,leaseOwnerToken:randomUUID(),admission:{application:admission,quota,coverage:{async assertCoverage(client,input){
   const source=histories.get(identity(input.binding));if(!source)throw Error('History authority unavailable');await source.repository.assertCoverage(client,input);
  }}}});
  const raw=await runtime.providerFactory(binding,{lookupOnly});
  const transportBoundary=supportsTransportBoundaryAdapter(raw)&&await runtimeTransaction(service.pool,3000,async c=>{const r=await c.query("SELECT to_regclass('communications.dispatch_transport_boundaries') IS NOT NULL AS present");if(r.rows.length!==1||typeof r.rows[0].present!=='boolean')throw Error('Transport boundary capability unavailable');return r.rows[0].present;});
  const coordinator=createDispatchCoordinator(binding,raw,journal,{transportBoundary,diagnostic:options.diagnostic,recoverUnknownEmail:(record,signal)=>runtime.recoverUnknownEmail(record,signal)});
  const adapter:MessagingAdapter={
   async ready(requested){assertSameBinding(binding,requested);const active=await runtime.store.resolve(binding);if(!active||!active.active||active.status!=='connected')return {status:'review',code:'reconnect'};
    const proof=await (await history(binding)).repository.coverage({binding,scope:'account',since:new Date(businessNow(service.businessClock)-300000).toISOString(),cursor:null,refresh:true});
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
  ...(service.businessClock?{businessClock:service.businessClock}:{}),
  ...(service.localSimulatorOrigin?{localSimulatorOrigin:service.localSimulatorOrigin}:{}),
  authorize(request){const h=request.headers.authorization;return auth.verify(typeof h==='string'?h:undefined);},connections:{get:connection},management:runtime,
  async resolveAdapter(record){return (await channel(record.binding)).adapter;},
  async lookupDetails(record,_scope,input){const journal=(await channel(record.binding)).journal,original=await journal.get(input.snapshot);if(!original||original.state!=='completed'||original.outcome.status!=='submitted')return null;return runtime.receiptDetails(record.binding,input,original.outcome.receipt);},
  async inspectRelationship(record,_scope,input){const relationships=(await history(record.binding)).relationships;if(!relationships)throw Error('Unsupported channel');return relationships.inspect({binding:record.binding,...input});}
 };
 const pendingOriginalSql=`FROM communications.event_outbox o JOIN communications.events e ON e.id=o.event_id AND e.application_id=o.application_id AND e.tenant_id=o.tenant_id AND e.owner_id=o.owner_id
 JOIN communications.connection_generations g ON g.connection_id=e.connection_id AND g.generation=e.generation AND g.account_id=e.account_id AND g.application_id=e.application_id AND g.tenant_id=e.tenant_id AND g.owner_id=e.owner_id
 JOIN communications.connections c ON c.id=g.connection_id AND c.application_id=g.application_id AND c.tenant_id=g.tenant_id AND c.owner_id=g.owner_id AND c.channel=g.channel AND c.platform=g.platform AND c.backend=g.backend
 JOIN communications.access_grants ag ON ag.application_id=g.application_id AND ag.tenant_id=g.tenant_id AND ag.owner_id=g.owner_id AND ag.revoked_at IS NULL AND ag.expires_at>clock_timestamp()
 WHERE o.application_id=$1 AND o.tenant_id=$2 AND o.owner_id=$3 AND o.subscriber_id=$4 AND g.authority='service' AND g.backend='unipile'
 AND (o.retry_at IS NULL OR o.retry_at<=clock_timestamp()) AND (o.state='pending' OR o.state='delivering' AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp()))`;
 const originalColumns='g.application_id,g.tenant_id,g.owner_id,g.connection_id,g.account_id,g.generation,g.channel,g.platform,g.backend';
 function pendingBinding(row:Record<string,unknown>,scope:AccessScope):ConnectionBinding{
  const b={applicationId:row.application_id,tenantId:row.tenant_id,ownerId:row.owner_id,connectionId:row.connection_id,accountId:row.account_id,generation:row.generation,channel:row.channel,platform:row.platform,backend:row.backend}as ConnectionBinding;
  assertSameBinding(b,b);if(b.applicationId!==scope.applicationId||b.tenantId!==scope.tenantId||b.ownerId!==scope.ownerId||b.backend!=='unipile')throw Error('Original pending reply binding unavailable');return b;
 }
 async function pendingReplyBindings(scope:AccessScope,bound=10){
  if(scope.applicationId!==applicationId||!Number.isSafeInteger(bound)||bound<1||bound>100)throw Error('Invalid retained reply scope');
  await appRead(scope,async()=>undefined);await runtime.store.requireGrant(scope);
  return runtimeTransaction(service.pool,5000,async c=>{const rows=await c.query(`SELECT ${originalColumns} ${pendingOriginalSql} GROUP BY ${originalColumns} ORDER BY min(o.event_id),g.connection_id,g.generation LIMIT $5`,[scope.applicationId,scope.tenantId,scope.ownerId,subscriberId,bound]);return rows.rows.map(row=>pendingBinding(row,scope));});
 }
 async function recordPendingReplyBinding(input:ConnectionBinding){
  const b=structuredClone(input);assertSameBinding(b,b);const scope={applicationId:b.applicationId,tenantId:b.tenantId,ownerId:b.ownerId};if(scope.applicationId!==applicationId)throw Error('Invalid retained reply scope');
  await appRead(scope,async()=>undefined);await runtime.store.requireGrant(scope);
  const proven=await runtimeTransaction(service.pool,5000,async c=>{const rows=await c.query(`SELECT DISTINCT ${originalColumns} ${pendingOriginalSql} AND g.connection_id=$5 AND g.account_id=$6 AND g.generation=$7 AND g.channel=$8 AND g.platform=$9 AND g.backend=$10`,[b.applicationId,b.tenantId,b.ownerId,subscriberId,b.connectionId,b.accountId,b.generation,b.channel,b.platform,b.backend]);if(rows.rows.length!==1)throw Error('Original retained reply proof unavailable');const original=pendingBinding(rows.rows[0],scope);assertSameBinding(b,original);return original;});
  return appRead(scope,async c=>{
   await lockAcquireSendGate(c,scope.tenantId,{required:true});
   const member=await c.query('SELECT public.communications_lock_reply_member($1,$2) AS allowed',[scope.tenantId,scope.ownerId]);if(member.rows.length!==1||member.rows[0].allowed!==true)throw Error('Current member required');
   const values=[proven.applicationId,proven.tenantId,proven.ownerId,proven.connectionId,proven.accountId,proven.generation,proven.channel,proven.platform,proven.backend];
   const found=await c.query('SELECT * FROM public.communication_bindings WHERE application_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND service_connection_id=$4 AND generation=$5',[proven.applicationId,proven.tenantId,proven.ownerId,proven.connectionId,proven.generation]);
   if(found.rows.length>1)throw Error('Ambiguous original application binding');let id:string;
   if(found.rows.length){const r=found.rows[0];assertSameBinding(proven,{applicationId:r.application_id,tenantId:r.organization_id,ownerId:r.owner_user_id,connectionId:r.service_connection_id,accountId:r.service_account_id,generation:r.generation,channel:r.channel,platform:r.platform,backend:r.backend}as ConnectionBinding);if(r.authority!=='service'||typeof r.id!=='string')throw Error('Original application binding differs');id=r.id;}
   else{const inserted=await c.query("INSERT INTO public.communication_bindings(application_id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'service') RETURNING id",values);if(inserted.rows.length!==1||typeof inserted.rows[0].id!=='string')throw Error('Original pending binding unavailable');id=inserted.rows[0].id;}
   return id;
  });
 }
 async function consumePending(b:ConnectionBinding,maxDeliveries=100){
  if(!Number.isSafeInteger(maxDeliveries)||maxDeliveries<1||maxDeliveries>1000)throw Error('Invalid delivery bound');
  const bindingId=await localBinding(b),actor={organizationId:b.tenantId,userId:b.ownerId},outbox=createPostgresOutboxRepository({pool:service.pool,binding:b,subscriberId,codec:eventCodec,replyBarrier:{async lock(client,applicationId,tenantId){await client.query('SELECT communications.lock_reply_barrier($1,$2)',[applicationId,tenantId]);}}});
  const worker=createCommunicationReplyDeliveryWorker({pool:applicationPool,binding:b,bindingId,actor,subscriberId,outbox,resolveIdentity:createRecordedReplyIdentityResolver({binding:b,bindingId,actor}),resolveUnrelated:createRecordedUnrelatedReplyResolver({binding:b,bindingId,actor}),async authenticateDelivery(delivery,signal){if(signal?.aborted)return false;assertSameBinding(b,delivery.binding);return delivery.bindingId===bindingId&&delivery.subscriberId===subscriberId;}});
  const deliveries=[];for(let i=0;i<maxDeliveries;i++){const r=await worker.run();deliveries.push(r);if(!['delivered','duplicate'].includes(r.status))break;}
  return {bindingId,deliveries};
 }
 async function readAgentChannelConversation(binding:ConnectionBinding,recipient:CanonicalIdentity,signal?:AbortSignal){return historyTurn(binding,()=>readAgentChannelConversationHeld(binding,recipient,signal),signal);}
 async function readAgentChannelConversationHeld(binding:ConnectionBinding,recipient:CanonicalIdentity,signal?:AbortSignal){
  const b=structuredClone(binding),scope={applicationId:b.applicationId,tenantId:b.tenantId,ownerId:b.ownerId};
  if(signal?.aborted||b.channel==='email'&&recipient.kind!=='email'||b.channel==='whatsapp'&&recipient.kind!=='phone'||b.channel==='linkedin'&&recipient.kind!=='linkedin_profile')throw Error('Recorded channel history unavailable');
  await appRead(scope,async()=>undefined);await runtime.store.requireGrant(scope);
  const source=await history(b),result=await source.readAgentConversation({recipient,since:'1970-01-01T00:00:00.000Z',signal}).catch(error=>{
   if(isHistoryRefreshBusyError(error)&&(!isHistoryRefreshBusyError(error,b)||signal?.aborted))throw Error('Recorded channel history unavailable');
   throw error;
  });
  assertSameBinding(b,result.binding);
  const {bindingId}=await consumePending(b,100);
  const projector=createAcquireCoverageProjector({businessClock:service.businessClock,pool:applicationPool,binding:b,bindingId,subscriberId,codec:appCodec,withCoverage:source.repository.withCoverage.bind(source.repository)});
  await projector.project({binding:b,scope:'account',since:'1970-01-01T00:00:00.000Z',cursor:null,refresh:true});
  await appRead(scope,async()=>undefined);await runtime.store.requireGrant(scope);
  if(signal?.aborted)throw Error('Recorded channel history unavailable');return {...result,scopeDigest:source.repository.scopeDigest('account')};
 }
 /** Provider-free catch-up after sequential account scans. Each projection uses
  * the original encrypted coverage under current authority; no revision is stamped. */
 async function revalidateAgentChannelCoverage(raw:ReadonlyArray<{binding:ConnectionBinding;bindingId:string;scopeDigest:string}>,signal?:AbortSignal){
  if(!Array.isArray(raw)||!raw.length)throw Error('Original channel coverage unavailable');
  return historyTurn(raw[0].binding,()=>revalidateAgentChannelCoverageHeld(raw,signal),signal);
 }
 async function revalidateAgentChannelCoverageHeld(raw:ReadonlyArray<{binding:ConnectionBinding;bindingId:string;scopeDigest:string}>,signal?:AbortSignal){
  if(!Array.isArray(raw)||raw.length<1||raw.length>3)throw Error('Original channel coverage unavailable');
  const selected=structuredClone(raw),first=selected[0].binding;
  if(new Set(selected.map(x=>x.binding.channel)).size!==selected.length||new Set(selected.map(x=>x.bindingId)).size!==selected.length)throw Error('Original channel coverage unavailable');
  for(const item of selected){assertSameBinding(item.binding,item.binding);if(item.binding.applicationId!==first.applicationId||item.binding.tenantId!==first.tenantId||item.binding.ownerId!==first.ownerId||!item.bindingId||!/^[a-f0-9]{64}$/.test(item.scopeDigest))throw Error('Original channel coverage unavailable');}
  const sources=[];
  for(const item of selected){
   if(signal?.aborted)throw Error('Original channel coverage unavailable');
   const scope={applicationId:item.binding.applicationId,tenantId:item.binding.tenantId,ownerId:item.binding.ownerId};
   await appRead(scope,async()=>undefined);await runtime.store.requireGrant(scope);
   if(await localBinding(item.binding)!==item.bindingId)throw Error('Original channel coverage binding changed');
   const source=await history(item.binding);if(source.repository.scopeDigest('account')!==item.scopeDigest)throw Error('Original channel coverage scope changed');sources.push({item,source});
  }
  let revision:string|undefined;
  for(const {item,source}of sources){
   const projector=createAcquireCoverageProjector({businessClock:service.businessClock,pool:applicationPool,binding:item.binding,bindingId:item.bindingId,subscriberId,codec:appCodec,
    withCoverage:(query,work,options)=>source.repository.withCoverage(query,async proof=>{
     if(signal?.aborted||revision!==undefined&&proof.serviceRevision!==revision)throw Error('Original channel coverage changed during revalidation');
     revision=proof.serviceRevision;return work(proof);
    },options)});
   await projector.project({binding:item.binding,scope:'account',since:'1970-01-01T00:00:00.000Z',cursor:null,refresh:true});
  }
  if(signal?.aborted)throw Error('Original channel coverage unavailable');
  return selected.map(({bindingId,scopeDigest})=>({bindingId,scopeDigest}));
 }
 return {drainRetainedOutbound:retainedOutbound.drain.bind(retainedOutbound),untrackedOutboundReview:retainedOutbound.proof.bind(retainedOutbound),serverDependencies,admission:async(b:ConnectionBinding)=>(await channel(b)).admission,history,consumePending,pendingReplyBindings,recordPendingReplyBinding,readAgentChannelConversation,revalidateAgentChannelCoverage,
  async renewScope(scope:AccessScope){try{return await auth.verify('Bearer '+auth.issue(scope))!==null;}catch{return false;}},
  async currentSubjects(limit=100){if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid subject bound');return runtimeTransaction(service.pool,5000,async c=>{const rows=await c.query<{application_id:string;tenant_id:string;owner_id:string}>(`SELECT application_id,tenant_id,owner_id FROM (SELECT application_id,tenant_id,owner_id FROM communications.connections WHERE application_id=$1 AND backend='unipile' AND active UNION SELECT e.application_id,e.tenant_id,e.owner_id FROM communications.event_outbox o JOIN communications.events e ON e.id=o.event_id AND e.application_id=o.application_id AND e.tenant_id=o.tenant_id AND e.owner_id=o.owner_id JOIN communications.connection_generations g ON g.connection_id=e.connection_id AND g.generation=e.generation AND g.account_id=e.account_id AND g.application_id=e.application_id AND g.tenant_id=e.tenant_id AND g.owner_id=e.owner_id WHERE o.application_id=$1 AND o.subscriber_id=$3 AND o.state IN('pending','delivering') AND g.authority='service' AND g.backend='unipile') subjects ORDER BY tenant_id,owner_id LIMIT $2`,[applicationId,limit,subscriberId]);return rows.rows.map(r=>({applicationId:r.application_id,tenantId:r.tenant_id,ownerId:r.owner_id}));});},
  createWebhooks(){return runtime.createWebhookRuntime({captureCodec,onEmailSentAssociation:async proof=>{if(!proof.snapshot.key.startsWith('acquire:agent:'))return;const b=proof.snapshot.binding,bindingId=await localBinding(b);await appRead(b,async c=>{await lockAcquireSendGate(c,b.tenantId,{required:true});await queueAgentReceiptAssociation(c,bindingId,proof);});},journal:async(binding:ConnectionBinding)=>createPostgresWebhookRepository({businessClock:service.businessClock,pool:service.pool,binding,integrationId:service.integrationId,providerConfigurationReference:service.providerConfigurationReference,subscriberId,codec:captureCodec,eventCodec,replyBarrier:createPostgresReplyBarrier({binding,integrationId:service.integrationId,codec:captureCodec,eventCodec})}),history});},
  /** Private service/body read. All-thread account scan starts at epoch; a
   * provider/history bound that cannot cover it must request human review.
   * Bodies stay out of generic event/outbox payloads and application SQL. */
  async readAgentConversation(binding:ConnectionBinding,recipient:string,signal?:AbortSignal){
   if(binding.channel!=='email')throw Error('Recorded email history unavailable');
   return readAgentChannelConversation(binding,{kind:'email',value:recipient},signal);
  },
  async refreshAndConsume(query:EventQuery,maxDeliveries=100){return historyTurn(query.binding,async()=>{
   if(!Number.isSafeInteger(maxDeliveries)||maxDeliveries<1||maxDeliveries>1000)throw Error('Invalid delivery bound');
   const b=structuredClone(query.binding),scope={applicationId:b.applicationId,tenantId:b.tenantId,ownerId:b.ownerId};
   await appRead(scope,async()=>undefined);await runtime.store.requireGrant(scope);const source=await history(b),result=await source.refresh(query);
   const {bindingId,deliveries}=await consumePending(b,maxDeliveries);
   const projector=createAcquireCoverageProjector({businessClock:service.businessClock,pool:applicationPool,binding:b,bindingId,subscriberId,codec:appCodec,withCoverage:source.repository.withCoverage.bind(source.repository)});
   await projector.project(query);
   return {result,deliveries};
  });}
 };
}
