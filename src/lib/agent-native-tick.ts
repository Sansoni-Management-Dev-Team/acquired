import{observeDispatchStage,withDispatchObservation}from'../../communications/packages/core/src/dispatch-diagnostic';
import{assertAgentBusinessTimeScope,type AgentBusinessTimeSelection}from'./agent-business-time';
import{installAgentBusinessTimeSql}from'./agent-business-time-sql';
import{createFieldsApprovedHandler,createFieldsDispatchHandler}from'./agent-fields-supervisor';
import{prepareMandateDemoContacts}from'./agent-demo-command';
import {nativeWorkerMandateScope,nativeRegisteredRuntime} from './agent-worker-scope';
import {createSequenceApprovedHandler} from './agent-sequence-supervisor';
import {createNativeChatProposalHandler} from './agent-chat-supervisor';
import {createResearchCompletedSupervisor,reuseCachedMandateTargets} from './agent-people-supervisor';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {AgentActor} from '@/db/agent-store';
import {agentActorSchema} from '@/db/agent-store';
import {agentPool,agentStore,nativeAgentEnabled} from './agent-runtime';
import {runAgentEvent} from './agent-event-worker';
import {createNativeAgentHandlers} from './agent-native-handlers';
import {createResearchSupervisor,createResearchApprovedHandler,createResearchDispatchHandler} from './agent-research-supervisor';
import {superviseInitialMandateResearch} from './agent-initial-research';
import {createPeopleApprovedHandler,createPeopleDispatchHandler} from './agent-people-supervisor';
import {configuredAgentCommunications,type ConfiguredAgentCommunicationsPorts} from './agent-communications-configured';
const outcomeSchema=z.enum(['idle','complete','review','defer','lost']);
type TickOutcome=z.infer<typeof outcomeSchema>;
export async function runNativeTickWithPorts(options:{businessTime?:AgentBusinessTimeSelection;enabled:boolean;mandateId?:string;requireMandateScope?:boolean;scopeMode?:string;runtimeId?:string;listRegisteredScopes?:(maximum:number,runtimeId:string)=>Promise<unknown>;listRegisteredReviewRecovery?:(maximum:number,runtimeId:string)=>Promise<unknown>;recoverReview?:(actor:AgentActor,requestKey:string)=>Promise<unknown>;listScopes:(maximum:number,mandateId?:string)=>Promise<unknown>;processScope:(actor:AgentActor,mandateId?:string)=>Promise<TickOutcome>}){
 if(!options.enabled)return {enabled:false,processed:0} as const;
 const runtimeId=nativeRegisteredRuntime({scopeMode:options.scopeMode,runtimeId:options.runtimeId,mandateId:options.mandateId,required:options.requireMandateScope});
 const processScope=(actor:AgentActor,mandateId?:string)=>withDispatchObservation({mandateId,runtimeId:runtimeId??undefined},()=>observeDispatchStage('native.scope',()=>mandateId===undefined?options.processScope(actor):options.processScope(actor,mandateId)));
 const businessTime=options.businessTime;
 if(businessTime){assertAgentBusinessTimeScope(businessTime.context,businessTime.scope);if(!runtimeId)throw Error('Agent business time scope unavailable');}
 const assertActor=(actor:AgentActor)=>{if(businessTime&&(actor.organizationId!==businessTime.context.scope.organizationId||actor.userId!==businessTime.context.scope.userId))throw Error('Agent business time scope unavailable');};
 if(runtimeId){
  if(!options.listRegisteredScopes)throw Error('Registered native worker enumeration unavailable');
  if(options.listRegisteredReviewRecovery){
   if(!options.recoverReview)throw Error('Registered review recovery unavailable');
   const recovery=z.array(agentActorSchema.extend({requestKey:z.string().uuid()})).max(10).parse(await options.listRegisteredReviewRecovery(10,runtimeId));
   if(new Set(recovery.map(row=>JSON.stringify(row))).size!==recovery.length)throw Error('Duplicate registered review recovery scope');
   recovery.forEach(assertActor);
   for(const {requestKey,...actor} of recovery)await options.recoverReview(actor,requestKey);
  }

  const rows=z.array(agentActorSchema.extend({mandateId:z.string().uuid()})).max(10).parse(await options.listRegisteredScopes(10,runtimeId));
  if(new Set(rows.map(row=>JSON.stringify(row))).size!==rows.length)throw Error('Duplicate registered native worker scopes');
  rows.forEach(assertActor);
  for(const {mandateId,...actor} of rows){const outcome=outcomeSchema.parse(await processScope(actor,mandateId));if(outcome!=='idle')return {enabled:true,processed:1,outcome} as const;}
 }else{
  const mandateId=nativeWorkerMandateScope({mandateId:options.mandateId,required:options.requireMandateScope}),scopes=z.array(agentActorSchema).max(10).parse(mandateId?await options.listScopes(10,mandateId):await options.listScopes(10));
  if(new Set(scopes.map(scope=>JSON.stringify(scope))).size!==scopes.length)throw Error('Duplicate native worker scopes');
  for(const actor of scopes){const outcome=outcomeSchema.parse(await (mandateId?processScope(actor,mandateId):processScope(actor)));if(outcome!=='idle')return {enabled:true,processed:1,outcome} as const;}
 }
 return {enabled:true,processed:0,outcome:'idle'} as const;
}
/** A cancelled HTTP caller cannot cancel PostgreSQL work by itself. Bound
 * discovery on the server and discard any session whose rollback is uncertain. */
