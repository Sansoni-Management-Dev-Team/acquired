import {after} from 'next/server';
import {dispatchCompanyBackground} from '@/lib/company-background-dispatch';
import {tickCompanyPeople} from '@/lib/company-people-research';
import {selectedResearchPipeline} from '@/domain/research-pipeline-design';
import { researchJsonResponse, researchRequestJson } from "@/lib/research-request-observability";
import { observeResearchRequest } from "@/lib/research-request-observability";
import { summariseResearchTimings, summariseCompactResearchTimings } from '@/domain/research-timing';
import { missingResearchFields, fieldSatisfied, researchFields } from '@/domain/research-objectives';
import { scheduleResearchRun } from "@/lib/research-scheduler";
import { newResearchPerformanceFlags } from "@/lib/research-performance-flags";
import { automaticResearchConfig } from "@/domain/automatic-research";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { requireDb } from "@/db/client";
import { organization } from "@/db/schema";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { ResearchRepository } from "@/db/research-repository";
import {
  researchStartSchema,
  researchActive,
  terminalResearchStates,
  continueResearchConfig,
  type ResearchConfig,
  type ResearchFinding,
} from "@/domain/research";
import { summariseEvidence, type EvidenceCounts } from "@/domain/evidence-status";
import { researchEnabled, researchWorker } from "@/lib/research-service";
import { briefResearchGeography, briefResearchSources, generateBriefResearchScope } from "@/lib/brief-research";
import { researchSettingsFromMetadata } from "@/domain/research-settings";
export const maxDuration = 300;
async function getMandateResearch(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId)
    return researchJsonResponse({ error: "Sign in first" }, { status: 401 });
  if (!researchEnabled())
    return researchJsonResponse({ enabled: false, active: false, jobs: [], findings: [] });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success)
    return researchJsonResponse({ error: "Invalid mandate" }, { status: 400 });
  const org = session.session.activeOrganizationId;
  if (!(await new AcquisitionRepository(org).getMandate(id)))
    return researchJsonResponse({ error: "Mandate not found" }, { status: 404 });
  const repo = new ResearchRepository(org);
  const [initialJobs, findings, results, targetEvidence] = await Promise.all([
    repo.listReview(id),
    repo.findings(id),
    repo.resultCounts(id),
    repo.targetEvidence(id),
  ]);
  if(initialJobs.some(job=>(job.config as ResearchConfig).companyBackgroundResearch && job.status==='queued'))after(()=>dispatchCompanyBackground(org,id));
  let reviewChanged = false;
  for (const job of initialJobs.filter(j => !(j.config as ResearchConfig).companyBackgroundResearch && !terminalResearchStates.includes(j.status) && Date.now() - j.updatedAt.getTime() > 90000)) {
    try {
      const worker = await researchWorker(`/jobs/${job.id}`) as { status: string };
      if (["running", "waiting"].includes(worker.status) && Date.now() - job.updatedAt.getTime() > 10 * 60000) {
        const recovery = await researchWorker(`/jobs/${job.id}`, "POST", { action: "recover-stalled" }) as { recovered?: boolean };
        if (recovery.recovered) { await repo.recoverStopped(job.id, job.revision, job.pages); reviewChanged = true; }
      }
      if (["errored", "terminated", "complete"].includes(worker.status)) { await repo.recoverStopped(job.id, job.revision, job.pages); reviewChanged = true; }
    } catch { /* An unavailable status endpoint does not imply the job stopped. */ }
  }
  const recoveryRuns = new Set(initialJobs.flatMap(job => {
    const config = job.config as ResearchConfig;
    return config.mode === "automatic" ? [config.researchRunId || job.id] : [];
  }));
  for (const rootId of recoveryRuns) {
    const root = initialJobs.find(job => job.id === rootId);
    const settled = root && (root.config as ResearchConfig).parallelBusinessResearch && (root.config as ResearchConfig).parallelResearchSettled && (root.config as ResearchConfig).parallelResearchPendingTasks === 0 && terminalResearchStates.includes(root.status) && initialJobs.filter(j => (j.config as ResearchConfig).researchRunId === rootId).every(j => terminalResearchStates.includes(j.status));
    if (!root || settled || root.status === "cancelled" || Date.now() >= ((root.config as ResearchConfig).automaticDeadline || 0)) continue;
    try { if (await scheduleResearchRun(org, rootId, { recovery: true }) !== false) reviewChanged = true; }
    catch { reviewChanged = true; /* A partial pass may have saved queued jobs before failing. */ }
  }
  for (const job of initialJobs.filter(job => (job.config as ResearchConfig).includeCompanyPeople && !(job.config as ResearchConfig).companyPeopleProgress?.settled && (job.config as ResearchConfig).researchRunId === job.id && terminalResearchStates.includes(job.status))) {
    await tickCompanyPeople(job); reviewChanged = true;
  }
  const jobs = reviewChanged ? await repo.listReview(id) : initialJobs;
  const evidence: Record<string, EvidenceCounts> = {};
  for (const targetId of new Set([...targetEvidence.map(f => f.targetId!), ...jobs.flatMap(j => (j.config as ResearchConfig).targetId ? [(j.config as ResearchConfig).targetId!] : [])])) {
    const own = jobs.filter(j => (j.config as ResearchConfig).targetId === targetId);
    evidence[targetId] = summariseEvidence(targetEvidence.filter(f => f.targetId === targetId).map(f => ({ evidence: f.evidence as ResearchFinding })), {
      searches: own.reduce((sum, j) => sum + ((j.config as ResearchConfig).targetedSearches?.length || 0), 0),
      researching: own.some(j => !terminalResearchStates.includes(j.status)),
    });
  }
  const compactTimings = await repo.timingSummaries(jobs);
  const timingRuns = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const config = job.config as ResearchConfig;
    const runId = config.researchRunId || config.parentJobId || job.id;
    const group = timingRuns.get(runId) || []; group.push(job); timingRuns.set(runId, group);
  }
  const timings = Object.fromEntries([...timingRuns].map(([runId, runJobs]) => [runId, (() => {
    const targetIds = new Set(runJobs.flatMap(job => { const c = job.config as ResearchConfig; return [...(c.newBusinessIds || []), ...(c.targetId ? [c.targetId] : [])]; }));
    const runJobIds = new Set(runJobs.map(job => job.id));
    const coverage = Object.fromEntries(researchFields.map(field => [field, [...targetIds].filter(targetId => {
      const observed = targetEvidence.filter(f => f.targetId === targetId && runJobIds.has(f.jobId)).map(f => f.evidence as ResearchFinding);
      const reused = runJobs.filter(job => (job.config as ResearchConfig).targetId === targetId).flatMap(job => (job.config as ResearchConfig).inheritedFindings || []);
      return fieldSatisfied(field, [...observed, ...reused]);
    }).length]));
    const timingJobs = runJobs.map(job => ({ ...job, config: job.config as ResearchConfig }));
    const summary = compactTimings[runId] ? summariseCompactResearchTimings(timingJobs, compactTimings[runId]) : summariseResearchTimings(timingJobs);
    return { ...summary, coverage, targetCompanies: targetIds.size };
  })()]));
  const pendingEnrichmentJobs = jobs.filter(job => {
    const config = job.config as ResearchConfig;
    if (config.enrichmentPhase !== 'initial' || !config.targetId || !terminalResearchStates.includes(job.status) || job.status === 'cancelled') return false;
    const root = jobs.find(root => root.id === config.researchRunId);
    if (!root || root.status === 'cancelled' || Date.now() >= ((root.config as ResearchConfig).automaticDeadline || 0)) return false;
    const evidence = targetEvidence.filter(finding => finding.targetId === config.targetId).map(finding => finding.evidence as ResearchFinding);
    if (jobs.some(other => {
      const c = other.config as ResearchConfig;
      return c.researchRunId === config.researchRunId && c.targetId === config.targetId && c.purpose === config.purpose && c.enrichmentPhase === 'initial' && !terminalResearchStates.includes(other.status);
    })) return false;
    return missingResearchFields(config, evidence).length > 0 && !jobs.some(other => {
      const c = other.config as ResearchConfig;
      return c.researchRunId === config.researchRunId && c.targetId === config.targetId && c.purpose === config.purpose && c.enrichmentPhase === 'deep';
    });
  }).map(job => ({ jobId: job.id, runId: (job.config as ResearchConfig).researchRunId, targetId: (job.config as ResearchConfig).targetId, purpose: (job.config as ResearchConfig).purpose }));
  const pendingEnrichment = [...new Map(pendingEnrichmentJobs.map(job => [`${job.runId}:${job.targetId}:${job.purpose}`, job])).values()];
  // Keep high-volume span events in the database; polling clients receive summaries.
  const publicJobs = jobs.map(job => ({ ...job, config: { ...(job.config as ResearchConfig), pipelineTiming: undefined } }));
  return researchJsonResponse(
    { enabled: true, timings, pendingEnrichment, active: researchActive(jobs.map(j => ({ status: j.status, updatedAt: j.updatedAt, config: j.config as ResearchConfig }))), results, evidence, jobs: publicJobs.filter(j => !(j.config as ResearchConfig).purpose), companyJobs: publicJobs.filter(j => (j.config as ResearchConfig).purpose === "firmographics"), peopleJobs: publicJobs.filter(j => (j.config as ResearchConfig).purpose === "people" && (j.config as ResearchConfig).parentJobId), findings: findings.filter(f => (f.evidence as { kind?: string }).kind !== "person") },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.session.activeOrganizationId)
    return researchJsonResponse({ error: "Sign in first" }, { status: 401 });
  if (!researchEnabled())
    return researchJsonResponse(
      { error: "Research is awaiting service activation" },
      { status: 503 },
    );
  const body = await researchRequestJson(request).catch(() => null);
  const briefStart = z.object({ requestId: z.string().uuid(), fromBrief: z.literal(true) }).safeParse(body);
  const parsed = briefStart.success ? null : researchStartSchema.safeParse(body);
  if (!briefStart.success && !parsed?.success)
    return researchJsonResponse(
      { error: parsed?.error.issues.map((i) => i.message).join("; ") || "Invalid research request" },
      { status: 400 },
    );
  const { id } = await context.params;
  const org = session.session.activeOrganizationId;
  if (!z.string().uuid().safeParse(id).success)
    return researchJsonResponse({ error: "Invalid mandate" }, { status: 400 });
  const mandate = await new AcquisitionRepository(org).getMandate(id);
  if (!mandate)
    return researchJsonResponse({ error: "Mandate not found" }, { status: 404 });
  let input: z.infer<typeof researchStartSchema>;
  if (briefStart.success) {
    try {
      const [row] = await requireDb().select({ metadata: organization.metadata }).from(organization).where(eq(organization.id, org)).limit(1);
      const targetBusinesses = researchSettingsFromMetadata(row?.metadata).defaultTargetBusinesses;
      const geography = briefResearchGeography(mandate.brief);
      const seeds = briefResearchSources(mandate.brief);
      const scope = await generateBriefResearchScope(mandate.brief);
      input = researchStartSchema.parse({
        requestId: briefStart.data.requestId,
        seeds,
        searchTerms: [],
        researchScope: scope,
        geography,
        discover: true,
        strategy: "discover",
        workflow: "business",
        mode: "automatic",
        targetBusinesses,
        findPeople: true,
        peopleSearchesPerCompany: 2,
        peopleBudget: { maxCompanies: targetBusinesses, maxPages: 12 },
        companyBudget: { maxCompanies: 2, maxPages: 3 },
        approved: true,
        budget: { maxPages: 5, maxDomains: 5, maxMinutes: 10, maxModelCalls: 5 },
      });
    } catch (error) {
      return researchJsonResponse({ error: error instanceof Error ? error.message : "Could not prepare research from the brief." }, { status: 422 });
    }
  } else input = parsed!.data!;
  const { requestId, continueFrom, ...submitted } = input;
  let config: ResearchConfig = { ...submitted, searchTerms: submitted.searchTerms.length ? submitted.searchTerms : submitted.researchScope!.split(/[;\n]/).map(s => s.trim().slice(0, 160)).filter(s => s.length >= 2).slice(0, 6) };
  if (continueFrom) {
    const repo = new ResearchRepository(org);
    const prior = await repo.get(continueFrom);
    if (!prior || prior.mandateId !== id)
      return researchJsonResponse(
        { error: "Previous job not found" },
        { status: 404 },
      );
    if (!terminalResearchStates.includes(prior.status))
      return researchJsonResponse(
        { error: "Wait for the previous job to finish" },
        { status: 409 },
      );
    const found = (await repo.findings(id))
      .filter((f) => f.jobId === continueFrom)
      .map((f) => f.sourceUrl);
    if ((prior.config as ResearchConfig).purpose) return researchJsonResponse({ error: "Start people research from the company contact panel" }, { status: 409 });
    config = continueResearchConfig(
      prior.config as ResearchConfig,
      prior.seeds as string[],
      found,
      submitted.budget,
      continueFrom,
    );
    config.strategy = submitted.strategy || "discover";
    if (config.workflow === "business") {
      config.findPeople = submitted.findPeople === true && submitted.budget.maxModelCalls > 0;
      config.peopleBudget = config.findPeople ? submitted.peopleBudget : undefined;
      config.companyBudget = submitted.companyBudget;
    }
    if (!config.runtime?.remaining.length)
      return researchJsonResponse(
        {
          error:
            "No saved URLs remain. Set up a new search or retry a failed URL explicitly.",
        },
        { status: 409 },
      );
  }
  if (config.mode === "automatic" && config.workflow === "business") {
    config.findPeople = true;
    config.peopleBudget = { maxCompanies: config.targetBusinesses || 20, maxPages: 12 };
  }
  if (!continueFrom) config.performanceFlags = newResearchPerformanceFlags();
  config = automaticResearchConfig(config);
  if(!continueFrom)config.pipelineDesign=selectedResearchPipeline(config,process.env.RESEARCH_PIPELINE_DESIGN,process.env.LOCAL_DEVELOPMENT==='true');
  if(['firmable-v1','web-firmable-v1','hybrid-firmable-v1'].includes(config.pipelineDesign||'')){config.includeCompanyPeople=config.pipelineDesign==='hybrid-firmable-v1';config.findPeople=Boolean(config.includeCompanyPeople);config.parallelBusinessResearch=false;config.automaticDeadline=Date.now()+10*60000;}
  if (config.mode === "automatic") config.researchRunId = requestId;
  try {
    const repo = new ResearchRepository(org);
    if (config.mode === "automatic" && !await repo.concurrentResearchReady()) return researchJsonResponse({ error: "Automatic research is awaiting the research concurrency database upgrade." }, { status: 503 });
    if (config.mode === "automatic" && await repo.hasOtherActive(requestId, id)) return researchJsonResponse({ error: "Research is already running for this mandate. Stop it before starting another run here." }, { status: 409 });
    const job = await repo.create(
      requestId,
      id,
      session.user.id,
      config,
    );
    if (!terminalResearchStates.includes(job.status)) {
      try {
        await researchWorker(`/jobs/${job.id}`, "POST");
      } catch {
        return researchJsonResponse(
          {
            jobId: job.id,
            message:
              "Job saved. Dispatch uncertain; retry this job to reconnect without duplicating it.",
          },
          { status: 202 },
        );
      }
    }
    return researchJsonResponse({ jobId: job.id }, { status: 202 });
  } catch {
    return researchJsonResponse(
      {
        error:
          "Another research job is active. Wait for it to finish or cancel it.",
      },
      { status: 409 },
    );
  }
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return observeResearchRequest(request, () => getMandateResearch(request, context));
}
