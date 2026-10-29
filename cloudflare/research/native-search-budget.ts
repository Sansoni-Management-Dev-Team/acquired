import{ServiceError}from'./firmable/transport';
import{localReaderEndpoint,type LocalReaderEnv}from'./local-reader';
import{localSearchEndpoint,type LocalSearchEnv}from'./local-search';
import type{NativeFirmableBudgetEnv,NativeFirmableContext}from'./native-firmable-budget';
const uuid=/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i;
type Env=NativeFirmableBudgetEnv&LocalReaderEnv&LocalSearchEnv&{CF_ACCOUNT_ID?:string};
/** Native identity is supplied by the authenticated app callback, never inferred
 * from an ordinary job ID. Partial identity cannot fall back to legacy search. */
export function nativeSearchContext(headers:Headers):NativeFirmableContext|undefined{
 const jobId=headers.get('x-acquire-native-research-job'),key=headers.get('x-acquire-native-research-key'),targetId=headers.get('x-acquire-native-research-target');
 if(jobId===null&&key===null&&targetId===null)return undefined;
 if(!jobId||!uuid.test(jobId)||!key||key.trim()!==key||key.length>100||headers.get('x-research-job-id')!==jobId||targetId!==null&&!uuid.test(targetId))throw new ServiceError(400,'invalid_native_search_context');
 return{jobId,key,...(targetId?{targetId}:{})};
}
/** Meter below OpenSERP engine retries and reader fallback, alongside (not in
 * place of) the existing account-wide provider coordinator. Only exact server
 * configured search transports are eligible; page bodies remain private. */
export function nativeSearchBudgetFetch(env:Env,context:NativeFirmableContext,physical:typeof fetch,callbackFetch:typeof fetch):typeof fetch{
 if(!uuid.test(context.jobId)||!context.key.trim()||context.key.length>100||!env.APP_ORIGIN||!env.SERVICE_SECRET)throw new ServiceError(503,'native_budget_not_configured');
 const origin=new URL(env.APP_ORIGIN);if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password)throw new ServiceError(503,'native_budget_not_configured');
 const ordinals=new Map<string,number>();
 const callback=async(body:unknown)=>{const r=await callbackFetch(`${origin.origin}/api/research/internal/${context.jobId}`,{method:'POST',headers:{authorization:`Bearer ${env.SERVICE_SECRET}`,'content-type':'application/json'},body:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new ServiceError(409,'native_budget_admission_required');return r.json()as Promise<Record<string,unknown>>;};
 return async(input,init)=>{
  if(typeof input!=='string'&&!(input instanceof URL))throw new ServiceError(400,'native_request_not_replayable');
  const url=new URL(String(input));if(url.username||url.password||url.hash||init?.body!==undefined&&init.body!==null&&typeof init.body!=='string')throw new ServiceError(403,'native_search_upstream_not_allowed');
  let provider:'search'|'page'|undefined;
  if(env.LOCAL_DEVELOPMENT==='true'){
   for(const engine of['duckduckgo','google',...(env.LOCAL_SEARCH_ENGINE==='bing'?['bing']:[])]){const endpoint=localSearchEndpoint(env,engine);if(endpoint&&url.origin+url.pathname===endpoint&&(!init?.method||init.method==='GET'))provider='search';}
   if(url.href===localReaderEndpoint(env)&&init?.method==='POST')provider='page';
  }else if(env.CF_ACCOUNT_ID&&url.href===`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/markdown`&&init?.method==='POST')provider='page';
  if(!provider)throw new ServiceError(403,'native_search_upstream_not_allowed');
  if(provider==='page'){
   let body:unknown;try{body=JSON.parse(String(init?.body));}catch{throw new ServiceError(400,'native_search_body_invalid');}
   const target=body&&typeof body==='object'&&'url'in body?(body as{url:unknown}).url:null;
   let search:URL;try{search=new URL(String(target));}catch{throw new ServiceError(400,'native_search_body_invalid');}
   if(search.protocol!=='https:'||search.hostname!=='html.duckduckgo.com'||search.pathname!=='/html/'||!search.searchParams.get('q')||search.username||search.password)throw new ServiceError(403,'native_search_upstream_not_allowed');
  }
  const material=JSON.stringify({url:url.href,method:init?.method??'GET',body:init?.body??null}),requestDigest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(material)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const ordinal=ordinals.get(requestDigest)??0;ordinals.set(requestDigest,ordinal+1);
  const begun=await callback({action:'native-provider-begin',provider,...(context.targetId?{targetId:context.targetId}:{}),key:`${context.key}:${requestDigest}:${ordinal}`,requestDigest});
  if(begun.kind!=='started'||typeof begun.operationId!=='string'||typeof begun.fence!=='string')throw new ServiceError(409,'native_provider_reconciliation_required');
  let response:Response;
  try{response=await physical(input,init);}catch(error){await callback({action:'native-provider-finish',operationId:begun.operationId,fence:begun.fence,outcome:{actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'}});throw error;}
  await callback({action:'native-provider-finish',operationId:begun.operationId,fence:begun.fence,outcome:{actualCostMicroUsd:null,costBasis:'unknown',response:{status:response.status,provider,requestDigest}}});return response;
 };
}
