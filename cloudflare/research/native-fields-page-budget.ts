import{ServiceError}from'./firmable/transport';
import type{NativeFirmableContext,NativeFirmableBudgetEnv}from'./native-firmable-budget';
import{publicResearchUrl}from'../../src/domain/research';
/** Only the server-selected company reader endpoint is eligible. The original
 * target remains tied to the separately reviewed target manifest at admission. */
export function nativeFieldsPageBudgetFetch(env:NativeFirmableBudgetEnv,context:NativeFirmableContext,endpoint:string,physical:typeof fetch,callbackFetch:typeof fetch):typeof fetch{
 if(!context.targetId||!env.APP_ORIGIN||!env.SERVICE_SECRET)throw new ServiceError(403,'native_fields_context_required');
 const origin=new URL(env.APP_ORIGIN);let ordinal=0;
 const callback=async(body:unknown)=>{const r=await callbackFetch(`${origin.origin}/api/research/internal/${context.jobId}`,{method:'POST',headers:{authorization:`Bearer ${env.SERVICE_SECRET}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new ServiceError(409,'native_budget_admission_required');return r.json()as Promise<Record<string,unknown>>;};
 return async(input,init)=>{
  if(String(input)!==endpoint||init?.method!=='POST'||typeof init.body!=='string')throw new ServiceError(403,'native_field_reader_not_allowed');
  let value:unknown;try{value=JSON.parse(init.body);}catch{throw new ServiceError(400,'native_field_reader_invalid');}
  if(!value||typeof value!=='object'||!('url'in value)||typeof value.url!=='string'||!publicResearchUrl(value.url))throw new ServiceError(403,'native_public_page_required');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({url:endpoint,body:init.body}))))].map(n=>n.toString(16).padStart(2,'0')).join(''),requestKey=`${context.key}:${hash}:${ordinal++}`;
  const begun=await callback({action:'native-provider-begin',provider:'page',targetId:context.targetId,key:requestKey,requestDigest:hash});
  if(begun.kind!=='started'||typeof begun.operationId!=='string'||typeof begun.fence!=='string')throw new ServiceError(409,'native_provider_reconciliation_required');
  let response:Response;try{response=await physical(input,init);}catch(error){await callback({action:'native-provider-finish',operationId:begun.operationId,fence:begun.fence,outcome:{actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'}});throw error;}
  await callback({action:'native-provider-finish',operationId:begun.operationId,fence:begun.fence,outcome:{actualCostMicroUsd:null,costBasis:'unknown',response:{provider:'page',status:response.status,requestDigest:hash}}});return response;
 };
}
