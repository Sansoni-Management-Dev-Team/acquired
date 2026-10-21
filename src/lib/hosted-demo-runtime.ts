import 'server-only';
import{createHash}from'node:crypto';
import{isDeepStrictEqual}from'node:util';
import{z}from'zod';
import{createHostedDemoRequestHandler}from'./hosted-demo-api';
import{readHostedDemoCommunicationsDescriptor,type HostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
import{createHostedDemoRecipientResolver}from'./hosted-demo-recipient-store';
import{createHostedDemoAuthorityRegistry}from'./hosted-demo-authority-registry';
import{createHostedDemoAccessProbe}from'./hosted-demo-access';
import{createHostedDemoProofBridge}from'./hosted-demo-proof-bridge';
import{createAcquireSendAdmission,type AcquireSendAdmission}from'./campaign-send-admission';
import{communicationsExecutionContextLoader}from'./communications-execution-context';
import{readAcquireCommunicationsKeys}from'./communications-configuration';
import{campaignSqlPool,withCampaignDb}from'@/db/campaign-client';
import{createScopedServiceAuth}from'../../communications/packages/core/src/scoped-service-auth';
import{assertOperationMatches,type ConnectionBinding}from'../../communications/packages/contracts/src';
import type{ServiceAdmissionReceipt}from'../../communications/packages/core/src/send-admission';
const fail=():never=>{throw Error('Hosted demo runtime unavailable');};
const secret=(value:string|undefined)=>{if(typeof value!=='string'||!/^(?:[A-Za-z0-9_-]{43}|[a-f0-9]{64})$/.test(value))return fail();const bytes=Buffer.from(value,value.length===64?'hex':'base64url');if(bytes.length!==32)return fail();return bytes;};
const paths=new Set(['/v1/hosted-demo/coverage/project','/v1/hosted-demo/participants','/v1/hosted-demo/accounts/attest','/v1/hosted-demo/admissions/verify','/v1/hosted-demo/no-submission','/v1/hosted-demo/history/read','/v1/hosted-demo/coverage/revalidate','/v1/hosted-demo/events/revalidate']);
/** Single-attempt scoped service RPC; production TLS, fixed private origin and
 * no redirects. Separate from the incoming application-authority credential. */
export function createHostedDemoServiceRequest(descriptor:HostedDemoCommunicationsDescriptor,key:Buffer,fetcher:typeof fetch=fetch){
 const signer=createScopedServiceAuth({key,audience:'communications',applicationId:'acquire',authorize:async()=>false});
 return async(path:string,command:unknown,signal:AbortSignal)=>{
  if(!paths.has(path)||signal.aborted)fail();const controller=new AbortController();let rejectStopped!:(error:Error)=>void;const stopped=new Promise<never>((_,reject)=>{rejectStopped=reject;}),abort=()=>{controller.abort();rejectStopped(Error('Hosted demo runtime unavailable'));};signal.addEventListener('abort',abort,{once:true});const timer=setTimeout(abort,5000);
  const run=async()=>{if(controller.signal.aborted||signal.aborted)fail();const response=await fetcher(descriptor.serviceOrigin+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+signer.issue(descriptor.actor)},body:JSON.stringify(command),redirect:'error',credentials:'omit',signal:controller.signal});if(controller.signal.aborted||!response.ok||response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json'||!response.body)fail();
   const reader=(response.body??fail()).getReader();try{let size=0;const chunks:Uint8Array[]=[];for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>65536||controller.signal.aborted)fail();chunks.push(next.value);}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as unknown;}finally{void reader.cancel().catch(()=>undefined);}
  };
  try{if(signal.aborted)abort();return await Promise.race([run(),stopped]);}catch{return fail();}finally{clearTimeout(timer);signal.removeEventListener('abort',abort);controller.abort();}
 };
}
/** One persistent application node owns these live handles. Restart loses them
 * and rolls back connections; a different replica must refuse unknown handles.
 * Horizontal/serverless deployment needs a separate reviewed ownership design. */
