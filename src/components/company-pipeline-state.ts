import { terminalResearchStates } from "@/domain/research";
import type { ResearchJob } from "./research-panel";
const terminal = (job: ResearchJob) =>
  terminalResearchStates.includes(job.status);
const backgroundJob = (job: ResearchJob) =>
  job.config.purpose === "firmographics" ||
  Boolean(job.config.companyBackgroundResearch);
const secondaryResearch = (job: ResearchJob) =>
  job.config.purpose === "people" || backgroundJob(job);
function scopedJobs(root: ResearchJob, jobs: ResearchJob[]) {
  const runId = root.config.researchRunId || root.id;
  return [
    ...new Map(
      [
        root,
        ...jobs.filter(
          (job) =>
            job.id === root.id ||
            job.config.researchRunId === runId ||
            job.config.parentJobId === runId,
        ),
      ].map((job) => [job.id, job]),
    ).values(),
  ];
}
export function isCompanyPipeline(job: ResearchJob) {
  return ["firmable-v1", "web-firmable-v1", "hybrid-firmable-v1"].includes(
    job.config.pipelineDesign || "",
  );
}
export function researchRoot(jobs: ResearchJob[], id?: string) {
  if (id) return jobs.find((job) => job.id === id);
  const roots = jobs.filter(
    (job) =>
      !job.config.purpose &&
      !job.config.discoveryCandidate &&
      !job.config.researchTask,
  );
  return roots.find((job) => !terminal(job)) || roots[0];
}
export type CompanyResearchCoverage = Partial<
  Record<"size" | "revenue" | "abn", number>
