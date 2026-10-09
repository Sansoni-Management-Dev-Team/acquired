import { afterEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ ready: vi.fn() }));
vi.mock("@/lib/campaign-reply-readiness", () => ({ campaignReplyReadiness: mock.ready }));
import { GET } from "./route";
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
it.each(["", "Basic secret", "Bearer wrong", "Bearer secret-extra"])("rejects invalid authentication %s before reading campaign state", async authorization => {
  vi.stubEnv("OUTREACH_WORKER_SECRET", "secret");
  expect((await GET(new Request("https://app.test?organizationId=org&userId=owner", { headers: { authorization } }))).status).toBe(401);
  expect(mock.ready).not.toHaveBeenCalled();
});
it("requires an explicit owner scope and returns uncached readiness", async () => {
  vi.stubEnv("OUTREACH_WORKER_SECRET", "secret"); const headers = { authorization: "Bearer secret" };
  expect((await GET(new Request("https://app.test", { headers }))).status).toBe(400);
  mock.ready.mockResolvedValue({ enforceReady: true, recoveryReady: false });
  const response = await GET(new Request("https://app.test?organizationId=org&userId=owner", { headers }));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mock.ready).toHaveBeenCalledWith({ organizationId: "org", userId: "owner" });
});
