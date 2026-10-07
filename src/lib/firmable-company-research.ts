import {tickCompanyPeople} from './company-people-research';
import {queueCompanyBackgroundResearch} from './company-background-research';
import {discoveryQueryPlan,seedRelevant} from '@/adapters/business-web-search';
import {cloudflareSearchResults} from '@/adapters/cloudflare-web-search';
import {webCompanyRows,matchWebFirmableCompany,type WebCompany} from '@/domain/web-firmable-pipeline';
import {isFirmableCompanyRoot,isWebFirmableRoot,isHybridCompanyRoot} from '@/domain/research-pipeline-design';
import {createHash} from 'node:crypto';
import {and,eq,sql} from 'drizzle-orm';
import {requireDb} from '@/db/client';
import {firmableCompanies,mandates,mandateTargets,researchFindings,researchJobs,targets} from '@/db/schema';
import {FirmableClient,FirmableError} from '@/adapters/firmable-client';
import {normalizeFirmableProfile,originalRevenueRange,type FirmableFilters} from '@/domain/firmable-company-pipeline';
import {mapFirmableProfile} from '@/adapters/firmable-company-mapper';
import {screenCompanyCandidate} from '@/domain/company-screening';
import {rankTarget} from '@/domain/scoring';
import type {Mandate} from '@/domain/models';
import type {ResearchConfig} from '@/domain/research';
type Job=typeof researchJobs.$inferSelect;
function stableId(root:string,key:string){const h=createHash('sha256').update(`${root}:firmable:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
export async function firmableCompanyResearch(job:Job,payload:Record<string,unknown>){
 const db=requireDb(),config=job.config as ResearchConfig;
 const hybrid=isHybridCompanyRoot(config,job.id);
 const web=isWebFirmableRoot(config,job.id)||(hybrid&&String(payload.action).startsWith('e-'));
 if(!isFirmableCompanyRoot(config,job.id)&&!web&&!hybrid)throw Error('Requires a company research root');
 if(!hybrid&&String(payload.action).startsWith(web?'d-':'e-'))throw Error('Action does not match pipeline design');
 const [mandate]=await db.select().from(mandates).where(and(eq(mandates.id,job.mandateId),eq(mandates.organizationId,job.organizationId)));if(!mandate)throw Error('Mandate missing');
 const guard=and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,job.organizationId),sql`${researchJobs.status} <> 'cancelled'`);
 if(payload.action==='company-people-status')return tickCompanyPeople(job);
 if(job.status==='cancelled')return {ok:false,stop:true};
 const client=new FirmableClient({retries:0});
 if(payload.action==='e-plan')return discoveryQueryPlan(config.searchTerms,config.geography);
 if(payload.action==='e-search'){
  const index=Number(payload.index);const query=discoveryQueryPlan(config.searchTerms,config.geography)[index];
  if(!Number.isInteger(index)||!query)throw Error('Invalid E query');
  if(Date.now()>=(config.automaticDeadline||Infinity))throw Error('E deadline reached');
  let result:{rows:WebCompany[];ok:boolean;error?:string};
  try{const rows=await cloudflareSearchResults(query.query,(input,init)=>{const headers=new Headers(init?.headers);if(typeof payload.browserReservation==='string')headers.set('x-research-browser-reservation',payload.browserReservation);return fetch(input,{...init,headers});},job.id,query.page);result={rows:webCompanyRows(rows.filter(row=>seedRelevant(row,config.searchTerms))).filter(row=>!config.skipDomains?.includes(row.domain)),ok:true};}
  catch(error){result={rows:[],ok:false,error:error instanceof Error?error.message:'Search failed'};}
  await db.update(researchJobs).set({status:'extracting',updatedAt:new Date(),message:`E web discovery query ${index+1}`,config:sql`${researchJobs.config} || jsonb_build_object('webSearchPages', COALESCE(${researchJobs.config}->'webSearchPages','{}'::jsonb) || jsonb_build_object(${String(index)}::text, ${JSON.stringify({query,...result})}::jsonb))`}).where(guard);
  return result;
 }
 if(payload.action==='d-search'){
  if(Date.now()>=(config.automaticDeadline||Infinity))throw Error('D deadline reached');
  const from=Number(payload.from||0);
  const cohort=process.env.LOCAL_RESEARCH_BENCHMARK==='true'&&process.env.FIRMABLE_BENCHMARK_COHORT?JSON.parse(process.env.FIRMABLE_BENCHMARK_COHORT) as Record<string,unknown>[]:null;
  if(cohort&&(!Array.isArray(cohort)||cohort.length<1||cohort.length>100||cohort.some(row=>!/^f\d+$/.test(String(row.id)))))throw Error('Invalid fixed Firmable benchmark cohort');
  const page=cohort?{records:cohort.slice(from,from+100),totalCompany:cohort.length,predictedFilters:{filters:{},operators:{},excluded:{}},benchmarkCohort:true}:await client.searchCompaniesPage(mandate.naturalLanguage,from,100,payload.interpreted as FirmableFilters|undefined);
  await db.update(researchJobs).set({status:'extracting',updatedAt:new Date(),message:`Firmable discovery: ${page.totalCompany} candidates; page ${from/100+1}`,config:sql`${researchJobs.config} || jsonb_build_object('firmableSearchPages', COALESCE(${researchJobs.config}->'firmableSearchPages','{}'::jsonb) || jsonb_build_object(${String(from)}::text, ${JSON.stringify({query:mandate.naturalLanguage,from,...page})}::jsonb))`}).where(guard);
  return page;
 }
 if(payload.action==='d-company'||payload.action==='e-company'){
  const row=payload.row as Record<string,unknown>;if(!row||(!web&&!/^f\d+$/.test(String(row.id)))||(web&&(!row.domain||!row.name||row.website!==`https://${row.domain}`)))throw Error('Invalid company');
  const id=stableId(job.id,String(hybrid?payload.expectedDomain:web?row.domain:row.id));
  const baseConfig={...config} as ResearchConfig & {firmableSearchPages?:unknown};delete baseConfig.firmableSearchPages;delete (baseConfig as Record<string,unknown>).webSearchPages;
  const childConfig={...baseConfig,...(hybrid?{discoveryOrigins:payload.sources,hybridFirmableId:web?null:row.id,hybridExpectedDomain:payload.expectedDomain}:{}),executionSlot:`d-${id}`,researchTask:'company',parentJobId:job.id,companyDomain:String(row.website||row.fqdn||'').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0],companyName:String(row.name||row.id),...(web?{webDiscovery:row}:{firmableCompanyId:row.id,firmableSearchRow:row}),parallelBusinessResearch:false};
  await db.insert(researchJobs).values({id,organizationId:job.organizationId,mandateId:job.mandateId,createdBy:job.createdBy,config:childConfig,status:'extracting',message:'Reading Firmable company profile'}).onConflictDoNothing();
  const [existing]=await db.select().from(researchJobs).where(eq(researchJobs.id,id));if(existing.status==='complete'){const saved=existing.config as ResearchConfig & {firmableCompanyId?:string;firmableProfile?:{firmableId:string};firmableMatch?:string};return {ok:true,matched:saved.firmableMatch==='matched',targetId:saved.targetId,firmableId:saved.firmableProfile?.firmableId||saved.firmableCompanyId};}
  try{
   let matched=true,matchStatus='matched';let raw:Record<string,unknown>;
   if(web){try{raw=await matchWebFirmableCompany(row as unknown as WebCompany,identifier=>client.enrichCompany(identifier));}
    catch(error){if(!(error instanceof FirmableError)||![404,409].includes(error.status))throw error;
     matched=false;matchStatus=error.status===409?'ambiguous':'not_found';raw={name:String(row.name),website:String(row.website),websiteResearch:{status:'queued',fields:{description:'research_incomplete',company_emails:'research_incomplete',company_phones:'research_incomplete',year_founded:'research_incomplete',acn:'research_incomplete',website_address:'research_incomplete',employee_count:'research_incomplete',revenue:'research_incomplete'},errors:[]}};}
   }else raw=await client.enrichCompany({id:String(row.id)});
   const websiteResearch=raw.websiteResearch as {status?:string;errors?:unknown[]}|undefined;
   const websiteOperationalPartial=!matched && ['failed','partial'].includes(websiteResearch?.status || '');
   const profile=normalizeFirmableProfile(raw);
   if(hybrid&&profile.domain!==payload.expectedDomain)throw Error('Hybrid company profile domain mismatch');
   if(!profile.domain||!profile.companyName)throw Error('Profile has no company identity');
   const abnLookup={status:matched&&profile.abn?'provider_reported':'pending',operationalStatus:'complete',missingReason:null,errors:[]};
   const original=mandate.filters as Mandate;
   // Respect the narrower original brief revenue range rather than the parser's separate ceiling.
   const brief=(mandate.filters as {brief?:{criteria?:{key:string;value?:string}[]}}).brief;
   const revenueRange=originalRevenueRange(brief?.criteria,original.revenue);
   const targetId=stableId(job.id,`domain:${profile.domain}`);
   const candidate=mapFirmableProfile(raw,original,job.organizationId);
   const screening=screenCompanyCandidate(candidate,{...original,revenue:revenueRange || original.revenue});
   const excluded=screening.eligibility==='excluded';
   const supported=['headcount','revenue','geography','sector'].every(k=>screening[k as 'headcount'|'revenue'|'geography'|'sector']==='supported');
   const abn=matched?profile.abn:null;
   const abnSource=matched&&profile.abn?{source:'Firmable',sourceUrl:`https://app.firmable.com/dashboard/company/${profile.firmableId}`,capturedAt:profile.retrievedAt}:undefined;
   const ranked=rankTarget(candidate,original);
   let backgroundJobId:string|null=null;
   await db.transaction(async tx=>{
    const [root]=await tx.select({status:researchJobs.status}).from(researchJobs).where(eq(researchJobs.id,job.id)).for('share');
    if(root?.status==='cancelled')throw Error('D root was cancelled');
    if(matched)await tx.insert(firmableCompanies).values({id:profile.firmableId,name:profile.companyName,domain:profile.domain,abn}).onConflictDoUpdate({target:firmableCompanies.id,set:{name:profile.companyName,domain:profile.domain,abn,updatedAt:new Date()}});
    await tx.insert(targets).values({id:targetId,organizationId:job.organizationId,mandateId:job.mandateId,companyName:profile.companyName,domain:profile.domain,firmableCompanyId:matched?profile.firmableId:null,identifiers:{...(matched?{firmableId:profile.firmableId}:{}),abn,...(abnSource?{abnSource}:{})},firmographics:{abnVerification:{status:abnLookup.status,operationalStatus:abnLookup.operationalStatus,missingReason:abnLookup.missingReason,errors:abnLookup.errors},suburb:ranked.suburb,state:ranked.state,sector:ranked.sector,revenue:ranked.revenue,ebitda:ranked.ebitda,headcount:ranked.headcount,headcountBand:candidate.headcountBand,establishedYear:ranked.establishedYear,...(matched?{firmable:{...ranked.sourceData?.firmable,rawResponse:raw}}:{webDiscovery:row,firmableMatch:matchStatus,websiteResearch:raw.websiteResearch,websiteProfile:ranked.sourceData?.firmable}),screening},status:'enriched',band:excluded?'excluded':ranked.scores.band,qualification:excluded?'excluded':'research',fitScore:ranked.scores.fit,ripenessScore:ranked.scores.ripeness,confidenceScore:ranked.scores.confidence,financeabilityScore:ranked.scores.financeability}).onConflictDoNothing();
    await tx.insert(mandateTargets).values({organizationId:job.organizationId,mandateId:job.mandateId,targetId,assessment:{decisionOrigin:'automatic',stage:excluded?'excluded':'identified',reason:excluded?'Outside an original mandate range':'Company-only profile; bands and diligence require review',nextAction:'Verify original mandate criteria',evidence:[],qualificationConfirmed:false}}).onConflictDoNothing();
    if(abn)await tx.insert(researchFindings).values({jobId:id,organizationId:job.organizationId,mandateId:job.mandateId,targetId,evidenceKey:'firmable-abn',sourceUrl:abnSource?.sourceUrl||`https://abr.business.gov.au/ABN/View?abn=${abn}`,observedAt:new Date(),confidence:.7,evidence:{kind:'identifier',name:'ABN',value:abn,quote:`Firmable company profile reports ABN ${abn}`,relevance:'unclear'}}).onConflictDoNothing();
    backgroundJobId=(await queueCompanyBackgroundResearch(job,{...ranked,id:targetId,abn:abn||undefined,sourceData:{...ranked.sourceData,abnVerification:abnLookup}},tx)).jobId;
    await tx.update(researchJobs).set({status:websiteOperationalPartial?'partial':'complete',pages:1,message:websiteOperationalPartial?`Discovered company retained; website research ${websiteResearch?.status}; Firmable ${matchStatus}`:matched?'Company-only profile saved':`Discovered company saved; Firmable ${matchStatus}`,updatedAt:new Date(),config:{...childConfig,companyDomain:profile.domain,targetId,firmableProfile:matched?profile:null,firmableMatch:matchStatus,websiteResearch:raw.websiteResearch,abnLookup,screening,newBusinessIds:supported?[targetId]:[]}}).where(eq(researchJobs.id,id));
   });
   return {ok:true,matched,targetId,firmableId:matched?profile.firmableId:undefined,backgroundJobId};
  }catch(error){const message=error instanceof Error?error.message:'Profile failed';await db.update(researchJobs).set({status:'failed',updatedAt:new Date(),message}).where(eq(researchJobs.id,id));return {ok:false};}
 }
 if(['d-finish','d-fail','e-finish','e-fail','f-finish','f-fail'].includes(String(payload.action))){
  const [partialCompany]=await db.select({id:researchJobs.id}).from(researchJobs).where(and(eq(researchJobs.organizationId,job.organizationId),eq(researchJobs.mandateId,job.mandateId),eq(researchJobs.status,'partial'),sql`${researchJobs.config}->>'parentJobId' = ${job.id}`,sql`${researchJobs.config}->>'researchTask' = 'company'`)).limit(1);
  const result=payload.result as Record<string,unknown>||{};const failed=Boolean(partialCompany)||['d-fail','e-fail','f-fail'].includes(String(payload.action))||Number(result.failed)>0||Number(result.searchFailed)>0||Number(result.discoveryFailed)>0||Number(result.unprocessed)>0||!['candidate_limit','exhausted'].includes(String(result.stopReason));
  if(hybrid&&Array.isArray(result.selection))for(const item of result.selection as {domain:string;sources:string[];firmableId:string|null}[]){
   await db.update(researchJobs).set({config:sql`${researchJobs.config} || ${JSON.stringify({discoveryOrigins:item.sources,hybridFirmableId:item.firmableId})}::jsonb`}).where(and(eq(researchJobs.id,stableId(job.id,item.domain)),eq(researchJobs.organizationId,job.organizationId)));
  }
  await db.update(researchJobs).set({status:failed?'partial':'complete',updatedAt:new Date(),message:failed?'Company retrieval completed with operational gaps':'Company retrieval completed; mandate fit requires review',config:sql`${researchJobs.config} || ${JSON.stringify({parallelResearchSettled:true,discoveryPending:false,...(hybrid?{hybridResult:result}:web?{webFirmableResult:result}:{firmableResult:result}),excludedCapabilities:config.includeCompanyPeople?['phone']:['people','email']})}::jsonb`}).where(guard);return {ok:!failed};
 }
 throw Error('Unsupported D action');
}
