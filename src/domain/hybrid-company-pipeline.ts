import {safeResearchTrace,type ResearchTraceContext} from './research-trace-context';
import {companyProfileDisposition,type CompanyProfileOutcome} from './company-profile-outcome';
import{firmablePaginationFilters}from'./firmable-pagination-filters';
import {balanceFirmableStaffBands,companyDiscoveryPolicySchema,type CompanyDiscoveryPolicy} from './research-discovery-policy';
import {deduplicateFirmableRows,firmableDomain,type CompanySearchPage,type FirmableFilters} from './firmable-company-pipeline';
import type {WebCompany,WebQuery} from './web-firmable-pipeline';
import {validateHybridCompanyContinuation,type HybridCompanyContinuation} from './hybrid-company-continuation';
type Row=Record<string,unknown>;
const partialResults=new WeakMap<object,Row>();
/** Metadata is attached only by this executor after draining its own work.
 * Never interpret arbitrary provider errors or a generic HTTP 409 as proof
 * that a request was not submitted. The original thrown value is preserved. */
export function hybridCompanyPartialResult(error:unknown):Row|undefined{return error!==null&&(typeof error==='object'||typeof error==='function')?partialResults.get(error):undefined;}
export type HybridCompany={candidateKey?:string;domain:string;sources:('firmable'|'web')[];firmableRow?:Row;webRow?:WebCompany};
/** Two discovery producers and one bounded enrichment queue. The first Firmable
 * page indexes known IDs before web matching, avoiding duplicate profile reads. */
