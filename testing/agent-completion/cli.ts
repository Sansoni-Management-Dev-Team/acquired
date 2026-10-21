import{saveCompletionBuyerProfile}from'./buyer-profile';
import{recordManagedConnection}from'../../src/lib/communications-bindings';import{assertSameBinding}from'../../communications/packages/contracts/src';
import{assertManagementBinding}from'../../communications/packages/contracts/src/management';import type{ConnectionBinding}from'../../communications/packages/contracts/src';
import{open}from'node:fs/promises';import{constants}from'node:fs';import{randomUUID}from'node:crypto';import{z}from'zod';
import{reviewItemSchema}from'../../src/domain/agent-authority';import type{createAgentCompletionRuntime}from'./composition';
import{nativeOutboundDraftSchema}from'../../src/domain/agent-execution';
type Runtime=ReturnType<typeof createAgentCompletionRuntime>;
const uuid=z.string().uuid(),reviewSchema=z.object({runId:z.string().min(1).max(80),organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200),threadId:uuid,batchId:uuid,revision:z.number().int().positive(),manifest:z.array(reviewItemSchema).min(1).max(50).refine(rows=>new Set(rows.map(row=>row.operationId)).size===rows.length)}).strict();
/** Explicit local command dispatcher. The owning CLI bootstrap supplies the
 * attested runtime/profile. No default action, start, approval or external AI. */
