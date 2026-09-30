import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  enabled: vi.fn(),
  worker: vi.fn(),
  mandate: vi.fn(),
  create: vi.fn(),
  org: vi.fn(),
  list: vi.fn(),
  timingSummaries: vi.fn(),
  findings: vi.fn(),
  resultCounts: vi.fn(),
  targetEvidence: vi.fn(),
  get: vi.fn(),
  hasOtherActive: vi.fn(),
  concurrentResearchReady: vi.fn(),
  scope: vi.fn(),
  geography: vi.fn(),
  sources: vi.fn(),
  schedule: vi.fn(),
  recoverStopped: vi.fn(),
}));
vi.mock("@/db/client", () => ({ requireDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ metadata: JSON.stringify({ researchSettings: { defaultTargetBusinesses: 30 } }) }] }) }) }) }) }));
vi.mock("@/lib/brief-research", () => ({ generateBriefResearchScope: mocks.scope, briefResearchGeography: mocks.geography, briefResearchSources: mocks.sources }));
vi.mock("@/lib/research-scheduler", () => ({ scheduleResearchRun: mocks.schedule }));
vi.mock("@/lib/automatic-discovery", () => ({ dispatchDiscoveryCandidates: vi.fn() }));
vi.mock("@/lib/automatic-enrichment", () => ({ dispatchAutomaticEnrichment: vi.fn() }));
vi.mock("@/lib/research-continuation", () => ({ dispatchContinuation: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/lib/research-service", () => ({
  researchEnabled: mocks.enabled,
  researchWorker: mocks.worker,
}));
vi.mock("@/db/acquisition-repository", () => ({
  AcquisitionRepository: class {
    constructor(org: string) {
      mocks.org(org);
    }
    getMandate = mocks.mandate;
  },
}));
vi.mock("@/db/research-repository", () => ({
  ResearchRepository: class {
    constructor(org: string) {
      mocks.org(org);
    }
    get = mocks.get;
    hasOtherActive = mocks.hasOtherActive;
    concurrentResearchReady = mocks.concurrentResearchReady;
    create = mocks.create;
    list = mocks.list;
    listReview = mocks.list;
    timingSummaries = mocks.timingSummaries;
    recoverStopped = mocks.recoverStopped;
    findings = mocks.findings;
    resultCounts = mocks.resultCounts;
    targetEvidence = mocks.targetEvidence;
  },
}));
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001",
  jobId = "00000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ id }) };