export async function runHybridCompanyPipeline(deps:{checkpoint:<T>(name:string,fn:(firmableAttempt?:number)=>Promise<T>)=>Promise<T>;now:()=>number;control:()=>Promise<boolean>;plan:()=>Promise<WebQuery[]>;firmableSearch:(from?:number,interpreted?:FirmableFilters,firmableAttempt?:number)=>Promise<CompanySearchPage>;webSearch:(query:WebQuery,index:number)=>Promise<{rows:WebCompany[];ok:boolean;category?:string}>;profile:(company:HybridCompany,firmableAttempt?:number)=>Promise<CompanyProfileOutcome>;beforeFinish?:()=>Promise<unknown>;finish:(result:Row)=>Promise<unknown>},options:{deadline:number;maxCompanies:number;concurrency:number;discoveryPolicy?:CompanyDiscoveryPolicy;traceContext?:ResearchTraceContext;continuation?:HybridCompanyContinuation}){
 const trace=safeResearchTrace(options.traceContext),began=Date.now();
 const log=(stage:string,fields:Row={})=>console.info('research-pipeline',JSON.stringify({...trace,module:'hybrid-company-pipeline',stage,policyVersion:options.discoveryPolicy?.version??1,...fields}));
 const policy=options.discoveryPolicy?companyDiscoveryPolicySchema.parse(options.discoveryPolicy):undefined,allDiscovered=policy?.version===4||policy?.version===5;
 log('start',{profileCap:options.maxCompanies});
 if(policy&&options.maxCompanies!==policy.maxProfiledCompanies)throw Error('Reviewed discovery profile cap changed');
 const continuation=options.continuation?validateHybridCompanyContinuation(options.continuation):undefined;
 if(continuation&&(!allDiscovered||trace.jobId===continuation.sourceRootId))throw Error('Saved candidates require a fresh reviewed V4 execution root');
 const plan=continuation?[]:await deps.checkpoint('f-plan',deps.plan),selected=new Map<string,HybridCompany>(),knownFirmable=new Map<string,Row>(),seenWeb=new Set<string>(),queue:HybridCompany[]=[],overflow:HybridCompany[]=[];
 const quota=Math.floor(options.maxCompanies/2);let firmableReportedTotal=0,firmableTruncated=false,webTruncated=false;let samplingBlockedReason:string|undefined;let profileSampling:ReturnType<typeof balanceFirmableStaffBands>['summary']|undefined;let firmablePages=0,firmableSampledRows=0,firmableSelected=0,webSelected=0,producersDone=0,searches=0,searchFailed=0,discoveryFailed=0,saved=0,matched=0,identityReviewRequired=0,skipped=0,failed=0,stopReason='exhausted';let started=0;
 const outcomes=new Map<string,'saved'|'review'|'skipped'|'known_failed'|'interrupted'|'not_started'>();
 let webStopCategory:string|undefined;
 let fatal=false,fatalError:unknown;
 let listeners:(()=>void)[]=[];const wake=()=>{const pending=listeners;listeners=[];pending.forEach(fn=>fn());};const wait=()=>new Promise<void>(resolve=>listeners.push(resolve));
 const running=async()=>{if(fatal)return false;if(deps.now()>=options.deadline){stopReason='deadline';return false;}if(!await deps.control()){stopReason='cancelled';return false;}return !fatal;};
 function add(company:HybridCompany,source:'firmable'|'web'){
  if(fatal&&!allDiscovered)return;
  const key=company.candidateKey??company.domain;const existing=selected.get(key);
  if(existing){existing.sources=[...new Set([...existing.sources,source])].sort() as HybridCompany['sources'];existing.firmableRow??=company.firmableRow;existing.webRow??=company.webRow;return;}
  if(selected.size>=options.maxCompanies){if(allDiscovered)throw Error('Discovered identity count exceeds declared source bounds');return;}
  if(!allDiscovered&&(source==='firmable'?firmableSelected:webSelected)>=quota){overflow.push(company);return;}
  selected.set(key,company);if(allDiscovered)outcomes.set(key,'not_started');queue.push(company);if(source==='firmable')firmableSelected++;else webSelected++;wake();
 }
 function addWeb(row:WebCompany){
  seenWeb.add(row.domain);
  const firmableRow=knownFirmable.get(row.domain);
  if(allDiscovered&&!firmableRow){
   // Different provider IDs sharing a domain stay separate for identity review.
   // Web evidence attaches to both; it cannot choose which identity is correct.
   const sameDomain=[...selected.values()].filter(c=>c.domain===row.domain&&c.firmableRow);
   if(sameDomain.length){for(const company of sameDomain){company.sources=['firmable','web'];company.webRow??=row;}return;}
  }
  add({...(allDiscovered?{candidateKey:firmableRow?`firmable:${firmableRow.id}`:`domain:${row.domain}`} : {}),domain:row.domain,sources:firmableRow?['firmable','web']:['web'],webRow:row,firmableRow},'web');
 }
 // Only server-materialized, explicitly never-started source candidates enter
 // this queue. Fresh root authority/receipt checks remain the caller's job.
 if(continuation)for(const company of continuation.candidates){add(company,company.firmableRow?'firmable':'web');if(company.sources.includes('web'))seenWeb.add(company.domain);}
 // This barrier concerns the initial ID index, not completion of web discovery.
 const firmableProducer=(async()=>{try{
  if(continuation)return;
  if(!await running())return;
  const sampled:Row[]=[],proofs:Array<Pick<CompanySearchPage,'predictedFilters'|'predictedCountry'>>=[];let filters:FirmableFilters|undefined;
  for(let pageIndex=0;pageIndex<(policy?.maxFirmablePages??1);pageIndex++){
   if(!await running())break;
   const from=pageIndex*(policy?.firmablePageSize??100);
   let page:CompanySearchPage;
   try{page=await deps.checkpoint(policy?`f-firmable-search-v${policy.version}-${from}`:'f-firmable-search',attempt=>policy?(attempt?deps.firmableSearch(from,filters,attempt):deps.firmableSearch(from,filters)):attempt?deps.firmableSearch(undefined,undefined,attempt):deps.firmableSearch());}
   catch(error){if(!policy)throw error;discoveryFailed++;break;}
   proofs.push({predictedFilters:page.predictedFilters??(pageIndex>0?proofs[0]?.predictedFilters:undefined),predictedCountry:page.predictedCountry??(pageIndex>0?proofs[0]?.predictedCountry:undefined)});
   firmableReportedTotal=Math.max(firmableReportedTotal,page.totalCompany);
   const sample=page.records.slice(0,policy?.firmablePageSize??page.records.length);sampled.push(...sample);firmablePages++;firmableSampledRows+=sample.length;
   if(!policy||page.records.length<policy.firmablePageSize||from+page.records.length>=page.totalCompany)break;
   if(!filters){
    if(!page.predictedFilters){discoveryFailed++;samplingBlockedReason='original_filters_unavailable';break;}
    try{filters=firmablePaginationFilters(page.predictedFilters,page.predictedCountry,policy.countryScope);}
    catch{discoveryFailed++;samplingBlockedReason='country_interpretation_requires_review';break;}
   }
  }
  // Search rows are discovery hints. Numeric bucket codes never become staff counts.
  // Deprioritise clearly labelled public bodies without deleting their evidence.
  firmableTruncated=firmableReportedTotal>firmableSampledRows;
  const rows=policy&&!allDiscovered?[...sampled].sort((a,b)=>Number(/\b(?:council|shire|government)\b/i.test(String(a.name)))-Number(/\b(?:council|shire|government)\b/i.test(String(b.name)))):sampled;
  const sampling=policy?balanceFirmableStaffBands(rows,policy,proofs):undefined;profileSampling=sampling?.summary;if(policy?.version===3)log('sampling',{sampledRows:firmableSampledRows,sampledPages:firmablePages,...profileSampling});
  if(allDiscovered){
   const seenIds=new Set<string>(),byDomain=new Map<string,Row[]>();
   for(const row of rows){const id=String(row.id??'');if(!/^f\d+$/.test(id)||seenIds.has(id))continue;seenIds.add(id);const domain=firmableDomain(row.website||row.fqdn);if(domain)byDomain.set(domain,[...(byDomain.get(domain)??[]),row]);add({candidateKey:`firmable:${id}`,domain,sources:['firmable'],firmableRow:row},'firmable');}
   for(const[domain,items]of byDomain)if(items.length===1)knownFirmable.set(domain,items[0]);
   log('discovery.firmable',{sampledRows:firmableSampledRows,uniqueIdentities:seenIds.size,missingWebsiteCandidates:[...selected.values()].filter(c=>!c.domain).length,conflictingDomains:[...byDomain.values()].filter(items=>items.length>1).length,sourceTruncated:firmableTruncated});
  }else{for(const row of deduplicateFirmableRows(sampling?.rows??rows)){const domain=firmableDomain(row.website||row.fqdn);if(!domain)continue;knownFirmable.set(domain,row);const existing=selected.get(domain);if(existing){existing.firmableRow=row;if(!existing.sources.includes('firmable'))existing.sources.unshift('firmable');}}
  for(const [domain,row] of knownFirmable)add({domain,sources:seenWeb.has(domain)?['firmable','web']:['firmable'],firmableRow:row},'firmable');}
 }catch{discoveryFailed++;}finally{producersDone++;wake();}})();
 const webProducer=(async()=>{try{
  if(continuation)return;
  const sampledWeb:WebCompany[][]=[];
  for(const [index,query]of (policy?plan.slice(0,policy.maxWebQueries):plan).entries()){
   if(!await running()||(!policy&&(webSelected>=quota||selected.size>=options.maxCompanies)))break;
   let result:{rows:WebCompany[];ok:boolean;category?:string};
   try{result=await deps.checkpoint(`f-web-search-${index}`,()=>deps.webSearch(query,index));}
   catch(error){if(!policy)throw error;searches++;searchFailed++;discoveryFailed++;break;}
   searches++;if(!result.ok)searchFailed++;
   if(allDiscovered&&!result.ok&&['native_budget_admission_required','native_provider_reconciliation_required'].includes(result.category??'')){
    webStopCategory=result.category;break;
   }
   if(policy){const maxRows=(policy.version===4||policy.version===5)?policy.maxWebRowsPerQuery:100;if(result.rows.length>maxRows)webTruncated=true;sampledWeb.push(result.rows.slice(0,maxRows));}
   else for(const row of result.rows)addWeb(row);
  }
  if(allDiscovered)await firmableProducer;
  if(policy)for(let round=0;round<Math.max(0,...sampledWeb.map(rows=>rows.length));round++)for(const rows of sampledWeb){const row=rows[round];if(row)addWeb(row);}
 }catch{discoveryFailed++;}finally{producersDone++;wake();}})();
 await firmableProducer;
 const consume=async()=>{for(;;){if(!await running())return;const company=queue.shift();if(company){const ordinal=++started;if(allDiscovered)outcomes.set(company.candidateKey??company.domain,'interrupted');const result=await deps.checkpoint(`f-company-${company.candidateKey??company.domain}`,attempt=>attempt?deps.profile(company,attempt):deps.profile(company));const disposition=companyProfileDisposition(result);if(allDiscovered)outcomes.set(company.candidateKey??company.domain,disposition==='failed'?'known_failed':disposition);if(allDiscovered)log('profile.result',{candidateOrdinal:ordinal,origins:company.sources,disposition});if(disposition==='saved'){saved++;if(result.matched)matched++;}else if(disposition==='review')identityReviewRequired++;else if(disposition==='skipped')skipped++;else failed++;continue;}
  if(producersDone===2){for(const company of overflow){if(selected.size>=options.maxCompanies)break;if(selected.has(company.domain))continue;selected.set(company.domain,company);queue.push(company);}overflow.length=0;if(queue.length)continue;return;}
  await wait();
 }};
 // A rejected profile must not let the caller finalize while an already-started
 // search or sibling profile can still persist progress. Stop launching work,
 // wake idle consumers, and drain the original requests without cancelling or
 // retrying them. Report the first error only after every branch is quiescent.
 await Promise.allSettled([webProducer,...Array.from({length:options.concurrency},()=>consume().catch(error=>{if(!fatal){fatal=true;fatalError=error;}wake();throw error;}))]);
 if(fatal&&allDiscovered)stopReason='interrupted';
 if(allDiscovered&&webStopCategory&&stopReason==='exhausted')stopReason=webStopCategory==='native_budget_admission_required'?'web_budget_limited':'web_reconciliation_required';
 if(!allDiscovered&&selected.size>=options.maxCompanies&&stopReason==='exhausted')stopReason='candidate_limit';
 const selection=[...selected.values()].map(c=>({... (c.candidateKey?{candidateKey:c.candidateKey}:{}),domain:c.domain,sources:c.sources,firmableId:c.firmableRow?.id||null,...(allDiscovered?{outcome:outcomes.get(c.candidateKey??c.domain)??'not_started'}:{})}));
 const interrupted=[...outcomes.values()].filter(value=>value==='interrupted').length;
 const result={...(fatal&&allDiscovered?{interrupted}:{}),...(continuation?{continuation:{version:1,sourceRootId:continuation.sourceRootId,sourceDigest:continuation.sourceDigest}}:{}),...(allDiscovered?{discoveryCoverage:{...(continuation?{}:{firmableReportedTotal,firmableTruncated,webTruncated}),scope:continuation?'reviewed_saved_candidates':'declared_source_bounds',webQueries:{planned:Math.min(plan.length,policy.maxWebQueries),attempted:searches,unattempted:Math.max(0,Math.min(plan.length,policy.maxWebQueries)-searches),...(webStopCategory?{stopCategory:webStopCategory}:{})}}}:{}),...(identityReviewRequired?{identityReviewRequired}:{}),...(skipped?{skipped}:{}),...(policy?{discoveryPolicy:policy,firmableSamplePages:firmablePages,firmableSampledRows,...(policy.version===3?{profileSampling}:{}),...(samplingBlockedReason?{samplingBlockedReason}:{})}:{}),candidates:selected.size,saved,matched,unmatched:saved-matched,failed,unprocessed:selected.size-started,searches,searchFailed,discoveryFailed,stopReason,firmableDiscovered:allDiscovered?[...selected.values()].filter(c=>c.firmableRow).length:knownFirmable.size,webDiscovered:seenWeb.size,overlap:[...seenWeb].filter(domain=>knownFirmable.has(domain)||(allDiscovered&&[...selected.values()].some(c=>c.domain===domain&&c.firmableRow))).length,selection};
 if(fatal){
  if(allDiscovered&&fatalError!==null&&(typeof fatalError==='object'||typeof fatalError==='function'))partialResults.set(fatalError,result);
  log('failed',{durationMs:Date.now()-began,profiled:started,...(allDiscovered?{saved,failed,interrupted,unprocessed:result.unprocessed}: {})});throw fatalError;
 }
 // Durable waits must run outside step.do: completion itself has a short timeout.
 await deps.beforeFinish?.();
 await deps.checkpoint('f-finish',()=>deps.finish(result));log('end',{durationMs:Date.now()-began,profiled:started,saved,failed,identityReviewRequired,stopReason});return result;
}
