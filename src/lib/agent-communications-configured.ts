import {AgentHistoryCheckpointPendingError} from './agent-history-checkpoint';
import{businessNow}from'../../communications/packages/core/src/business-clock';
import{campaignSendWindowOpen,nextAllowedCampaignSend}from'../domain/campaign';
import{AgentPreBeginSendWindowError}from'./agent-pre-begin-send-window-error';
import{observeDispatchStage,withDispatchObservation}from'../../communications/packages/core/src/dispatch-diagnostic';
import type{Pool,PoolClient}from'pg';
import type{SqlPool}from'../../communications/packages/storage-postgres/src/webhook-repository';
import type{JournalCodec}from'../../communications/packages/core/src/journal-codec';
import type{createAcquireCommunicationsRuntime}from'./communications-runtime';
import{assertAgentBusinessTimeScope,type AgentBusinessTimeSelection}from'./agent-business-time';
import{installAgentBusinessTimeSql,type AgentBusinessDbOptions}from'./agent-business-time-sql';
import 'server-only';
import {readHostedDemoCommunicationsDescriptor} from './hosted-demo-communications-environment';
import {configuredHostedDemoRuntime} from './hosted-demo-runtime';
import {createHostedDemoNativeFacade} from './hosted-demo-native';
import {AgentPreBeginHistoryError} from './agent-pre-begin-history-error';
import {createHash} from 'node:crypto';
import {localSimulatorTestPolicy} from './agent-simulator-test-policy';
import {settleAgentNoSubmission} from './agent-communications-no-submission';
import {readAgentCommunicationsSource,readAgentChannelCommunicationsSource} from './agent-communications-source';
import {registerNativeReplyIdentity} from './agent-recorded-reply-identity';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import type {AgentOutreachStore} from '@/db/agent-outreach-store';
import type {AgentExecutionFence} from '@/db/agent-execution-store';
import type {NativeHistory} from '@/domain/agent-execution';
import type {AgentChannelRelationship} from '@/domain/agent-invitation';
import {AgentDecisionReviewError} from './agent-conversation-engine';
import {recordedAgentBindingDigest} from '@/db/agent-execution-store';
import {assertSameBinding,type CanonicalIdentity,type ConnectionBinding} from '../../communications/packages/contracts/src';
import {configuredAcquireCommunicationsForBinding} from './communications-configuration';
import {actorCommunicationsClient} from './communications-client';
import{captureOriginalSubmission}from'./communications-submission-projection';
import {createAgentCommunicationsDelivery} from './agent-communications-delivery';
type RecordedRoute={id:string;conversationId:string;channel:'email'|'whatsapp'|'linkedin';bindingId:string;bindingDigest:string;recipient:CanonicalIdentity;historyComplete?:boolean;historyObservedAt?:string|null};
type ChannelDispatchRecord={conversation:Awaited<ReturnType<AgentOutreachStore['conversation']>>;operation:{input?:Record<string,unknown>};route:RecordedRoute|null;submitted:boolean;notSubmitted:boolean;originalAccount?:Record<string,unknown>};
type ConfiguredAgentStore=Pick<AgentOutreachStore,'conversation'|'ingestHistory'|'beginNativeCommunicationsEmail'> & {
 channelPolicy?:(threadId:string)=>Promise<{policy:null|{acceleratedSimulation:boolean}}> ;
 testingSendWindowExempt?:(threadId:string,routeId:string)=>Promise<boolean>;
 preBeginHistoryRetryProof?:(threadId:string,operationId:string,conversationId:string)=>Promise<boolean>;
 historyAccountSnapshot?:(threadId:string,conversationId:string)=>Promise<{conversation:ChannelDispatchRecord['conversation'];accounts:Record<string,unknown>[]}>;
 channelRoutes?:(threadId:string,conversationId:string)=>Promise<RecordedRoute[]>;
 ingestChannelHistory?:(threadId:string,conversationId:string,routeId:string,history:NativeHistory)=>Promise<unknown>;
 channelDispatchRecord?:(threadId:string,operationId:string,options?:{includeOriginalAccount?:boolean})=>Promise<ChannelDispatchRecord>;
 beginNativeCommunicationsMessage?:(threadId:string,operationId:string,authority?:AgentExecutionFence,delegation?:{id:string;revision:number})=>Promise<Awaited<ReturnType<AgentOutreachStore['beginNativeCommunicationsEmail']>>|{operationId:string;conversationId:string;routeId:string;epoch:number;fence:string;bindingId:string;recipient:CanonicalIdentity;channel:'email'|'whatsapp'|'linkedin';subject:string;body:string;effect?:'invitation'}>;
 ingestChannelRelationship?:(threadId:string,conversationId:string,routeId:string,relationship:AgentChannelRelationship)=>Promise<unknown>;
};
type AgentCommunicationsHost=Pick<ReturnType<typeof createAcquireCommunicationsRuntime>,'admission'|'readAgentConversation'|'readAgentChannelConversation'|'revalidateAgentChannelCoverage'>;
export type ConfiguredAgentCommunicationsPorts={businessTime?:AgentBusinessTimeSelection;host?:AgentCommunicationsHost;actorClient?:typeof actorCommunicationsClient;applicationPool?:Pick<Pool,'connect'>;applicationCodec?:JournalCodec};
/** Trusted host composition. The immutable conversation account is the only
 * selection; defaults and model arguments cannot choose an account. */
