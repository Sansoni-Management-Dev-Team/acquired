import {deduplicateFirmableRows,firmableDomain,type CompanySearchPage} from './firmable-company-pipeline';
import type {WebCompany,WebQuery} from './web-firmable-pipeline';
type Row=Record<string,unknown>;
export type HybridCompany={domain:string;sources:('firmable'|'web')[];firmableRow?:Row;webRow?:WebCompany};
/** Two discovery producers and one bounded enrichment queue. The first Firmable
 * page indexes known IDs before web matching, avoiding duplicate profile reads. */
export async function runHybridCompanyPipeline(deps:{checkpoint:<T>(name:string,fn:()=>Promise<T>)=>Promise<T>;now:()=>number;control:()=>Promise<boolean>;plan:()=>Promise<WebQuery[]>;firmableSearch:()=>Promise<CompanySearchPage>;webSearch:(query:WebQuery,index:number)=>Promise<{rows:WebCompany[];ok:boolean}>;profile:(company:HybridCompany)=>Promise<{ok:boolean;matched?:boolean}>;finish:(result:Row)=>Promise<unknown>},options:{deadline:number;maxCompanies:number;concurrency:number}){
 const plan=await deps.checkpoint('f-plan',deps.plan),selected=new Map<string,HybridCompany>(),knownFirmable=new Map<string,Row>(),seenWeb=new Set<string>(),queue:HybridCompany[]=[],overflow:HybridCompany[]=[];
 const quota=Math.floor(options.maxCompanies/2);let firmableSelected=0,webSelected=0,producersDone=0,searches=0,searchFailed=0,discoveryFailed=0,saved=0,matched=0,failed=0,stopReason='exhausted';let started=0;
 let listeners:(()=>void)[]=[];const wake=()=>{const pending=listeners;listeners=[];pending.forEach(fn=>fn());};const wait=()=>new Promise<void>(resolve=>listeners.push(resolve));
 const running=async()=>{if(deps.now()>=options.deadline){stopReason='deadline';return false;}if(!await deps.control()){stopReason='cancelled';return false;}return true;};
 function add(company:HybridCompany,source:'firmable'|'web'){
  const existing=selected.get(company.domain);
  if(existing){existing.sources=[...new Set([...existing.sources,source])].sort() as HybridCompany['sources'];existing.firmableRow??=company.firmableRow;existing.webRow??=company.webRow;return;}
  if(selected.size>=options.maxCompanies)return;
  if((source==='firmable'?firmableSelected:webSelected)>=quota){overflow.push(company);return;}
  selected.set(company.domain,company);queue.push(company);if(source==='firmable')firmableSelected++;else webSelected++;wake();
 }
 // This barrier concerns the initial ID index, not completion of web discovery.
 const firmableProducer=(async()=>{try{
  if(!await running())return;
  const page=await deps.checkpoint('f-firmable-search',deps.firmableSearch);
  for(const row of deduplicateFirmableRows(page.records)){const domain=firmableDomain(row.website||row.fqdn);if(!domain)continue;knownFirmable.set(domain,row);const existing=selected.get(domain);if(existing){existing.firmableRow=row;if(!existing.sources.includes('firmable'))existing.sources.unshift('firmable');}}
  for(const [domain,row] of knownFirmable)add({domain,sources:seenWeb.has(domain)?['firmable','web']:['firmable'],firmableRow:row},'firmable');
 }catch{discoveryFailed++;}finally{producersDone++;wake();}})();
 const webProducer=(async()=>{try{
  for(const [index,query]of plan.entries()){
   if(!await running()||webSelected>=quota||selected.size>=options.maxCompanies)break;
   const result=await deps.checkpoint(`f-web-search-${index}`,()=>deps.webSearch(query,index));searches++;if(!result.ok)searchFailed++;
   for(const row of result.rows){seenWeb.add(row.domain);const firmableRow=knownFirmable.get(row.domain);add({domain:row.domain,sources:firmableRow?['firmable','web']:['web'],webRow:row,firmableRow},'web');}
  }
 }catch{discoveryFailed++;}finally{producersDone++;wake();}})();
 await firmableProducer;
 const consume=async()=>{for(;;){if(!await running())return;const company=queue.shift();if(company){started++;const result=await deps.checkpoint(`f-company-${company.domain}`,()=>deps.profile(company));if(result.ok){saved++;if(result.matched)matched++;}else failed++;continue;}
  if(producersDone===2){for(const company of overflow){if(selected.size>=options.maxCompanies)break;if(selected.has(company.domain))continue;selected.set(company.domain,company);queue.push(company);}overflow.length=0;if(queue.length)continue;return;}
  await wait();
 }};
 await Promise.all([webProducer,...Array.from({length:options.concurrency},consume)]);
 if(selected.size>=options.maxCompanies&&stopReason==='exhausted')stopReason='candidate_limit';
 const selection=[...selected.values()].map(c=>({domain:c.domain,sources:c.sources,firmableId:c.firmableRow?.id||null}));
 const result={candidates:selected.size,saved,matched,unmatched:saved-matched,failed,unprocessed:selected.size-started,searches,searchFailed,discoveryFailed,stopReason,firmableDiscovered:knownFirmable.size,webDiscovered:seenWeb.size,overlap:[...seenWeb].filter(domain=>knownFirmable.has(domain)).length,selection};
 await deps.checkpoint('f-finish',()=>deps.finish(result));return result;
}
