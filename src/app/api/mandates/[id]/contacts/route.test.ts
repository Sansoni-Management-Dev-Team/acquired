import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ session: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mock.session } } }));
vi.mock("@/lib/campaign-service", () => ({ createMandateContact: mock.create, CampaignError: class extends Error {} }));
import { POST } from "./route";
const id = randomUUID();
const request = (body: unknown) => new Request("http://localhost/api/mandates/" + id + "/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mock.session.mockResolvedValue({ session: { activeOrganizationId: "org" }, user: { id: "owner" } });
  mock.create.mockResolvedValue({ id: "contact" });
});
it("accepts an empty person record with the authenticated organisation and mandate", async () => {
  expect((await POST(request({}), { params: Promise.resolve({ id }) })).status).toBe(201);
  expect(mock.create).toHaveBeenCalledWith({ organizationId: "org", userId: "owner" }, id, {});
});
it("accepts a LinkedIn-only person", async () => {
  const body = { linkedinUrl: "https://www.linkedin.com/in/example/" };
  expect((await POST(request(body), { params: Promise.resolve({ id }) })).status).toBe(201);
  expect(mock.create).toHaveBeenCalledWith(expect.anything(), id, body);
});
it("refuses unauthenticated writes", async () => {
  mock.session.mockResolvedValue(null);
  expect((await POST(request({}), { params: Promise.resolve({ id }) })).status).toBe(401);
  expect(mock.create).not.toHaveBeenCalled();
});
it.each([{ email: "bad" }, { organizationId: "someone-else" }, { linkedinUrl: "https://linkedin.com/company/example" }])("rejects invalid supplied fields or scope overrides", async body => {
  expect((await POST(request(body), { params: Promise.resolve({ id }) })).status).toBe(400);
  expect(mock.create).not.toHaveBeenCalled();
});