>;
type ProfileConfig = ResearchJob["config"] & {
  firmableProfile?: {
    abn?: string | null;
    headcountExact?: number | null;
    headcountBand?: unknown;
    revenueBand?: unknown;
  } | null;
  abnLookup?: { status: string; abn?: string };
  companyBackgroundResult?: { abnStatus?: string };
};
function overallState(root: ResearchJob, scoped: ResearchJob[]) {
  const background = scoped.filter(backgroundJob),
    peopleJobs = scoped.filter((job) => job.config.purpose === "people"),
    people = root.config.companyPeopleProgress;
  const count = (jobs: ResearchJob[], status: string) =>
    jobs.filter((job) => job.status === status).length;
  const companySettled =
    terminal(root) &&
    scoped.filter((job) => !secondaryResearch(job)).every(terminal);
  const peopleActive =
    people?.active ??
    peopleJobs.filter((job) => job.status !== "queued" && !terminal(job))
      .length;
  const peopleQueued = people?.queued ?? count(peopleJobs, "queued");
  const peopleSettled =
    peopleActive + peopleQueued === 0 &&
    (people?.settled ?? true) &&
    peopleJobs.every(terminal);
  const peopleFailed =
    people?.failed ??
    peopleJobs.filter((job) => ["failed", "partial"].includes(job.status))
      .length;
  const peopleCancelled = people?.cancelled ?? count(peopleJobs, "cancelled");
  const peopleUnattempted = people?.admissionIncomplete || 0;
  const backgroundActive = background.filter(
      (job) => job.status !== "queued" && !terminal(job),
    ).length,
    backgroundQueued = count(background, "queued");
  const backgroundFailed = background.filter((job) =>
    ["partial", "failed", "cancelled"].includes(job.status),
  ).length;
  const deadlineReached = Boolean(
    root.config.automaticDeadline &&
      Date.now() >= root.config.automaticDeadline,
  );
  const hasIssues =
    scoped.some((job) =>
      ["partial", "failed", "cancelled"].includes(job.status),
    ) ||
    peopleFailed + peopleCancelled + (people?.profilesFailed || 0) > 0 ||
    (deadlineReached &&
      (!companySettled ||
        !peopleSettled ||
        backgroundActive + backgroundQueued > 0));
  const lastUpdatedAt = Math.max(
    ...scoped
      .map((job) => new Date(job.updatedAt || job.createdAt).getTime())
      .filter(Number.isFinite),
  );
  const abnJobs = background.filter(
    (job) => job.config.companyBackgroundResearch?.verifyAbn,
  );
  return {
    companySettled,
    settled: companySettled && peopleSettled && scoped.every(terminal),
    hasIssues,
    deadlineReached,
    lastUpdatedAt,
    abnActive: abnJobs.filter(
      (job) => job.status !== "queued" && !terminal(job),
    ).length,
    abnQueued: count(abnJobs, "queued"),
    backgroundTotal: background.length,
    backgroundActive,
    backgroundQueued,
    backgroundComplete: count(background, "complete"),
    backgroundFailed,
    peopleSettled,
    peopleFound: people?.found || 0,
    peopleSaved: people?.saved || 0,
    peopleTotal: people?.total ?? peopleJobs.length,
    peopleComplete: people?.complete ?? count(peopleJobs, "complete"),
    peopleActive,
    peopleQueued,
    peopleFailed,
    peopleCancelled,
    peopleUnattempted,
  };
}
export function companyPipelineState(root: ResearchJob, jobs: ResearchJob[]) {
  const scoped = scopedJobs(root, jobs),
    children = scoped.filter((job) => job.config.researchTask === "company");
  const savedIds = [
    ...new Set(
      children
        .filter(
          (job) =>
            ["complete", "partial"].includes(job.status) && job.config.targetId,
        )
        .map((job) => job.config.targetId!),
    ),
  ];
  // Count an identity once. Provider ABNs take precedence over fallback registry
  // observations; neither an empty value nor an unsuccessful lookup counts.
  const abns = new Map<string, "firmable" | "registry">();
  for (const job of children) {
    const config = job.config as ProfileConfig,
      key = config.targetId || job.id;
    if (config.firmableProfile?.abn) abns.set(key, "firmable");
    else if (
      config.abnLookup?.status === "matched" &&
      config.abnLookup.abn &&
      !abns.has(key)
    )
      abns.set(key, "registry");
  }
  for (const job of scoped.filter(backgroundJob)) {
    const config = job.config as ProfileConfig;
    if (
      config.targetId &&
      config.companyBackgroundResult?.abnStatus === "matched" &&
      !abns.has(config.targetId)
    )
      abns.set(config.targetId, "registry");
  }
  const config = root.config as typeof root.config & {
    webSearchPages?: Record<string, { ok: boolean }>;
    firmableSearchPages?: Record<string, unknown>;
  };
  return {
    ...overallState(root, scoped),
    savedIds,
    discovered: root.discovery?.candidates ?? 0,
    processed: children.filter(terminal).length,
    companyQueued: children.filter((job) => job.status === "queued").length,
    active: children.filter((job) => !terminal(job)).length,
    failed: children.filter((job) => ["failed", "partial"].includes(job.status))
      .length,
    headcounts: children.filter((job) => {
      const profile = (job.config as ProfileConfig).firmableProfile;
      return profile?.headcountExact != null || profile?.headcountBand != null;
    }).length,
    revenueBands: children.filter(
      (job) =>
        (job.config as ProfileConfig).firmableProfile?.revenueBand != null,
    ).length,
    matched: children.filter(
      (job) =>
        (job.config as ProfileConfig & { firmableMatch?: string })
          .firmableMatch === "matched",
    ).length,
    abns: abns.size,
    firmableAbns: [...abns.values()].filter((source) => source === "firmable")
      .length,
    registryAbns: [...abns.values()].filter((source) => source === "registry")
      .length,
    webSearches:
      root.discovery?.webQueries ??
      Object.values(config.webSearchPages || {}).length,
    webFailures:
      root.discovery?.webFailures ??
      Object.values(config.webSearchPages || {}).filter((page) => !page.ok)
        .length,
    firmableSearches:
      root.discovery?.firmablePages ??
      Object.values(config.firmableSearchPages || {}).length,
  };
}
export function companyResearchProgressState(
  root: ResearchJob,
  jobs: ResearchJob[],
  summary: { coverage?: CompanyResearchCoverage; peopleSaved?: number } = {},
) {
  const state = companyPipelineState(root, jobs);
  if (isCompanyPipeline(root)) return state;
  const scoped = scopedJobs(root, jobs),
    companies = scoped.filter(
      (job) =>
        job.config.discoveryCandidate ||
        (job.id === root.id && !job.config.discover),
    );
  return {
    ...state,
    discovered: Math.max(
      state.discovered,
      companies.filter((job) => job.config.discoveryCandidate).length,
    ),
    savedIds: [
      ...new Set(scoped.flatMap((job) => job.config.newBusinessIds || [])),
    ],
    processed: companies.filter(terminal).length,
    companyQueued: companies.filter((job) => job.status === "queued").length,
    active: companies.filter((job) => !terminal(job)).length,
    headcounts: summary.coverage?.size || 0,
    revenueBands: summary.coverage?.revenue || 0,
    abns: summary.coverage?.abn || 0,
    peopleSaved: summary.peopleSaved ?? state.peopleSaved,
  };
}
