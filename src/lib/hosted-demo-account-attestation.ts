import{isDeepStrictEqual}from'node:util';
import{z}from'zod';
import{assertSameBinding,type ConnectionBinding}from'../../communications/packages/contracts/src';
import type{HostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';
const text=z.string().min(1).max(200).refine(v=>v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v));
const wire=z.object({version:z.literal(1),runId:text,scope:z.object({applicationId:z.literal('acquire'),tenantId:text,ownerId:text}).strict(),serviceOrigin:text,integrationId:text,configurationReference:text,observedAt:z.iso.datetime({precision:3}),accounts:z.array(z.object({binding:z.unknown(),status:z.literal('connected'),providerAccountId:text,sourceId:text}).strict()).length(3)}).strict();
/** Reads real service ownership metadata. This authenticates neither a new
 * provider guarantee nor permission to send; reviewed owner registration stores
 * the original response, and ordinary admission/history remain mandatory. */
export async function readHostedDemoAccountAttestation(options:{descriptor:HostedDemoCommunicationsDescriptor;request:(path:string,body:unknown,signal:AbortSignal)=>Promise<unknown>;recorded:(binding:ConnectionBinding)=>Promise<{bindingId:string;bindingDigest:string}>}){
 const descriptor=structuredClone(options.descriptor),fail=():never=>{throw Error('Hosted demo account verification unavailable');};
 try{
  const response=wire.parse(await options.request('/v1/hosted-demo/accounts/attest',{version:1},AbortSignal.timeout(5000)));
  if(response.runId!==descriptor.runId||!isDeepStrictEqual(response.scope,descriptor.actor)||response.serviceOrigin!==descriptor.serviceOrigin||response.integrationId!==descriptor.integrationId||response.configurationReference!==descriptor.configurationReference||Math.abs(Date.now()-Date.parse(response.observedAt))>30000||descriptor.bindings.length!==3)fail();
  const captured=response.accounts.map(account=>{const binding=account.binding as ConnectionBinding;assertSameBinding(binding,binding);if(!descriptor.bindings.some(original=>isDeepStrictEqual(original,binding))||account.providerAccountId!==`sim-${descriptor.runId}-${binding.channel}`||account.sourceId!==`sim-source-${binding.channel}`)fail();return{...account,binding};});
  if(new Set(captured.map(a=>a.binding.channel)).size!==3||new Set(captured.map(a=>a.binding.connectionId)).size!==3||new Set(captured.map(a=>a.binding.accountId)).size!==3)fail();
  const senders=[];for(const channel of['email','whatsapp','linkedin']as const){const account=captured.find(a=>a.binding.channel===channel)??fail(),saved=await options.recorded(account.binding);if(!saved.bindingId||!/^[a-f0-9]{64}$/.test(saved.bindingDigest))fail();senders.push({...account,...saved,active:true});}
  return{attestation:response,senders};
 }catch{return fail();}
}