const body = {
  requestId: jobId,
  approved: true,
  seeds: ["https://supplier.example.com/"],
  searchTerms: ["sensors"],
  geography: "Australia",
  budget: { maxPages: 1, maxDomains: 1, maxMinutes: 10, maxModelCalls: 1 },
};
const request = (data: unknown) =>
  new Request("https://app.example.com/api/research", {
    method: "POST",
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.timingSummaries.mockResolvedValue({});
  mocks.session.mockResolvedValue({
    session: { activeOrganizationId: "org-a" },
    user: { id: "user-a" },
  });
  mocks.enabled.mockReturnValue(true);
  mocks.mandate.mockResolvedValue({ id });
  mocks.create.mockResolvedValue({ id: jobId, status: "queued" });
  mocks.scope.mockResolvedValue("Specialist Australian manufacturers");
  mocks.geography.mockReturnValue("VIC, NSW");
  mocks.sources.mockReturnValue(["https://directory.example.org/"]);
  mocks.concurrentResearchReady.mockResolvedValue(true);
});
describe("research API isolation and dispatch", () => {
  it("returns run timings and pending deep work without transferring raw spans", async () => {
    const now = new Date();
    const span = { id: crypto.randomUUID(), step: 'extract-1', segment: 'extraction', startedAt: now.toISOString(), finishedAt: new Date(now.getTime() + 1000).toISOString(), elapsedMs: 1000, outcome: 'succeeded' };
    const root = { id: jobId, status: 'complete', createdAt: now, updatedAt: now, config: { mode: 'automatic', automaticDeadline: now.getTime() + 60000, pipelineTiming: { [span.id]: span } } };
    const initial = { id: crypto.randomUUID(), status: 'partial', createdAt: now, updatedAt: now, config: { researchRunId: jobId, enrichmentPhase: 'initial', purpose: 'firmographics', targetId: 'target' } };
    mocks.list.mockResolvedValue([initial, root]);
    mocks.findings.mockResolvedValue([]); mocks.resultCounts.mockResolvedValue([]); mocks.targetEvidence.mockResolvedValue([]);
    const response = await GET(new Request('https://app.example.com'), context);
    const payload = await response.json();
    expect(payload.timings[jobId].segments.extraction).toMatchObject({ calls: 1, totalMs: 1000 });
    expect(payload.jobs[0].config.pipelineTiming).toBeUndefined();
    expect(payload.pendingEnrichment).toEqual([{ jobId: initial.id, runId: jobId, targetId: 'target', purpose: 'firmographics' }]);
    mocks.list.mockResolvedValue([initial, root, { ...initial, id: crypto.randomUUID(), status: 'queued', config: { ...initial.config, enrichmentPhase: 'deep' } }]);
    expect((await (await GET(new Request('https://app.example.com'), context)).json()).pendingEnrichment).toEqual([]);
  });
  it("does not access new tables while feature is disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    expect(
      await (await GET(new Request("https://app.example.com"), context)).json(),
    ).toMatchObject({ enabled: false });
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.mandate).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await POST(request(body), context)).status).toBe(401);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("refuses a foreign mandate", async () => {
    mocks.mandate.mockResolvedValue(undefined);
    expect((await POST(request(body), context)).status).toBe(404);
    expect(mocks.org).toHaveBeenCalledWith("org-a");
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("requires approval before external dispatch", async () => {
    expect(
      (await POST(request({ ...body, approved: false }), context)).status,
    ).toBe(400);
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("dispatches only the saved job ID and keeps the job recoverable after network failure", async () => {
    mocks.worker.mockRejectedValue(new Error("timeout"));
    const response = await POST(request(body), context);
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ jobId });
    expect(mocks.worker).toHaveBeenCalledWith(`/jobs/${jobId}`, "POST");
    expect(mocks.create).toHaveBeenCalledWith(
      jobId,
      id,
      "user-a",
      expect.objectContaining({ approved: true }),
    );
  });
  it("does not restart completed jobs", async () => {
    mocks.create.mockResolvedValue({ id: jobId, status: "complete" });
    expect((await POST(request(body), context)).status).toBe(202);
    expect(mocks.worker).not.toHaveBeenCalled();
  });
  it("starts brief-driven research with saved settings, sources and people lookup", async () => {
    mocks.mandate.mockResolvedValue({ id, brief: { naturalLanguage: "Manufacturers" } });
    const response = await POST(request({ requestId: jobId, fromBrief: true }), context);
    expect(response.status).toBe(202);
    expect(mocks.create).toHaveBeenCalledWith(jobId, id, "user-a", expect.objectContaining({
      researchScope: "Specialist Australian manufacturers",
      geography: "VIC, NSW",
      seeds: ["https://directory.example.org/"],
      targetBusinesses: 30,
      findPeople: true,
    }));
  });
});

it("cannot continue a job from another mandate", async () => {
  mocks.get.mockResolvedValue({ mandateId: "another", status: "partial" });
  expect(
    (await POST(request({ ...body, continueFrom: jobId }), context)).status,
  ).toBe(404);
  expect(mocks.worker).not.toHaveBeenCalled();
});
it("continues server-saved public terms and queue, ignoring client replacements", async () => {
  mocks.get.mockResolvedValue({
    mandateId: id,
    status: "partial",
    seeds: [],
    config: {
      ...body,
      discover: true,
      runtime: {
        remaining: ["https://remaining.example.com/"],
        visited: ["https://visited.example.com/"],
        attempts: [],
      },
    },
  });
  mocks.findings.mockResolvedValue([]);
  expect(
    (
      await POST(
        request({ ...body, continueFrom: jobId, searchTerms: ["changed"] }),
        context,
      )
    ).status,
  ).toBe(202);
  expect(mocks.create).toHaveBeenCalledWith(
    jobId,
    id,
    "user-a",
    expect.objectContaining({
      searchTerms: ["sensors"],
      discover: false,
      seeds: ["https://remaining.example.com/"],
    }),
  );
});

 it("derives automatic depth server-side and waits for the concurrency migration", async () => {
  const automatic = { ...body, workflow: "business", mode: "automatic", targetBusinesses: 30 };
  mocks.concurrentResearchReady.mockResolvedValue(false);
  expect((await POST(request(automatic), context)).status).toBe(503);
  expect(mocks.create).not.toHaveBeenCalled();
  mocks.concurrentResearchReady.mockResolvedValue(true);
  expect((await POST(request(automatic), context)).status).toBe(202);
  expect(mocks.create.mock.calls[0][3]).toMatchObject({ mode: "automatic", budget: { maxPages: 10 }, companyBudget: { maxCompanies: 30 }, researchRunId: jobId });
});

