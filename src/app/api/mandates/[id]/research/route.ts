import { startMandateResearch } from "@/lib/start-mandate-research";
import {companyDiscoveryProgress, projectCompanyDiscoveryConfig} from '@/domain/company-discovery-progress';
import { researchJsonResponse, researchRequestJson } from "@/lib/research-request-observability";
import { observeResearchRequest } from "@/lib/research-request-observability";
import { summariseResearchTimings, summariseCompactResearchTimings } from '@/domain/research-timing';
import { missingResearchFields, fieldSatisfied, researchFields } from '@/domain/research-objectives';
import { z } from "zod";
import { auth } from "@/lib/auth";
import { AcquisitionRepository } from "@/db/acquisition-repository";
import { ResearchRepository } from "@/db/research-repository";
import {
  researchActive,
  terminalResearchStates,
  type ResearchConfig,
  type ResearchFinding,
} from "@/domain/research";
import { summariseEvidence, type EvidenceCounts } from "@/domain/evidence-status";
import { researchEnabled } from "@/lib/research-service";
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
  const jobs = initialJobs;
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
  const publicJobs = jobs.map(job => ({ ...job,
    discovery: companyDiscoveryProgress(job.config as ResearchConfig),
    config: { ...projectCompanyDiscoveryConfig(job.config as ResearchConfig), pipelineTiming: undefined },
  }));
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
    return researchJsonResponse({ error: "Research is awaiting service activation" }, { status: 503 });
  const body = await researchRequestJson(request).catch(() => null);
  const { id } = await context.params;
  const result = await startMandateResearch(
    { organizationId: session.session.activeOrganizationId, userId: session.user.id },
    id,
    body,
  );
  return researchJsonResponse(result.body, { status: result.status });
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return observeResearchRequest(request, () => getMandateResearch(request, context));
}
