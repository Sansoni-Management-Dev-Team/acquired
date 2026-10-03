import {isFirmableCompanyRoot} from '@/domain/research-pipeline-design';
import {createHash} from 'node:crypto';
import {and,eq,sql} from 'drizzle-orm';
import {requireDb} from '@/db/client';
import {firmableCompanies,mandates,mandateTargets,researchFindings,researchJobs,targets} from '@/db/schema';
import {FirmableClient} from '@/adapters/firmable-client';
import type {IdentityPage,AbnRecord} from '@/domain/abn-resolution.mjs';
import {resolvePublicCompanyAbn} from '@/adapters/abn-identity-resolver';
import {normalizeFirmableProfile,screenBand,originalRevenueRange,type FirmableFilters} from '@/domain/firmable-company-pipeline';
import {mapFirmableProfile} from '@/adapters/firmable-company-mapper';
import {rankTarget} from '@/domain/scoring';
import type {Mandate} from '@/domain/models';
import type {ResearchConfig} from '@/domain/research';
type Job=typeof researchJobs.$inferSelect;
function stableId(root:string,key:string){const h=createHash('sha256').update(`${root}:firmable:${key}`).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
export async function firmableCompanyResearch(job:Job,payload:Record<string,unknown>){
 const db=requireDb(),config=job.config as ResearchConfig;
 if(!isFirmableCompanyRoot(config,job.id))throw Error('D requires an automatic company research root');
 const [mandate]=await db.select().from(mandates).where(and(eq(mandates.id,job.mandateId),eq(mandates.organizationId,job.organizationId)));if(!mandate)throw Error('Mandate missing');
 const guard=and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,job.organizationId),sql`${researchJobs.status} <> 'cancelled'`);
 if(job.status==='cancelled')return {ok:false,stop:true};
 const client=new FirmableClient({retries:0});
 if(payload.action==='d-search'){
  if(Date.now()>=(config.automaticDeadline||Infinity))throw Error('D deadline reached');
  const from=Number(payload.from||0);
  const cohort=process.env.LOCAL_RESEARCH_BENCHMARK==='true'&&process.env.FIRMABLE_BENCHMARK_COHORT?JSON.parse(process.env.FIRMABLE_BENCHMARK_COHORT) as Record<string,unknown>[]:null;
  if(cohort&&(!Array.isArray(cohort)||cohort.length<1||cohort.length>100||cohort.some(row=>!/^f\d+$/.test(String(row.id)))))throw Error('Invalid fixed Firmable benchmark cohort');
  const page=cohort?{records:cohort.slice(from,from+100),totalCompany:cohort.length,predictedFilters:{filters:{},operators:{},excluded:{}},benchmarkCohort:true}:await client.searchCompaniesPage(mandate.naturalLanguage,from,100,payload.interpreted as FirmableFilters|undefined);
  await db.update(researchJobs).set({status:'extracting',updatedAt:new Date(),message:`Firmable discovery: ${page.totalCompany} candidates; page ${from/100+1}`,config:sql`${researchJobs.config} || jsonb_build_object('firmableSearchPages', COALESCE(${researchJobs.config}->'firmableSearchPages','{}'::jsonb) || jsonb_build_object(${String(from)}::text, ${JSON.stringify({query:mandate.naturalLanguage,from,...page})}::jsonb))`}).where(guard);
  return page;
 }
 if(payload.action==='d-company'){
  const row=payload.row as Record<string,unknown>;if(!row||!/^f\d+$/.test(String(row.id)))throw Error('Invalid Firmable company');
  const id=stableId(job.id,String(row.id));
  const baseConfig={...config} as ResearchConfig & {firmableSearchPages?:unknown};delete baseConfig.firmableSearchPages;
  const childConfig={...baseConfig,executionSlot:`d-${id}`,researchTask:'company',parentJobId:job.id,companyDomain:String(row.website||row.fqdn||'').replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0],companyName:String(row.name||row.id),firmableCompanyId:row.id,firmableSearchRow:row,parallelBusinessResearch:false};
  await db.insert(researchJobs).values({id,organizationId:job.organizationId,mandateId:job.mandateId,createdBy:job.createdBy,config:childConfig,status:'extracting',message:'Reading Firmable company profile'}).onConflictDoNothing();
  const [existing]=await db.select().from(researchJobs).where(eq(researchJobs.id,id));if(existing.status==='complete')return {ok:true};
  try{
   const raw=await client.enrichCompany({id:String(row.id)}),profile=normalizeFirmableProfile(raw);
   if(!profile.domain||!profile.companyName)throw Error('Profile has no company identity');
   let abnLookup:Awaited<ReturnType<typeof resolvePublicCompanyAbn>>|null=null;let registryAbn:string|null=null;
   // Reuse only recent, completed evidence belonging to this organization and domain.
   const [previous]=await db.select({config:researchJobs.config}).from(researchJobs).where(and(eq(researchJobs.organizationId,job.organizationId),eq(researchJobs.status,'complete'),sql`${researchJobs.id} <> ${id}`,sql`${researchJobs.config}->>'companyDomain' = ${profile.domain}`,sql`${researchJobs.updatedAt} > NOW() - INTERVAL '24 hours'`)).orderBy(sql`${researchJobs.updatedAt} DESC`).limit(1);
   const saved=(previous?.config as {abnLookup?:{websitePages?:IdentityPage[];records?:AbnRecord[]}}|undefined)?.abnLookup;
   const prior=saved&&Array.isArray(saved.websitePages)&&Array.isArray(saved.records)?{websitePages:saved.websitePages,records:saved.records}:undefined;
   abnLookup=await resolvePublicCompanyAbn({name:profile.companyName,website:profile.website||`https://${profile.domain}`,deadline:config.automaticDeadline,explicitAbns:profile.abnCandidates,firmableProfileUrl:`https://app.firmable.com/dashboard/company/${profile.firmableId}`,prior});registryAbn=abnLookup.abn;
   const original=mandate.filters as Mandate;
   // Respect the narrower original brief revenue range rather than the parser's separate ceiling.
   const brief=(mandate.filters as {brief?:{criteria?:{key:string;value?:string}[]}}).brief;
   const revenueRange=originalRevenueRange(brief?.criteria,original.revenue);
   const targetId=stableId(job.id,`domain:${profile.domain}`);
   const screening={headcount:screenBand(profile.headcountExact?{min:profile.headcountExact,max:profile.headcountExact}:profile.headcountBand,original.headcount),revenue:screenBand(profile.revenueBand,revenueRange),geography:profile.states.length?(profile.states.some(s=>original.states.includes(s))?'supported':'excluded'):'review',sector:'review',diligence:'review'};
   const content=`${profile.industries.join(' ')} ${profile.description}`.toLowerCase();
   if(original.sectors.some(s=>s.toLowerCase().split(/\W+/).filter(w=>w.length>3&&!['services','commercial','industrial','specialty','and'].includes(w)).some(w=>content.includes(w))))screening.sector='supported';
   const excluded=Object.values(screening).includes('excluded');const supported=['headcount','revenue','geography','sector'].every(k=>screening[k as keyof typeof screening]==='supported');
   const abn=registryAbn;
   const candidate=mapFirmableProfile(raw,original,job.organizationId);
   const ranked=rankTarget(candidate,original);
   await db.transaction(async tx=>{
    const [root]=await tx.select({status:researchJobs.status}).from(researchJobs).where(eq(researchJobs.id,job.id)).for('share');
    if(root?.status==='cancelled')throw Error('D root was cancelled');
    await tx.insert(firmableCompanies).values({id:profile.firmableId,name:profile.companyName,domain:profile.domain,abn}).onConflictDoUpdate({target:firmableCompanies.id,set:{name:profile.companyName,domain:profile.domain,abn,updatedAt:new Date()}});
    await tx.insert(targets).values({id:targetId,organizationId:job.organizationId,mandateId:job.mandateId,companyName:profile.companyName,domain:profile.domain,firmableCompanyId:profile.firmableId,identifiers:{firmableId:profile.firmableId,abn},firmographics:{suburb:ranked.suburb,state:ranked.state,sector:ranked.sector,revenue:ranked.revenue,ebitda:ranked.ebitda,headcount:ranked.headcount,headcountBand:candidate.headcountBand,establishedYear:ranked.establishedYear,firmable:{...ranked.sourceData?.firmable,rawResponse:raw,employeeCount:undefined},screening},status:'enriched',band:excluded?'excluded':ranked.scores.band,qualification:excluded?'excluded':'research',fitScore:ranked.scores.fit,ripenessScore:ranked.scores.ripeness,confidenceScore:ranked.scores.confidence,financeabilityScore:ranked.scores.financeability}).onConflictDoNothing();
    await tx.insert(mandateTargets).values({organizationId:job.organizationId,mandateId:job.mandateId,targetId,assessment:{stage:excluded?'excluded':'identified',reason:excluded?'Outside an original mandate range':'Company-only profile; bands and diligence require review',nextAction:'Verify original mandate criteria',evidence:[],qualificationConfirmed:false}}).onConflictDoNothing();
    if(abn)await tx.insert(researchFindings).values({jobId:id,organizationId:job.organizationId,mandateId:job.mandateId,targetId,evidenceKey:'firmable-abn',sourceUrl:`https://abr.business.gov.au/ABN/View?abn=${abn}`,observedAt:new Date(),confidence:.7,evidence:{kind:'identifier',name:'ABN',value:abn,quote:abnLookup?.record?.quote||JSON.stringify({entityName:abnLookup?.record?.entityName,abn,identityEvidence:abnLookup?.evidence}),relevance:'unclear'}}).onConflictDoNothing();
    await tx.update(researchJobs).set({status:'complete',pages:1,message:'Company-only profile saved',updatedAt:new Date(),config:{...childConfig,companyDomain:profile.domain,targetId,firmableProfile:profile,abnLookup,screening,newBusinessIds:supported?[targetId]:[]}}).where(eq(researchJobs.id,id));
   });
   return {ok:true};
  }catch(error){const message=error instanceof Error?error.message:'Profile failed';await db.update(researchJobs).set({status:'failed',updatedAt:new Date(),message}).where(eq(researchJobs.id,id));return {ok:false};}
 }
 if(payload.action==='d-finish'||payload.action==='d-fail'){
  const result=payload.result as Record<string,unknown>||{};const failed=payload.action==='d-fail'||Number(result.failed)>0||!['candidate_limit','exhausted'].includes(String(result.stopReason));
  await db.update(researchJobs).set({status:failed?'partial':'complete',updatedAt:new Date(),message:failed?'D completed with retrieval gaps':'D company-only retrieval completed; mandate fit requires review',config:sql`${researchJobs.config} || ${JSON.stringify({parallelResearchSettled:true,discoveryPending:false,firmableResult:result,excludedCapabilities:['people','email']})}::jsonb`}).where(guard);return {ok:!failed};
 }
 throw Error('Unsupported D action');
}
