import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ session: vi.fn(), save: vi.fn(), publish: vi.fn(), action: vi.fn(), create: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mock.session } } }));
vi.mock("@/lib/campaign-service", () => ({ CampaignError: class extends Error { constructor(message: string, public status = 409) { super(message); } }, saveCampaign: mock.save, publishCampaign: mock.publish, changeEnrolment: mock.action, createCampaign: mock.create, listCampaignStudio: mock.list }));
import { PUT } from "./campaigns/[id]/route";
import { POST as publish } from "./campaigns/[id]/publish/route";
import { POST as action } from "./campaign-enrolments/[id]/action/route";
import { POST as create, GET as list } from "./mandates/[id]/campaigns/route";
const id = randomUUID(); const actor = { organizationId: "actual-org", userId: "actual-user" };
const definition = { schemaVersion: 1, steps: [{ id: randomUUID(), kind: "email", title: "Intro", subject: "Hi", body: "Hello" }] };
const payloads = { save: { name: "Sequence", definition }, publish: {}, action: { action: "pause" }, create: { mandateId: id, name: "Sequence", definition }, list: undefined };
const cases = [
  { name: "save", fn: PUT, service: mock.save, method: "PUT", status: 200 },
  { name: "publish", fn: publish, service: mock.publish, method: "POST", status: 200 },
  { name: "action", fn: action, service: mock.action, method: "POST", status: 200 },
  { name: "create", fn: create, service: mock.create, method: "POST", status: 201 },
  { name: "list", fn: list, service: mock.list, method: "GET", status: 200 },
] as const;
// Every handler consumes the same asynchronous id parameter shape.
const invoke = (entry: typeof cases[number], body = payloads[entry.name], targetId: string = id) => entry.fn(new Request("https://app.test/api/test", { method: entry.method, ...(entry.method === "GET" ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ id: targetId }) } as never);
beforeEach(() => { vi.resetAllMocks(); mock.session.mockResolvedValue({ session: { activeOrganizationId: actor.organizationId }, user: { id: actor.userId } }); cases.forEach(entry => entry.service.mockResolvedValue({ ok: true })); });
for (const entry of cases) {
  it.each([null, { session: {}, user: { id: "user" } }])(`${entry.name}: blocks missing session or organisation %#`, async session => { mock.session.mockResolvedValue(session); expect((await invoke(entry)).status).toBe(401); expect(entry.service).not.toHaveBeenCalled(); });
  it(`${entry.name}: passes authenticated scope to the service`, async () => { expect((await invoke(entry)).status).toBe(entry.status); expect(entry.service.mock.calls[0][0]).toEqual(actor); expect(entry.service.mock.calls[0][1]).toBe(id); });
  it(`${entry.name}: rejects malformed resource IDs`, async () => { expect((await invoke(entry, payloads[entry.name], "../../other-org")).status).toBe(400); expect(entry.service).not.toHaveBeenCalled(); });
  it(`${entry.name}: preserves service errors without reporting success`, async () => { entry.service.mockRejectedValue(new Error("transaction failed")); const response = await invoke(entry); expect(response.status).toBe(500); expect(await response.json()).toEqual({ error: "transaction failed" }); });
}
for (const entry of cases.filter(entry => ["save", "create", "action"].includes(entry.name))) {
  it(`${entry.name}: rejects injected owner fields`, async () => { const body = { ...payloads[entry.name], organizationId: "victim", ownerUserId: "victim" }; expect((await invoke(entry, body as never)).status).toBe(400); expect(entry.service).not.toHaveBeenCalled(); });
  it(`${entry.name}: rejects invalid JSON without mutating`, async () => { const request = new Request("https://app.test/api/test", { method: entry.method, body: "{" }); expect((await entry.fn(request, { params: Promise.resolve({ id }) } as never)).status).toBe(400); expect(entry.service).not.toHaveBeenCalled(); });
}
it("create rejects a valid body targeting a different mandate", async () => { expect((await invoke(cases[3], { ...payloads.create, mandateId: randomUUID() })).status).toBe(400); expect(mock.create).not.toHaveBeenCalled(); });
it.each(["send", "retry", "delete", "resume_all", "__proto__", null])("action rejects unsupported operation %s", async value => { expect((await invoke(cases[2], { action: value } as never)).status).toBe(400); expect(mock.action).not.toHaveBeenCalled(); });
