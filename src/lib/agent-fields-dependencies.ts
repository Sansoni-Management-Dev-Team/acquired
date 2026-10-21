import{lookup}from'node:dns/promises';
import{createIdentityWebsiteReader,createAbnIdentityResolver}from'@/adapters/abn-identity-resolver';
import{createPublicAbnClient}from'@/adapters/abn-public-lookup';
import{createCompanyMissingFieldResearch,createMissingFieldCrawlReader,type MissingFieldCrawlEnvironment}from'@/adapters/company-missing-field-research';
import{cloudflareSearchResults}from'@/adapters/cloudflare-web-search';
import{localReaderEndpoint}from'../../cloudflare/research/local-reader';
import{createNativeFieldsPhysicalFetch}from'./agent-fields-fetch';
import type{NativeResearchRequestPort}from'./agent-research-provider-request';
/** Native composition of unchanged normal public-field extractors. Every
 * physical public read is metered; worker search/page proxies meter downstream. */
export function createNativeFieldsDependencies(options:{store:NativeResearchRequestPort;threadId:string;researchOperationId:string;researchJobId:string;targetId:string;env?:MissingFieldCrawlEnvironment;fetch?:typeof fetch;lookup?:typeof lookup}){
 const env:MissingFieldCrawlEnvironment=options.env??{LOCAL_DEVELOPMENT:process.env.LOCAL_DEVELOPMENT,LOCAL_RESEARCH_BENCHMARK:process.env.LOCAL_RESEARCH_BENCHMARK,LOCAL_CRAWL4AI_URL:process.env.LOCAL_CRAWL4AI_URL,CRAWL4AI_URL:process.env.CRAWL4AI_URL,CRAWL4AI_SECRET:process.env.CRAWL4AI_SECRET,RESEARCH_WORKER_URL:process.env.RESEARCH_WORKER_URL,RESEARCH_SERVICE_SECRET:process.env.RESEARCH_SERVICE_SECRET},physical=options.fetch??fetch,local=env.LOCAL_DEVELOPMENT==='true',proxy=!local&&!env.CRAWL4AI_URL&&Boolean(env.RESEARCH_WORKER_URL&&env.RESEARCH_SERVICE_SECRET);
 const endpoint=local?localReaderEndpoint(env):env.CRAWL4AI_URL?new URL('/crawl',env.CRAWL4AI_URL).href:null;
 const publicRead=createNativeFieldsPhysicalFetch({...options,requestKeyPrefix:'fields:'+options.targetId,fetch:physical,...(endpoint?{readerEndpoints:[endpoint]}:{})});
 const identity=createIdentityWebsiteReader({fetch:publicRead,lookup:options.lookup??lookup});
 const delegated:typeof fetch=(input,init)=>{const url=new URL(String(input)),worker=env.RESEARCH_WORKER_URL?new URL(env.RESEARCH_WORKER_URL):null;
  if(!worker||url.origin!==worker.origin||!['/search','/company-page'].includes(url.pathname))throw Error('Saved public-field worker transport required');
  const headers=new Headers(init?.headers);headers.set('x-research-job-id',options.researchJobId);headers.set('x-acquire-native-research-job',options.researchJobId);headers.set('x-acquire-native-research-target',options.targetId);headers.set('x-acquire-native-research-key','fields:'+options.targetId+':'+url.pathname.slice(1));return physical(input,{...init,headers});
 };
 const readPage=endpoint||proxy?createMissingFieldCrawlReader(env,proxy?delegated:publicRead):async(url:string,deadline:number)=>{const p=await identity(url,deadline);return{url:p.url,html:p.html,truncated:p.truncated,reader:'public-http',onlyMainContent:false as const};};
 const researchFields=createCompanyMissingFieldResearch({readPage,readDocument:async(url,deadline)=>{const p=await identity(url,deadline);return{url:p.url,text:p.html,truncated:p.truncated};},search:async(query,_field,deadline)=>cloudflareSearchResults(query,(input,init)=>delegated(input,{...init,signal:AbortSignal.any([...(init?.signal?[init.signal]:[]),AbortSignal.timeout(Math.max(1,deadline-Date.now()))])}),options.researchJobId)});
 const abn=createPublicAbnClient(publicRead,{concurrency:2,spacingMs:500,timeoutMs:10000});
 return{researchFields,resolveAbn:createAbnIdentityResolver({search:abn.search,record:abn.record,website:identity})};
}
