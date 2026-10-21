import{isDeepStrictEqual,types}from'node:util';
import{z}from'zod';
import{assertSameBinding,type CanonicalIdentity,type ConnectionBinding}from'../../communications/packages/contracts/src';
import{parseAuthorityRecipient}from'../../communications/packages/core/src/remote-application-authority';
import type{HostedDemoCommunicationsDescriptor}from'./hosted-demo-communications-environment';

export interface HostedDemoNativeRuntime<Admission=unknown>{
 descriptor:HostedDemoCommunicationsDescriptor;
 admission(binding:ConnectionBinding):Admission;
 localBinding(binding:ConnectionBinding):Promise<string>;
 serviceRequest(path:string,body:unknown,signal:AbortSignal):Promise<unknown>;
}
const fail:()=>never=()=>{throw Error('Hosted channel history unavailable');};
const id=z.string().min(1).max(300).refine(v=>v===v.trim()&&!/[\u0000-\u001f\u007f]/.test(v));
const stamp=z.string().refine(v=>Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v);
const coverage=z.object({binding:z.unknown(),scope:z.literal('account'),from:z.literal('1970-01-01T00:00:00.000Z'),through:stamp,observedAt:stamp,complete:z.boolean(),initialSyncComplete:z.boolean(),invalidated:z.boolean()}).strict();
const message=z.object({id,direction:z.enum(['inbound','outbound']),text:z.string().max(6000),at:stamp,subject:z.string().max(300).optional(),providerConversationId:id.optional()}).strict();
const historySchema=z.object({binding:z.unknown(),coverage,source:z.literal('communications'),observedAt:stamp,complete:z.boolean(),messages:z.array(message).max(200),scopeDigest:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().max(300).optional(),deliveryFailures:z.array(z.object({id,at:stamp}).strict()).max(200).optional()}).strict();
/** RPC data must be plain bounded JSON. Accessors/proxies never enter parsers,
 * authority methods or downstream native history as trusted evidence. */
function plain(value:unknown,depth=0):void{
 if(depth>10)fail();if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return;
 if(!value||typeof value!=='object'||types.isProxy(value))fail();
 if(Array.isArray(value)){if(value.length>1000||Reflect.ownKeys(value).length!==value.length+1)fail();for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!('value'in d))fail();plain(d.value,depth+1);}return;}
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();for(const key of Reflect.ownKeys(value)){if(typeof key!=='string')fail();const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!('value'in d)||!d.enumerable)fail();plain(d.value,depth+1);}
}
/** Only explicit hosted bindings are reachable. All returned checkpoints were
 * projected by the ordinary application projector under a live service-held
 * barrier; this facade has no service database or outbound dispatch access. */
export function createHostedDemoNativeFacade<Admission>(runtime:HostedDemoNativeRuntime<Admission>){
 const descriptor=structuredClone(runtime.descriptor);
 function selected(raw:ConnectionBinding){assertSameBinding(raw,raw);if(descriptor.phase!=='active'||!descriptor.bindings.some(b=>isDeepStrictEqual(b,raw)))fail();return structuredClone(raw);}
 function signal(parent?:AbortSignal){if(parent?.aborted)fail();return parent?AbortSignal.any([parent,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);}
 async function readAgentChannelConversation(raw:ConnectionBinding,recipient:CanonicalIdentity,parent?:AbortSignal){
  try{
   const requestSignal=signal(parent),binding=selected(raw),peer=parseAuthorityRecipient(recipient,binding);if(!await runtime.localBinding(binding)||requestSignal.aborted)fail();
   const rawResult=await runtime.serviceRequest('/v1/hosted-demo/history/read',{binding,recipient:peer},requestSignal);if(requestSignal.aborted)fail();plain(rawResult);const result=historySchema.parse(rawResult);
   assertSameBinding(binding,result.binding as ConnectionBinding);assertSameBinding(binding,result.coverage.binding as ConnectionBinding);
   if(result.observedAt!==result.coverage.observedAt||Date.parse(result.coverage.through)>Date.parse(result.observedAt)||Date.parse(result.observedAt)>Date.now()||result.complete&&(!result.coverage.complete||!result.coverage.initialSyncComplete||result.coverage.invalidated)||!result.complete&&result.messages.length!==0||new Set(result.messages.map(m=>m.id)).size!==result.messages.length)fail();
   for(const m of result.messages)if(Date.parse(m.at)>Date.parse(result.observedAt)||binding.channel!=='email'&&(!m.providerConversationId||m.subject!==undefined))fail();
   if(binding.channel!=='email'&&result.deliveryFailures!==undefined)fail();
   return{...result,binding,coverage:{...result.coverage,binding}};
  }catch{return fail();}
 }
 async function revalidateAgentChannelCoverage(raw:ReadonlyArray<{binding:ConnectionBinding;bindingId:string;scopeDigest:string}>,parent?:AbortSignal){
  try{
   const requestSignal=signal(parent);plain(raw);if(!Array.isArray(raw)||raw.length<1||raw.length>3)fail();const selectedScopes=raw.map(item=>{if(Object.keys(item).sort().join(',')!=='binding,bindingId,scopeDigest'||typeof item.bindingId!=='string'||!item.bindingId||item.bindingId.length>200||! /^[a-f0-9]{64}$/.test(item.scopeDigest))fail();return{binding:selected(item.binding),bindingId:item.bindingId,scopeDigest:item.scopeDigest};});
   if(new Set(selectedScopes.map(s=>s.binding.channel)).size!==selectedScopes.length||new Set(selectedScopes.map(s=>s.bindingId)).size!==selectedScopes.length)fail();
   for(const item of selectedScopes)if(await runtime.localBinding(item.binding)!==item.bindingId||requestSignal.aborted)fail();
   const scopes=selectedScopes.map(({binding,scopeDigest})=>({binding,scopeDigest})),result=await runtime.serviceRequest('/v1/hosted-demo/coverage/project',{scopes},requestSignal);if(requestSignal.aborted)fail();plain(result);const parsed=z.object({serviceRevision:z.string().regex(/^(0|[1-9]\d{0,18})$/),scopes:z.unknown()}).strict().parse(result);if(!isDeepStrictEqual(parsed.scopes,scopes))fail();return selectedScopes.map(({bindingId,scopeDigest})=>({bindingId,scopeDigest}));
  }catch{return fail();}
 }
 return{readAgentChannelConversation,revalidateAgentChannelCoverage,async readAgentConversation(binding:ConnectionBinding,email:string,parent?:AbortSignal){if(binding.channel!=='email')fail();return readAgentChannelConversation(binding,{kind:'email',value:email},parent);},admission:(binding:ConnectionBinding)=>runtime.admission(selected(binding))};
}
