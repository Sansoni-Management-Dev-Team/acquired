import type{DispatchDiagnosticPort}from'../../communications/packages/core/src/dispatch-diagnostic';
import{AsyncLocalStorage}from'node:async_hooks';import{randomUUID}from'node:crypto';import type{Pool,PoolClient}from'pg';
import{createAgentBusinessTimeContext,type AgentBusinessTimeSelection,type AgentBusinessTimeScope}from'../../src/lib/agent-business-time';
import{agentBusinessTimePool}from'../../src/lib/agent-business-time-pool';
import{AgentInvitationStore}from'../../src/db/agent-invitation-store';
import{configureAcquireCommunications}from'../../src/lib/communications-configuration';
import{configuredAgentCommunications}from'../../src/lib/agent-communications-configured';
import{createAcquireCommunicationsService}from'../../src/lib/communications-service';
import{createNativeAgentHandlers}from'../../src/lib/agent-native-handlers';import{runAgentEvent}from'../../src/lib/agent-event-worker';
import{createNativeModelDecision}from'../../src/lib/agent-model-decision';import type{completeOpenAiJson}from'../../src/adapters/ai/openai';
import{createNativeChatProposalHandler}from'../../src/lib/agent-chat-supervisor';
import{createResearchSupervisor}from'../../src/lib/agent-research-supervisor';import{reuseCachedMandateTargets}from'../../src/lib/agent-people-supervisor';
import{createSequenceApprovedHandler}from'../../src/lib/agent-sequence-supervisor';
import{createScopedServiceAuth}from'../../communications/packages/core/src/scoped-service-auth';import{CommunicationsClient}from'../../communications/packages/sdk/src';
import type{LocalSyncEventsOptions}from'../../communications/packages/core/src/local-sync-event';
import type{SqlPool}from'../../communications/packages/storage-postgres/src/webhook-repository';import{z}from'zod';
export type CompletionClockPort={operation<T>(id:string,work:(snapshot:AgentBusinessTimeScope&{now():number})=>Promise<T>):Promise<T>};
export type AgentCompletionOptions={scope:AgentBusinessTimeScope;runtimeId:string;environment:Record<string,string|undefined>;pools:{application:Pick<Pool,'connect'>;service:Pick<Pool,'connect'>};remoteClock:CompletionClockPort;localSyncEvents?:LocalSyncEventsOptions;diagnostic?:DispatchDiagnosticPort;model:{kind:'local-fixture'|'configured-ai';complete:typeof completeOpenAiJson}};
/** CLI-only current-source composition. Construction performs no SQL, listens on
 * no socket and starts no worker. Remote ownership encloses every operation.
 * This slice excludes external research dispatch. A model port is explicit;
 * it never chooses credentials, enables live AI or bypasses native accounting. */
