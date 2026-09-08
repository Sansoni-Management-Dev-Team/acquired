import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), mandate: vi.fn(), members: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), generate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.session } } }));
vi.mock("@/db/client", () => ({ requireDb: () => ({ select: m.select, insert: m.insert, update: m.update }) }));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class { getMandate = m.mandate; memberships = m.members; } }));
vi.mock("@/adapters/outreach-drafting", () => ({ createOutreachDraftingProvider: () => ({ generateSequence: m.generate }) }));
import { POST } from "./route";
import { organization, targets, signals } from "@/db/schema";
const id = "00000000-0000-4000-8000-000000000001", mandateId = "00000000-0000-4000-8000-000000000002";
const publicProfile = { senderName: "Alex Example", background: "I operate instrument businesses.", investmentThesis: "Instrument manufacturers", operatingIntent: "Maintain the operating team.", callToAction: "An introductory call", signature: "Alex Example", publicProfileApproved: true };
beforeEach(() => {
  vi.resetAllMocks(); m.session.mockResolvedValue({ session: { activeOrganizationId: "org-a" }, user: { id: "user-a" } });
  m.mandate.mockResolvedValue({ id: mandateId, brief: { disclosureApproved: true, outreachPositioning: "A home for instrument companies" } });
  m.members.mockResolvedValue([{ target: { id }, assessment: { stage: "shortlisted", evidence: [] }, accreditations: [] }]);
  m.select.mockImplementation(() => ({ from: (table: unknown) => ({ where: () => {
    const rows = table === targets ? [{ id, companyName: "Example Instruments", firmographics: {} }] : table === organization ? [{ metadata: JSON.stringify({ buyerProfile: publicProfile }) }] : table === signals ? [{ id: "signal", kind: "capability", value: "Makes instruments", weight: "medium", direction: "positive", capturedAt: new Date(), source: "Company website", confidence: 70 }] : [];
    return { limit: async () => rows, then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  } }) }));
  m.generate.mockResolvedValue([{ step: 1, subject: "Introduction", body: "Hi there", signalIds: ["signal"] }]);
});
const request = (preview: boolean) => new Request("https://app.example.com", { method: "POST", body: JSON.stringify({ mandateId, targetId: id, preview }) });
it("previews without a contact and never writes a sequence or Gmail draft", async () => {
  const response = await POST(request(true)); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ saved: false, preview: [{ step: 1 }] });
  expect(m.generate).toHaveBeenCalledWith(expect.objectContaining({ contactFirstName: "there" })); expect(m.insert).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
});
it("still requires a contact for saved sequences and approved disclosure for previews", async () => {
  expect((await POST(request(false))).status).toBe(404); expect(m.generate).not.toHaveBeenCalled();
  m.mandate.mockResolvedValue({ id: mandateId, brief: { disclosureApproved: false } }); expect((await POST(request(true))).status).toBe(409); expect(m.generate).not.toHaveBeenCalled();
});
