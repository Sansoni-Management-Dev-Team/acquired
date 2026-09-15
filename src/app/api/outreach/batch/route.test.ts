import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ session: vi.fn(), mandate: vi.fn(), members: vi.fn(), generate: vi.fn(), approve: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: m.session } } }));
vi.mock("@/db/client", () => ({ requireDb: () => ({ select: m.select }) }));
vi.mock("@/db/acquisition-repository", () => ({ AcquisitionRepository: class { getMandate = m.mandate; memberships = m.members; } }));
vi.mock("../drafts/route", () => ({ POST: m.generate }));
vi.mock("../messages/[id]/approval/route", () => ({ POST: m.approve }));
import { POST } from "./route";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const body = { mandateId: id(1), action: "generate", rows: [{ targetId: id(2), contactId: id(3) }, { targetId: id(4), contactId: id(5) }] };
const request = (value = body) => new Request("https://app.test/api/outreach/batch", { method: "POST", body: JSON.stringify(value) });
beforeEach(() => {
  vi.resetAllMocks();
  m.session.mockResolvedValue({ session: { activeOrganizationId: "org" }, user: { id: "user" } });
  m.mandate.mockResolvedValue({ id: id(1) });
  m.members.mockResolvedValue([{ target: { id: id(2) } }, { target: { id: id(4) } }]);
  m.generate.mockResolvedValue(Response.json({ messageCount: 7 }));
});
it("requires a session and organization", async () => {
  m.session.mockResolvedValueOnce(null);
  expect((await POST(request())).status).toBe(401);
  m.session.mockResolvedValueOnce({ session: {}, user: { id: "user" } });
  expect((await POST(request())).status).toBe(403);
  expect(m.generate).not.toHaveBeenCalled();
});
it("rejects another mandate before calling generation", async () => {
  m.mandate.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(404);
  expect(m.generate).not.toHaveBeenCalled();
});
it("does not generate for targets outside the mandate, preserving valid results", async () => {
  m.members.mockResolvedValue([{ target: { id: id(2) } }]);
  const result = await (await POST(request())).json();
  expect(result.results.map((row: { ok: boolean }) => row.ok)).toEqual([true, false]);
  expect(m.generate).toHaveBeenCalledTimes(1);
  expect(await m.generate.mock.calls[0][0].json()).toMatchObject({ targetId: id(2), contactId: id(3), reuseExisting: true });
});
it("reports partial Gmail failures and skips already-synced messages", async () => {
  m.select.mockReturnValueOnce({ from: () => ({ where: async () => [{ id: "enrolment" }] }) })
    .mockReturnValueOnce({ from: () => ({ where: async () => [{ id: "saved", state: "approved", providerMessageId: "gmail", stepNumber: 1 }, { id: "retry", state: "draft", stepNumber: 2 }, { id: "failed", state: "draft", stepNumber: 3 }] }) });
  m.approve.mockResolvedValueOnce(Response.json({ saved: true })).mockResolvedValueOnce(Response.json({ error: "Reconnect Gmail" }, { status: 409 }));
  const result = await (await POST(request({ ...body, action: "save-gmail", rows: [body.rows[0]] }))).json();
  expect(m.approve).toHaveBeenCalledTimes(2);
  expect(result.results[0]).toMatchObject({ ok: false, error: "2/3 drafts saved. Step 3: Reconnect Gmail" });
});