export function createAgentCompletionRuntime(options:AgentCompletionOptions){
 const scope=createAgentBusinessTimeContext(options.scope,{now:()=>0}).scope;
 const actor=Object.freeze({organizationId:scope.organizationId,userId:scope.userId});
 const runtimeId=z.string().regex(/^[a-z][a-z0-9-]{2,99}$/).parse(options.runtimeId),env=Object.freeze({...options.environment});
 if(!['local-fixture','configured-ai'].includes(options.model?.kind)||typeof options.model.complete!=='function')throw Error('Explicit completion model required');
 const complete=options.model.complete;
 if(options.diagnostic!==undefined&&typeof options.diagnostic!=='function')throw Error('Local dispatch diagnostic unavailable');
 const serviceOrigin=new URL(env.COMMUNICATIONS_SERVICE_URL??'');
 if(serviceOrigin.protocol!=='https:'||serviceOrigin.hostname!=='127.0.0.1'||serviceOrigin.username||serviceOrigin.password||serviceOrigin.pathname!=='/'||serviceOrigin.search||serviceOrigin.hash||env.NODE_ENV==='production')throw Error('Owned local completion service required');
 const encoded=env.COMMUNICATIONS_SCOPED_AUTH_KEY??'',key=Buffer.from(encoded,'base64');
 if(!/^[A-Za-z0-9+/]{43}=$/.test(encoded)||key.length!==32||key.toString('base64')!==encoded)throw Error('Completion scoped credentials unavailable');
 const subject=Object.freeze({applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId}),signer=createScopedServiceAuth({key,audience:'communications',applicationId:'acquire',authorize:async()=>false});
 type Lifetime={accepting:boolean;clients:Set<PoolClient>;pending:Set<Promise<unknown>>};
 const contexts=new AsyncLocalStorage<AgentBusinessTimeSelection>(),ownedContexts=new WeakSet<AgentBusinessTimeSelection>(),lifetimes=new WeakMap<AgentBusinessTimeSelection,Lifetime>();let active=0,closed=false;
 const current=()=>{const selected=contexts.getStore();if(!selected||closed||!ownedContexts.has(selected)||!lifetimes.get(selected)?.accepting)throw Error('Completion operation required');return selected;};
 const businessClock=Object.freeze({now:()=>current().context.now()});
 function track<T>(life:Lifetime,promise:Promise<T>){life.pending.add(promise);void promise.then(()=>life.pending.delete(promise),()=>life.pending.delete(promise));return promise;}
 function scopedPool(raw:Pick<Pool,'connect'>):Pick<Pool,'connect'>{return{async connect(){
  const selected=current(),life=lifetimes.get(selected)!;
  return track(life,(async()=>{const client=await agentBusinessTimePool(raw,{runtimeId,businessTime:selected}).connect();if(!life.accepting){client.release(Error('Completion connection ownership ended'));throw Error('Completion operation required');}
   const owned=new Proxy(client,{get(target,property){
    if(property==='query')return(...input:unknown[])=>{const args=[...input],callback=typeof args.at(-1)==='function'?args.pop()as(error:unknown,result?:unknown)=>void:undefined;
     const pending=track(life,(async()=>{if(current()!==selected)throw Error('Completion operation changed');return Reflect.apply(target.query,target,args);})());
     if(callback){void pending.then(result=>callback(null,result),error=>callback(error));return;}return pending;};
    if(property==='release')return(error?:Error)=>{life.clients.delete(owned);target.release(error);};
    const value=Reflect.get(target,property,target);return typeof value==='function'?value.bind(target):value;
   }})as PoolClient;life.clients.add(owned);return owned;})());
 }}as Pick<Pool,'connect'>;}
 const applicationPool=scopedPool(options.pools.application),servicePool=scopedPool(options.pools.service);
 const sqlPool=(pool:Pick<Pool,'connect'>):SqlPool=>({async connect(){const c=await pool.connect();return{async query<Row>(sql:string,values?:unknown[]){const result=await c.query(sql,values);return{rows:result.rows as Row[],rowCount:result.rowCount};},release(error?:Error){c.release(error);}};}});
 const pools={application:sqlPool(applicationPool),service:sqlPool(servicePool)};
 let configured:ReturnType<typeof configureAcquireCommunications>|undefined,servicePromise:Promise<Awaited<ReturnType<typeof createAcquireCommunicationsService>>>|undefined;
 function configuration(){current();return configured??=configureAcquireCommunications({...env},pools,{businessClock,scope:subject,...(options.localSyncEvents?{localSyncEvents:options.localSyncEvents}:{}),...(options.diagnostic?{diagnostic:options.diagnostic}:{})});}
 const actorClient=async(requested:typeof actor)=>{current();if(requested.organizationId!==actor.organizationId||requested.userId!==actor.userId)throw Error('Completion actor differs');return new CommunicationsClient({baseUrl:serviceOrigin.origin,businessClock,contractVersion:'1',apiKey:signer.issue(subject),allowLoopbackHttp:false,timeoutMs:28000,...(env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN?{localSimulatorOrigin:env.COMMUNICATIONS_LOCAL_SIMULATOR_ORIGIN}:{})});};
 async function service():Promise<Awaited<ReturnType<typeof createAcquireCommunicationsService>>>{current();return servicePromise??=createAcquireCommunicationsService(configuration(),{aroundRequest:<T>(work:()=>Promise<T>)=>operation('http:'+randomUUID(),async()=>work())});}
 async function operation<T>(id:string,work:(session:ReturnType<typeof view>)=>Promise<T>):Promise<T>{
  if(closed)throw Error('Completion runtime closed');if(!/^[a-zA-Z0-9][a-zA-Z0-9_.:@-]{0,159}$/.test(id))throw Error('Completion operation id unavailable');
  active++;
  try{return await options.remoteClock.operation(id,async snapshot=>{
   if(snapshot.runId!==scope.runId||snapshot.organizationId!==scope.organizationId||snapshot.userId!==scope.userId)throw Error('Completion clock scope differs');
   const businessTime={context:createAgentBusinessTimeContext(scope,snapshot),scope};
   const life:Lifetime={accepting:true,clients:new Set(),pending:new Set()};lifetimes.set(businessTime,life);ownedContexts.add(businessTime);
   let result:T|undefined,failure:unknown,failed=false;
   try{result=await contexts.run(businessTime,async()=>work(view()));}catch(error){failed=true;failure=error;}
   life.accepting=false;const unfinished=life.clients.size>0||life.pending.size>0;
   await Promise.allSettled([...life.pending]);
   for(const client of [...life.clients])client.release(Error('Completion operation ownership ended'));
   ownedContexts.delete(businessTime);
   if(failed)throw failure;if(unfinished)throw Error('Completion operation has unfinished SQL');return result as T;
  });}finally{active--;}
 }
 function view(){
  const businessTime=current(),configured=configuration();
  const own=()=>{if(current()!==businessTime)throw Error('Completion operation changed');};
  const bind=(pool:Pick<Pool,'connect'>):Pick<Pool,'connect'>=>({async connect(){own();return pool.connect();}}as Pick<Pool,'connect'>);
  const operationApplicationPool=bind(applicationPool),operationServicePool=bind(servicePool),store=new AgentInvitationStore(operationApplicationPool,actor,{businessTime});
  const communications=configuredAgentCommunications(actor,store,{businessTime,host:configured.host,actorClient:async requested=>{own();return actorClient(requested);},applicationPool:operationApplicationPool,applicationCodec:configured.applicationCodec});
  return{businessTime,applicationPool:operationApplicationPool,servicePool:operationServicePool,configured,store,communications,actorClient:async(requested:typeof actor)=>{own();return actorClient(requested);},
   async service(){own();return service();},async serviceTick(){own();return(await service()).tick([subject]);},
   async runEvent(mandateId:string,workerId=randomUUID()){
    own();z.string().uuid().parse(mandateId);z.string().uuid().parse(workerId);
    const handlers=createNativeAgentHandlers({store,businessTime,
     decide:input=>createNativeModelDecision({store,...input,complete,now:()=>new Date(businessTime.context.now()).toISOString()}),
     channelDue:(threadId,payload)=>store.channelDueReassessment(threadId,payload),chatProposal:createNativeChatProposalHandler(store),
     supervise:createResearchSupervisor(store,{reuseCached:reuseCachedMandateTargets(store)}),sequenceApproved:createSequenceApprovedHandler(store),
     targetApproved:async input=>{const{reviewBatchId}=z.object({reviewBatchId:z.string().uuid()}).parse(input.event.payload),targets=await store.reviewDispatchTargets(input.event.thread_id,reviewBatchId);if(!targets.length||targets.some(target=>target.name!=='target.select'))return{kind:'review',message:'Contact allocation requires its exact reviewed batch.'};for(const target of targets){await input.assertCurrent();await store.allocateApprovedTargets(input.event.thread_id,target.id,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});}return{kind:'complete'};},
     reconcileProvider:async(threadId,operationId,authority)=>{const record=await store.channelDispatchRecord(threadId,operationId);if(record.notSubmitted||record.submitted)return{known:true};const recovered=await communications.recover(threadId,record.conversation.id,operationId);if(!recovered.found)return{known:await store.abandonUnpreparedNativeEmail(threadId,operationId,authority)};if('noSubmission'in recovered)return{known:true};if(recovered.outcome.status!=='submitted')return{known:false};await store.markNativeCommunicationsOutcome(threadId,operationId,recovered.outcome);return{known:true};},
     refreshProviderHistory:(threadId,conversationId)=>communications.refresh(threadId,conversationId).then(()=>undefined),
     dispatchProvider:async(threadId,operationId,authority,delegation)=>{const record=await store.channelDispatchRecord(threadId,operationId),outcome=await communications.dispatch(threadId,record.conversation.id,operationId,authority,delegation);if(outcome.status==='unknown'&&(await store.channelDispatchRecord(threadId,operationId)).notSubmitted)return;await store.markNativeCommunicationsOutcome(threadId,operationId,outcome);},
     handoffReminder:async input=>{await input.assertCurrent();await store.fireHandoffReminder(input.event.thread_id,'handoff-reminder:'+input.event.id,input.event.payload,{runId:input.runId,eventId:input.event.id,leaseOwner:input.event.lease_owner,fence:input.event.fence});return{kind:'complete'};},
    });
    const activeHandlers=new Set<Promise<unknown>>(),tracked=Object.fromEntries(Object.entries(handlers).map(([name,handler])=>[name,(input:Parameters<typeof handler>[0])=>{const work=Promise.resolve().then(()=>handler(input));activeHandlers.add(work);void work.then(()=>activeHandlers.delete(work),()=>activeHandlers.delete(work));return work;}]));
    try{return await runAgentEvent({store,mandateId,workerId,handlers:tracked});}finally{await Promise.allSettled([...activeHandlers]);}
   },
  };
 }
 return{scope,runtimeId,operation,async close(){if(active)throw Error('Completion operations still active');if(closed)return;closed=true;if(servicePromise)await(await servicePromise).close();}};
}