export async function runAgentCompletionCli(runtime:Runtime,argv:readonly string[],options:{readReview?:(path:string)=>Promise<unknown>;sourceProfile?:{databaseUrl:string;mandateId:string}}={}){
 const action=argv[0];
 if(['inspect','conversations','reviews','event','budgets','policy'].includes(action)&&argv.length===2){
  const mandateId=uuid.parse(argv[1]);return runtime.operation('cli:'+randomUUID(),async view=>{
   if(action==='event')return{action,mandateId,outcome:await view.runEvent(mandateId)};
   if(action==='budgets')return{action,mandateId,budgets:await view.store.budgetSettings(mandateId)};
   const thread=await view.store.findThread(mandateId);if(!thread)return{action,mandateId,threadId:null};
   if(action==='policy')return{action,mandateId,threadId:thread.id,policy:await view.store.channelPolicy(thread.id)};
   return action==='inspect'||action==='conversations'?{action,mandateId,threadId:thread.id,state:await view.store.executionState(thread.id)}:{action,mandateId,threadId:thread.id,reviews:await view.store.listReviewBatches(thread.id,{pendingOnly:true})};
  });
 }
 if(action==='routes'&&argv.length===3){const mandateId=uuid.parse(argv[1]),conversationId=uuid.parse(argv[2]);return runtime.operation('cli:'+randomUUID(),async view=>{const thread=await view.store.findThread(mandateId);if(!thread)return{action,mandateId,threadId:null,conversationId,routes:[]};return{action,mandateId,threadId:thread.id,conversationId,routes:await view.store.channelRoutes(thread.id,conversationId)};});}
 if(action==='service-tick'&&argv.length===1)return runtime.operation('cli:'+randomUUID(),async view=>{await view.serviceTick();return{action,requested:true};});
 if(action==='review'&&argv.length===3&&['approved','rejected'].includes(argv[1])&&typeof argv[2]==='string'&&argv[2].length>0&&argv[2].length<=4096){
  let artifact:z.infer<typeof reviewSchema>;try{artifact=reviewSchema.parse(await(options.readReview??readPrivateCompletionReview)(argv[2]));}catch{throw Error('Completion review unavailable');}
  if(artifact.runId!==runtime.scope.runId||artifact.organizationId!==runtime.scope.organizationId||artifact.userId!==runtime.scope.userId)throw Error('Completion review scope differs');
  const decision=argv[1]as'approved'|'rejected';return runtime.operation('cli:'+randomUUID(),async view=>({action,decision,batchId:artifact.batchId,result:await view.store.decideReviewBatch(artifact.threadId,artifact.batchId,artifact.revision,artifact.manifest,decision)}));
 }
 if(action==='review.edit'&&argv.length===2&&typeof argv[1]==='string'&&argv[1].length>0&&argv[1].length<=4096){
  const schema=z.object({runId:z.string().min(1).max(80),organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200),threadId:uuid,batchId:uuid,operationId:uuid,revision:z.number().int().positive(),body:z.string().trim().min(1).max(6000)}).strict();
  let artifact:z.infer<typeof schema>;try{artifact=schema.parse(await(options.readReview??readPrivateCompletionReview)(argv[1]));}catch{throw Error('Completion review edit unavailable');}
  if(artifact.runId!==runtime.scope.runId||artifact.organizationId!==runtime.scope.organizationId||artifact.userId!==runtime.scope.userId)throw Error('Completion review edit scope differs');
  return runtime.operation('cli:'+randomUUID(),async view=>({action,result:await view.store.editEmailReview(artifact.threadId,artifact.batchId,artifact.operationId,artifact.revision,artifact.body)}));
 }
 if(action==='operator.message.propose'&&argv.length===2&&typeof argv[1]==='string'&&argv[1].length>0&&argv[1].length<=4096){
  const draft=nativeOutboundDraftSchema.refine(value=>value.kind!=='invitation_linkedin'&&value.routeId!==undefined,'An explicit message route is required'),schema=z.object({runId:z.string().min(1).max(80),organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200),threadId:uuid,requestId:uuid,input:z.object({conversationId:uuid,revision:z.number().int().positive(),contextRevision:z.string().regex(/^[a-f0-9]{64}$/),draft}).strict()}).strict();
  let artifact:z.infer<typeof schema>;try{artifact=schema.parse(await(options.readReview??readPrivateCompletionReview)(argv[1]));}catch{throw Error('Completion operator proposal unavailable');}
  if(artifact.runId!==runtime.scope.runId||artifact.organizationId!==runtime.scope.organizationId||artifact.userId!==runtime.scope.userId)throw Error('Completion operator proposal scope differs');
  return runtime.operation('cli:'+randomUUID(),async view=>({action,authorship:'test-operator',result:await view.store.proposeNativeMessage(artifact.threadId,artifact.requestId,artifact.input,undefined,{forceHumanReview:true})}));
 }
 if(action==='buyer-profile'&&argv.length===2){
  const source=options.sourceProfile;if(!source)throw Error('Completion source profile unavailable');let artifact:{runId:string;organizationId:string;userId:string;mandateId:string;profile:unknown};
  try{artifact=z.object({runId:z.string().min(1).max(80),organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200),mandateId:uuid,profile:z.json()}).strict().parse(await(options.readReview??readPrivateCompletionReview)(argv[1]));}catch{throw Error('Completion source profile unavailable');}
  if(artifact.runId!==runtime.scope.runId||artifact.organizationId!==runtime.scope.organizationId||artifact.userId!==runtime.scope.userId||artifact.mandateId!==source.mandateId)throw Error('Completion source profile scope differs');
  return runtime.operation('cli:'+randomUUID(),async view=>({action,result:await saveCompletionBuyerProfile({pool:view.applicationPool,databaseUrl:source.databaseUrl,mandateId:source.mandateId,scope:runtime.scope,runtimeId:runtime.runtimeId,profile:artifact.profile})}));
 }
 const actor={organizationId:runtime.scope.organizationId,userId:runtime.scope.userId},subject={applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId};
 if(action==='connections'&&argv.length===1)return runtime.operation('cli:'+randomUUID(),async view=>({action,result:await(await view.actorClient(actor)).connections(subject)}));
 if(['connection.setup','connection.status','connection.history','connection.record'].includes(action)&&argv.length===2&&typeof argv[1]==='string'&&argv[1].length>0&&argv[1].length<=4096){
  const binding=z.custom<ConnectionBinding>(value=>{try{assertManagementBinding(value as ConnectionBinding,subject);return true;}catch{return false;}}),common={runId:z.string().min(1).max(80),organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)},setup=z.object({...common,input:z.object({channel:z.enum(['email','whatsapp','linkedin']),platform:z.enum(['gmail','outlook','imap','whatsapp','linkedin']),reconnectBinding:binding.optional()}).strict()}).strict(),status=z.object({...common,binding}).strict();
  let artifact:z.infer<typeof setup>|z.infer<typeof status>;try{artifact=(action==='connection.setup'?setup:status).parse(await(options.readReview??readPrivateCompletionReview)(argv[1]));}catch{throw Error('Completion connection command unavailable');}
  if(artifact.runId!==runtime.scope.runId||artifact.organizationId!==runtime.scope.organizationId||artifact.userId!==runtime.scope.userId)throw Error('Completion command scope differs');
  return runtime.operation('cli:'+randomUUID(),async view=>{
   const client=await view.actorClient(actor);if('input'in artifact)return{action,result:await client.setupConnection(subject,artifact.input)};
   const managed=await client.connectionStatus(artifact.binding);if(action==='connection.status')return{action,result:managed};
   assertSameBinding(artifact.binding,managed.binding);if(managed.active!==true||!['connected','syncing'].includes(managed.status))throw Error('Current exact owned connection required');
   if(action==='connection.record'){const bindingId=await recordManagedConnection(actor,managed,{pool:view.applicationPool});return{action,result:{bindingId,binding:managed.binding}};}
   const source=await view.configured.host.history(artifact.binding),result=await source.refresh({binding:artifact.binding,scope:'account',since:new Date(view.businessTime.context.now()-300000).toISOString(),cursor:null,refresh:true},{signal:AbortSignal.timeout(25000)});
   return{action,result:{status:result.status}};
  });
 }
 if(['control','responsibility','channel-policy','budget','conversation.open','conversation.refresh-held','conversation.resume-held','conversation.review-history','conversation.reassess-reviewed','route.register','handover.begin','handover.commit','handoff','grant.create','grant.channel.create','grant.revoke'].includes(action)&&argv.length===2&&typeof argv[1]==='string'&&argv[1].length>0&&argv[1].length<=4096){
  const common={runId:z.string().min(1).max(80),organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200),requestId:uuid,input:z.json()},threadSchema=z.object({...common,threadId:uuid}).strict(),mandateSchema=z.object({...common,mandateId:uuid}).strict();
  let artifact:z.infer<typeof threadSchema>|z.infer<typeof mandateSchema>;try{artifact=(action==='handoff'?mandateSchema:threadSchema).parse(await(options.readReview??readPrivateCompletionReview)(argv[1]));}catch{throw Error('Completion command unavailable');}
  if(artifact.runId!==runtime.scope.runId||artifact.organizationId!==runtime.scope.organizationId||artifact.userId!==runtime.scope.userId)throw Error('Completion command scope differs');
  return runtime.operation('cli:'+randomUUID(),async view=>{
   let result:unknown;
   if(action==='handoff'&&'mandateId'in artifact)result=await view.store.controlHandoff(artifact.mandateId,artifact.requestId,artifact.input);
   else if('threadId'in artifact){const{threadId,requestId,input}=artifact;
    // Each existing public command parses its own domain schema and enforces
    // membership, revision, history and authority. No generic method dispatch.
    switch(action){
     case'control':case'responsibility':result=await view.store.controlResponsibility(threadId,requestId,input);break;
     case'channel-policy':result=await view.store.saveChannelPolicy(threadId,requestId,input);break;
     case'budget':result=await view.store.configureExecutionBudget(threadId,requestId,input);break;
     case'conversation.open':result=await view.store.openConversation(threadId,requestId,input);break;
     case'conversation.refresh-held':result=await view.store.requestHeldHistoryRefresh(threadId,requestId,input);break;
     case'conversation.resume-held':result=await view.store.resumeHeldConversation(threadId,requestId,input);break;
     case'conversation.review-history':result=await view.store.requestConversationReviewHistory(threadId,requestId,input);break;
     case'conversation.reassess-reviewed':result=await view.store.reassessConversationAfterReview(threadId,requestId,input);break;
     case'route.register':result=await view.store.registerConversationChannel(threadId,requestId,input);break;
     case'handover.begin':result=await view.store.beginConversationHandover(threadId,requestId,input);break;
     case'handover.commit':result=await view.store.commitConversationHandover(threadId,requestId,input);break;
     case'grant.create':result=await view.store.createConversationGrant(threadId,requestId,input);break;
     case'grant.channel.create':result=await view.store.createChannelGrant(threadId,requestId,input);break;
     case'grant.revoke':result=await view.store.revokeConversationGrant(threadId,requestId,input);break;
     default:throw Error('Explicit completion command required');
    }
   }else throw Error('Completion command unavailable');
   return{action,result};
  });
 }
 throw Error('Explicit completion command required');
}
export async function readPrivateCompletionReview(path:string):Promise<unknown>{
 let file:Awaited<ReturnType<typeof open>>|undefined;
 try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);const info=await file.stat();if(!info.isFile()||info.size>200000||(info.mode&0o077)!==0)throw Error();return JSON.parse(await file.readFile('utf8'));}
 catch{throw Error('Private completion review unavailable');}finally{await file?.close();}
}