it("starts adaptive research from a scope without requiring user-written queries", async () => {
  mocks.concurrentResearchReady.mockResolvedValue(true);
  const response = await POST(request({ ...body, searchTerms: [], researchScope: "Waste recycling; Industrial decontamination", researchEffort: "focused", mode: "automatic", workflow: "business" }), context);
  expect(response.status).toBe(202);
  expect(mocks.create.mock.calls[0][3]).toMatchObject({ adaptiveDiscovery: true, searchTerms: ["Waste recycling", "Industrial decontamination"], researchScope: "Waste recycling; Industrial decontamination", researchEffort: "focused" });
  expect(mocks.create.mock.calls[0][3].automaticDeadline - Date.now()).toBeLessThanOrEqual(30 * 60000);
});

it('snapshots server-controlled performance flags on new runs', async () => {
  const response = await POST(request({ ...body, performanceFlags: { schedulerCoalescing: false } }), context);
  expect(response.status).toBe(202);
  expect(mocks.create.mock.calls[0][3].performanceFlags).toEqual({ telemetryBatching: true, progressCoalescing: true, schedulerCoalescing: true });
});
it('deduplicates automatic recovery by run', async () => {
  const now = new Date();
  const root = { id: jobId, status: 'crawling', createdAt: now, updatedAt: now, config: { mode: 'automatic', automaticDeadline: now.getTime() + 60000 } };
  const child = { ...root, id: crypto.randomUUID(), config: { mode: 'automatic', researchRunId: jobId, discoveryCandidate: true } };
  mocks.list.mockResolvedValue([child, root]);
  mocks.targetEvidence.mockResolvedValue([]); mocks.findings.mockResolvedValue([]);
  expect((await GET(new Request('https://app.example.com'), context)).status).toBe(200);
  expect(mocks.schedule).toHaveBeenCalledTimes(1);
  expect(mocks.schedule).toHaveBeenCalledWith('org-a', jobId, { recovery: true });
});

