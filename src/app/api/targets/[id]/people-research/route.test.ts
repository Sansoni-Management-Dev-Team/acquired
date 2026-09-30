import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), mandate: vi.fn(), members: vi.fn(), create: vi.fn(), get: vi.fn(), worker: vi.fn(), enabled: vi.fn(), finding: vi.fn(), existing: vi.fn(), values: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.session } } }));
vi.mock("@/lib/research-service", () => ({ researchEnabled: m.enabled, researchWorker: m.worker }));
vi.mock("@/db/client", () => ({ requireDb: () => ({ select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: m.finding }) }), where: m.existing }) }), insert: () => ({ values: m.values }) }) }));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class { getMandate = m.mandate; memberships = m.members; } }));
vi.mock("@/db/research-repository", () => ({ ResearchRepository: class { get = m.get; create = m.create; } }));
vi.mock("@/db/repositories", () => ({ OrganizationRepository: class { appendAudit = m.audit; } }));
import { POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001", mandateId = "00000000-0000-4000-8000-000000000002", requestId = "00000000-0000-4000-8000-000000000003";
const ctx = { params: Promise.resolve({ id }) };
const body = { action: "start", mandateId, requestId, approved: true };
const request = (data: unknown = body) => new Request("https://app.example.com", { method: "POST", body: JSON.stringify(data) });
beforeEach(() => {
  vi.resetAllMocks(); m.session.mockResolvedValue({ session: { activeOrganizationId: "org-a" }, user: { id: "user-a" } }); m.enabled.mockReturnValue(true); m.mandate.mockResolvedValue({ id: mandateId }); m.members.mockResolvedValue([{ target: { id, domain: "instruments.example.com", companyName: "Example Instruments" } }]); m.create.mockResolvedValue({ id: requestId, status: "queued" });
});
it("requires authentication and mandate membership before dispatch", async () => {
  m.session.mockResolvedValueOnce(null); expect((await POST(request(), ctx)).status).toBe(401);
  m.members.mockResolvedValueOnce([]); expect((await POST(request(), ctx)).status).toBe(404);
  expect(m.worker).not.toHaveBeenCalled();
});
it("derives public company identity and fixed budget server-side", async () => {
  expect((await POST(request({ ...body, companyName: "injected", seeds: ["http://localhost/"], budget: { maxPages: 999 } }), ctx)).status).toBe(202);
  expect(m.create).toHaveBeenCalledWith(requestId, mandateId, "user-a", expect.objectContaining({ targetedFollowup: true, targetId: id, companyName: "Example Instruments", seeds: ["https://instruments.example.com/"], budget: { maxPages: 5, maxDomains: 3, maxModelCalls: 5, maxMinutes: 10 } }));
  expect(m.worker).toHaveBeenCalledWith(`/jobs/${requestId}`, "POST");
});
it("does not reuse another target's request or start without a reviewed public website", async () => {
  m.get.mockResolvedValueOnce({ config: { purpose: "people", targetId: "other" } }); expect((await POST(request(), ctx)).status).toBe(409);
  m.members.mockResolvedValueOnce([{ target: { id, domain: "localhost", companyName: "Example" } }]); expect((await POST(request(), ctx)).status).toBe(409);
  expect(m.worker).not.toHaveBeenCalled();
});
it("keeps dispatch failures recoverable without creating a replacement job", async () => {
  m.worker.mockRejectedValue(new Error("timeout")); m.get.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: requestId });
  const response = await POST(request(), ctx); expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ jobId: requestId }); expect(m.create).toHaveBeenCalledOnce();
});
it("continues server-saved unread pages and legal identity without repeating discovery", async () => {
  const previousId = "00000000-0000-4000-8000-000000000004";
  m.get.mockResolvedValueOnce({ id: previousId, mandateId, status: "partial", config: { purpose: "people", targetId: id, companyDomain: "instruments.example.com", companyName: "Example Instruments", legalEntity: "Example Holdings Pty Ltd", runtime: { remaining: ["https://directory.example.com/company-profile"], visited: ["https://instruments.example.com/", "https://instruments.example.com/team"], attempts: [{ url: "https://instruments.example.com/team", status: "failed" }] } } });
  expect((await POST(request({ ...body, continueFrom: previousId }), ctx)).status).toBe(202);
  expect(m.create).toHaveBeenCalledWith(requestId, mandateId, "user-a", expect.objectContaining({ discover: false, legalEntity: "Example Holdings Pty Ltd", runtime: expect.objectContaining({ visited: ["https://instruments.example.com/"], remaining: ["https://instruments.example.com/team", "https://directory.example.com/company-profile"] }) }));
});
it("refuses to continue research from another mandate or company", async () => {
  m.get.mockResolvedValueOnce({ mandateId: "foreign", status: "partial", config: { purpose: "people", targetId: id } });
  expect((await POST(request({ ...body, continueFrom: requestId }), ctx)).status).toBe(409); expect(m.worker).not.toHaveBeenCalled();
});

it.each([
  ["apollo", "Apollo", "unverified"],
  [undefined, "Cloudflare public web research", "published-unverified"],
])("preserves %s attribution when a research lead becomes a contact", async (provider, source, roleStatus) => {
  const sourceUrl = provider === "apollo" ? "https://app.apollo.io/#/people/person1" : "https://instruments.example.com/team";
  m.finding.mockResolvedValue([{ config: { purpose: "people", targetId: id, provider }, finding: {
    id: requestId, sourceUrl, observedAt: new Date("2026-09-15T00:00:00Z"), confidence: 0.4,
    evidence: { kind: "person", name: "Alex Example", value: "Owner", email: "alex@instruments.example.com", quote: "Alex Example is listed as Owner.", website: sourceUrl },
  } }]);
  m.existing.mockResolvedValue([]);
  m.values.mockReturnValue({ returning: async () => [{ id: "contact-id" }] });
  const response = await POST(request({ action: "save", mandateId, findingId: requestId }), ctx);
  expect(response.status).toBe(200);
  expect(m.values).toHaveBeenCalledWith(expect.objectContaining({
    displayName: "Alex Example", provenance: expect.objectContaining({ source, sourceUrl, roleStatus, findingId: requestId, reviewedBy: "user-a" }),
  }));
});

it("keeps research leads without an email out of saved contacts", async () => {
  m.finding.mockResolvedValue([{ config: { purpose: "people", targetId: id }, finding: {
    evidence: { kind: "person", name: "Alex Example", value: "Owner", quote: "Alex Example is Owner.", website: "https://instruments.example.com/team" },
  } }]);
  const response = await POST(request({ action: "save", mandateId, findingId: requestId }), ctx);
  expect(response.status).toBe(409);
  expect(m.values).not.toHaveBeenCalled();
});
