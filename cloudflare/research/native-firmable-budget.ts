import {ServiceError} from './firmable/transport';
export type NativeFirmableContext={jobId:string;key:string;targetId?:string};
export type NativeFirmableBudgetEnv={APP_ORIGIN?:string;SERVICE_SECRET?:string};
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
type RequestClass='company_search'|'company_profile'|'auth'|'people_search'|'person_profile'|'phone_reveal'|'unsupported';
/** The private service classifies its actual outbound request, not an agent
 * assertion or browser header. Current parent authority is checked by the app
 * before this fetcher is allowed to make the corresponding physical request. */
function requestClass(url:URL,init?:RequestInit):RequestClass{
 const method=(init?.method??'GET').toUpperCase();
 if(url.origin==='https://clerk.firmable.com')return method==='POST'&&/^\/v1\/client\/sessions\/[a-zA-Z0-9_-]+\/tokens$/.test(url.pathname)?'auth':'unsupported';
 if(url.origin!=='https://api.firmable.com')return'unsupported';
 if(method==='GET'&&/^\/internal\/company\/f[0-9]+$/.test(url.pathname))return'company_profile';
 if(method==='POST'&&url.pathname==='/internal/records/v2'){try{const payload=init?.body,body=JSON.parse(typeof payload==='string'?payload:'null');return body?.category==='company'?'company_search':'unsupported';}catch{return'unsupported';}}
 if(method==='POST'&&url.pathname==='/internal/people')return'people_search';
 if(method==='GET'&&/^\/internal\/people\/fp[0-9]+$/.test(url.pathname))return'person_profile';
 if(method==='GET'&&/^\/internal\/people\/fp[0-9]+\/phones\/(?:new|show)$/.test(url.pathname))return'phone_reveal';
 return'unsupported';
}
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
  const begun=await callback({action:'native-provider-begin',requestClass:requestClass(url,init),...(context.targetId?{targetId:context.targetId}:{}),key:`${context.key}:${requestDigest}:${ordinal}`,requestDigest});
  if(begun.kind!=='started'||typeof begun.operationId!=='string'||typeof begun.fence!=='string')throw new ServiceError(409,'native_provider_reconciliation_required');
  let response:Response;
  try{response=await physical(input,init);}catch(error){await callback({action:'native-provider-finish',operationId:begun.operationId,fence:begun.fence,outcome:{actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'}});throw error;}
  await callback({action:'native-provider-finish',operationId:begun.operationId,fence:begun.fence,outcome:{actualCostMicroUsd:null,costBasis:'unknown',response:{status:response.status,provider:'firmable',requestDigest}}});
  return response;
 };
}
