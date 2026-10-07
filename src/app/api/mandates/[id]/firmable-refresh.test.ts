import { beforeEach, expect, it, vi } from "vitest";
import { emptyBrief, initialAssessment } from "@/domain/acquisition";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  getMandate: vi.fn(),
  memberships: vi.fn(),
  queueRun: vi.fn(),
  failRun: vi.fn(), claim: vi.fn(),
  worker: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/db/client", () => ({ requireDb: vi.fn(() => ({})) }));
vi.mock("@/db/acquisition-repository", () => ({
  AcquisitionRepository: class {
    getMandate = mocks.getMandate;
    memberships = mocks.memberships;
  },
}));
vi.mock("@/db/firmable-history-repository", () => ({
  FirmableHistoryRepository: class { queueRun = mocks.queueRun; failRun = mocks.failRun; claimManualRecovery = mocks.claim; },
}));
vi.mock("@/db/repositories", () => ({ OrganizationRepository: class {} }));
vi.mock("@/lib/research-service", () => ({ researchEnabled: () => true, researchWorker: mocks.worker }));
vi.mock("@/adapters/target-search-guard", () => ({
  TargetSearchRateLimitError: class extends Error {},
  acquireTargetSearch: () => mocks.release,
}));

import { POST } from "./route";
import { recoverFirmableRefreshes } from "@/lib/firmable-run-recovery";

const mandateId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const requestId = "00000000-0000-4000-8000-000000000004";
const context = { params: Promise.resolve({ id: mandateId }) };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.FIRMABLE_API_KEY = "test-only";
  mocks.session.mockResolvedValue({ user: { id: "user-a" }, session: { activeOrganizationId: "org-a" } });
  mocks.getMandate.mockResolvedValue({ id: mandateId, brief: emptyBrief() });
  mocks.memberships.mockResolvedValue([{ target: { id: targetId, companyName: "Example Industries", domain: "example.test", sourceData: {} }, assessment: initialAssessment, accreditations: [], researchFindings: [], version: 1 }]);
  mocks.queueRun.mockResolvedValue({ id: runId, targetId, status: "queued", trigger: "phones" });
  mocks.worker.mockReset().mockResolvedValue({ id: runId });
  mocks.claim.mockResolvedValue(true);
});

it("persists a Firmable run before dispatching its named workflow and returns immediately", async () => {
  const response = await POST(new Request(`http://localhost/api/mandates/${mandateId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "enrich", targetIds: [targetId], requestId }),
  }), context);

  expect(response.status).toBe(202);
  expect(mocks.queueRun).toHaveBeenCalledWith({ organizationId: "org-a", actorId: "user-a", targetId, requestKey: `${requestId}:${targetId}`, trigger: "phones" });
  expect(mocks.worker).toHaveBeenCalledWith(`/firmable/${runId}`, "POST", { mandateId }, 4000);
  expect(mocks.queueRun.mock.invocationCallOrder[0]).toBeLessThan(mocks.worker.mock.invocationCallOrder[0]);
  await expect(response.json()).resolves.toMatchObject({ refresh: { runs: [{ id: runId, targetId, status: "queued" }] } });
  expect(mocks.release).toHaveBeenCalledOnce();
});

it("keeps the persisted run visible when workflow dispatch is uncertain", async () => {
  mocks.worker.mockRejectedValueOnce(new Error("Worker unavailable"));
  const response = await POST(new Request(`http://localhost/api/mandates/${mandateId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "enrich", targetIds: [targetId], requestId }),
  }), context);
  const body = await response.json();

  expect(response.status).toBe(202);
  expect(body.refresh.runs).toHaveLength(1);
  expect(body.warnings[0]).toContain("dispatch is uncertain");
});

it("redispatches queued runs and closes a stale run whose workflow already ended", async () => {
  const queued = { id: runId, status: "queued", updatedAt: new Date() };
  const staleId = "00000000-0000-4000-8000-000000000005";
  const stale = { id: staleId, status: "running", updatedAt: new Date(Date.now() - 180_000) };
  mocks.worker.mockImplementation(async (_path, method) => method === "GET" ? { status: "complete" } : { id: runId });

  await recoverFirmableRefreshes({ failRun: mocks.failRun, claimManualRecovery: mocks.claim } as never, [queued, stale], mandateId);

  expect(mocks.worker).toHaveBeenCalledWith(`/firmable/${runId}`, "POST", { mandateId }, 4000);
  expect(mocks.worker).toHaveBeenCalledWith(`/firmable/${staleId}`, "GET", undefined, 4000);
  expect(mocks.failRun).toHaveBeenCalledWith(staleId, expect.stringContaining("ended before"));
});

it("times out an unreachable stale workflow while retaining its saved data", async () => {
  const staleId = "00000000-0000-4000-8000-000000000006";
  mocks.worker.mockRejectedValueOnce(new Error("unreachable"));
  await recoverFirmableRefreshes({ failRun: mocks.failRun, claimManualRecovery: mocks.claim } as never, [{ id: staleId, status: "running", updatedAt: new Date(Date.now() - 660_000) }], mandateId);
  expect(mocks.failRun).toHaveBeenCalledWith(staleId, expect.stringContaining("timed out"));
});
it('does not turn ongoing automatic people retrieval into a paid phone action',async()=>{
 mocks.queueRun.mockResolvedValue({id:runId,targetId,status:'running',trigger:'discovery'});
 const response=await POST(new Request(`http://localhost/api/mandates/${mandateId}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'enrich',targetIds:[targetId],requestId})}),context);
 expect(mocks.worker).not.toHaveBeenCalled();expect((await response.json()).warnings[0]).toContain('contact research is still running');
});

it("queues people retrieval separately from paid phone lookup", async () => {
  mocks.queueRun.mockResolvedValue({ id: runId, targetId, status: "queued", trigger: "people" });
  const response = await POST(new Request(`http://localhost/api/mandates/${mandateId}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "load-people", targetIds: [targetId], requestId }),
  }), context);
  expect(response.status).toBe(202);
  expect(mocks.queueRun).toHaveBeenCalledWith(expect.objectContaining({trigger:"people",requestKey:`${requestId}:${targetId}`}));
  expect(mocks.worker).toHaveBeenCalledWith(`/firmable/${runId}`, "POST", {mandateId}, 4000);
});
it("follows existing discovery instead of dispatching a duplicate workflow", async () => {
  mocks.queueRun.mockResolvedValue({id:runId,targetId,status:"running",trigger:"discovery"});
  const response = await POST(new Request(`http://localhost/api/mandates/${mandateId}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "load-people", targetIds: [targetId], requestId }),
  }), context);
  expect(mocks.worker).not.toHaveBeenCalled();
  expect(await response.json()).toMatchObject({refresh:{runs:[{id:runId,status:"running"}]}});
});
it("rejects people retrieval for companies outside the mandate", async () => {
  mocks.memberships.mockResolvedValue([]);
  const response = await POST(new Request(`http://localhost/api/mandates/${mandateId}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "load-people", targetIds: [targetId], requestId }),
  }), context);
  expect(response.status).toBe(404);
  expect(mocks.queueRun).not.toHaveBeenCalled();
});
