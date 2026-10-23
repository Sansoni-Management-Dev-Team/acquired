import {z} from 'zod';
import {agentRecordDigest} from '@/db/agent-store';
import {performNativeResearchProviderRequest,type NativeResearchRequestPort} from './agent-research-provider-request';
const savedResponse=z.object({status:z.number().int().min(200).max(599),headers:z.record(z.string(),z.string()),body:z.string().max(40000)}).strict();
type Estimate={actualCostMicroUsd:string|null;costBasis:'observed_provider_usage'|'configured_rate_estimate'|'unknown'};
/** Inject into a provider client at its fetch boundary, below its retry loop.
 * Prefix identifies a persisted logical step. Attempt ordinals replay the same
 * physical receipts after restart; an uncertain ordinal cannot issue HTTP again.
 * Caller must retain its existing global provider/account concurrency controls. */
export function createNativeResearchProviderFetch(options:{store:NativeResearchRequestPort;threadId:string;researchOperationId:string;researchJobId:string;provider:'search'|'page'|'ai'|'firmable';requestKeyPrefix:string;fetch:typeof fetch;estimateCost?:(response:{status:number;body:string})=>Estimate}):typeof fetch{
 z.string().trim().min(1).max(100).parse(options.requestKeyPrefix);
 const ordinals=new Map<string,number>();
 return async(input,init)=>{
  if(typeof input!=='string'&&!(input instanceof URL))throw new Error('Native provider fetch requires an explicit URL and request init');
  const url=new URL(String(input));if(url.username||url.password)throw new Error('Credential-bearing provider URL is not supported');
  if(init?.body!==undefined&&init.body!==null&&typeof init.body!=='string')throw new Error('Native provider fetch requires a replayable string body');
  const request={url:url.href,method:(init?.method??'GET').toUpperCase(),body:init?.body??null};
  const identity=JSON.stringify(request),ordinal=ordinals.get(identity)??0;ordinals.set(identity,ordinal+1);
  // Keep the key bounded while the request body itself is stored only as a digest.
  const key=options.requestKeyPrefix+':'+ordinal+':'+agentRecordDigest(request);
  const value=await performNativeResearchProviderRequest({store:options.store,threadId:options.threadId,key,request:{researchOperationId:options.researchOperationId,researchJobId:options.researchJobId,provider:options.provider,payload:request},execute:async()=>{
   const result=await options.fetch(input,init),reader=result.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
   if(reader)try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>40000)throw new Error('Provider response exceeds bounded replay storage');chunks.push(next.value);}}finally{await reader.cancel().catch(()=>{});}
   const joined=new Uint8Array(bytes);let at=0;for(const chunk of chunks){joined.set(chunk,at);at+=chunk.byteLength;}
   const body=new TextDecoder().decode(joined),headers:Record<string,string>={};
   for(const name of ['content-type','retry-after']){const value=result.headers.get(name);if(value!==null)headers[name]=value;}
   const response=savedResponse.parse({status:result.status,headers,body}),cost=options.estimateCost?.({status:result.status,body})??{actualCostMicroUsd:null,costBasis:'unknown' as const};
   return {response,...cost};
  }});
  const saved=savedResponse.parse(value);return new Response([204,205,304].includes(saved.status)?null:saved.body,{status:saved.status,headers:saved.headers});
 };
}
