import{agentRecordDigest as digest}from'@/db/agent-store';
import{publicResearchUrl}from'@/domain/research';
import type{NativeResearchRequestPort}from'./agent-research-provider-request';
/** Below readonly HTTP retries/redirects; bodies and credential-bearing ABR
 * query strings are hashed, never written into accounting receipts. */
export function createNativeFieldsPhysicalFetch(options:{store:NativeResearchRequestPort;threadId:string;researchOperationId:string;researchJobId:string;targetId:string;requestKeyPrefix:string;fetch:typeof fetch;readerEndpoints?:string[]}):typeof fetch{
 if(!options.requestKeyPrefix||options.requestKeyPrefix.length>100)throw Error('Stable public-field request key required');
 const ordinals=new Map<string,number>();
 return async(input,init)=>{
  if(typeof input!=='string'&&!(input instanceof URL)||init?.body!==undefined&&init.body!==null&&typeof init.body!=='string')throw Error('Explicit readonly public request required');
  const url=new URL(String(input)),method=(init?.method??'GET').toUpperCase(),reader=options.readerEndpoints?.includes(url.href)===true;
  if(url.username||url.password||url.hash||(!reader&&(!publicResearchUrl(url.href)||method!=='GET'))||reader&&method!=='POST')throw Error('Public-field transport outside saved server configuration');
  if(reader){let target:unknown;try{target=JSON.parse(String(init?.body)).url;}catch{throw Error('Explicit public page required');}if(typeof target!=='string'||!publicResearchUrl(target))throw Error('Public page required');}
  const requestDigest=digest({url:url.href,method,body:init?.body??null}),ordinal=ordinals.get(requestDigest)??0;ordinals.set(requestDigest,ordinal+1);
  const begun=await options.store.beginNativeResearchAttempt(options.threadId,`${options.requestKeyPrefix}:${requestDigest}:${ordinal}`,{researchOperationId:options.researchOperationId,researchJobId:options.researchJobId,targetId:options.targetId,provider:'page',requestDigest});
  if(begun.kind!=='started')throw Error('Original public request requires reconciliation before another HTTP request');
  let response:Response;
  try{response=await options.fetch(input,init);}catch(error){await options.store.finishNativeResearchAttempt(options.threadId,begun.operationId,begun.fence,{actualCostMicroUsd:null,costBasis:'unknown',reason:'request_outcome_unknown'});throw error;}
  await options.store.finishNativeResearchAttempt(options.threadId,begun.operationId,begun.fence,{actualCostMicroUsd:null,costBasis:'unknown',response:{provider:'page',status:response.status,requestDigest}});return response;
 };
}
