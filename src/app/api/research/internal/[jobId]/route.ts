import {withResearchJobWorkflow} from '@/lib/acquisition-workflow-context';
import {observeInitialResearchProgress} from '@/lib/agent-initial-research-observer';
import {nativeResearchRequestClassSchema} from '@/lib/agent-research-provider-request';
import{executeNativeFieldsResearch,finishNativeFieldsResearch}from'@/lib/agent-fields-execution';
import {executeNativePeopleResearch,finishNativePeopleResearch} from '@/lib/agent-people-execution';
import {agentStore,nativeAgentEnabled} from '@/lib/agent-runtime';
import {nativeResearchProviderAdmissionRequired} from '@/lib/agent-research-admission';
import {dispatchCompanyBackground} from '@/lib/company-background-dispatch';
import {executeCompanyBackground} from '@/lib/company-background-execution';
import {queueCompanyPeople} from '@/lib/company-people-research';
import { firmableCompanyResearch } from '@/lib/firmable-company-research';
import {FirmableError} from '@/adapters/firmable-client';
import { researchCallbackContext } from '@/lib/research-egress-metrics';
import { adaptiveDiscovery, discoveryLimit, discoveryRegions, resolveDiscoveryDecision, DISCOVERY_BATCH_SIZE, discoveryQueryId, type DiscoveryContext, type DiscoveryAttempt } from "@/domain/adaptive-discovery";
import { setResearchDatabaseContext, bufferResearchTiming, configureResearchTelemetry, flushResearchTiming, observeResearchRequest, researchRequestJson, researchJsonResponse, observeResearchOperation, researchRequestId } from "@/lib/research-request-observability";
import {safeResearchTrace} from '@/domain/research-trace-context';
import { saveResearchTimingSpans } from "@/db/research-timing-repository";
import { measureResearchSegment } from "@/lib/research-segment-timing";
import { scheduleResearchRun } from "@/lib/research-scheduler";
import { registerWebsitePages } from '@/lib/parallel-business-research';
import { coolDownResearchBrowser, reserveResearchProvider, releaseResearchProvider } from "@/lib/research-provider-queue";
import { researchBrowserPermit } from "@/lib/research-browser-permit";
import { objectiveFields, fieldSatisfied, nextSearchQuery, type ResearchField } from "@/domain/research-objectives";
import { targetedQueries } from "@/domain/targeted-research";
import { snippetSizeEstimates } from "@/domain/snippet-estimates";
import { researchDomain } from "@/domain/research";
import { companyFactSearchQuery } from "@/domain/company-facts";
import { mergePeopleSearchLeads, peopleFollowupQuery, cleanLegalEntity, type PeopleSearchLead } from "@/domain/people-search-results";
import { dispatchContinuation } from "@/lib/research-continuation";
import { abnResearchResults, companyResultMatches } from "@/domain/company-research-routing";
import { publicAbnLookup } from '@/adapters/abn-public-lookup';
import { usesPublicAbnLookup } from '@/domain/public-abn-policy';
import { cloudflareSearchResults } from "@/adapters/cloudflare-web-search";
import { discoveryQueryPlan, runDiscoveryQueries } from "@/adapters/business-web-search";
import { dispatchBusinessPeople } from "@/lib/business-research-people";
import { peopleWebSearch } from "@/adapters/people-web-search";
import { after } from "next/server";
import { z } from "zod";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { requireDb } from "@/db/client";
import { directorySource } from "@/domain/discovery-sources";
import { mandateTargets, researchJobs, researchFindings, targets } from "@/db/schema";
import { researchExecutionProgressAt, researchExecutionSelection, ResearchRepository } from "@/db/research-repository";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { OrganizationRepository } from "@/db/repositories";
import { createTargetDataProvider } from "@/adapters/provider-mode";
import { discoverMandate } from "@/adapters/mandate-discovery";
import { briefToMandate } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import {
  progressSchema,
  researchPerformanceFlags,
  researchQueries,
  publicResearchUrl,
  terminalResearchStates,
  type ResearchConfig,
} from "@/domain/research";
import {
  researchEnabled,
  researchServiceAuthorized,
} from "@/lib/research-service";
export const maxDuration = 120;
const DISCOVERY_PERSIST_BATCH = 8;
async function getJob(request: Request, jobId: string, lean = false,action='control') {
  if (!researchServiceAuthorized(request) || !researchEnabled()) return null;
  if (!z.string().uuid().safeParse(jobId).success) return null;
  const job = (
    await requireDb()
      .select({... (lean ? {
        ...researchExecutionSelection,
        nativeAgentJob:sql<boolean>`${researchJobs.config} ? 'nativeAgent'`,
        nativeAgentSnapshot:sql<ResearchConfig['nativeAgent']>`${researchJobs.config}->'nativeAgent'`,
        config: sql<ResearchConfig>`jsonb_build_object('researchRunId', ${researchJobs.config}->'researchRunId', 'budget', ${researchJobs.config}->'budget', 'automaticDeadline', ${researchJobs.config}->'automaticDeadline', 'newBusinessIds', ${researchJobs.config}->'newBusinessIds', 'performanceFlags', ${researchJobs.config}->'performanceFlags', 'discoveryCandidate', ${researchJobs.config}->'discoveryCandidate', 'parallelDiscovery', ${researchJobs.config}->'parallelDiscovery', 'companyBackgroundResearch', ${researchJobs.config}->'companyBackgroundResearch')`,
      } : researchExecutionSelection), ...(action==='control'?{executionUpdatedAt:researchExecutionProgressAt}:{})})
      .from(researchJobs)
      .where(eq(researchJobs.id, jobId))
      .limit(1)
  )[0];
  if(!job)return null;
  if(('nativeAgentJob' in job&&job.nativeAgentJob===true)||nativeResearchProviderAdmissionRequired(job.config)){
    const metadata=(job.config as ResearchConfig).nativeAgent??('nativeAgentSnapshot' in job?job.nativeAgentSnapshot:undefined);
    const allowed=metadata?.providerAdmission==='public-fields-v1'?['control','native-fields-plan','native-fields-company','native-fields-finish','provider-reserve','provider-release','browser-permit','browser-cooldown','native-provider-begin','native-provider-finish']:metadata?.providerAdmission==='hybrid-company-v1'?['control','f-continuation-plan','d-search','d-company','e-plan','e-search','e-company','f-finish','f-fail','provider-reserve','provider-release','browser-permit','browser-cooldown','native-provider-begin','native-provider-finish']:metadata?.providerAdmission==='firmable-company-v1'?['control','d-search','d-company','d-finish','d-fail','native-provider-begin','native-provider-finish']:metadata?.providerAdmission==='firmable-people-v1'?['control','native-people-plan','native-people-company','native-people-finish','native-provider-begin','native-provider-finish']:[];
    if(!nativeAgentEnabled()||!metadata||(job.config as ResearchConfig).researchRunId!==job.id||!allowed.includes(action))return null;
    const store=agentStore({organizationId:job.organizationId,userId:job.createdBy});
    if(action!=='native-provider-finish'&&!await store.nativeResearchExecutionAllowed(metadata.threadId,metadata.operationId,['d-finish','d-fail','f-finish','f-fail'].includes(action)))return null;
    return job;
  }
  // Root provenance fences children whose existing configuration builder did
  // not copy extension fields. No agent schema is needed for original UI jobs.
  const rootId=(job.config as ResearchConfig).researchRunId;
  if(rootId&&rootId!==job.id&&z.string().uuid().safeParse(rootId).success){
    const root=await new ResearchRepository(job.organizationId).getExecution(rootId);
    if(root&&root.mandateId===job.mandateId&&nativeResearchProviderAdmissionRequired(root.config))return null;
  }
  return job;
}
async function getResearchControl(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const lean = new URL(request.url).searchParams.get("control") === "1";
  const job = await getJob(request, jobId, lean);
  if (!job) return researchJsonResponse({ error: "Not available" }, { status: 403 });
  setResearchDatabaseContext({ ...jobTraceContext(job), organizationId: job.organizationId });
  configureResearchTelemetry(researchPerformanceFlags(job.config as ResearchConfig).telemetryBatching);
  return withResearchJobWorkflow(job,async()=>researchJsonResponse(await controlSnapshot(job, !lean), { headers: { "Cache-Control": "no-store" } }));
}
async function runEvidence(job: NonNullable<Awaited<ReturnType<typeof getJob>>>) {
  const config = job.config as ResearchConfig;
  const rootId = config.researchRunId || job.id;
  if (!config.targetId && config.parallelBusinessResearch && config.researchTask === 'field' && config.companyDomain) {
    const domain = researchDomain(`https://${config.companyDomain}/`);
    const target = sql`(SELECT CASE WHEN count(DISTINCT t.id) = 1 THEN (array_agg(DISTINCT t.id))[1] ELSE NULL END FROM targets t JOIN mandate_targets member ON member.target_id = t.id AND member.organization_id = ${job.organizationId} AND member.mandate_id = ${job.mandateId} WHERE t.organization_id = ${job.organizationId} AND regexp_replace(lower(t.domain), '^www[.]', '') = ${domain})`;
    return requireDb().select().from(researchFindings).where(and(eq(researchFindings.organizationId, job.organizationId), eq(researchFindings.mandateId, job.mandateId),
      sql`(${researchFindings.jobId} = ${job.id} OR (${researchFindings.targetId} = ${target} AND ${researchFindings.jobId} IN (SELECT sibling.id FROM research_jobs sibling WHERE sibling.organization_id = ${job.organizationId} AND sibling.mandate_id = ${job.mandateId} AND (sibling.id = ${rootId} OR sibling.config->>'researchRunId' = ${rootId}))))`,
      sql`COALESCE(${researchFindings.evidence}->'factMetadata'->>'basis', '') <> 'search_snippet'`));
  }
  return requireDb().select().from(researchFindings).where(and(eq(researchFindings.organizationId, job.organizationId), config.targetId ? and(eq(researchFindings.targetId, config.targetId), sql`${researchFindings.jobId} IN (SELECT id FROM research_jobs WHERE id = ${rootId} OR config->>'researchRunId' = ${rootId})`) : eq(researchFindings.jobId, job.id)));
}
function jobTraceContext(job: NonNullable<Awaited<ReturnType<typeof getJob>>>) {
  const config=job.config as ResearchConfig;
  const native=config.nativeAgent??('nativeAgentSnapshot' in job?job.nativeAgentSnapshot as ResearchConfig['nativeAgent']:undefined);
  return safeResearchTrace({jobId:job.id,mandateId:job.mandateId,runId:config.researchRunId||job.id,operationId:native?.operationId});
}
async function controlSnapshot(job: NonNullable<Awaited<ReturnType<typeof getJob>>>, includeFindings = false) {
  const config = job.config as ResearchConfig;
  const root = config.researchRunId && config.researchRunId !== job.id ? await new ResearchRepository(job.organizationId).getControl(config.researchRunId) : job;
  return {
    traceContext: jobTraceContext(job),
    status: root?.status === "cancelled" ? "cancelled" : job.status,
    updatedAt: job.updatedAt.toISOString(), executionUpdatedAt: job.executionUpdatedAt?.toISOString(), crawlId: job.crawlId, config: { ...(config.discoveryCandidate || config.parallelDiscovery ? { ...config, newBusinessIds: (root?.config as ResearchConfig | undefined)?.newBusinessIds || [] } : config), pipelineTiming: undefined }, seeds: job.seeds,
    deadline: config.companyBackgroundResearch ? config.automaticDeadline || Infinity : Math.min(job.createdAt.getTime() + config.budget.maxMinutes * 60000, (root?.config as ResearchConfig | undefined)?.automaticDeadline || Infinity),
    ...(includeFindings && (config.targetId || (config.parallelBusinessResearch && config.researchTask === 'field' && config.companyDomain)) ? { findings: (await runEvidence(job)).map(f => f.evidence) } : {}),
  };
}

