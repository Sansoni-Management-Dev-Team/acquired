import 'server-only';
import {AgentPreBeginHistoryError} from './agent-pre-begin-history-error';
import {createHash} from 'node:crypto';
import {localSimulatorTestPolicy} from './agent-simulator-test-policy';
import {settleAgentNoSubmission} from './agent-communications-no-submission';
import {readAgentCommunicationsSource,readAgentChannelCommunicationsSource} from './agent-communications-source';
import {saveReplyIdentity} from './campaign-reply-store';
import {withCampaignDb,type CampaignActor} from '@/db/campaign-client';
import type {AgentOutreachStore} from '@/db/agent-outreach-store';
import type {AgentExecutionFence} from '@/db/agent-execution-store';
import type {NativeHistory} from '@/domain/agent-execution';
import type {AgentChannelRelationship} from '@/domain/agent-invitation';
import {AgentDecisionReviewError} from './agent-conversation-engine';
import {recordedAgentBindingDigest} from '@/db/agent-execution-store';
import {assertSameBinding,type CanonicalIdentity,type ConnectionBinding} from '../../communications/packages/contracts/src';
import {configuredAcquireCommunications} from './communications-configuration';
import {actorCommunicationsClient} from './communications-client';
import {createAgentCommunicationsDelivery} from './agent-communications-delivery';
type RecordedRoute={id:string;conversationId:string;channel:'email'|'whatsapp'|'linkedin';bindingId:string;bindingDigest:string;recipient:CanonicalIdentity};
type ChannelDispatchRecord={conversation:Awaited<ReturnType<AgentOutreachStore['conversation']>>;operation:{input?:Record<string,unknown>};route:RecordedRoute|null;submitted:boolean;notSubmitted:boolean};
type ConfiguredAgentStore=Pick<AgentOutreachStore,'conversation'|'ingestHistory'|'beginNativeCommunicationsEmail'> & {
 preBeginHistoryRetryProof?:(threadId:string,operationId:string,conversationId:string)=>Promise<boolean>;
 channelRoutes?:(threadId:string,conversationId:string)=>Promise<RecordedRoute[]>;
 ingestChannelHistory?:(threadId:string,conversationId:string,routeId:string,history:NativeHistory)=>Promise<unknown>;
 channelDispatchRecord?:(threadId:string,operationId:string)=>Promise<ChannelDispatchRecord>;
 beginNativeCommunicationsMessage?:(threadId:string,operationId:string,authority?:AgentExecutionFence,delegation?:{id:string;revision:number})=>Promise<Awaited<ReturnType<AgentOutreachStore['beginNativeCommunicationsEmail']>>|{operationId:string;conversationId:string;routeId:string;epoch:number;fence:string;bindingId:string;recipient:CanonicalIdentity;channel:'email'|'whatsapp'|'linkedin';subject:string;body:string;effect?:'invitation'}>;
 ingestChannelRelationship?:(threadId:string,conversationId:string,routeId:string,relationship:AgentChannelRelationship)=>Promise<unknown>;
};
/** Trusted host composition. The immutable conversation account is the only
 * selection; defaults and model arguments cannot choose an account. */
