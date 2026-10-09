import { beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ session: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mock.session } } }));
vi.mock("@/lib/campaign-reply-alerts", () => ({ listCampaignReplyAlerts: mock.list }));
import { GET } from "./route";
beforeEach(() => {
  vi.resetAllMocks();
  mock.session.mockResolvedValue({ session: { activeOrganizationId: "actual-org" }, user: { id: "actual-user" } });
  mock.list.mockResolvedValue([]);
});
it.each([null, { session: {}, user: { id: "user" } }])("requires a signed-in user and active organisation", async session => {
  mock.session.mockResolvedValue(session);
  expect((await GET(new Request("https://app.test/api/campaigns/reply-alerts"))).status).toBe(401);
  expect(mock.list).not.toHaveBeenCalled();
});
it("uses session scope and prevents caching private alerts", async () => {
  const response = await GET(new Request("https://app.test/api/campaigns/reply-alerts?organizationId=victim&userId=victim"));
  expect(mock.list).toHaveBeenCalledWith({ organizationId: "actual-org", userId: "actual-user" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ scope: JSON.stringify(["actual-org", "actual-user"]), alerts: [] });
});
it("does not expose database errors or report successful checks on an outage", async () => {
  mock.list.mockRejectedValue(new Error("private database details"));
  const response = await GET(new Request("https://app.test/api/campaigns/reply-alerts"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Reply alerts unavailable" });
});