async function discoveryContext(job: NonNullable<Awaited<ReturnType<typeof getJob>>>): Promise<DiscoveryContext> {
  const config = job.config as ResearchConfig;
  const rootId = config.researchRunId || job.id;
  const jobs = await new ResearchRepository(job.organizationId).discoveryRunJobs(rootId, job.mandateId);
  const attempts = config.discoveryAttempts || [];
  const stopped = jobs.some(j => j.status === "cancelled") || Boolean(config.discoveryStopReason) || Date.now() >= (config.automaticDeadline || Infinity);
  return {
    scope: config.researchScope || config.searchTerms.join("; "), startingTerms: config.searchTerms,
    regions: discoveryRegions(config.geography), target: config.targetBusinesses || 20,
    found: new Set(jobs.flatMap(j => (j.config as ResearchConfig).newBusinessIds || [])).size,
    remainingSearches: stopped ? 0 : Math.max(0, discoveryLimit(config) - attempts.length), attempts,
    knownDomains: [...new Set(jobs.flatMap(j => (j.seeds as string[]).map(researchDomain)))].slice(0, 1000),
    candidates: jobs.filter(j => (j.config as ResearchConfig).discoveryCandidate).slice(0, 100).map(j => ({ domain: (j.config as ResearchConfig).companyDomain || "", status: j.status, relevant: Boolean((j.config as ResearchConfig).newBusinessIds?.length) })),
  };
}