it('retains disabled or absent flags when continuing an existing run', async () => {
  mocks.get.mockResolvedValue({ mandateId: id, status: 'partial', seeds: [], config: { ...body, runtime: { remaining: ['https://remaining.example.com/'], visited: [], attempts: [] } } });
  mocks.findings.mockResolvedValue([]);
  expect((await POST(request({ ...body, continueFrom: jobId, performanceFlags: { schedulerCoalescing: true } }), context)).status).toBe(202);
  expect(mocks.create.mock.calls[0][3].performanceFlags).toBeUndefined();
});
it('reuses the review snapshot when scheduling recovery is throttled', async () => {
  const now = new Date();
  mocks.list.mockResolvedValue([{ id: jobId, status: 'crawling', createdAt: now, updatedAt: now, config: { mode: 'automatic', automaticDeadline: now.getTime() + 60000 } }]);
  mocks.targetEvidence.mockResolvedValue([]); mocks.findings.mockResolvedValue([]);
  mocks.schedule.mockResolvedValue(false);
  expect((await GET(new Request('https://app.example.com'), context)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledTimes(1);
});
it('refreshes the review snapshot after a scheduling pass', async () => {
  const now = new Date();
  mocks.list.mockResolvedValue([{ id: jobId, status: 'crawling', createdAt: now, updatedAt: now, config: { mode: 'automatic', automaticDeadline: now.getTime() + 60000 } }]);
  mocks.targetEvidence.mockResolvedValue([]); mocks.findings.mockResolvedValue([]);
  mocks.schedule.mockResolvedValue(true);
  expect((await GET(new Request('https://app.example.com'), context)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it('refreshes after recovering a stopped worker even when scheduling is throttled', async () => {
  const now = new Date();
  mocks.list.mockResolvedValue([{ id: jobId, status: 'crawling', revision: 1, pages: 0, createdAt: now, updatedAt: new Date(now.getTime() - 100000), config: { mode: 'automatic', automaticDeadline: now.getTime() + 60000 } }]);
  mocks.targetEvidence.mockResolvedValue([]); mocks.findings.mockResolvedValue([]);
  mocks.schedule.mockResolvedValue(false); mocks.worker.mockResolvedValue({ status: 'complete' });
  expect((await GET(new Request('https://app.example.com'), context)).status).toBe(200);
  expect(mocks.recoverStopped).toHaveBeenCalledWith(jobId, 1, 0);
  expect(mocks.list).toHaveBeenCalledTimes(2);
});

it('uses compact timing summaries while review jobs contain no raw span maps', async () => {
 const now=new Date();
 const root={id:jobId,status:'complete',createdAt:now,updatedAt:now,config:{mode:'automatic',researchRunId:jobId}};
 mocks.list.mockResolvedValue([root]);mocks.targetEvidence.mockResolvedValue([]);mocks.findings.mockResolvedValue([]);
 mocks.timingSummaries.mockResolvedValue({[jobId]:{runId:jobId,spans:3,cappedJobs:0,measuredWindowMs:100,segments:{extraction:{durations:[10,20,30],failed:1}}}});
 const response=await GET(new Request('https://app.example.com'),context);const data=await response.json();
 expect(data.timings[jobId].segments.extraction).toEqual({calls:3,failed:1,totalMs:60,maxMs:30,meanMs:20,p95Ms:30});
 expect(data.jobs[0].config).not.toHaveProperty('pipelineTiming');
 expect(mocks.timingSummaries).toHaveBeenCalledWith([root]);
});

it.each(['partial','complete'])('skips idle recovery for a durably settled %s parallel run',async status=>{
 const now=new Date();const root={id:jobId,status,createdAt:now,updatedAt:now,config:{mode:'automatic',parallelBusinessResearch:true,parallelResearchSettled:true,parallelResearchPendingTasks:0,automaticDeadline:now.getTime()+60000}};
 mocks.list.mockResolvedValue([root,{...root,id:'child',config:{mode:'automatic',researchRunId:jobId,researchTask:'website'}}]);mocks.targetEvidence.mockResolvedValue([]);mocks.findings.mockResolvedValue([]);
 expect((await GET(new Request('https://app.example.com'),context)).status).toBe(200);
 expect(mocks.schedule).not.toHaveBeenCalled();expect(mocks.list).toHaveBeenCalledTimes(1);
});
it.each(['queued','crawling'])('recovers %s children despite a stale settled root marker',async status=>{
 const now=new Date();const root={id:jobId,status:'partial',createdAt:now,updatedAt:now,config:{mode:'automatic',parallelBusinessResearch:true,parallelResearchSettled:true,parallelResearchPendingTasks:0,automaticDeadline:now.getTime()+60000}};
 mocks.list.mockResolvedValue([root,{...root,id:'child',status,config:{mode:'automatic',researchRunId:jobId,researchTask:'website'}}]);mocks.targetEvidence.mockResolvedValue([]);mocks.findings.mockResolvedValue([]);mocks.schedule.mockResolvedValue(false);
 await GET(new Request('https://app.example.com'),context);expect(mocks.schedule).toHaveBeenCalledTimes(1);
});
it('does not skip recovery while the durable parallel task count is pending',async()=>{
 const now=new Date();mocks.list.mockResolvedValue([{id:jobId,status:'partial',createdAt:now,updatedAt:now,config:{mode:'automatic',parallelBusinessResearch:true,parallelResearchSettled:true,parallelResearchPendingTasks:2,automaticDeadline:now.getTime()+60000}}]);mocks.targetEvidence.mockResolvedValue([]);mocks.findings.mockResolvedValue([]);
 await GET(new Request('https://app.example.com'),context);expect(mocks.schedule).toHaveBeenCalledTimes(1);
});