export function configuredAgentCommunications(actor:CampaignActor,store:ConfiguredAgentStore,options:ConfiguredAgentCommunicationsPorts={}){
 const time=options.businessTime;
 if(time){assertAgentBusinessTimeScope(time.context,time.scope);if(time.scope.organizationId!==actor.organizationId||time.scope.userId!==actor.userId)throw Error('Agent business time scope unavailable');if(!options.host||!options.actorClient||!options.applicationPool||!options.applicationCodec)throw Error('Scoped native communications ports unavailable');}
 const dbOptions:AgentBusinessDbOptions|undefined=options.applicationPool||time?{pool:options.applicationPool,businessTime:time}:undefined;
 const withNativeDb=<T>(work:(client:PoolClient)=>Promise<T>,readOnly=false)=>withCampaignDb(actor,async c=>{if(time)await installAgentBusinessTimeSql(c,time,actor);return work(c);},{...(options.applicationPool?{pool:options.applicationPool}:{}),...(readOnly&&!time?{readOnly:true}:{})});
 const applicationSqlPool:SqlPool|undefined=options.applicationPool?{async connect(){const c=await options.applicationPool!.connect();return{async query<Row>(sql:string,values?:unknown[]){const result=await c.query(sql,values);return{rows:result.rows as Row[],rowCount:result.rowCount};},release(error?:Error){c.release(error);}};}}:undefined;
 type Stage='ports.original_account'|'ports.client'|'ports.status'|'ports.admission'|'dispatch.ports'|'dispatch.recover'|'refresh.ports'|'refresh.save_identity'|'refresh.read_history'|'refresh.ingest'|'dispatch.begin'|'dispatch.source'|'refresh.coverage_revalidate';
 function trace(stage:Stage,outcome:'start'|'complete'|'error',cause?:unknown){
  try{if(!localSimulatorTestPolicy(process.env))return;let sqlState:unknown,errorName:unknown;
   if(cause&&typeof cause==='object'){const code=Object.getOwnPropertyDescriptor(cause,'code'),name=Object.getOwnPropertyDescriptor(cause,'name');if(code&&'value'in code&&['40001','40P01','55P03','57014','42501'].includes(code.value))sqlState=code.value;if(name&&'value'in name&&['Error','TypeError','RangeError','AbortError','ReplyProcessingPendingError','ZodError'].includes(name.value))errorName=name.value;else if(cause instanceof Error)errorName='Error';}
   console.warn(JSON.stringify({component:'local-simulator-native-communications',stage,outcome,...(errorName?{errorName}:{}),...(sqlState?{sqlState}:{})}));
  }catch{/*Diagnostics never change permissions, outcomes or errors.*/}
 }
 async function observed<T>(stage:Stage,work:()=>Promise<T>,context:Parameters<typeof observeDispatchStage>[2]={}):Promise<T>{return observeDispatchStage(stage,async()=>{trace(stage,'start');try{const value=await work();trace(stage,'complete');return value;}catch(cause){trace(stage,'error',cause);throw cause;}},context);}
 function cancellationObserver(signal?:AbortSignal){return async<T>(stage:Stage,work:()=>Promise<T>,context:Parameters<typeof observeDispatchStage>[2]={})=>{signal?.throwIfAborted();const value=await observed(stage,work,context);signal?.throwIfAborted();return value;};}
 async function originalAccount(threadId:string,conversationId:string,route?:RecordedRoute,captured?:Pick<ChannelDispatchRecord,'conversation'|'originalAccount'>){
  const row=captured?.conversation??await store.conversation(threadId,conversationId);
  const bindingId=route?.bindingId??row.binding_id,digest=route?.bindingDigest??row.binding_digest,channel=route?.channel??'email';
  if(row.delivery_mode!=='communications'||typeof bindingId!=='string'||route&&route.conversationId!==conversationId)throw Error('Recorded native communications account required');
  const records=captured?[captured.originalAccount]:await withNativeDb(async c=>(await c.query("SELECT * FROM public.communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND application_id='acquire' AND authority='service' AND backend='unipile'",[bindingId,actor.organizationId,actor.userId])).rows,true);
  const r=records[0];
  if(records.length!==1||!r||r.id!==bindingId||r.channel!==channel||r.organization_id!==actor.organizationId||r.owner_user_id!==actor.userId||r.application_id!=='acquire'||r.authority!=='service'||r.backend!=='unipile'||recordedAgentBindingDigest(r)!==digest)throw Error('Original native account changed');
  const binding:ConnectionBinding={applicationId:r.application_id as string,tenantId:r.organization_id as string,ownerId:r.owner_user_id as string,connectionId:r.service_connection_id as string,accountId:r.service_account_id as string,generation:r.generation as number,channel:r.channel as ConnectionBinding['channel'],platform:r.platform as ConnectionBinding['platform'],backend:r.backend as ConnectionBinding['backend']};assertSameBinding(binding,binding);return {row,binding,bindingId};
 }
 async function ports(threadId:string,conversationId:string,route?:RecordedRoute,captured?:Pick<ChannelDispatchRecord,'conversation'|'originalAccount'>,signal?:AbortSignal){
  const observe=cancellationObserver(signal);
  const original=await observe('ports.original_account',()=>originalAccount(threadId,conversationId,route,captured)),client=await observe('ports.client',()=>options.actorClient?options.actorClient(actor):actorCommunicationsClient(actor));
  // Authenticated status renews service scope, including historical disconnected
  // records. It is not readiness and does not block original receipt recovery.
  await observe('ports.status',()=>client.connectionStatus(original.binding));
  let hosted:ReturnType<typeof configuredHostedDemoRuntime>|undefined;
  if(process.env.AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED==='true'){
   const descriptor=readHostedDemoCommunicationsDescriptor(process.env,actor),captured=descriptor.bindings.find(b=>b.connectionId===original.binding.connectionId);
   if(captured){try{assertSameBinding(captured,original.binding);}catch{throw Error('Original hosted account changed');}if(descriptor.phase!=='active'||options.host||time)throw Error('Hosted native communications ports unavailable');hosted=configuredHostedDemoRuntime();}
  }
  const configured=options.host||hosted?undefined:await configuredAcquireCommunicationsForBinding(actor,original.binding),host:AgentCommunicationsHost=options.host??(hosted?createHostedDemoNativeFacade(hosted):configured!.host),admission=await observe('ports.admission',()=>host.admission(original.binding),{bindingId:original.bindingId,channel:original.binding.channel,configurationId:hosted?.descriptor.configurationReference??configured?.options?.providerConfigurationReference});
  return {...original,client,host,delivery:createAgentCommunicationsDelivery({businessClock:time?.context,binding:original.binding,admission,client,async recordSubmitted(operationId,outcome){const receipt=outcome.receipt;const source={bindingId:original.bindingId,binding:original.binding,sourceKind:'agent' as const,sourceId:operationId},expected={effect:'message'in receipt?'message' as const:'invitation' as const,providerReference:'message'in receipt?receipt.message.id:receipt.operation.id,submittedAt:receipt.submittedAt!};if(time)await captureOriginalSubmission(actor,source,expected,{pool:applicationSqlPool!,codec:options.applicationCodec!,admission,client,businessClock:time.context});else if(hosted)await captureOriginalSubmission(actor,source,expected,{pool:hosted.applicationPool,codec:hosted.applicationCodec,admission,client});else await captureOriginalSubmission(actor,source,expected);}})};
 }
 type PreparedRoutePorts={route:RecordedRoute;ports:Awaited<ReturnType<typeof ports>>};
 const sameRoute=(a:RecordedRoute,b:RecordedRoute)=>a.id===b.id&&a.conversationId===b.conversationId&&a.channel===b.channel&&a.bindingId===b.bindingId&&a.bindingDigest===b.bindingDigest&&a.recipient.kind===b.recipient.kind&&a.recipient.value===b.recipient.value;
 // Reuse only the original ports constructed by this dispatch, after reading
 // the current route list again. History, coverage and final SQL admission are
 // still fresh; no metadata or authority survives into another dispatch call.
 async function refresh(threadId:string,conversationId:string,prepared?:PreparedRoutePorts,signal?:AbortSignal,checkpointSince?:string){
  const observe=cancellationObserver(signal);signal?.throwIfAborted();
  const routes=store.channelRoutes?await store.channelRoutes(threadId,conversationId):[];
  signal?.throwIfAborted();
  if(routes.length){
   if(!store.ingestChannelHistory||routes.length>3||new Set(routes.map(r=>r.channel)).size!==routes.length||new Set(routes.map(r=>r.bindingId)).size!==routes.length)throw Error('Recorded person channel routes need review');
   const checkpointAt=checkpointSince===undefined?undefined:Date.parse(checkpointSince);
   if(checkpointAt!==undefined&&(!Number.isFinite(checkpointAt)||checkpointAt>businessNow(time?.context)))throw Error('Invalid history checkpoint time');
   const pending=checkpointAt===undefined?routes:routes.filter(route=>{const observed=Date.parse(route.historyObservedAt??'');return !route.historyComplete||!Number.isFinite(observed)||observed<checkpointAt||observed>businessNow(time?.context)||businessNow(time?.context)-observed>300000;});
   const selected:Array<{route:RecordedRoute}&Awaited<ReturnType<typeof ports>>>=[];
   // This snapshot belongs only to this read refresh. Dispatch retains its exact
   // operation capture and final authority checks; no account cache crosses calls.
   const snapshot=!prepared&&store.historyAccountSnapshot?await store.historyAccountSnapshot(threadId,conversationId):undefined;
   signal?.throwIfAborted();
   const checkpointIdentities:Array<{route:RecordedRoute}&Awaited<ReturnType<typeof originalAccount>>>=[];
   if(checkpointAt!==undefined){
    if(!snapshot)throw Error('Recorded history checkpoint snapshot unavailable');
    for(const route of routes){signal?.throwIfAborted();checkpointIdentities.push({route,...await originalAccount(threadId,conversationId,route,{conversation:snapshot.conversation,originalAccount:snapshot.accounts.find(account=>account.id===route.bindingId)})});}
    if(!pending.length)return [];
   }
   const working=checkpointAt===undefined?routes:pending.slice(0,1);
   for(const route of working){
    const captured=snapshot?{conversation:snapshot.conversation,originalAccount:snapshot.accounts.find(account=>account.id===route.bindingId)}:undefined;
    selected.push({route,...await observe('refresh.ports',()=>prepared&&sameRoute(prepared.route,route)?Promise.resolve(prepared.ports):ports(threadId,conversationId,route,captured,signal))});
   }
   // Register every explicitly reviewed identity before any account scan can
   // consume a reply. No model input or provider display name supplies a peer.
   const identities=checkpointAt===undefined?selected:checkpointIdentities;
   for(const {row,route}of identities)await observe('refresh.save_identity',()=>registerNativeReplyIdentity(actor,{threadId,conversationId,routeId:route.id,bindingId:route.bindingId,identity:{contactId:row.contact_id,email:row.recipient_email??null,channel:route.channel,identity:route.recipient.value,sourceIdentity:route.recipient.value,since:new Date('1970-01-01T00:00:00.000Z'),authority:'service'}},dbOptions));
   const coverage:Array<{bindingId:string;scopeDigest:string}>=[];
   for(const {route,binding,host,bindingId,client}of selected){
    const history=await observe('refresh.read_history',()=>signal?host.readAgentChannelConversation(binding,route.recipient,signal):host.readAgentChannelConversation(binding,route.recipient));
    assertSameBinding(binding,history.binding);
    const normalized:NativeHistory={source:history.source,observedAt:history.observedAt,complete:history.complete,messages:history.messages.map(m=>({...m,id:'channel-message:'+createHash('sha256').update(JSON.stringify([route.bindingDigest,m.id])).digest('hex'),providerMessageId:m.id,routeId:route.id,channel:route.channel,bindingDigest:route.bindingDigest})),...('deliveryFailures'in history&&history.deliveryFailures?.length?{deliveryFailures:history.deliveryFailures}:{})};
    // Persist relationship proof before the channel-history checkpoint so a
    // failed relationship read leaves this route eligible for the next attempt.
    if(checkpointAt!==undefined&&route.channel==='linkedin'&&store.ingestChannelRelationship){
     signal?.throwIfAborted();const relationship=await client.inspectRelationship(binding,route.recipient);signal?.throwIfAborted();
     await store.ingestChannelRelationship(threadId,conversationId,route.id,relationship);
    }
    const ingested=await observe('refresh.ingest',()=>store.ingestChannelHistory!(threadId,conversationId,route.id,normalized));
    if(ingested&&typeof ingested==='object'&&'status'in ingested&&ingested.status==='held'&&(!('historyAccepted'in ingested)||ingested.historyAccepted!==true))throw new AgentDecisionReviewError('The recorded channel history has a conflict and requires human review.');
    if(!history.complete)throw new AgentDecisionReviewError('Full recorded-account channel history needs human review');
    if(checkpointAt===undefined&&route.channel==='linkedin'&&store.ingestChannelRelationship){
     signal?.throwIfAborted();
     const relationship=await client.inspectRelationship(binding,route.recipient);
     signal?.throwIfAborted();
     await store.ingestChannelRelationship(threadId,conversationId,route.id,relationship);
    }
    coverage.push({bindingId,scopeDigest:history.scopeDigest});
   }
   if(checkpointAt!==undefined)throw new AgentHistoryCheckpointPendingError();
   // Each completed account scan advances the shared reply barrier. Catch up
   // every original encrypted coverage proof after the final scan, provider-free.
   const caughtUp=await observe('refresh.coverage_revalidate',()=>selected[0].host.revalidateAgentChannelCoverage(selected.map(({binding,bindingId},i)=>({binding,bindingId,scopeDigest:coverage[i].scopeDigest})),...(signal?[signal]:[])));
   if(caughtUp.length!==coverage.length||coverage.some(expected=>!caughtUp.some(actual=>actual.bindingId===expected.bindingId&&actual.scopeDigest===expected.scopeDigest)))throw new AgentDecisionReviewError('Original channel coverage changed before admission');
   return caughtUp;
  }
  const {row,binding,host}=await observe('refresh.ports',()=>ports(threadId,conversationId,undefined,undefined,signal));
  await observe('refresh.save_identity',()=>registerNativeReplyIdentity(actor,{threadId,conversationId,bindingId:row.binding_id as string,identity:{contactId:row.contact_id,email:row.recipient_email,channel:'email',identity:row.recipient_email,sourceIdentity:row.recipient_email,since:new Date('1970-01-01T00:00:00.000Z'),authority:'service'}},dbOptions));
  const history=await observe('refresh.read_history',()=>signal?host.readAgentConversation(binding,row.recipient_email,signal):host.readAgentConversation(binding,row.recipient_email));
  if('deliveryFailures'in history&&history.deliveryFailures?.length)await observe('refresh.ingest',()=>store.ingestHistory(threadId,conversationId,{source:history.source,observedAt:history.observedAt,complete:false,messages:history.messages,deliveryFailures:history.deliveryFailures}));
  if(!history.complete)throw new AgentDecisionReviewError('Full recorded-account conversation history needs human review');
  await observe('refresh.ingest',()=>store.ingestHistory(threadId,conversationId,{source:history.source,observedAt:history.observedAt,complete:true,messages:history.messages}));
  return [{bindingId:row.binding_id as string,scopeDigest:history.scopeDigest}];
 }
 async function operationAccount(threadId:string,conversationId:string,operationId:string){
  const record=store.channelDispatchRecord?await store.channelDispatchRecord(threadId,operationId,{includeOriginalAccount:true}):null;
  if(record&&(record.conversation.id!==conversationId||record.operation.input?.routeId&&!record.route))throw Error('Recorded operation route needs review');
  return {route:record?.route??undefined,captured:record&&Object.hasOwn(record,'originalAccount')?record:undefined};
 }
 return {refreshCheckpoint:(threadId:string,conversationId:string,since:string,signal?:AbortSignal)=>withDispatchObservation({threadId,conversationId},()=>refresh(threadId,conversationId,undefined,signal,since)),refresh:(threadId:string,conversationId:string,signal?:AbortSignal)=>withDispatchObservation({threadId,conversationId},()=>refresh(threadId,conversationId,undefined,signal)),async recover(threadId:string,conversationId:string,operationId:string){return withDispatchObservation({threadId,conversationId,operationId},async()=>{const {route,captured}=await operationAccount(threadId,conversationId,operationId),recovered=await (await ports(threadId,conversationId,route,captured)).delivery.recover(operationId);if(recovered.found&&'noSubmission'in recovered)await (dbOptions?settleAgentNoSubmission(actor,operationId,recovered.noSubmission,dbOptions):settleAgentNoSubmission(actor,operationId,recovered.noSubmission));return recovered;});},async dispatch(threadId:string,conversationId:string,operationId:string,authority?:AgentExecutionFence,delegation?:{id:string;revision:number}){return withDispatchObservation({threadId,conversationId,operationId},async()=>{
  const {route,captured}=await operationAccount(threadId,conversationId,operationId),capturedRoute=route?structuredClone(route):undefined,preparedPorts=await observed('dispatch.ports',()=>ports(threadId,conversationId,route,captured)),recovered=await observed('dispatch.recover',()=>preparedPorts.delivery.recover(operationId));
  if(recovered.found){if('noSubmission'in recovered){await (dbOptions?settleAgentNoSubmission(actor,operationId,recovered.noSubmission,dbOptions):settleAgentNoSubmission(actor,operationId,recovered.noSubmission));return {status:'unknown' as const};}return recovered.outcome;}
  let coverageScopes:Array<{bindingId:string;scopeDigest:string}>;
  try{coverageScopes=await refresh(threadId,conversationId,capturedRoute?{route:capturedRoute,ports:preparedPorts}:undefined);}catch(error){
   let preBegin=false;try{preBegin=await store.preBeginHistoryRetryProof?.(threadId,operationId,conversationId)===true;}catch{/* Missing current proof cannot authorize a retry. */}
   if(preBegin)throw new AgentPreBeginHistoryError(threadId,conversationId,operationId,error);
   throw error;
  }
  // Known policy closure is a read-only wait, never an attempted effect. Original
  // lookup above stays first, and final SQL admission retains every authority gate.
  if(route&&store.channelPolicy){
   const {policy}=await store.channelPolicy(threadId),instant=businessNow(time?.context);
   if(policy?.acceleratedSimulation===false&&!campaignSendWindowOpen(new Date(instant))&&await store.preBeginHistoryRetryProof?.(threadId,operationId,conversationId)===true&&await store.testingSendWindowExempt?.(threadId,route.id)!==true){
    const next=nextAllowedCampaignSend(new Date(instant)).getTime();
    throw new AgentPreBeginSendWindowError(threadId,conversationId,operationId,new Date(time?next:Date.now()+next-instant).toISOString(),time?.context);
   }
  }
  if(route&&!store.beginNativeCommunicationsMessage)throw Error('Recorded channel admission unavailable');
  const record=route?await observed('dispatch.begin',()=>store.beginNativeCommunicationsMessage!(threadId,operationId,authority,delegation)):await observed('dispatch.begin',()=>store.beginNativeCommunicationsEmail(threadId,operationId,authority,delegation));
  if(record.conversationId!==conversationId||record.bindingId!==preparedPorts.bindingId||route&&(!('routeId'in record)||record.routeId!==route.id))throw Error('Native source/account changed before admission');
  const source={kind:'agent' as const,operationId:record.operationId,conversationId:record.conversationId,epoch:record.epoch,fence:record.fence,...('effect'in record&&record.effect==='invitation'?{effect:'invitation' as const}:{})};
  if(route){
   const proof=await observed('dispatch.source',()=>withNativeDb(c=>readAgentChannelCommunicationsSource(c,source,record.bindingId)),{routeId:route.id,channel:route.channel,bindingId:record.bindingId});
   if(proof.routeId!==route.id||proof.channel!==route.channel||proof.subject!==record.subject||proof.body!==record.body)throw Error('Native reviewed channel source changed');
   const replyParent=proof.replyParent?{message:{binding:preparedPorts.binding,id:proof.replyParent.id},contentDigest:proof.replyParent.contentDigest}:undefined;
   const message={recipient:proof.recipient,text:proof.body,...(route.channel==='email'?{subject:proof.subject,...(replyParent?{replyParent}:{})}:proof.conversation?{conversation:{binding:preparedPorts.binding,id:proof.conversation.id}}:{})};
   return preparedPorts.delivery.dispatch({source,message,coverageScopes});
  }
  // The same scoped SQL source selects the parent for construction and final
  // admission; no locale/timestamp tie can choose a different client parent.
  const proof=await observed('dispatch.source',()=>withNativeDb(c=>readAgentCommunicationsSource(c,source,record.bindingId)),{channel:'email',bindingId:record.bindingId});
  const replyParent=proof.replyParent?{message:{binding:preparedPorts.binding,id:proof.replyParent.id},contentDigest:proof.replyParent.contentDigest}:undefined;
  if(typeof record.recipient!=='string')throw Error('Legacy email source required');
  return preparedPorts.delivery.dispatch({source,message:{recipient:{kind:'email',value:record.recipient},subject:record.subject,text:record.body,...(replyParent?{replyParent}:{})},coverageScopes});
 });}};
}
