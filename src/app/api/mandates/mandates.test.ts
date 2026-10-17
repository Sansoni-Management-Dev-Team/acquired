import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyBrief, initialAssessment } from "@/domain/acquisition";
const mocks = vi.hoisted(() => ({ session: vi.fn(), listMandates: vi.fn(), getMandate: vi.fn(), saveAssessment: vi.fn(), saveBrief: vi.fn(), updateBrief:vi.fn(), memberships: vi.fn(), provider: vi.fn(), org: vi.fn(), generateMandate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.session } } }));
vi.mock("@/db/client", () => ({ requireDb: vi.fn(() => { throw new Error("Unexpected database access"); }) }));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class { constructor(org: string) { mocks.org(org); } listMandates = mocks.listMandates; getMandate = mocks.getMandate; saveAssessment = mocks.saveAssessment; saveBrief = mocks.saveBrief; updateBrief = mocks.updateBrief; memberships = mocks.memberships; } }));
vi.mock("@/lib/organization-access",()=>({assertOrganizationActor:vi.fn()}));
vi.mock("@/db/repositories", () => ({ OrganizationRepository: class {} }));
vi.mock("@/adapters/provider-mode", () => ({ createTargetDataProvider: mocks.provider }));
vi.mock("@/adapters/mandate-generation", () => ({ generateMandate: mocks.generateMandate }));
import { GET as list, POST as create } from "./route";
import { POST as update } from "./[id]/route";
import { GET as readWorkspace } from "./[id]/route";
const id = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000002";
const context = { params: Promise.resolve({ id }) };
const request = (body: unknown) => new Request(`http://localhost/api/mandates/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ user: { id: "user-a" }, session: { activeOrganizationId: "org-a" } }); mocks.getMandate.mockResolvedValue({ id, brief: emptyBrief(),revision:"123",createdAt:"2026-10-17T00:00:00Z" }); mocks.updateBrief.mockImplementation(async (brief)=>({id,brief,revision:"124",createdAt:"2026-10-17T00:00:00Z"})); });
describe("mandate API boundaries", () => {
  it("returns only the authenticated workspace's list with its cache identity", async () => {
    mocks.session.mockResolvedValue({ user: { id: "user-a" }, session: { id: "session-a", activeOrganizationId: "org-a" } });
    mocks.listMandates.mockResolvedValue([]);
    const response = await list(new Request("http://localhost/api/mandates"));
    expect(mocks.org).toHaveBeenCalledWith("org-a");
    expect(await response.json()).toEqual({ mandates: [], scope: JSON.stringify(["user-a", "org-a", "session-a"]) });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it("rejects signed-out list reads before querying mandates", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await list(new Request("http://localhost/api/mandates"))).status).toBe(401);
    expect(mocks.listMandates).not.toHaveBeenCalled();
  });
  it("rejects signed-out creation without writing", async () => {
    mocks.session.mockResolvedValue(null);
    expect((await create(request(emptyBrief()))).status).toBe(401);
    expect(mocks.saveBrief).not.toHaveBeenCalled();
  });
  it("uses the active organisation and refuses a foreign mandate", async () => {
    mocks.getMandate.mockResolvedValue(undefined);
    expect((await update(request({ action: "discover" }), context)).status).toBe(404);
    expect(mocks.org).toHaveBeenCalledWith("org-a"); expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("does not call discovery providers for unreviewed criteria", async () => {
    expect((await update(request({ action: "discover" }), context)).status).toBe(409);
    expect(mocks.provider).not.toHaveBeenCalled();
  });
  it("refuses duplicate criterion evidence rather than inflating completeness", async () => {
    const e = { criterionKey: "management", assessment: "unknown", kind: "inferred", value: "", source: "", sourceUrl: "", confidence: 0, capturedAt: "2026-09-01T00:00:00.000Z", nextStep: "Ask owner" };
    expect((await update(request({ action: "assessment", targetId, version: 1, assessment: { ...initialAssessment, evidence: [e,e] } }),context)).status).toBe(400);
    expect(mocks.saveAssessment).not.toHaveBeenCalled();
  });
  it("permits shortlisting with unknown owner answers and passes the expected version", async () => {
    const result = await update(request({ action: "assessment", targetId, version: 7, assessment: { ...initialAssessment, stage: "shortlisted" } }),context);
    // A pure assessment update must not instantiate the company write path / database.
    expect(mocks.saveAssessment).toHaveBeenCalledWith(id,targetId,expect.objectContaining({ stage: "shortlisted" }),7,"user-a");
    expect(result.status).toBe(200);
  });
});


it("returns regenerated criteria so the editor cannot save stale values after a description update", async () => {
  const brief = { ...emptyBrief(), naturalLanguage: "Acquire an industrial business in Victoria." };
  mocks.generateMandate.mockResolvedValue(brief);
  const response = await update(request({ action: "brief-description", expectedRevision:"123", description: brief.naturalLanguage }), context);
  expect(response.status).toBe(200);
  expect((await response.json()).brief).toEqual(brief);
  expect(mocks.updateBrief).toHaveBeenCalledWith(brief, "user-a", id,"123");
});
it("returns the current brief without regenerating an unchanged description", async () => {
  const brief = { ...emptyBrief(), naturalLanguage: "Acquire an industrial business in Victoria." };
  mocks.getMandate.mockResolvedValue({ id, brief,revision:"123",createdAt:"2026-10-17T00:00:00Z" });
  const response = await update(request({ action: "brief-description", expectedRevision:"123", description: brief.naturalLanguage }), context);
  expect((await response.json()).brief).toEqual(brief);
  expect(mocks.generateMandate).not.toHaveBeenCalled();
  expect(mocks.saveBrief).not.toHaveBeenCalled();
});

it('preserves explicitly selected financial scope when regenerating description criteria', async () => {
  const existing = { ...emptyBrief(), financialScope: 'AU' as const };
  mocks.getMandate.mockResolvedValue({ id, brief: existing,revision:"123",createdAt:"2026-10-17T00:00:00Z" });
  mocks.generateMandate.mockResolvedValue({ ...emptyBrief(), naturalLanguage: 'Acquire manufacturers in Australia.' });
  const response = await update(request({ action: 'brief-description', expectedRevision:'123', description: 'Acquire manufacturers in Australia.' }), context);
  expect((await response.json()).brief.financialScope).toBe('AU');
});
it('rejects stale and missing editor revisions before paying for regeneration',async()=>{
 for(const revision of [undefined,'122']){
  const response=await update(request({action:'brief-description',description:'Acquire manufacturers in Australia.',expectedRevision:revision}),context);
  expect(response.status).toBe(revision?409:400);
 }
 expect(mocks.generateMandate).not.toHaveBeenCalled();expect(mocks.updateBrief).not.toHaveBeenCalled();
});
it('rejects an edit made obsolete while regeneration was running',async()=>{
 mocks.generateMandate.mockImplementation(async()=>{
  mocks.getMandate.mockResolvedValue({id,brief:emptyBrief(),revision:'125',createdAt:'2026-10-17T00:00:00Z'});
  return {...emptyBrief(),naturalLanguage:'Acquire manufacturers in Australia.'};
 });
 expect((await update(request({action:'brief-description',description:'Acquire manufacturers in Australia.',expectedRevision:'123'}),context)).status).toBe(409);
 expect(mocks.updateBrief).not.toHaveBeenCalled();
});
it('loads just the saved brief without research recovery, enrichment or workspace queries',async()=>{
 const response=await readWorkspace(new Request(`http://localhost/api/mandates/${id}?briefOnly=true`),context);
 expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
 expect(await response.json()).toMatchObject({mandate:{id,revision:'123'}});
 expect(mocks.memberships).not.toHaveBeenCalled();expect(mocks.generateMandate).not.toHaveBeenCalled();
});
