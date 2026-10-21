import {companyProfileDisposition,type CompanyProfileOutcome} from './company-profile-outcome';
import type {WebSearchResult} from './cloudflare-search';
import {directorySource,serviceBusinessDomain} from './discovery-sources';
import {firmableDomain} from './firmable-company-pipeline';
export type WebCompany={domain:string;name:string;website:string;discovery:WebSearchResult};
export type WebQuery={query:string;page:number};
/** A's first-party supplier seeds, preserving titles for the existing name/domain matcher. */
export function webCompanyRows(results:WebSearchResult[]):WebCompany[]{
 const seen=new Set<string>();return results.flatMap(discovery=>{
  const domain=firmableDomain(discovery.url);
  if(!domain||seen.has(domain)||/\.(?:gov|edu)\.au$/.test(domain)||/^(?:list of \d|top \d|top .+ companies in|.+ business directory)/i.test(discovery.title)||directorySource(discovery.url)||serviceBusinessDomain(discovery.url))return[];
  seen.add(domain);const name=discovery.title.split(/\s+[|–—]\s+|\s+-\s+/)[0].replace(/^(?:Home|Welcome)(?:\s+(?:to|at))?\s*[:–-]?\s*/i,'').trim()||domain.split('.')[0];
  return[{domain,name,website:`https://${domain}`,discovery}];
 });
}
export async function matchWebFirmableCompany(row:WebCompany,enrich:(identifier:{fqdn:string;name:string})=>Promise<Record<string,unknown>>){
 const raw=await enrich({fqdn:row.domain,name:row.name});
 if(firmableDomain(raw.website||raw.fqdn)!==row.domain)throw Error('Firmable profile domain mismatch');
 return raw;
}
export async function runWebFirmablePipeline(deps:{checkpoint:<T>(name:string,fn:(firmableAttempt?:number)=>Promise<T>)=>Promise<T>;now:()=>number;control:()=>Promise<boolean>;plan:()=>Promise<WebQuery[]>;search:(query:WebQuery,index:number)=>Promise<{rows:WebCompany[];ok:boolean}>;profile:(row:WebCompany,firmableAttempt?:number)=>Promise<CompanyProfileOutcome>;finish:(result:Record<string,unknown>)=>Promise<unknown>},options:{deadline:number;maxCompanies:number;concurrency:number}){
 const plan=await deps.checkpoint('e-plan',deps.plan),companies:WebCompany[]=[];const domains=new Set<string>();let searchFailed=0,searches=0,saved=0,matched=0,identityReviewRequired=0,skipped=0,failed=0,stopReason='exhausted';
 const running=async()=>{if(deps.now()>=options.deadline){stopReason='deadline';return false;}if(!await deps.control()){stopReason='cancelled';return false;}return true;};
 for(const [index,query]of plan.entries()){
  if(!await running())break;
  const result=await deps.checkpoint(`e-search-${index}`,()=>deps.search(query,index));searches++;if(!result.ok)searchFailed++;
  for(const row of result.rows){if(domains.has(row.domain))continue;domains.add(row.domain);companies.push(row);if(companies.length>=options.maxCompanies)break;}
  if(companies.length>=options.maxCompanies){stopReason='candidate_limit';break;}
 }
 for(let i=0;i<companies.length;i+=options.concurrency){if(!await running())break;
  const results=await Promise.all(companies.slice(i,i+options.concurrency).map(row=>deps.checkpoint(`e-company-${row.domain}`,attempt=>attempt?deps.profile(row,attempt):deps.profile(row))));
  for(const r of results){const disposition=companyProfileDisposition(r);if(disposition==='saved'){saved++;if(r.matched)matched++;}else if(disposition==='review')identityReviewRequired++;else if(disposition==='skipped')skipped++;else failed++;}
 }
 const result={...(identityReviewRequired?{identityReviewRequired}:{}),...(skipped?{skipped}:{}),candidates:companies.length,searches,searchFailed,saved,matched,unmatched:saved-matched,failed,unprocessed:companies.length-saved-failed-identityReviewRequired-skipped,stopReason};
 await deps.checkpoint('e-finish',()=>deps.finish(result));return result;
}
