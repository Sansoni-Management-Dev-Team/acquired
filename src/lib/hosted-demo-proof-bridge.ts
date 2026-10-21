import{hostedProofDigest,parseHostedCoverageProof,parseHostedEventDelivery,type HostedCoverageProof,type HostedEventDelivery}from'../../communications/packages/core/src/hosted-proof-sessions';
import type{SqlPool}from'../../communications/packages/storage-postgres/src/webhook-repository';
import type{JournalCodec}from'../../communications/packages/core/src/journal-codec';
import type{ConnectionBinding}from'../../communications/packages/contracts/src';
import type{HostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
import{isDeepStrictEqual}from'node:util';
import{createAcquireCoverageProjector}from'./communications-coverage-projector';
import{createCommunicationReplyConsumer}from'./communications-reply-consumer';
import{createRecordedReplyIdentityResolver}from'./communications-reply-identity';
import{createRecordedUnrelatedReplyResolver}from'./communications-unrelated-reply';
export type HostedProofBridgeOptions={descriptor:HostedDemoCommunicationsDescriptor;pool:SqlPool;codec:JournalCodec;subscriberId:string;localBinding:(binding:ConnectionBinding)=>Promise<string>;serviceRequest:(path:string,command:unknown,signal:AbortSignal)=>Promise<unknown>};
/** Uses the original application projector/consumer. The hosted service retains
 * its real coverage/lease transaction until this application COMMIT responds. */
export function createHostedDemoProofBridge(options:HostedProofBridgeOptions){
 const descriptor=structuredClone(options.descriptor),actor={organizationId:descriptor.actor.tenantId,userId:descriptor.actor.ownerId},fail=():never=>{throw Error('Hosted proof unavailable');};
 async function held<T>(proof:HostedCoverageProof|HostedEventDelivery,parent:AbortSignal,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  const binding='coverage'in proof?proof.coverage.binding:proof.binding,remaining=Date.parse(proof.expiresAt)-Date.now();
  if(parent.aborted||remaining<=0||remaining>20000||proof.subscriberId!==options.subscriberId||!descriptor.bindings.some(b=>isDeepStrictEqual(b,binding)))return fail();
  const controller=new AbortController();let rejectStopped!:(e:Error)=>void;const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject;}),abort=()=>{controller.abort();rejectStopped(Error('Hosted proof unavailable'));};parent.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,remaining);
  try{if(parent.aborted)abort();const result=await Promise.race([work(controller.signal),stopped]);if(controller.signal.aborted||parent.aborted||Date.now()>=Date.parse(proof.expiresAt))fail();return result;}catch{return fail();}finally{clearTimeout(timer);parent.removeEventListener('abort',abort);controller.abort();}
 }
 async function verify(path:string,input:unknown,signal:AbortSignal){if(signal.aborted)fail();const result=await options.serviceRequest(path,input,signal);if(!result||typeof result!=='object'||Object.keys(result).join(',')!=='verified'||(result as {verified?:unknown}).verified!==true||signal.aborted)fail();}
 return{
  async projectCoverage(raw:HostedCoverageProof,parent:AbortSignal){const proof=parseHostedCoverageProof(raw,descriptor.actor);return held(proof,parent,async signal=>{
   const binding=proof.coverage.binding,bindingId=await options.localBinding(binding),digest=hostedProofDigest(proof);
   const revalidate=()=>verify('/v1/hosted-demo/coverage/revalidate',{proofDigest:digest,sessionId:proof.sessionId,binding,scopeDigest:proof.scopeDigest,serviceRevision:proof.serviceRevision},signal);
   const projector=createAcquireCoverageProjector({pool:options.pool,codec:options.codec,binding,bindingId,subscriberId:options.subscriberId,async withCoverage(query,work,selection){
    if(query.scope!==proof.coverage.scope||query.since!==proof.coverage.from||query.cursor!==null||query.refresh!==true||!isDeepStrictEqual(query.binding,binding))fail();
    const combined=selection?.signal?AbortSignal.any([signal,selection.signal]):signal;await revalidate();if(combined.aborted)fail();return work({coverage:structuredClone(proof.coverage),scopeDigest:proof.scopeDigest,serviceRevision:proof.serviceRevision,signal:combined,async revalidate(){if(combined.aborted)fail();await revalidate();if(combined.aborted)fail();}});
   }});
   await projector.project({binding,scope:proof.coverage.scope,since:proof.coverage.from,cursor:null,refresh:true});
  });},
  async deliverEvents(raw:HostedEventDelivery,parent:AbortSignal){const event=parseHostedEventDelivery(raw,descriptor.actor);return held(event,parent,async signal=>{
   const binding=event.binding,bindingId=await options.localBinding(binding),digest=hostedProofDigest(event),consumer=createCommunicationReplyConsumer({pool:options.pool,actor,binding,bindingId,subscriberId:options.subscriberId,resolveIdentity:createRecordedReplyIdentityResolver({actor,binding,bindingId}),resolveUnrelated:createRecordedUnrelatedReplyResolver({actor,binding,bindingId}),async authenticateDelivery(input,consumerSignal){
    if(input.bindingId!==bindingId||input.subscriberId!==event.subscriberId||input.serviceEventId!==event.eventId||input.sourceKey!==event.sourceEventKey||!isDeepStrictEqual(input.binding,event.binding)||!isDeepStrictEqual(input.payload,event.payload))return false;
    try{await verify('/v1/hosted-demo/events/revalidate',{proofDigest:digest,sessionId:event.sessionId,binding,subscriberId:event.subscriberId,eventId:event.eventId,fingerprint:event.payload.fingerprint},consumerSignal?AbortSignal.any([signal,consumerSignal]):signal);return true;}catch{return false;}
   }});
   const result=await consumer.apply({binding,bindingId,subscriberId:event.subscriberId,serviceEventId:event.eventId,sourceKey:event.sourceEventKey,payload:event.payload},signal);
   if(signal.aborted||!['applied','duplicate','review'].includes(result.status)||!['stop','ignore','review'].includes(result.decision)||result.status==='review'&&result.decision!=='review')fail();
   return{binding,subscriberId:event.subscriberId,eventId:event.eventId,fingerprint:event.payload.fingerprint,status:result.status==='duplicate'?'duplicate' as const:'committed' as const};
  });}
 };
}
