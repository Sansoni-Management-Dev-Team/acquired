import { beforeEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ session: vi.fn(), enrol: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocked.session } } }));
vi.mock("@/lib/campaign-service", () => ({ CampaignError: class extends Error { status = 409; }, enrolContacts: mocked.enrol }));
import { POST } from "./route";

const sequenceId = "593e2dd1-42a6-4423-a913-1bccb3a320ba";
const contactId = "8acc969c-4c7e-4d25-9f51-84514f2bc3de";
const request = (value: unknown) => new Request(`https://app.test/api/campaigns/${sequenceId}/enrolments`, { method: "POST", body: JSON.stringify(value) });
const context = { params: Promise.resolve({ id: sequenceId }) } as RouteContext<"/api/campaigns/[id]/enrolments">;

beforeEach(() => {
  vi.resetAllMocks();
  mocked.session.mockResolvedValue({ session: { activeOrganizationId: "org-1" }, user: { id: "owner-1" } });
  mocked.enrol.mockResolvedValue([{ id: "enrolment-1" }]);
});

it("requires explicit confirmation before enrolling", async () => {
  expect((await POST(request({ contactIds: [contactId], confirmation: false }), context)).status).toBe(400);
  expect(mocked.enrol).not.toHaveBeenCalled();
});

it("passes only the authenticated owner, never a client-supplied sender", async () => {
  const response = await POST(request({ contactIds: [contactId], confirmation: true }), context);
  expect(response.status).toBe(201);
  expect(mocked.enrol).toHaveBeenCalledWith({ organizationId: "org-1", userId: "owner-1" }, sequenceId, [contactId]);
});

it("does not enrol without an authenticated organisation", async () => {
  mocked.session.mockResolvedValue(null);
  expect((await POST(request({ contactIds: [contactId], confirmation: true }), context)).status).toBe(401);
  expect(mocked.enrol).not.toHaveBeenCalled();
});