function createRuntime(env:Record<string,string|undefined>){
 if(env.COMMUNICATIONS_RUNTIME_ENABLED!=='true')fail();
 const descriptor=readHostedDemoCommunicationsDescriptor(env),incoming=secret(env.AGENT_HOSTED_DEMO_APP_AUTH_KEY),outgoing=secret(env.AGENT_HOSTED_DEMO_SERVICE_AUTH_KEY);if(incoming.equals(outgoing))fail();
 const actor={organizationId:descriptor.actor.tenantId,userId:descriptor.actor.ownerId},pool=campaignSqlPool(),codec=readAcquireCommunicationsKeys(env,[incoming,outgoing]),serviceRequest=createHostedDemoServiceRequest(descriptor,outgoing),admissions=new Map<string,AcquireSendAdmission>();
 const db=<T>(work:Parameters<typeof withCampaignDb<T>>[1])=>withCampaignDb(actor,work);
 async function localBinding(binding:ConnectionBinding){
  if(!descriptor.bindings.some(value=>isDeepStrictEqual(value,binding)))fail();
  return db(async client=>{const rows=(await client.query("SELECT id FROM public.communication_bindings WHERE application_id=$1 AND organization_id=$2 AND owner_user_id=$3 AND service_connection_id=$4 AND service_account_id=$5 AND generation=$6 AND channel=$7 AND platform=$8 AND backend=$9 AND authority='service'",[binding.applicationId,binding.tenantId,binding.ownerId,binding.connectionId,binding.accountId,binding.generation,binding.channel,binding.platform,binding.backend])).rows;if(rows.length!==1||typeof rows[0].id!=='string')fail();return rows[0].id as string;});
 }
 async function admission(binding:ConnectionBinding){const id=await localBinding(binding),old=admissions.get(id);if(old)return old;
  const load=communicationsExecutionContextLoader(actor),value=createAcquireSendAdmission({pool,binding,bindingId:id,codec,async loadExecutionContext(tx,source){const context=await load(tx,source);if(context.mode!=='demo'||!context.mapping)fail();const runs=await tx.query('SELECT id FROM public.agent_demo_runs WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3 AND run_id=$4 AND integration_id=$5 AND configuration_ref=$6',[(context.mapping??fail()).demoRunId,actor.organizationId,actor.userId,descriptor.runId,descriptor.integrationId,descriptor.configurationReference]);if(runs.rows.length!==1)fail();return context;},
   async verifyServiceAdmission(receipt:ServiceAdmissionReceipt,signal){return z.object({verified:z.boolean()}).strict().parse(await serviceRequest('/v1/hosted-demo/admissions/verify',{receipt},signal)).verified;},
   async proveNoSubmission(snapshot,signal){const result=z.object({proof:z.object({snapshot:z.unknown(),journalId:z.string().min(1).max(200),outcome:z.unknown(),evidenceDigest:z.string().regex(/^[a-f0-9]{64}$/),keyVersion:z.string().min(1).max(64)}).strict().nullable()}).strict().parse(await serviceRequest('/v1/hosted-demo/no-submission',{snapshot},signal));if(!result.proof)return null;assertOperationMatches(snapshot,result.proof.snapshot as typeof snapshot);return{...result.proof,snapshot};}
  });admissions.set(id,value);return value;
 }
 const authority=createHostedDemoAuthorityRegistry({scope:descriptor.actor,admission});
 const subscriberId=env.AGENT_HOSTED_DEMO_SUBSCRIBER_ID??'acquire-hosted-demo-replies';if(!subscriberId||subscriberId.length>200||subscriberId!==subscriberId.trim()||/[\u0000-\u001f\u007f]/.test(subscriberId))fail();
 const bridge=createHostedDemoProofBridge({descriptor,pool,codec,subscriberId,localBinding,serviceRequest});
 const proxyListenOrigin=env.NODE_ENV==='production'&&env.HOSTNAME==='0.0.0.0'&&/^[1-9][0-9]{0,4}$/.test(env.PORT??'')?new URL(descriptor.applicationOrigin).protocol+'//'+env.HOSTNAME+':'+env.PORT:undefined;
 const handler=createHostedDemoRequestHandler({descriptor,proxyListenOrigin,key:env.AGENT_HOSTED_DEMO_APP_AUTH_KEY!,subscriberId,authority,resolveRecipient:createHostedDemoRecipientResolver(descriptor,db),authorizeCurrent:createHostedDemoAccessProbe(descriptor,pool),projectCoverage:bridge.projectCoverage,deliverEvents:bridge.deliverEvents});
 return{descriptor,handler,admission,serviceRequest,localBinding,subscriberId,applicationCodec:codec,applicationPool:pool,close:authority.close};
}
let configured:ReturnType<typeof createRuntime>|undefined,fingerprint:string|undefined;
export function configuredHostedDemoRuntime(){
 if(process.env.AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED!=='true')return fail();
 const hash=createHash('sha256').update(JSON.stringify([process.env.AGENT_HOSTED_DEMO_COMMUNICATIONS_DESCRIPTOR_JSON,process.env.AGENT_HOSTED_DEMO_APP_AUTH_KEY,process.env.AGENT_HOSTED_DEMO_SERVICE_AUTH_KEY,process.env.ACQUIRE_COMMUNICATIONS_KEYRING_JSON,process.env.ACQUIRE_COMMUNICATIONS_ACTIVE_KEY_VERSION,process.env.NODE_ENV,process.env.APP_URL,process.env.DATABASE_URL,process.env.COMMUNICATIONS_RUNTIME_ENABLED,process.env.HOSTNAME,process.env.PORT])).digest('hex');
 if(configured){if(hash!==fingerprint)fail();return configured;}configured=createRuntime({...process.env});fingerprint=hash;return configured;
}
export async function hostedDemoRequest(request:Request){
 if(process.env.AGENT_HOSTED_DEMO_COMMUNICATIONS_ENABLED!=='true')return Response.json({error:'Not available'},{status:404,headers:{'Cache-Control':'no-store'}});
 try{return await configuredHostedDemoRuntime().handler(request);}catch{return Response.json({error:'Hosted demo unavailable'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