async function nativeDiscovery<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{
 const raw=await agentPool().connect();let discarded=false;
 const client=new Proxy(raw,{get(target,key){
  if(key==='query')return(text:string,values?:unknown[])=>{const config={text,values,query_timeout:6500};return target.query(config);};
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 try{
  await client.query('BEGIN');
  await client.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true)",['5000ms','1000ms']);
  await client.query('SET LOCAL ROLE acquire_agent_worker');
  const role=(await client.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(role?.name!=='acquire_agent_worker'||role.rolsuper||role.rolbypassrls)throw Error('Native worker role must enforce row scope');
  const result=await work(client);await client.query('COMMIT');return result;
 }catch(error){
  try{await client.query('ROLLBACK');}catch{
   raw.release(error instanceof Error?error:Error('Native discovery transaction unavailable'));discarded=true;
  }
  throw error;
 }finally{if(!discarded)raw.release();}
}
export async function listDueNativeAgentScopes(maximum:number,mandateId?:string){
 z.number().int().min(1).max(10).parse(maximum);if(mandateId!==undefined)z.string().uuid().parse(mandateId);
 return nativeDiscovery(async client=>{
  const rows=(await (mandateId?client.query('SELECT * FROM agent_worker_scopes_for_mandate($1::integer,$2::uuid)',[maximum,mandateId]):client.query('SELECT * FROM agent_worker_scopes($1::integer)',[maximum]))).rows;
  return rows.map(row=>({organizationId:row.organization_id,userId:row.owner_user_id}));
 });
}
export async function listRegisteredNativeAgentScopes(maximum:number,runtimeId:string,businessTime?:AgentBusinessTimeSelection){
 z.number().int().min(1).max(10).parse(maximum);nativeRegisteredRuntime({scopeMode:'registered',runtimeId,required:true});if(businessTime)assertAgentBusinessTimeScope(businessTime.context,businessTime.scope);
 return nativeDiscovery(async client=>{
  await client.query("SELECT set_config('app.acquire_runtime_id',$1,true)",[runtimeId]);
  if(businessTime){await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[businessTime.context.scope.organizationId,businessTime.context.scope.userId]);await installAgentBusinessTimeSql(client,businessTime,businessTime.context.scope);}
  const rows=(await client.query('SELECT * FROM agent_registered_worker_scopes($1::integer,$2::text)',[maximum,runtimeId])).rows;
  return rows.map(row=>({organizationId:row.organization_id,userId:row.owner_user_id,mandateId:row.mandate_id}));
 });
}
export async function listRegisteredReviewRecoveryScopes(maximum:number,runtimeId:string,businessTime?:AgentBusinessTimeSelection){
 z.number().int().min(1).max(10).parse(maximum);nativeRegisteredRuntime({scopeMode:'registered',runtimeId,required:true});if(businessTime)assertAgentBusinessTimeScope(businessTime.context,businessTime.scope);
 return nativeDiscovery(async c=>{
  await c.query("SELECT set_config('app.acquire_runtime_id',$1,true)",[runtimeId]);
  if(businessTime){await c.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)",[businessTime.context.scope.organizationId,businessTime.context.scope.userId]);await installAgentBusinessTimeSql(c,businessTime,businessTime.context.scope);}
  // Until the exact forward migration is approved, the normal API hook remains available.
  const installed=(await c.query("SELECT to_regprocedure('public.agent_registered_review_recovery_scopes(integer,text)') IS NOT NULL AS installed")).rows[0]?.installed;if(typeof installed!=='boolean')throw Error('Review recovery capability unknown');
  const rows=installed?(await (businessTime?c.query('SELECT * FROM public.agent_registered_review_recovery_scopes($1,$2) WHERE organization_id=$3 AND owner_user_id=$4',[maximum,runtimeId,businessTime.context.scope.organizationId,businessTime.context.scope.userId]):c.query('SELECT * FROM public.agent_registered_review_recovery_scopes($1,$2)',[maximum,runtimeId]))).rows:[];
  return rows.map(r=>({organizationId:r.organization_id,userId:r.owner_user_id,requestKey:r.review_request_key}));
 });
}
export async function runNativeAgentTick(options:{businessTime?:AgentBusinessTimeSelection;communications?:ConfiguredAgentCommunicationsPorts}={}){
 if(options.communications?.businessTime&&options.communications.businessTime.context!==options.businessTime?.context)throw Error('Agent business time scope unavailable');
 return runNativeTickWithPorts({businessTime:options.businessTime,enabled:nativeAgentEnabled(),scopeMode:process.env.AGENT_WORKER_SCOPE_MODE,runtimeId:process.env.AGENT_WORKER_RUNTIME_ID,listRegisteredScopes:(maximum,runtimeId)=>listRegisteredNativeAgentScopes(maximum,runtimeId,options.businessTime),listRegisteredReviewRecovery:(maximum,runtimeId)=>listRegisteredReviewRecoveryScopes(maximum,runtimeId,options.businessTime),recoverReview:(actor,key)=>agentStore(actor,options).reconcileCommittedChannelReview(key),mandateId:process.env.AGENT_WORKER_MANDATE_ID,requireMandateScope:z.enum(['true','false']).optional().parse(process.env.AGENT_WORKER_REQUIRE_MANDATE_SCOPE)==='true',listScopes:listDueNativeAgentScopes,processScope:async(actor,mandateId)=>{
  const store=agentStore(actor,options),communications=options.communications||options.businessTime?configuredAgentCommunications(actor,store,{...options.communications,businessTime:options.businessTime}):configuredAgentCommunications(actor,store);return runAgentEvent({store,mandateId,workerId:randomUUID(),handlers:createNativeAgentHandlers({store,businessTime:options.businessTime,channelDue:(threadId,payload)=>store.channelDueReassessment(threadId,payload),chatProposal:createNativeChatProposalHandler(store),supervise:createResearchSupervisor(store,{initialResearch:input=>superviseInitialMandateResearch(agentPool(),actor,input.event.thread_id),reuseCached:reuseCachedMandateTargets(store)}),researchApproved:createResearchApprovedHandler(store),researchDispatch:createResearchDispatchHandler(store),researchCompleted:createResearchCompletedSupervisor(store,{prepareDemoContacts:({mandateId,requestKey})=>prepareMandateDemoContacts(actor,mandateId,requestKey)}),fieldsApproved:createFieldsApprovedHandler(store),fieldsDispatch:createFieldsDispatchHandler(store),peopleApproved:createPeopleApprovedHandler(store),peopleDispatch:createPeopleDispatchHandler(store),sequenceApproved:createSequenceApprovedHandler(store),targetApproved:async input=>{
   const {reviewBatchId}=z.object({reviewBatchId:z.string().uuid()}).parse(input.event.payload);
   const targets=await store.reviewDispatchTargets(input.event.thread_id,reviewBatchId);
   if(!targets.length||targets.some(target=>target.name!=='target.select'))return {kind:'review',message:'Contact allocation requires its exact reviewed batch.'};
   for(const target of targets){await input.assertCurrent();await store.allocateApprovedTargets(input.event.thread_id,target.id,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});}
   return {kind:'complete'};
  },reconcileProvider:async(threadId,operationId,authority)=>{
   const record=await store.channelDispatchRecord(threadId,operationId);
   if(record.notSubmitted||record.submitted)return {known:true};
   const recovered=await communications.recover(threadId,record.conversation.id,operationId);
   if(!recovered.found)return {known:await store.abandonUnpreparedNativeEmail(threadId,operationId,authority)};
   if(recovered.found&&'noSubmission'in recovered)return {known:true};
   if(recovered.outcome.status!=='submitted')return {known:false};
   await store.markNativeCommunicationsOutcome(threadId,operationId,recovered.outcome);return {known:true};
  },refreshProviderHistory:async(threadId,conversationId)=>{await communications.refresh(threadId,conversationId);},dispatchProvider:async(threadId,operationId,authority,delegation)=>{
   const record=await store.channelDispatchRecord(threadId,operationId);
   const outcome=await communications.dispatch(threadId,record.conversation.id,operationId,authority,delegation);
   if(outcome.status==='unknown'&&(await store.channelDispatchRecord(threadId,operationId)).notSubmitted)return;
   await store.markNativeCommunicationsOutcome(threadId,operationId,outcome);
  },handoffReminder:async input=>{
   await input.assertCurrent();await store.fireHandoffReminder(input.event.thread_id,'handoff-reminder:'+input.event.id,input.event.payload,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});return {kind:'complete'};
  }})});
 }});
}
