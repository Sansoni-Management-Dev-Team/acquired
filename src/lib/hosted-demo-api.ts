import {reportHostedDemoFailure} from './hosted-demo-diagnostic';
import type{HostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
import type{HostedRecipientQuery}from'./hosted-demo-recipient-context';
import type{createHostedDemoAuthorityRegistry}from'./hosted-demo-authority-registry';
import{createHash,timingSafeEqual}from'node:crypto';
import{parseRemoteAuthorityRequest,parseRemoteAuthorityResponse,parseAuthoritySnapshot}from'../../communications/packages/core/src/remote-application-authority';
import{parseHostedCoverageProof,parseHostedEventDelivery}from'../../communications/packages/core/src/hosted-proof-sessions';
import{isDeepStrictEqual}from'node:util';
import{parseHostedRecipientRequest,parseHostedRecipientProjection}from'./hosted-demo-recipient-context';
export type HostedDemoApiOptions={descriptor:HostedDemoCommunicationsDescriptor;key:string;subscriberId?:string;proxyListenOrigin?:string;authorizeCurrent:()=>Promise<boolean>;authority:Pick<ReturnType<typeof createHostedDemoAuthorityRegistry>,'execute'>;resolveRecipient:(query:HostedRecipientQuery)=>Promise<unknown>;projectCoverage?:(input:ReturnType<typeof parseHostedCoverageProof>,signal:AbortSignal)=>Promise<unknown>;deliverEvents?:(input:ReturnType<typeof parseHostedEventDelivery>,signal:AbortSignal)=>Promise<unknown>};
async function body(request:Request){
 if(request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!request.body)throw Error('Invalid body');
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let count=0,timer:ReturnType<typeof setTimeout>|undefined;
 try{const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Body deadline')),5000);});for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;count+=next.value.byteLength;if(count>65536||request.signal.aborted)throw Error('Body bound');chunks.push(next.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
 finally{clearTimeout(timer);void reader.cancel().catch(()=>undefined);}
}
/** Persistent-node handler. Authentication identifies only the fixed private
 * demo actor. Every underlying source/admission read still checks membership,
 * original bindings, execution mode and current authority inside Acquire. */
export function createHostedDemoRequestHandler(options:HostedDemoApiOptions){
 const descriptor=structuredClone(options.descriptor),key=options.key,subscriberId=options.subscriberId??'acquire-hosted-demo-replies';
 if(!/^(?:[A-Za-z0-9_-]{43}|[a-f0-9]{64})$/.test(key))throw Error('Hosted demo API unavailable');
 // Next's self-hosted request URL uses its listening address. Only the
 // explicitly configured listener may use the public authority supplied by
 // our TLS proxy; arbitrary request/forwarded hosts never select that origin.
 const canonical=new URL(descriptor.applicationOrigin),listen=options.proxyListenOrigin;
 if(listen){const url=new URL(listen);if(url.origin!==listen||url.protocol!==canonical.protocol||url.hostname!=='0.0.0.0'||!url.port)throw Error('Hosted demo API unavailable');}
 const matchesOrigin=(url:URL,request:Request)=>url.origin===canonical.origin||(listen!==undefined&&url.origin===listen&&request.headers.get('host')===canonical.host&&request.headers.get('x-forwarded-proto')===canonical.protocol.slice(0,-1));
 const digest=(v:string)=>createHash('sha256').update(v).digest(),expected=digest(key),respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});
 return async(request:Request):Promise<Response>=>{
  const url=new URL(request.url),match=/^\/api\/agent\/hosted-demo\/(authority|recipient|access|coverage|events)$/.exec(url.pathname);
  if(!matchesOrigin(url,request)||url.search||!match)return respond({error:'Not available'},404);
  if(request.method!=='POST')return respond({error:'Unsupported method'},405);
  const authorization=request.headers.get('authorization')??'',credential=authorization.startsWith('Bearer ')?authorization.slice(7):'';
  if(credential.length>128||!timingSafeEqual(digest(credential),expected)||request.headers.get('x-acquire-demo-run')!==descriptor.runId||request.headers.get('x-acquire-demo-audience')!=='acquire-hosted-demo-v1')return respond({error:'Not available'},403);
  try{if(await options.authorizeCurrent()!==true)return respond({error:'Not available'},403);}catch(error){reportHostedDemoFailure('callback.access',error);return respond({error:'Hosted demo unavailable'},503);}
  if(match[1]!=='access'&&descriptor.phase!=='active')return respond({error:'Not available'},403);
  let raw:unknown;try{raw=await body(request);}catch{return respond({error:'Invalid request'},400);}
  const kind=match[1];
  if(kind==='access'){if(!raw||typeof raw!=='object'||Object.keys(raw).join(',')!=='version'||(raw as {version?:unknown}).version!==1)return respond({error:'Invalid request'},400);return respond({version:1,authorized:true,scope:descriptor.actor,runId:descriptor.runId,phase:descriptor.phase,authorityReady:descriptor.phase==='active'});}
  if(kind==='authority'){
   let command;try{command=parseRemoteAuthorityRequest(raw,descriptor.actor);}catch{return respond({error:'Invalid request'},400);}
   try{return respond(parseRemoteAuthorityResponse(command,await options.authority.execute(command,request.signal),descriptor.actor));}catch{return respond({error:'Hosted demo unavailable'},503);}
  }
  if(kind==='recipient'){
   let query;try{query=parseHostedRecipientRequest(raw,descriptor);}catch{return respond({error:'Invalid request'},400);}
   try{return respond({version:1,status:'resolved',projection:parseHostedRecipientProjection(await options.resolveRecipient(query),descriptor,query)});}catch{return respond({error:'Hosted demo unavailable'},503);}
  }
  if(kind==='coverage'){
   let proof:ReturnType<typeof parseHostedCoverageProof>;try{proof=parseHostedCoverageProof(raw,descriptor.actor);if(proof.subscriberId!==subscriberId||!descriptor.bindings.some(b=>isDeepStrictEqual(b,proof.coverage.binding))||proof.coverage.scope!=='account'||proof.coverage.from!=='1970-01-01T00:00:00.000Z'||Date.parse(proof.expiresAt)<=Date.now()||Date.parse(proof.expiresAt)>Date.now()+20000)throw Error();}catch{return respond({error:'Invalid request'},400);}
   try{if(!options.projectCoverage)throw Error();await options.projectCoverage(proof,request.signal);return respond({status:'projected'});}catch(error){reportHostedDemoFailure('callback.coverage',error);return respond({error:'Hosted demo unavailable'},503);}
  }
  let event:ReturnType<typeof parseHostedEventDelivery>;try{event=parseHostedEventDelivery(raw,descriptor.actor);if(event.subscriberId!==subscriberId||!descriptor.bindings.some(b=>isDeepStrictEqual(b,event.binding))||Date.parse(event.expiresAt)<=Date.now()||Date.parse(event.expiresAt)>Date.now()+20000)throw Error();}catch{return respond({error:'Invalid request'},400);}
  try{if(!options.deliverEvents)throw Error();const result=await options.deliverEvents(event,request.signal);if(!result||typeof result!=='object'||Object.keys(result).sort().join(',')!=='binding,eventId,fingerprint,status,subscriberId')throw Error();const ack=result as Record<string,unknown>,binding=parseAuthoritySnapshot({binding:ack.binding,key:'event-ack',operation:'message',payloadDigest:'0'.repeat(64)},descriptor.actor).binding;if(!isDeepStrictEqual(binding,event.binding)||ack.subscriberId!==event.subscriberId||ack.eventId!==event.eventId||ack.fingerprint!==event.payload.fingerprint||!['committed','duplicate'].includes(ack.status as string))throw Error();return respond({binding,subscriberId:event.subscriberId,eventId:event.eventId,fingerprint:event.payload.fingerprint,status:ack.status});}catch{return respond({error:'Hosted demo unavailable'},503);}
 };
}
