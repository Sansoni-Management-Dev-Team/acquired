import type {ResearchConfig} from './research';
import {firmableDomain} from './firmable-company-pipeline';

export type CompanyDiscoveryProgress={candidates:number;firmablePages:number;webQueries:number;webFailures:number};

function record(value:unknown):Record<string,unknown>{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function pages(value:unknown){return Object.entries(record(value)).filter(([key,page])=>/^(?:0|[1-9][0-9]*)$/.test(key)&&Number.isSafeInteger(Number(key))&&page!==null&&typeof page==='object'&&!Array.isArray(page)).sort(([a],[b])=>Number(a)-Number(b)).map(([key,page])=>({index:Number(key),page:record(page)}));}

/** Count saved discovery observations, before profiles or targets exist. The
 * source match total is not a found-company count, and a profile shortlist does
 * not erase discovered identities. This read projection grants no authority. */
export function companyDiscoveryProgress(config:ResearchConfig):CompanyDiscoveryProgress{
 const continuation=config.companyContinuation;
 if(continuation)return{candidates:new Set(continuation.candidateKeys).size,firmablePages:0,webQueries:0,webFailures:0};
 const raw=config as ResearchConfig&Record<string,unknown>,policy=config.companyDiscoveryPolicy;
 const pageSize=policy?.firmablePageSize??(config.pipelineDesign==='firmable-v1'&&config.nativeAgent?Math.min(config.targetBusinesses||20,20):100);
 // The original D executor bounds pagination at offset 10,000. Legacy E/F
 // query maps retain their original scope instead of acquiring a new V4 cap.
 const maxRows=policy?.maxFirmableRows??10000,maxPages=policy?.maxFirmablePages??Math.ceil(maxRows/pageSize);
 const firmable=pages(raw.firmableSearchPages).filter(({index})=>index%pageSize===0&&index<maxRows&&index/pageSize<maxPages);
 const web=pages(raw.webSearchPages).filter(({index})=>!policy||index<policy.maxWebQueries);
 const ids=new Set<string>(),firmableDomains=new Set<string>(),webDomains=new Set<string>();
 for(const{index,page}of firmable)for(const value of(Array.isArray(page.records)?page.records:[]).slice(0,Math.min(pageSize,maxRows-index))){
  const row=record(value),id=String(row.id??'');if(!/^f[0-9]+$/.test(id)||ids.has(id))continue;
  ids.add(id);const domain=firmableDomain(row.website||row.fqdn);if(domain)firmableDomains.add(domain);
 }
 const webRowLimit=policy&&'maxWebRowsPerQuery'in policy?policy.maxWebRowsPerQuery:100;
 for(const{page}of web)for(const value of(Array.isArray(page.rows)?page.rows:[]).slice(0,webRowLimit)){
  const domain=firmableDomain(record(value).domain);if(domain&&!firmableDomains.has(domain))webDomains.add(domain);
 }
 return{candidates:ids.size+webDomains.size,firmablePages:firmable.length,webQueries:web.length,webFailures:web.filter(({page})=>page.ok===false).length};
}

/** Public polling needs progress, never the saved provider discovery rows. */
export function projectCompanyDiscoveryConfig(config:ResearchConfig):ResearchConfig{
 const projected={...config} as ResearchConfig&Record<string,unknown>;
 delete projected.firmableSearchPages;delete projected.webSearchPages;
 return projected;
}
