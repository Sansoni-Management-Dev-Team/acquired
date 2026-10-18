import {ServiceError} from './firmable/transport';
export type NativeFirmableContext={jobId:string;key:string;targetId?:string};
export type NativeFirmableBudgetEnv={APP_ORIGIN?:string;SERVICE_SECRET?:string};
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
/** Wrap the real upstream, including auth renewal and authentication retries.
 * Receipts contain status only, never cookies, tokens or upstream bodies. */
export function nativeFirmableBudgetFetch(env:NativeFirmableBudgetEnv,context:NativeFirmableContext,physical:typeof fetch,callbackFetch:typeof fetch=fetch):typeof fetch{
 if(!uuid.test(context.jobId)||!context.key.trim()||context.key.length>100||!env.APP_ORIGIN||!env.SERVICE_SECRET)throw new ServiceError(503,'native_budget_not_configured');
 const origin=new URL(env.APP_ORIGIN);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password)throw new ServiceError(503,'native_budget_not_configured');
 const ordinals=new Map<string,number>();
 const callback=async(body:unknown)=>{const response=await callbackFetch(`${origin.origin}/api/research/internal/${context.jobId}`,{method:'POST',headers:{authorization:`Bearer ${env.SERVICE_SECRET}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(10000)});if(!response.ok)throw new ServiceError(409,'native_budget_admission_required');return response.json() as Promise<Record<string,unknown>>;};
 return async(input,init)=>{
  if(typeof input!=='string'&&!(input instanceof URL))throw new ServiceError(400,'native_request_not_replayable');
  const url=new URL(String(input));if(!['api.firmable.com','clerk.firmable.com'].includes(url.hostname)||url.protocol!=='https:')throw new ServiceError(403,'native_upstream_not_allowed');
  const material=JSON.stringify({url:url.href,method:init?.method??'GET',body:typeof init?.body==='string'?init.body:null}),requestDigest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const ordinal=ordinals.get(requestDigest)??0;ordinals.set(requestDigest,ordinal+1);
  const begun=await callback({action:'native-provider-begin',...(context.targetId?{targetId:context.targetId}:{}),key:`${context.key}:${requestDigest}:${ordinal}`,requestDigest});
  if(begun.kind!=='started'||typeof begun.operationId!=='string'||typeof begun.fence!=='string')throw new ServiceError(409,'native_provider_reconciliation_required');
  let response:Response;
  try{response=await physical(input,init);}catch(error){await callback({action:'native-provider-finish',operationId:begun.operationId,fence:begun.fence,outcome:{actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'}});throw error;}
  await callback({action:'native-provider-finish',operationId:begun.operationId,fence:begun.fence,outcome:{actualCostMicroUsd:null,costBasis:'unknown',response:{status:response.status,provider:'firmable',requestDigest}}});
  return response;
 };
}
