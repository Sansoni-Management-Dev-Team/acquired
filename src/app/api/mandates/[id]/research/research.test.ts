import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  enabled: vi.fn(),
  worker: vi.fn(),
  mandate: vi.fn(),
  create: vi.fn(),
  org: vi.fn(),
  list: vi.fn(),
  findings: vi.fn(),
  get: vi.fn(),
  hasOtherActive: vi.fn(),
  concurrentResearchReady: vi.fn(),
}));
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
    findings = mocks.findings;
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
  mocks.session.mockResolvedValue({
    session: { activeOrganizationId: "org-a" },
    user: { id: "user-a" },
  });
  mocks.enabled.mockReturnValue(true);
  mocks.mandate.mockResolvedValue({ id });
  mocks.create.mockResolvedValue({ id: jobId, status: "queued" });
});
describe("research API isolation and dispatch", () => {
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
