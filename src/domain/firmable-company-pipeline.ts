import {companyProfileDisposition,type CompanyProfileOutcome} from './company-profile-outcome';
import {firmableCompanyPayload} from './firmable-company-fields';
import {abnChecksum as validAbn} from './abn-public-lookup.mjs';
type Row=Record<string,unknown>;
export type FirmableFilters={filters:Row;operators:Row;excluded:Row};
export type CompanySearchPage={records:Row[];totalCompany:number;predictedFilters?:FirmableFilters;predictedCountry?:unknown};
export type CompanyBand={label:string;min:number;max:number|null};
export function firmableDomain(value:unknown){if(!value)return '';try{return new URL(String(value).includes('://')?String(value):`https://${value}`).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
function label(value:unknown):string|null{const text=typeof value==='string'?value: value&&typeof value==='object'?Object.values(value).filter(v=>typeof v==='string').join(', '):'';return text&&!/^\d+$/.test(text.trim())?text.trim():null;}
export function parseCompanyBand(value:unknown,money=false):CompanyBand|null{
 const text=label(value);if(!text)return null;
 const parts=[...text.matchAll(/([\d,]+(?:\.\d+)?)\s*([kmb])?/gi)].map(m=>Number(m[1].replaceAll(',',''))*(money?({k:1e3,m:1e6,b:1e9}[m[2]?.toLowerCase() as 'k']||1):1));
 if(!parts.length)return null;
 if(parts.length===1&&/\+|>/.test(text))return {label:text,min:parts[0],max:null};
 if(parts.length===1&&/</.test(text))return {label:text,min:0,max:parts[0]};
 return parts.length===2&&parts[0]<=parts[1]?{label:text,min:parts[0],max:parts[1]}:null;
}
export function reportedFirmableAbns(raw:Row){
 const paths=['region.AU.business_identifiers.abn.value','industry_codes.abn','browserResponse.region.AU.business_identifiers.abn.value'];
 const seen=new Set<string>();return paths.flatMap(sourcePath=>{let value:unknown=raw;for(const key of sourcePath.split('.'))value=value&&typeof value==='object'?(value as Row)[key]:undefined;const abn=typeof value==='string'||typeof value==='number'?String(value).replace(/\D/g,''):'';if(!validAbn(abn)||seen.has(abn))return[];seen.add(abn);return[{abn,sourcePath}];});
}
export function normalizeFirmableProfile(raw:Row){
 raw=firmableCompanyPayload(raw);
 const abnCandidates=reportedFirmableAbns(raw),abn=abnCandidates[0]?.abn||null;
 return {firmableId:String(raw.id||''),companyName:String(raw.name||raw.company_name||''),domain:firmableDomain(raw.website||raw.fqdn),website:String(raw.website||''),abn,abnCandidates,headcountExact:typeof raw.employee_count==='number'&&Number.isInteger(raw.employee_count)&&raw.employee_count>0?raw.employee_count:null,headcountBand:parseCompanyBand(raw.company_size),revenueBand:parseCompanyBand(raw.revenue,true),industries:Array.isArray(raw.industries)?raw.industries.filter(v=>typeof v==='string'):raw.industries&&typeof raw.industries==='object'?Object.values(raw.industries).filter(v=>typeof v==='string'):[],states:[...new Set([...(Array.isArray(raw.states)?raw.states.map(String):raw.states&&typeof raw.states==='object'?Object.values(raw.states).map(String):[]),...(String(raw.hq_location||'').match(/\b(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/g)||[])])],description:String(raw.description||raw.tagline||''),rawResponse:raw,retrievedAt:new Date().toISOString()};
}
export function screenBand(band:{min:number;max:number|null}|null,requested:{min:number;max:number|null}|undefined){if(!requested)return 'supported';if(!band)return 'review';if(band.min>(requested.max??Infinity)||(band.max??Infinity)<requested.min)return 'excluded';return band.min>=requested.min&&(band.max??Infinity)<=(requested.max??Infinity)?'supported':'review';}
export function deduplicateFirmableRows(rows:Row[]){const ids=new Set<string>(),domains=new Set<string>(),abns=new Set<string>();return rows.filter(r=>{const id=String(r.id||''),domain=firmableDomain(r.website||r.fqdn||''),abn=String((r.industry_codes as Row)?.abn||'').replace(/\D/g,'');if(!/^f\d+$/.test(id)||ids.has(id)||(domain&&domains.has(domain))||(validAbn(abn)&&abns.has(abn)))return false;ids.add(id);if(domain)domains.add(domain);if(validAbn(abn))abns.add(abn);return true;});}
export async function runFirmableCompanyPipeline(deps:{checkpoint:<T>(name:string,fn:(firmableAttempt?:number)=>Promise<T>)=>Promise<T>;search:(from:number,filters?:FirmableFilters,firmableAttempt?:number)=>Promise<CompanySearchPage>;profile:(row:Row,firmableAttempt?:number)=>Promise<CompanyProfileOutcome>;finish:(result:Row)=>Promise<unknown>;now:()=>number},options:{deadline:number;maxCompanies:number;pageSize:number;concurrency:number}){
 let filters:FirmableFilters|undefined;const rows:Row[]=[];let saved=0,identityReviewRequired=0,skipped=0,failed=0,stopReason='candidate_limit';
 for(let from=0;rows.length<options.maxCompanies&&from<10000;from+=options.pageSize){
  if(deps.now()>=options.deadline){stopReason='deadline';break;}
  const page=await deps.checkpoint(`d-search-${from}`,attempt=>attempt?deps.search(from,filters,attempt):deps.search(from,filters));filters??=page.predictedFilters;
  if(from===0&&!filters)throw Error('Firmable search did not return interpreted filters');
  const before=rows.length,next=deduplicateFirmableRows([...rows,...page.records]).slice(before,options.maxCompanies);rows.push(...next);
  for(let start=0;start<next.length;start+=options.concurrency){if(deps.now()>=options.deadline){stopReason='deadline';break;}
   const results=await Promise.all(next.slice(start,start+options.concurrency).map(row=>deps.checkpoint(`d-company-${row.id}`,attempt=>attempt?deps.profile(row,attempt):deps.profile(row))));for(const r of results){const disposition=companyProfileDisposition(r);if(disposition==='saved')saved++;else if(disposition==='review')identityReviewRequired++;else if(disposition==='skipped')skipped++;else failed++;}
  }
  if(stopReason==='deadline')break;
  if(!next.length&&page.records.length){stopReason='pagination_did_not_advance';break;}
  if(from+page.records.length>=page.totalCompany){stopReason='exhausted';break;}
  if(page.records.length<options.pageSize){stopReason='premature_short_page';break;}
 }
 const result={...(identityReviewRequired?{identityReviewRequired}:{}),...(skipped?{skipped}:{}),saved,failed,candidates:rows.length,stopReason};await deps.checkpoint('d-finish',()=>deps.finish(result));return result;
}

export function originalRevenueRange(criteria:{key:string;value?:string}[]|undefined,fallback:{min:number;max:number|null}|undefined){const match=criteria?.find(c=>c.key==='revenue')?.value?.match(/(\d+)\D+(\d+)/);return match?{min:Number(match[1]),max:Number(match[2])}:fallback;}