export function configuredAgentCommunications(actor:CampaignActor,store:ConfiguredAgentStore){
 type Stage='ports.original_account'|'ports.client'|'ports.status'|'ports.admission'|'dispatch.ports'|'dispatch.recover'|'refresh.ports'|'refresh.save_identity'|'refresh.read_history'|'refresh.ingest'|'dispatch.begin'|'refresh.coverage_revalidate';
 function trace(stage:Stage,outcome:'start'|'complete'|'error',cause?:unknown){
  try{if(!localSimulatorTestPolicy(process.env))return;let sqlState:unknown,errorName:unknown;
   if(cause&&typeof cause==='object'){const code=Object.getOwnPropertyDescriptor(cause,'code'),name=Object.getOwnPropertyDescriptor(cause,'name');if(code&&'value'in code&&['40001','40P01','55P03','57014','42501'].includes(code.value))sqlState=code.value;if(name&&'value'in name&&['Error','TypeError','RangeError','AbortError','ReplyProcessingPendingError'].includes(name.value))errorName=name.value;else if(cause instanceof Error)errorName='Error';}
   console.warn(JSON.stringify({component:'local-simulator-native-communications',stage,outcome,...(errorName?{errorName}:{}),...(sqlState?{sqlState}:{})}));
  }catch{/*Diagnostics never change permissions, outcomes or errors.*/}
 }
 async function observed<T>(stage:Stage,work:()=>Promise<T>):Promise<T>{trace(stage,'start');try{const value=await work();trace(stage,'complete');return value;}catch(cause){trace(stage,'error',cause);throw cause;}}
 async function originalAccount(threadId:string,conversationId:string,route?:RecordedRoute){
  const row=await store.conversation(threadId,conversationId);
  const bindingId=route?.bindingId??row.binding_id,digest=route?.bindingDigest??row.binding_digest,channel=route?.channel??'email';
  if(row.delivery_mode!=='communications'||typeof bindingId!=='string'||route&&route.conversationId!==conversationId)throw Error('Recorded native communications account required');
  const binding=await withCampaignDb(actor,async c=>{
   const rows=(await c.query("SELECT * FROM public.communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND application_id='acquire' AND authority='service' AND backend='unipile'",[bindingId,actor.organizationId,actor.userId])).rows;
   if(rows.length!==1||rows[0].id!==bindingId||rows[0].channel!==channel||recordedAgentBindingDigest(rows[0])!==digest)throw Error('Original native account changed');
   const r=rows[0],value:ConnectionBinding={applicationId:r.application_id,tenantId:r.organization_id,ownerId:r.owner_user_id,connectionId:r.service_connection_id,accountId:r.service_account_id,generation:r.generation,channel:r.channel,platform:r.platform,backend:r.backend};assertSameBinding(value,value);return value;
  });return {row,binding,bindingId};
 }
 async function ports(threadId:string,conversationId:string,route?:RecordedRoute){
  const original=await observed('ports.original_account',()=>originalAccount(threadId,conversationId,route)),client=await observed('ports.client',()=>actorCommunicationsClient(actor));
  // Authenticated status renews service scope, including historical disconnected
  // records. It is not readiness and does not block original receipt recovery.
  await observed('ports.status',()=>client.connectionStatus(original.binding));
  const host=configuredAcquireCommunications().host,admission=await observed('ports.admission',()=>host.admission(original.binding));
  return {...original,client,host,delivery:createAgentCommunicationsDelivery({binding:original.binding,admission,client})};
 }
 async function refresh(threadId:string,conversationId:string){
  const routes=store.channelRoutes?await store.channelRoutes(threadId,conversationId):[];
  if(routes.length){
   if(!store.ingestChannelHistory||routes.length>3||new Set(routes.map(r=>r.channel)).size!==routes.length||new Set(routes.map(r=>r.bindingId)).size!==routes.length)throw Error('Recorded person channel routes need review');
   const selected:Array<{route:RecordedRoute}&Awaited<ReturnType<typeof ports>>>=[];
   for(const route of routes)selected.push({route,...await observed('refresh.ports',()=>ports(threadId,conversationId,route))});
   // Register every explicitly reviewed identity before any account scan can
   // consume a reply. No model input or provider display name supplies a peer.
   for(const {row,route}of selected)await observed('refresh.save_identity',()=>saveReplyIdentity(actor,{contactId:row.contact_id,email:row.recipient_email??null,channel:route.channel,identity:route.recipient.value,sourceIdentity:route.recipient.value,since:new Date('1970-01-01T00:00:00.000Z'),authority:'service'}));
   const coverage:Array<{bindingId:string;scopeDigest:string}>=[];
   for(const {route,binding,host,bindingId,client}of selected){
    const history=await observed('refresh.read_history',()=>host.readAgentChannelConversation(binding,route.recipient));
    assertSameBinding(binding,history.binding);
    const normalized:NativeHistory={source:history.source,observedAt:history.observedAt,complete:history.complete,messages:history.messages.map(m=>({...m,id:'channel-message:'+createHash('sha256').update(JSON.stringify([route.bindingDigest,m.id])).digest('hex'),providerMessageId:m.id,routeId:route.id,channel:route.channel,bindingDigest:route.bindingDigest})),...('deliveryFailures'in history&&history.deliveryFailures?.length?{deliveryFailures:history.deliveryFailures}:{})};
    const ingested=await observed('refresh.ingest',()=>store.ingestChannelHistory!(threadId,conversationId,route.id,normalized));
    if(ingested&&typeof ingested==='object'&&'status'in ingested&&ingested.status==='held'&&(!('historyAccepted'in ingested)||ingested.historyAccepted!==true))throw new AgentDecisionReviewError('The recorded channel history has a conflict and requires human review.');
    if(!history.complete)throw new AgentDecisionReviewError('Full recorded-account channel history needs human review');
    if(route.channel==='linkedin'&&store.ingestChannelRelationship){
     const relationship=await client.inspectRelationship(binding,route.recipient);
     await store.ingestChannelRelationship(threadId,conversationId,route.id,relationship);
    }
    coverage.push({bindingId,scopeDigest:history.scopeDigest});
   }
   // Each completed account scan advances the shared reply barrier. Catch up
   // every original encrypted coverage proof after the final scan, provider-free.
   const caughtUp=await observed('refresh.coverage_revalidate',()=>selected[0].host.revalidateAgentChannelCoverage(selected.map(({binding,bindingId},i)=>({binding,bindingId,scopeDigest:coverage[i].scopeDigest}))));
   if(caughtUp.length!==coverage.length||coverage.some(expected=>!caughtUp.some(actual=>actual.bindingId===expected.bindingId&&actual.scopeDigest===expected.scopeDigest)))throw new AgentDecisionReviewError('Original channel coverage changed before admission');
   return caughtUp;
  }
  const {row,binding,host}=await observed('refresh.ports',()=>ports(threadId,conversationId));
  await observed('refresh.save_identity',()=>saveReplyIdentity(actor,{contactId:row.contact_id,email:row.recipient_email,channel:'email',identity:row.recipient_email,sourceIdentity:row.recipient_email,since:new Date('1970-01-01T00:00:00.000Z'),authority:'service'}));
  const history=await observed('refresh.read_history',()=>host.readAgentConversation(binding,row.recipient_email));
  if('deliveryFailures'in history&&history.deliveryFailures?.length)await observed('refresh.ingest',()=>store.ingestHistory(threadId,conversationId,{source:history.source,observedAt:history.observedAt,complete:false,messages:history.messages,deliveryFailures:history.deliveryFailures}));
  if(!history.complete)throw new AgentDecisionReviewError('Full recorded-account conversation history needs human review');
  await observed('refresh.ingest',()=>store.ingestHistory(threadId,conversationId,{source:history.source,observedAt:history.observedAt,complete:true,messages:history.messages}));
  return [{bindingId:row.binding_id as string,scopeDigest:history.scopeDigest}];
 }
 async function operationRoute(threadId:string,conversationId:string,operationId:string){
  const record=store.channelDispatchRecord?await store.channelDispatchRecord(threadId,operationId):null;
  if(record&&(record.conversation.id!==conversationId||record.operation.input?.routeId&&!record.route))throw Error('Recorded operation route needs review');
  return record?.route??undefined;
 }
 return {refresh,async recover(threadId:string,conversationId:string,operationId:string){const route=await operationRoute(threadId,conversationId,operationId),recovered=await (await ports(threadId,conversationId,route)).delivery.recover(operationId);if(recovered.found&&'noSubmission'in recovered)await settleAgentNoSubmission(actor,operationId,recovered.noSubmission);return recovered;},async dispatch(threadId:string,conversationId:string,operationId:string,authority?:AgentExecutionFence,delegation?:{id:string;revision:number}){
  const route=await operationRoute(threadId,conversationId,operationId),preparedPorts=await observed('dispatch.ports',()=>ports(threadId,conversationId,route)),recovered=await observed('dispatch.recover',()=>preparedPorts.delivery.recover(operationId));
  if(recovered.found){if('noSubmission'in recovered){await settleAgentNoSubmission(actor,operationId,recovered.noSubmission);return {status:'unknown' as const};}return recovered.outcome;}
  let coverageScopes:Array<{bindingId:string;scopeDigest:string}>;
  try{coverageScopes=await refresh(threadId,conversationId);}catch(error){
   let preBegin=false;try{preBegin=await store.preBeginHistoryRetryProof?.(threadId,operationId,conversationId)===true;}catch{/* Missing current proof cannot authorize a retry. */}
   if(preBegin)throw new AgentPreBeginHistoryError(threadId,conversationId,operationId,error);
   throw error;
  }
  if(route&&!store.beginNativeCommunicationsMessage)throw Error('Recorded channel admission unavailable');
  const record=route?await observed('dispatch.begin',()=>store.beginNativeCommunicationsMessage!(threadId,operationId,authority,delegation)):await observed('dispatch.begin',()=>store.beginNativeCommunicationsEmail(threadId,operationId,authority,delegation));
  if(record.conversationId!==conversationId||record.bindingId!==preparedPorts.bindingId||route&&(!('routeId'in record)||record.routeId!==route.id))throw Error('Native source/account changed before admission');
  const source={kind:'agent' as const,operationId:record.operationId,conversationId:record.conversationId,epoch:record.epoch,fence:record.fence,...('effect'in record&&record.effect==='invitation'?{effect:'invitation' as const}:{})};
  if(route){
   const proof=await withCampaignDb(actor,c=>readAgentChannelCommunicationsSource(c,source,record.bindingId));
   if(proof.routeId!==route.id||proof.channel!==route.channel||proof.subject!==record.subject||proof.body!==record.body)throw Error('Native reviewed channel source changed');
   const replyParent=proof.replyParent?{message:{binding:preparedPorts.binding,id:proof.replyParent.id},contentDigest:proof.replyParent.contentDigest}:undefined;
   const message={recipient:proof.recipient,text:proof.body,...(route.channel==='email'?{subject:proof.subject,...(replyParent?{replyParent}:{})}:proof.conversation?{conversation:{binding:preparedPorts.binding,id:proof.conversation.id}}:{})};
   return preparedPorts.delivery.dispatch({source,message,coverageScopes});
  }
  // The same scoped SQL source selects the parent for construction and final
  // admission; no locale/timestamp tie can choose a different client parent.
  const proof=await withCampaignDb(actor,c=>readAgentCommunicationsSource(c,source,record.bindingId));
  const replyParent=proof.replyParent?{message:{binding:preparedPorts.binding,id:proof.replyParent.id},contentDigest:proof.replyParent.contentDigest}:undefined;
  if(typeof record.recipient!=='string')throw Error('Legacy email source required');
  return preparedPorts.delivery.dispatch({source,message:{recipient:{kind:'email',value:record.recipient},subject:record.subject,text:record.body,...(replyParent?{replyParent}:{})},coverageScopes});
 }};
}