async function saveSearchLeads(jobId: string, previous: PeopleSearchLead[], leads: PeopleSearchLead[]) {
  await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{peopleSearchLeads}', ${JSON.stringify(mergePeopleSearchLeads([...leads, ...previous]))}::jsonb)` }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates)));
}
async function postResearchCallback(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  if (!researchServiceAuthorized(request) || !researchEnabled() || !z.string().uuid().safeParse(jobId).success) return researchJsonResponse({ error: "Not available" }, { status: 403 });
  const payload = await researchRequestJson(request).catch(() => null);
  setResearchDatabaseContext(researchCallbackContext(payload?.action));
  const job = await getJob(request, jobId,false,typeof payload?.action==='string'?payload.action:'progress');
  if (!job) return researchJsonResponse({ error: "Not available" }, { status: 403 });
  setResearchDatabaseContext({ ...jobTraceContext(job), organizationId: job.organizationId });
  return withResearchJobWorkflow(job,()=>applyResearchCallback(job,jobId,payload));
}
async function applyResearchCallback(job:NonNullable<Awaited<ReturnType<typeof getJob>>>,jobId:string,payload:Awaited<ReturnType<typeof researchRequestJson>>){
  configureResearchTelemetry(researchPerformanceFlags(job.config as ResearchConfig).telemetryBatching);
  const repo = new ResearchRepository(job.organizationId);
  if(payload?.action==='native-fields-plan'){const meta=(job.config as ResearchConfig).nativeAgent!,plan=await agentStore({organizationId:job.organizationId,userId:job.createdBy}).nativeFieldsPlan(meta.threadId,meta.operationId);return researchJsonResponse({targetIds:plan.selected.map(c=>c.targetId)});}
  if(payload?.action==='native-fields-company'){const p=z.object({action:z.literal('native-fields-company'),targetId:z.string().uuid()}).strict().safeParse(payload);if(!p.success)return researchJsonResponse({error:'Exact field company required'},{status:400});return researchJsonResponse(await executeNativeFieldsResearch(job,p.data.targetId));}
  if(payload?.action==='native-fields-finish')return researchJsonResponse(await finishNativeFieldsResearch(job));
  if(payload?.action==='native-people-plan'){const meta=(job.config as ResearchConfig).nativeAgent!;const plan=await agentStore({organizationId:job.organizationId,userId:job.createdBy}).nativePeoplePlan(meta.threadId,meta.operationId);return researchJsonResponse({targetIds:plan.selected.map(c=>c.targetId)});}
  if(payload?.action==='native-people-company'){const p=z.object({action:z.literal('native-people-company'),targetId:z.string().uuid()}).strict().safeParse(payload);if(!p.success)return researchJsonResponse({error:'Invalid company step'},{status:400});return researchJsonResponse(await executeNativePeopleResearch(job,{targetId:p.data.targetId}));}
  if(payload?.action==='native-people-finish')return researchJsonResponse(await finishNativePeopleResearch(job));
  if(payload?.action==='native-provider-begin'||payload?.action==='native-provider-finish'){
    const metadata=(job.config as ResearchConfig).nativeAgent;
    if(!metadata)return researchJsonResponse({error:'Native research required'},{status:403});
    const store=agentStore({organizationId:job.organizationId,userId:job.createdBy});
    if(payload.action==='native-provider-begin'){
      const p=z.object({action:z.literal('native-provider-begin'),targetId:z.string().uuid().optional(),provider:z.enum(['firmable','search','page']).default('firmable'),requestClass:nativeResearchRequestClassSchema.optional(),key:z.string().min(1).max(200),requestDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(payload);
      if(!p.success)return researchJsonResponse({error:'Invalid native provider request'},{status:400});
      if((job.config as ResearchConfig).companyDiscoveryPolicy?.version===4&&p.data.provider==='firmable'&&!['company_search','company_profile','auth'].includes(p.data.requestClass??''))return researchJsonResponse({error:'Company-only research cannot perform this provider action'},{status:403});
      if(p.data.provider!=='firmable'&&!['hybrid-company-v1','public-fields-v1'].includes(metadata.providerAdmission))return researchJsonResponse({error:'Provider is outside the reviewed execution plan'},{status:403});
      const result=await store.beginNativeResearchAttempt(metadata.threadId,p.data.key,{researchOperationId:metadata.operationId,researchJobId:job.id,provider:p.data.provider,...(p.data.requestClass?{requestClass:p.data.requestClass}:{}),...(p.data.targetId?{targetId:p.data.targetId}:{}),requestDigest:p.data.requestDigest});return researchJsonResponse(result);
    }
    const p=z.object({action:z.literal('native-provider-finish'),operationId:z.string().uuid(),fence:z.string().regex(/^\d+$/),outcome:z.object({actualCostMicroUsd:z.null(),costBasis:z.literal('unknown'),reason:z.literal('request_outcome_unknown').optional(),response:z.object({status:z.number().int().min(100).max(599),provider:z.enum(['firmable','search','page']),requestDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional()}).strict()}).strict().safeParse(payload);
    if(!p.success)return researchJsonResponse({error:'Invalid native provider receipt'},{status:400});
    await store.finishNativeResearchAttempt(metadata.threadId,p.data.operationId,p.data.fence,p.data.outcome,metadata.operationId);return researchJsonResponse({ok:true});
  }
  if (['company-background-research','company-background-failed'].includes(payload?.action)) {
    if(!(job.config as ResearchConfig).companyBackgroundResearch)return researchJsonResponse({error:'Not a background job'},{status:400});
    const result=await executeCompanyBackground(job,payload.action==='company-background-failed');
    after(()=>dispatchCompanyBackground(job.organizationId,job.mandateId));
    return researchJsonResponse(result);
  }
  if(payload?.action==='f-continuation-plan'){
    const meta=(job.config as ResearchConfig).nativeAgent;
    if(!meta||(job.config as ResearchConfig).researchRunId!==job.id||!(job.config as ResearchConfig).companyContinuation)return researchJsonResponse({error:'Reviewed native continuation required'},{status:403});
    return researchJsonResponse(await agentStore({organizationId:job.organizationId,userId:job.createdBy}).nativeCompanyContinuation(meta.threadId,meta.operationId));
  }
  if (['company-people-status','d-search','d-company','d-finish','d-fail','e-plan','e-search','e-company','e-finish','e-fail','f-finish','f-fail'].includes(payload?.action)) {
    let result:Awaited<ReturnType<typeof firmableCompanyResearch>>;
    try { result=await firmableCompanyResearch(job,payload); }
    catch(error){
      if(error instanceof FirmableError){
        const categories=new Set(['reconnect_required','authentication_or_policy','rate_limit_unspecified','transport','timeout','provider_error']);
        const category=error.category&&categories.has(error.category)?error.category:error.status===401||error.status===403?'authentication_or_policy':error.status===429?'rate_limit_unspecified':'provider_error';
        const issue={version:1,provider:'firmable',category,...(error.status>=400&&error.status<=599?{status:error.status}:{})};
        try{await requireDb().update(researchJobs).set({config:sql`jsonb_set(${researchJobs.config}, '{operationalIssues}', (SELECT coalesce(jsonb_agg(value),'[]'::jsonb) FROM (SELECT DISTINCT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(${researchJobs.config}->'operationalIssues')='array' THEN ${researchJobs.config}->'operationalIssues' ELSE '[]'::jsonb END || ${JSON.stringify([issue])}::jsonb) value LIMIT 10) saved_issues))`}).where(and(eq(researchJobs.id,job.id),eq(researchJobs.organizationId,job.organizationId),eq(researchJobs.mandateId,job.mandateId)));}
        catch{/* Failure presentation must not overwrite the original provider outcome. */}
        if(error.status===401||error.status===403)return researchJsonResponse({provider:'firmable',category,error:category==='reconnect_required'?'The Firmable connection needs renewal.':'Firmable authentication or policy requires attention.'},{status:error.status});
      }
      if(error instanceof FirmableError&&error.status===429&&['d-search','d-company','e-company'].includes(payload.action)){
        const retryAfterMs=error.retryAfterMs??30000;
        return researchJsonResponse({provider:'firmable',category:'rate_limited',retryAfterMs},{status:429,headers:{'Retry-After':String(Math.ceil(retryAfterMs/1000))}});
      }
      throw error;
    }
    if((job.config as ResearchConfig).nativeAgent&&['d-finish','d-fail','f-finish','f-fail'].includes(String(payload.action))){const meta=(job.config as ResearchConfig).nativeAgent!;await agentStore({organizationId:job.organizationId,userId:job.createdBy}).finishNativeResearchJob(meta.threadId,meta.operationId);}
    if(['d-company','e-company','d-finish','e-finish','f-finish'].includes(payload.action))after(async()=>{
      await dispatchCompanyBackground(job.organizationId,job.mandateId);
      const company=result as {matched?:boolean;targetId?:string;firmableId?:string};
      if(company.matched&&company.targetId&&company.firmableId)await queueCompanyPeople(job,company.targetId,company.firmableId);
      if(!(job.config as ResearchConfig).nativeAgent)await observeInitialResearchProgress(job);
    });
    if(!(job.config as ResearchConfig).nativeAgent&&!['d-company','e-company','d-finish','e-finish','f-finish'].includes(payload.action))after(()=>observeInitialResearchProgress(job).then(()=>{}));
    return researchJsonResponse(result);
  }
  if (payload?.action === 'balanced-wakeup') {
    const config = job.config as ResearchConfig;
    if (process.env.LOCAL_DEVELOPMENT !== 'true' || !['balanced-v1','corpus-v1'].includes(config.pipelineDesign || '') || config.researchRunId !== job.id) return researchJsonResponse({error:'Unavailable'}, {status:403});
    await scheduleResearchRun(job.organizationId,job.id,{recovery:true});
    const current = await repo.getExecution(job.id);
    const [state] = await requireDb().select({ active: sql<number>`count(*)::int` }).from(researchJobs)
      .where(and(eq(researchJobs.organizationId,job.organizationId),sql`${researchJobs.config}->>'researchRunId' = ${job.id}`,notInArray(researchJobs.status,terminalResearchStates)));
    return researchJsonResponse({stop:current?.status === 'cancelled' || Boolean((current?.config as ResearchConfig | undefined)?.parallelResearchSettled) || (Date.now() >= (config.automaticDeadline || 0) && !state.active)});
  }
  if (payload?.action === "provider-reserve") {
    if (terminalResearchStates.includes(job.status) || !['page', 'search', 'ai'].includes(payload.provider) || typeof payload.token !== 'string' || payload.token.length > 160) return researchJsonResponse({ granted: false, retryAfterMs: 1000 });
    const reservation = await reserveResearchProvider(jobId, payload.token, payload.provider, undefined, payload.policy === "paid-v1");
    // A durable queue wait is live work, not an unresponsive provider step.
    await requireDb().update(researchJobs).set({ updatedAt: new Date(), message: `Waiting for ${payload.provider === "ai" ? "AI" : "browser"} slot` }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates)));
    return researchJsonResponse(reservation);
  }
  if (payload?.action === "browser-cooldown") {
    const delay = Number(payload.retryAfterMs);
    if (!Number.isFinite(delay) || delay < 0) return researchJsonResponse({ error: "Invalid delay" }, { status: 400 });
    let domain: string | undefined;
    if (payload.domain !== undefined) {
      // Accept a hostname only. Paths, credentials, ports and arbitrary strings
      // must never create queue keys that differ from browser permit domains.
      if (typeof payload.domain !== "string" || payload.domain.length > 253 || !payload.domain.split(".").every((label: string) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) return researchJsonResponse({ error: "Invalid domain" }, { status: 400 });
      const url = `https://${payload.domain}/`;
      if (!publicResearchUrl(url)) return researchJsonResponse({ error: "Invalid domain" }, { status: 400 });
      domain = researchDomain(url);
    }
    await coolDownResearchBrowser(delay, domain);
    return researchJsonResponse({ ok: true });
  }
  if (payload?.action === "provider-release") {
    if (typeof payload.token !== 'string' || payload.token.length > 160) return researchJsonResponse({ error: "Invalid token" }, { status: 400 });
    await releaseResearchProvider(jobId, payload.token);
    return researchJsonResponse({ ok: true });
  }
  if (payload?.action === "browser-permit") {
    const permit = await researchBrowserPermit(jobId, typeof payload.token === 'string' ? payload.token : undefined, typeof payload.url === "string" ? researchDomain(payload.url) || undefined : undefined);
    if (permit.granted) await requireDb().update(researchJobs).set({ updatedAt: new Date(), message: job.status === "discovering" ? "Searching the web" : "Reading website" }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates)));
    return researchJsonResponse(permit);
  }
  // Pass the reserved search slot through the existing provider adapter. It is
  // consumed atomically by /search, never trusted merely because a header exists.
  const searchFetch: typeof fetch = (input, init) => {
    const headers = new Headers(init?.headers);
    if (typeof payload?.browserReservation === 'string') headers.set('x-research-browser-reservation', payload.browserReservation);
    return fetch(input, { ...init, headers });
  };
  if (payload?.action === "discovery-context") {
    return researchJsonResponse(await discoveryContext(job));
  }
  if (payload?.action === 'website-pages') {
    const parsed = z.array(z.string().url()).max(1000).safeParse(payload.urls);
    if (!parsed.success || (job.config as ResearchConfig).researchTask !== 'website') return researchJsonResponse({ error: 'Invalid website page fanout' }, { status: 400 });
    await registerWebsitePages(job.organizationId, job, parsed.data);
    await scheduleResearchRun(job.organizationId, job.id);
    return researchJsonResponse({ ok: true });
  }
  if (payload?.action === "targeted-followup") {
    const config = job.config as ResearchConfig;
    const field = payload.field as ResearchField;
    if (!config.targetedFollowup || !objectiveFields(config).includes(field) || ((field === "people" || field === "email") && config.maxPeopleSearches !== 2) || terminalResearchStates.includes(job.status)) return researchJsonResponse({ seeds: [], exhausted: true });
    const evidence = await runEvidence(job);
    const facts = evidence.map(f => f.evidence as import("@/domain/research").ResearchFinding);
    if (fieldSatisfied(field, facts)) return researchJsonResponse({ seeds: [], exhausted: true, findings: facts });
    const legalEntity = facts.find(f => f.kind === "identifier" && f.name === "Legal entity")?.value || config.legalEntity;
    const completed = config.targetedSearches || [], attempts = config.targetedSearchAttempts || [];
    const ladder = targetedQueries(field, { ...config, legalEntity }, facts);
    const query = nextSearchQuery(ladder, completed, attempts);
    if (!query) return researchJsonResponse({ seeds: [], exhausted: true });
    const lease = crypto.randomUUID();
    const claimed = await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{targetedSearchLease}', ${JSON.stringify({ id: lease, until: Date.now() + 65000 })}::jsonb)` })
      .where(and(eq(researchJobs.id, job.id), sql`COALESCE((${researchJobs.config}->'targetedSearchLease'->>'until')::bigint, 0) < ${Date.now()}`, sql`NOT (COALESCE(${researchJobs.config}->'targetedSearches', '[]'::jsonb) ? ${query})`, notInArray(researchJobs.status, terminalResearchStates))).returning({ id: researchJobs.id });
    const deferSearch = (retryAfterMs = 3000) => researchJsonResponse({ seeds: [], deferred: true, retryable: true, retryAfterMs: Number.isFinite(retryAfterMs) ? Math.max(1000, Math.min(30000, retryAfterMs)) : 3000, warning: "Search capacity is busy; retry shortly within the job budget" });
    if (!claimed.length) return deferSearch();
    const saveAttempt = async (status: 'succeeded' | 'failed', category?: string) => {
      const attempt = { query, field, status, ...(category ? { category } : {}) };
      const base = sql`jsonb_set(${researchJobs.config} - 'targetedSearchLease', '{targetedSearchAttempts}', COALESCE(${researchJobs.config}->'targetedSearchAttempts', '[]'::jsonb) || ${JSON.stringify([attempt])}::jsonb)`;
      await requireDb().update(researchJobs).set({ config: status === 'succeeded' ? sql`jsonb_set(${base}, '{targetedSearches}', COALESCE(${researchJobs.config}->'targetedSearches', '[]'::jsonb) || ${JSON.stringify([query])}::jsonb)` : base })
        .where(and(eq(researchJobs.id, job.id), sql`${researchJobs.config}->'targetedSearchLease'->>'id' = ${lease}`));
      return !nextSearchQuery(ladder, status === 'succeeded' ? [...completed, query] : completed, [...attempts, attempt]);
    };
    try {
      let seeds: string[];
      if (usesPublicAbnLookup(config, field)) {
        // A search-table match is only a candidate. Read the official record next;
        // existing name/location/quote validation still decides what is saved.
        const lookup = await publicAbnLookup(legalEntity || config.companyName!);
        await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{publicAbnLookup}', ${JSON.stringify(lookup)}::jsonb)` })
          .where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, job.organizationId), sql`${researchJobs.config}->'targetedSearchLease'->>'id' = ${lease}`));
        seeds = lookup.match ? [lookup.match.sourceUrl] : [];
      } else if (field === "people" || field === "email") {
        const result = await peopleWebSearch(config.companyName!, config.companyDomain!, searchFetch, query, legalEntity, job.id);
        await saveSearchLeads(job.id, config.peopleSearchLeads || [], result.leads);
        seeds = result.seeds;
      } else {
        const results = await cloudflareSearchResults(query, searchFetch, job.id);
        await repo.saveSnippetEstimates(job.id, snippetSizeEstimates(results, { ...config, legalEntity }));
        seeds = (field === "abn" ? abnResearchResults(results, { ...config, legalEntity }) : results.filter(r => companyResultMatches(r, config.companyName!, config.companyDomain!, legalEntity))).map(r => r.url);
      }
      const exhausted = await saveAttempt('succeeded');
      return researchJsonResponse({ seeds, query, exhausted });
    } catch (error) {
      const category = error instanceof Error && 'category' in error ? String(error.category) : 'provider_unavailable';
      if (['browser_admission', 'reader_busy', 'domain_backoff'].includes(category)) {
        // Admission never ran a search. Keep the query allowance intact, and
        // release only this request's lease so a successor owner stays protected.
        await requireDb().update(researchJobs).set({ config: sql`${researchJobs.config} - 'targetedSearchLease'` })
          .where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, job.organizationId), sql`${researchJobs.config}->'targetedSearchLease'->>'id' = ${lease}`));
        const retryAfterMs = error instanceof Error && 'retryAfterMs' in error && typeof error.retryAfterMs === 'number' ? error.retryAfterMs : 3000;
        return deferSearch(retryAfterMs);
      }
      const exhausted = await saveAttempt('failed', category);
      return researchJsonResponse({ seeds: [], query, failed: true, exhausted, warning: `Search for ${field} failed (${category}); existing evidence retained` });
    }
  }
  if (payload?.action === "people-followup") {
    const config = job.config as ResearchConfig;
    if (config.purpose !== "people" || config.maxPeopleSearches !== 2 || terminalResearchStates.includes(job.status)) return researchJsonResponse({ seeds: [] });
    const findings = await requireDb().select().from(researchFindings).where(and(eq(researchFindings.jobId, job.id), eq(researchFindings.organizationId, job.organizationId)));
    const candidate = findings.map(f => f.evidence as { kind?: string; name?: string; value?: string }).find(f => f.kind === "identifier" && f.name === "Legal entity");
    const legalEntity = candidate?.value ? cleanLegalEntity(candidate.value) : config.legalEntity;
    const query = peopleFollowupQuery(config.companyName!, config.peopleSearchLeads || [], legalEntity, config.companyDomain);
    if (!query) return researchJsonResponse({ seeds: [] });
    const claimed = await requireDb().update(researchJobs).set({ config: sql`jsonb_set(jsonb_set(${researchJobs.config}, '{peopleFollowupStarted}', 'true'::jsonb), '{legalEntity}', ${JSON.stringify(legalEntity || "")}::jsonb)` }).where(and(eq(researchJobs.id, job.id), sql`COALESCE(${researchJobs.config}->>'peopleFollowupStarted', 'false') = 'false'`, notInArray(researchJobs.status, terminalResearchStates))).returning({ id: researchJobs.id });
    if (!claimed.length) return researchJsonResponse({ seeds: [] });
    try {
      const result = await peopleWebSearch(config.companyName!, config.companyDomain!, searchFetch, query, legalEntity, job.id);
      await saveSearchLeads(job.id, config.peopleSearchLeads || [], result.leads);
      return researchJsonResponse({ seeds: result.seeds });
    }
    catch (error) { return researchJsonResponse({ seeds: [], warning: `${error instanceof Error ? error.message : "Targeted people follow-up search unavailable"}; saved website research retained.` }); }
  }
  if (payload?.action === "discovery-sources") {
    const config = job.config as ResearchConfig;
    if (terminalResearchStates.includes(job.status) || config.purpose || config.workflow !== "business" || !config.discover)
      return researchJsonResponse({ pending: false });
    if (config.discoverySourcesPrepared)
      return researchJsonResponse({ pending: !config.discoverySourceCoverageRecorded || (config.discoverySourceCursor || 0) < (config.discoverySourceCandidates?.length || 0) });
    const mandate = await new AcquisitionRepository(job.organizationId).getMandate(job.mandateId);
    if (!mandate) return researchJsonResponse({ error: "Mandate unavailable" }, { status: 409 });
    const filters = briefToMandate(mandate.brief);
    const provider = createTargetDataProvider();
    const discovery = await discoverMandate({
      interleavePlaces: true,
      directory: {
        search: () => provider.manufacturingDirectory.search(
          { ...filters, sectors: researchQueries(config.searchTerms) },
          Number.MAX_SAFE_INTEGER,
        ),
      },
      places: provider.places,
      mandate: {
        ...filters,
        sectors: researchQueries(config.searchTerms),
        locations: [/^national$/i.test(config.geography) ? "Australia" : config.geography],
      },
      organizationId: job.organizationId,
    });
    const linkedTargets = await requireDb().select({ domain: targets.domain }).from(targets).innerJoin(mandateTargets, and(eq(mandateTargets.targetId, targets.id), eq(mandateTargets.organizationId, job.organizationId), eq(mandateTargets.mandateId, job.mandateId))).where(eq(targets.organizationId, job.organizationId));
    const skipDomains = [...new Set(linkedTargets.flatMap(target => target.domain ? [target.domain.toLowerCase().replace(/^www\./, "")] : []))];
    const urls = discovery.targets.flatMap(target => {
      const url = target.domain && publicResearchUrl(`https://${target.domain}/`);
      return url && !skipDomains.includes(researchDomain(url)) ? [url] : [];
    });
    // Google listing content remains transient. Only public URLs and sourced
    // directory records are staged for resumable persistence.
    const candidates = discovery.targets.slice(0, 100).flatMap(target => target.sourceData?.manufacturingDirectory ? [{
      ...target,
      sourceData: { manufacturingDirectory: target.sourceData.manufacturingDirectory },
    }] : []);
    const nextConfig = {
      discoverySourcesPrepared: true,
      discoverySourceCandidates: candidates,
      discoverySourceCursor: 0,
      discoverySourceCoverage: discovery.sources,
      discoverySourceCoverageRecorded: false,
      skipDomains,
    };
    const prepared = await requireDb().update(researchJobs).set({
      discoveryStarted: true,
      status: "discovering",
      seeds: [...new Set([...(job.seeds as string[]), ...urls])].slice(0, 1000),
      config: sql`${researchJobs.config} || ${JSON.stringify(nextConfig)}::jsonb`,
      message: candidates.length ? "Saving discovered businesses" : "Discovery sources searched",
      updatedAt: new Date(),
    }).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, job.organizationId), notInArray(researchJobs.status, terminalResearchStates), eq(researchJobs.discoveryStarted, false))).returning({ id: researchJobs.id });
    if (!prepared.length) {
      const current = await repo.getExecution(jobId);
      const currentConfig = current?.config as ResearchConfig | undefined;
      return researchJsonResponse({ pending: Boolean(currentConfig?.discoverySourcesPrepared && (!currentConfig.discoverySourceCoverageRecorded || (currentConfig.discoverySourceCursor || 0) < (currentConfig.discoverySourceCandidates?.length || 0))) });
    }
    return researchJsonResponse({ pending: true });
  }
  if (payload?.action === "discovery-persist") {
    const config = job.config as ResearchConfig;
    if (terminalResearchStates.includes(job.status) || !config.discoverySourcesPrepared) return researchJsonResponse({ pending: false });
    const candidates = config.discoverySourceCandidates || [];
    const cursor = config.discoverySourceCursor || 0;
    const batch = candidates.slice(cursor, cursor + DISCOVERY_PERSIST_BATCH);
    const mandate = await new AcquisitionRepository(job.organizationId).getMandate(job.mandateId);
    if (!mandate) return researchJsonResponse({ error: "Mandate unavailable" }, { status: 409 });
    const filters = briefToMandate(mandate.brief);
    const next = cursor + batch.length;
    let advanced = false;
    await requireDb().transaction(async tx => {
      const companies = new OrganizationRepository(tx, job.organizationId);
      const acquisition = new AcquisitionRepository(job.organizationId, tx);
      const savedIds: string[] = [];
      for (const target of batch) {
        const saved = await companies.upsertEnrichedTarget({ target: rankTarget(target, filters), mandateId: job.mandateId, actorId: job.createdBy });
        if (saved) savedIds.push(saved.id);
      }
      await acquisition.attachMany(job.mandateId, savedIds);
      const rows = await tx.update(researchJobs).set({
        config: sql`jsonb_set(${researchJobs.config}, '{discoverySourceCursor}', ${String(next)}::jsonb)`,
        message: next < candidates.length ? `Saving discovered businesses (${next}/${candidates.length})` : "Discovered businesses saved",
        updatedAt: new Date(),
      }).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, job.organizationId), notInArray(researchJobs.status, terminalResearchStates), sql`COALESCE((${researchJobs.config}->>'discoverySourceCursor')::int, 0) = ${cursor}`)).returning({ id: researchJobs.id });
      if (!rows.length) return;
      advanced = true;
      if (next >= candidates.length && !config.discoverySourceCoverageRecorded) {
        await acquisition.recordCoverage(job.mandateId, config.discoverySourceCoverage || []);
        await tx.update(researchJobs).set({
          config: sql`jsonb_set(${researchJobs.config} - 'discoverySourceCandidates' - 'discoverySourceCoverage', '{discoverySourceCoverageRecorded}', 'true'::jsonb)`,
          updatedAt: new Date(),
        }).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, job.organizationId), notInArray(researchJobs.status, terminalResearchStates)));
      }
    });
    if (!advanced) {
      const current = await repo.getExecution(jobId);
      const currentConfig = current?.config as ResearchConfig | undefined;
      return researchJsonResponse({ pending: Boolean(current && !terminalResearchStates.includes(current.status) && (currentConfig?.discoverySourceCursor || 0) < (currentConfig?.discoverySourceCandidates?.length || 0)) });
    }
    return researchJsonResponse({ pending: next < candidates.length });
  }
  // Each batch query is its own durable callback and provider reservation. Claims
  // and completion are atomic against the current JSON so concurrent siblings do
  // not overwrite seeds, attempts, or cancellation state.
  if (payload?.action === "discover" && payload.decision?.queryId !== undefined) {
    const parsed = z.object({ query: z.string().trim().min(3).max(410).refine(q => !/[\r\n]/.test(q)), reason: z.string().max(300), queryId: z.string().regex(/^q-\d+-\d+-[a-f0-9]+$/), batchStartIndex: z.number().int().min(0) }).safeParse(payload.decision);
    if (!parsed.success) return researchJsonResponse({ error: "Invalid discovery query" }, { status: 400 });
    const decision = parsed.data;
    const index = Number(decision.queryId.split("-")[2]);
    if (index >= DISCOVERY_BATCH_SIZE || discoveryQueryId(decision.query, decision.batchStartIndex, index) !== decision.queryId) return researchJsonResponse({ error: "Invalid query identifier" }, { status: 400 });
    const config = job.config as ResearchConfig;
    const control = await controlSnapshot(job);
    if (!adaptiveDiscovery(config) || terminalResearchStates.includes(job.status) || control.status === "cancelled" || Date.now() >= control.deadline) return researchJsonResponse({ seeds: [], stopped: true, more: false });
    const context = await discoveryContext(job);
    const completed = context.attempts.find(a => a.queryId === decision.queryId);
    if (completed) {
      // Dispatch is idempotent, and may need replaying if the callback terminated
      // after saving search results but before admitting their candidate jobs.
      if (config.parallelDiscovery) await measureResearchSegment(jobId, job.organizationId, `discovery-dispatch-${decision.queryId}`, "coordination", () => scheduleResearchRun(job.organizationId, jobId));
      return researchJsonResponse({ seeds: config.parallelDiscovery ? [] : job.seeds, more: context.remainingSearches > 0 });
    }
    if (!context.remainingSearches || context.found >= context.target) return researchJsonResponse({ seeds: [], more: false });
    const lease = crypto.randomUUID(), started = Date.now();
    const claims = sql`COALESCE(${researchJobs.config}->'discoveryClaims', '{}'::jsonb)`;
    const attempted = sql`COALESCE(${researchJobs.config}->'discoveryAttempts', '[]'::jsonb)`;
    const claimed = await measureResearchSegment(jobId, job.organizationId, `discovery-claim-${decision.queryId}`, "coordination", async () => requireDb().update(researchJobs).set({
      config: sql`jsonb_set(${researchJobs.config}, '{discoveryClaims}', ${claims} || jsonb_build_object(${decision.queryId}::text, ${JSON.stringify({ id: lease, until: started + 65000 })}::jsonb))`, updatedAt: new Date(),
    }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates),
      sql`COALESCE((${claims}->${decision.queryId}::text->>'until')::bigint, 0) < ${started}`,
      sql`COALESCE((${researchJobs.config}->'discoveryLease'->>'until')::bigint, 0) < ${started}`,
      sql`NOT EXISTS (SELECT 1 FROM jsonb_array_elements(${attempted}) a WHERE a->>'queryId' = ${decision.queryId})`,
      sql`jsonb_array_length(${attempted}) + (SELECT count(*) FROM jsonb_each(${claims}) c WHERE (c.value->>'until')::bigint > ${started}) < ${discoveryLimit(config)}`,
      sql`jsonb_array_length(${attempted}) >= ${decision.batchStartIndex} AND jsonb_array_length(${attempted}) < ${decision.batchStartIndex + DISCOVERY_BATCH_SIZE}`,
      sql`COALESCE(${researchJobs.config}->>'discoveryStopReason', '') = ''`,
    )).returning({ id: researchJobs.id }));
    if (!claimed.length) return researchJsonResponse({ seeds: [], more: true, deferred: true });
    let attempt: DiscoveryAttempt | undefined, safeSeeds: string[] = [], warning: string | undefined;
    let deferred = false;
    try {
      const results = await measureResearchSegment(jobId, job.organizationId, `discovery-query-${decision.queryId}`, "discovery_search", () => cloudflareSearchResults(decision.query, searchFetch, jobId));
      const safe = results.flatMap(r => { const url = publicResearchUrl(r.url); return url ? [{ ...r, url }] : []; });
      const known = new Set([...(context.knownDomains || []), ...context.candidates.map(c => c.domain), ...(config.skipDomains || [])]);
      safeSeeds = safe.filter(r => !known.has(researchDomain(r.url))).map(r => r.url);
      attempt = { queryId: decision.queryId, query: decision.query, reason: decision.reason, status: "succeeded", resultCount: safe.length, newDomains: new Set(safeSeeds.map(researchDomain)).size, results: safe.slice(0, 8).map(r => ({ url: r.url, title: r.title.slice(0, 180), snippet: r.snippet.slice(0, 400) })) };
    } catch (error) {
      const category = error instanceof Error && "category" in error ? String(error.category) : "provider_error";
      deferred = category === "browser_admission";
      if (!deferred) attempt = { queryId: decision.queryId, query: decision.query, reason: decision.reason, status: "failed", category };
      warning = "Web search temporarily unavailable; saved sources retained.";
    }
    if (attempt) Object.assign(attempt, { startedAt: new Date(started).toISOString(), durationMs: Date.now() - started });
    // Count genuinely new domains against the row at commit time: sibling
    // searches may have saved the same domain since this callback read context.
    const attemptJson = attempt?.status === "succeeded"
      ? sql`jsonb_set(${JSON.stringify(attempt)}::jsonb, '{newDomains}', to_jsonb((SELECT count(DISTINCT d.value) FROM jsonb_array_elements_text(${JSON.stringify([...new Set(safeSeeds.map(researchDomain))])}::jsonb) d WHERE d.value NOT IN (SELECT split_part(s.value, '/', 3) FROM jsonb_array_elements_text(COALESCE(${researchJobs.seeds}, '[]'::jsonb)) s))))`
      : sql`${JSON.stringify(attempt || null)}::jsonb`;
    const appended = sql`${attempted} || ${attempt ? sql`jsonb_build_array(${attemptJson})` : sql`'[]'::jsonb`}`;
    const nextConfig = sql`jsonb_set(jsonb_set(jsonb_set(${researchJobs.config}, '{discoveryClaims}', ${claims} - ${decision.queryId}::text), '{discoveryAttempts}', ${appended}), '{discoveryCursor}', to_jsonb(jsonb_array_length(${appended})))`;
    const updated = await measureResearchSegment(jobId, job.organizationId, `discovery-save-${decision.queryId}`, "persistence", async () => requireDb().update(researchJobs).set({
      seeds: sql`(SELECT COALESCE(jsonb_agg(u.url), '[]'::jsonb) FROM (SELECT DISTINCT value AS url FROM jsonb_array_elements(COALESCE(${researchJobs.seeds}, '[]'::jsonb) || ${JSON.stringify(safeSeeds)}::jsonb) LIMIT 1000) u)`,
      config: sql`jsonb_set(${nextConfig}, '{discoveryPending}', to_jsonb(jsonb_array_length(${appended}) < ${discoveryLimit(config)}))`,
      updatedAt: new Date(), message: deferred ? "Waiting for search capacity" : "Search batch result saved; researching candidate businesses",
    }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates), sql`${researchJobs.config}->'discoveryClaims'->${decision.queryId}::text->>'id' = ${lease}`, ...(attempt ? [sql`jsonb_array_length(${attempted}) < ${discoveryLimit(config)}`] : []))).returning({ id: researchJobs.id }));
    console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), jobId, event: "discovery_query_completed", queryId: decision.queryId, durationMs: Date.now() - started, status: deferred ? "deferred" : attempt?.status, resultCount: attempt?.resultCount, newDomains: attempt?.newDomains, committed: Boolean(updated.length) }));
    if (updated.length && config.parallelDiscovery) await measureResearchSegment(jobId, job.organizationId, `discovery-dispatch-${decision.queryId}`, "coordination", () => scheduleResearchRun(job.organizationId, jobId));
    const latest = await repo.getExecution(jobId);
    const latestContext = await discoveryContext(latest || job);
    return researchJsonResponse({ seeds: config.parallelDiscovery ? [] : latest?.seeds || safeSeeds, warning, deferred, more: latestContext.remainingSearches > 0 && latestContext.found < latestContext.target });
  }
  if (payload?.action === "discover") {
    if (terminalResearchStates.includes(job.status))
      return researchJsonResponse({ seeds: job.seeds, stopped: true });
    const config = job.config as ResearchConfig;
    const control = await controlSnapshot(job);
    if (control.status === "cancelled" || Date.now() >= control.deadline) return researchJsonResponse({ seeds: [], stopped: true, more: false });
    // Web discovery runs in slices: the first call claims discovery and runs the fast
    // sources; each call then runs a few searches and reports whether more remain.
    const sourcesPrepared = config.discoverySourcesPrepared === true;
    const continuing = typeof config.discoveryCursor === "number";
    if (!sourcesPrepared && !continuing && !(await repo.claimDiscovery(jobId)))
      return researchJsonResponse({
        seeds: job.seeds,
        warning: "Discovery already attempted; existing seeds reused.",
      });
    let seeds = (sourcesPrepared || continuing ? (job.seeds as string[]) : (config.runtime?.remaining || config.seeds))
      .map(publicResearchUrl)
      .filter((s): s is string => Boolean(s));
    let warning = "";
    let peopleLeadCount = config.peopleSearchLeads?.length || 0;
    if (sourcesPrepared || continuing) { /* durable source discovery already ran */ }
    else if (config.purpose === "firmographics" && config.discover && !config.targetedFollowup) {
      try { const profileResults = await cloudflareSearchResults(companyFactSearchQuery(config.companyName!, config.companyDomain!), searchFetch, job.id); await repo.saveSnippetEstimates(job.id, snippetSizeEstimates(profileResults, config)); seeds.push(...profileResults.filter(r => companyResultMatches(r, config.companyName!, config.companyDomain!, config.legalEntity)).map(r => r.url)); }
      catch { warning = "Public profile search unavailable; company website research continues."; }
    } else if (config.purpose === "people" && config.discover && !config.targetedFollowup) {
      try {
        const result = await peopleWebSearch(config.companyName!, config.companyDomain!, searchFetch, undefined, undefined, job.id);
        seeds.push(...result.seeds);
        peopleLeadCount = result.leads.length;
        await saveSearchLeads(job.id, config.peopleSearchLeads || [], result.leads);
      }
      catch (error) { warning = `${error instanceof Error ? error.message : "Public web search unavailable"}; company website research continues.`; }
    } else if (config.discover && !config.purpose) {
      try {
        const mandate = await new AcquisitionRepository(
          job.organizationId,
        ).getMandate(job.mandateId);
        if (!mandate) throw new Error("Mandate unavailable");
        const filters = briefToMandate(mandate.brief);
        const provider = createTargetDataProvider();
        // Only explicitly approved search terms/geography reach Google.
        const discovery = await discoverMandate({
          interleavePlaces: true,
          directory: {
            search: () =>
              provider.manufacturingDirectory.search(
                { ...filters, sectors: researchQueries(config.searchTerms) },
                Number.MAX_SAFE_INTEGER,
              ),
          },
          places: provider.places,
          mandate: {
            ...filters,
            sectors: researchQueries(config.searchTerms),
            locations: [
              /^national$/i.test(config.geography)
                ? "Australia"
                : config.geography,
            ],
          },
          organizationId: job.organizationId,
        });
        const companies = new OrganizationRepository(
          requireDb(),
          job.organizationId,
        );
        const acquisition = new AcquisitionRepository(job.organizationId);
        // Businesses already attached to the mandate are enriched separately; discovery skips their websites.
        const skipDomains = [...new Set((await acquisition.memberships(job.mandateId)).flatMap(m => m.target.domain ? [m.target.domain.toLowerCase().replace(/^www\./, "")] : []))];
        if (skipDomains.length) await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{skipDomains}', ${JSON.stringify(skipDomains)}::jsonb)` }).where(eq(researchJobs.id, jobId));
        seeds = seeds.filter(url => !skipDomains.includes(researchDomain(url)));
        // Prefer exact directory searches for separate capabilities; existing company identities are reused.
        for (const target of discovery.targets.slice(0, 100)) {
          const latest = (await repo.getExecution(jobId))?.config as ResearchConfig | undefined;
          if (config.targetBusinesses && new Set(latest?.newBusinessIds || []).size >= config.targetBusinesses) break;
          const saved = await companies.upsertEnrichedTarget({
            target: rankTarget(target, filters),
            mandateId: job.mandateId,
            actorId: job.createdBy,
          });
          // Directory and map listings are discovery sources. A business counts toward
          // the target only once its own website shows mandate-relevant evidence.
          if (saved) await acquisition.attach(job.mandateId, saved.id);
          const url = target.domain
            ? publicResearchUrl(`https://${target.domain}/`)
            : null;
          if (url) seeds.push(url);
        }
        await acquisition.recordCoverage(job.mandateId, discovery.sources);
        if (discovery.sources.some((s) => s.status === "failed"))
          warning = "Some discovery sources failed; available seeds retained.";
      } catch {
        warning =
          "Discovery interrupted; supplied seeds retained. Retry discovery separately if needed.";
      }
    }
    const afterDiscovery = (await repo.getExecution(jobId))?.config as ResearchConfig | undefined;
    let more = false;
    let admissionDeferred = false;
    if (config.workflow === "business" && config.discover && (!config.targetBusinesses || new Set(afterDiscovery?.newBusinessIds || []).size < config.targetBusinesses)) {
      const skip = new Set(afterDiscovery?.skipDomains || []);
      if (adaptiveDiscovery(config)) {
        const latest = await repo.getExecution(jobId);
        const context = await discoveryContext(latest || job);
        // A workflow callback can be replayed after its result was committed.
        // Reuse the committed attempt instead of charging for the same search again.
        if (typeof payload.decision?.attemptIndex === "number" && payload.decision.attemptIndex !== context.attempts.length) return researchJsonResponse({ seeds: config.parallelDiscovery ? [] : latest?.seeds || [], more: Boolean((latest?.config as ResearchConfig | undefined)?.discoveryPending) });
        const lease = crypto.randomUUID();
        const claimed = await requireDb().update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{discoveryLease}', ${JSON.stringify({ id: lease, until: Date.now() + 65000 })}::jsonb)` }).where(and(eq(researchJobs.id, jobId), notInArray(researchJobs.status, terminalResearchStates), sql`jsonb_array_length(COALESCE(${researchJobs.config}->'discoveryAttempts', '[]'::jsonb)) = ${context.attempts.length}`, sql`COALESCE((${researchJobs.config}->'discoveryLease'->>'until')::bigint, 0) < ${Date.now()}`, sql`NOT EXISTS (SELECT 1 FROM jsonb_each(COALESCE(${researchJobs.config}->'discoveryClaims', '{}'::jsonb)) c WHERE (c.value->>'until')::bigint > ${Date.now()})`)).returning({ id: researchJobs.id });
        if (!claimed.length) return researchJsonResponse({ seeds: [], more: true, deferred: true });
        const decision = resolveDiscoveryDecision(payload.decision?.planning, context, discoveryQueryPlan(config.searchTerms, config.geography).map(p => p.query));
        let attempt: DiscoveryAttempt | undefined;
        if (decision.query) {
          try {
            // Queries are discovery leads. Semantic relevance is checked against the
            // original scope on the company page, never by matching seed keywords.
            const results = await cloudflareSearchResults(decision.query, searchFetch, job.id);
            const known = new Set([...seeds.map(researchDomain), ...(context.knownDomains || []), ...context.candidates.map(c => c.domain), ...skip]);
            const safe = results.flatMap(r => { const url = publicResearchUrl(r.url); return url ? [{ ...r, url }] : []; });
            const fresh = safe.filter(r => !known.has(researchDomain(r.url)));
            attempt = { query: decision.query, reason: decision.reason, status: "succeeded", resultCount: safe.length, newDomains: new Set(fresh.map(r => researchDomain(r.url))).size, results: safe.slice(0, 8).map(r => ({ url: r.url, title: r.title.slice(0, 180), snippet: r.snippet.slice(0, 400) })) };
            seeds.push(...safe.filter(r => !skip.has(researchDomain(r.url))).map(r => r.url));
          } catch (error) {
            const category = error instanceof Error && "category" in error ? String(error.category) : "provider_error";
            admissionDeferred = category === "browser_admission";
            if (!admissionDeferred) attempt = { query: decision.query, reason: decision.reason, status: "failed", category };
            warning = "Web search temporarily unavailable; saved sources retained.";
          }
        }
        const attempts = [...context.attempts, ...(attempt ? [attempt] : [])];
        more = !decision.stop && attempts.length < discoveryLimit(config);
        const stopReason = decision.stop ? decision.reason : !more ? "Search budget reached." : "";
        const committed = await requireDb().update(researchJobs).set({ seeds: [...new Set(seeds)].filter(url => !skip.has(researchDomain(url))).slice(0, 1000), config: sql`jsonb_set(jsonb_set(jsonb_set(jsonb_set(${researchJobs.config} - 'discoveryLease', '{discoveryCursor}', ${String(attempts.length)}::jsonb), '{discoveryPending}', ${JSON.stringify(more)}::jsonb), '{discoveryAttempts}', ${JSON.stringify(attempts)}::jsonb), '{discoveryStopReason}', ${JSON.stringify(stopReason)}::jsonb)` }).where(and(eq(researchJobs.id, jobId), sql`${researchJobs.config}->'discoveryLease'->>'id' = ${lease}`, sql`jsonb_array_length(COALESCE(${researchJobs.config}->'discoveryAttempts', '[]'::jsonb)) = ${context.attempts.length}`, sql`NOT EXISTS (SELECT 1 FROM jsonb_each(COALESCE(${researchJobs.config}->'discoveryClaims', '{}'::jsonb)) c WHERE (c.value->>'until')::bigint > ${Date.now()})`, notInArray(researchJobs.status, terminalResearchStates))).returning({ id: researchJobs.id });
        if (!committed.length) return researchJsonResponse({ seeds: [], more: true, deferred: true });
      } else {
        const plan = discoveryQueryPlan(config.searchTerms, config.geography);
        const cursor = afterDiscovery?.discoveryCursor || 0;
        const slice = plan.slice(cursor, cursor + 1);
        const attempts = afterDiscovery?.discoveryAttempts || [];
        let newAttempts: NonNullable<ResearchConfig['discoveryAttempts']> = [];
        try {
          const web = await runDiscoveryQueries(slice, config.searchTerms, searchFetch, job.id);
          newAttempts = web.attempts;
          const fresh = web.seeds.filter(url => !skip.has(researchDomain(url)));
          seeds = Array.from({ length: Math.max(seeds.length, fresh.length) }, (_, i) => [seeds[i], fresh[i]].filter((url): url is string => Boolean(url))).flat();
          if (web.warning) warning = [warning, web.warning].filter(Boolean).join(" ");
        } catch {
          newAttempts = slice.map(({ query }) => ({ query, status: "failed", category: "provider_error" }));
          warning = [warning, "Public web discovery unavailable; directory and supplied websites retained."].filter(Boolean).join(" ");
        }
        admissionDeferred = newAttempts.some(a => a.category === "browser_admission");
        if (admissionDeferred) newAttempts = [];
        const failed = newAttempts.some(a => a.status === "failed");
        const retry = failed && !attempts.some(a => a.query === slice[0]?.query && a.status === "failed");
        const next = cursor + (retry || admissionDeferred ? 0 : slice.length);
        more = next < plan.length;
        await requireDb().update(researchJobs).set({ config: sql`jsonb_set(jsonb_set(jsonb_set(${researchJobs.config}, '{discoveryCursor}', ${String(next)}::jsonb), '{discoveryPending}', ${JSON.stringify(more)}::jsonb), '{discoveryAttempts}', COALESCE(${researchJobs.config}->'discoveryAttempts', '[]'::jsonb) || ${JSON.stringify(newAttempts)}::jsonb)` }).where(eq(researchJobs.id, jobId));
      }
    }
    const finalSkip = new Set(((await repo.getExecution(jobId))?.config as ResearchConfig | undefined)?.skipDomains || []);
    seeds = [...new Set(seeds)].filter(url => !finalSkip.has(researchDomain(url))).slice(0, config.adaptiveDiscovery ? 1000 : 100);
    if (!adaptiveDiscovery(config)) await repo.seeds(jobId, seeds, warning || (seeds.length ? "Website search finished; researching candidate businesses" : "Website search finished; no candidate websites found in this batch"));
    if (config.parallelDiscovery) await scheduleResearchRun(job.organizationId, jobId);
    return researchJsonResponse({ seeds: config.parallelDiscovery ? [] : seeds, deferred: admissionDeferred, warning, peopleLeadCount, skipDomains: [...finalSkip], more });
  }
  setResearchDatabaseContext({ action: "progress", stage: "persistence" });
  const event = progressSchema.safeParse(payload);
  if (!event.success)
    return researchJsonResponse({ error: "Invalid progress event" }, { status: 400 });
  let saved;
  try {
    saved = await repo.progress(jobId, event.data, job);
  } catch {
    return researchJsonResponse(
      { error: "Unable to record progress" },
      { status: 409 },
    );
  }
  // Progress is saved above. Queue refills run after the response so the
  // Workflow is not held for coordination queries. A dispatch failure must not
  // make the worker retry and then fail a healthy run; the next callback or
  // poll refills the queue.
  const status = event.data.status, page = event.data.page;
  // Refill work only when a page produced evidence or directory links, or the job ended;
  // status-only heartbeats must stay cheap.
  const pageMatters = Boolean(page && (page.findings.length > 0 || directorySource(page.url, page.markdown)));
  const terminal = ["complete", "partial", "failed"].includes(status);
  if(!(job.config as ResearchConfig).nativeAgent&&event.data.revision>job.revision&&(status!==job.status||pageMatters||terminal))after(()=>observeInitialResearchProgress(job).then(()=>{}));
  if ((pageMatters || terminal) && event.data.revision > job.revision && !terminalResearchStates.includes(job.status)) {
    const requestId = researchRequestId() || crypto.randomUUID();
    after(() => observeResearchOperation(`${requestId}-dispatch`, async () => {
      setResearchDatabaseContext({ ...jobTraceContext(job), organizationId: job.organizationId, stage: "coordination", action: "dispatch" });
      configureResearchTelemetry(researchPerformanceFlags(job.config as ResearchConfig).telemetryBatching);
      try {
        if ((job.config as ResearchConfig).mode === "automatic") {
          await scheduleResearchRun(job.organizationId, jobId);
        } else if (terminal && !await dispatchContinuation(job.organizationId, jobId)) await dispatchBusinessPeople(job.organizationId, jobId);
      } catch (error) {
        console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), jobId, event: "dispatch_deferred", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
      }
    }));
  }
  let timingAcceptedIds: string[] | undefined;
  if (event.data.timingSpans) {
    const spans = event.data.timingSpans;
    if (bufferResearchTiming(jobId, job.organizationId, spans)) {
      const accepted = new Set(await flushResearchTiming());
      timingAcceptedIds = spans.filter(span => accepted.has(span.id)).map(span => span.id);
    } else {
      // Mixed-version callbacks can contain spans even when an old run has
      // batching disabled. Preserve explicit acknowledgement in that case too.
      try { await saveResearchTimingSpans(jobId, job.organizationId, spans); timingAcceptedIds = spans.map(span => span.id); }
      catch {
        timingAcceptedIds = [];
        console.info("research-pipeline", JSON.stringify({ event: "timing_delivery_deferred", jobId, requestId: researchRequestId(), pending: spans.length }));
      }
    }
  }
  return researchJsonResponse({ ok: true, ...(timingAcceptedIds ? { timingAcceptedIds } : {}), ...(saved ? { control: await controlSnapshot(saved) } : {}) });
}


export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  return observeResearchRequest(request, () => getResearchControl(request, context));
}
export async function POST(request: Request, context: { params: Promise<{ jobId: string }> }) {
  return observeResearchRequest(request, () => postResearchCallback(request, context));
}
