import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn(), checkHostedHealth: vi.fn(), checkGmailHealth: vi.fn(), requireDb: vi.fn(), decryptToken: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/channel-health", () => ({ checkHostedHealth: mocks.checkHostedHealth, checkGmailHealth: mocks.checkGmailHealth }));
vi.mock("@/db/client", () => ({ requireDb: mocks.requireDb }));
vi.mock("@/lib/token-crypto", () => ({ decryptToken: mocks.decryptToken }));
import { POST } from "./route";
const request = (provider: string, origin = "https://app.example") => new Request(`https://app.example/api/channels/health?provider=${provider}&userId=attacker`, { method: "POST", headers: { origin } });
beforeEach(() => { vi.resetAllMocks(); mocks.getSession.mockResolvedValue({ user: { id: "owner" }, session: { activeOrganizationId: "org" } }); });
it("rejects unauthenticated, cross-origin and unknown checks before touching credentials", async () => {
  mocks.getSession.mockResolvedValueOnce(null);
  expect((await POST(request("gmail"))).status).toBe(401);
  expect((await POST(request("gmail", "https://other.example"))).status).toBe(403);
  expect((await POST(request("arbitrary"))).status).toBe(400);
  expect(mocks.requireDb).not.toHaveBeenCalled(); expect(mocks.checkHostedHealth).not.toHaveBeenCalled();
});
it("uses signed-in ownership and returns uncached health results", async () => {
  mocks.checkHostedHealth.mockResolvedValue({ status: "healthy", message: "Connected", checkedAt: "now" });
  const response = await POST(request("linkedin"));
  expect(mocks.checkHostedHealth).toHaveBeenCalledWith("linkedin", { organizationId: "org", userId: "owner" });
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ status: "healthy" });
});
it("does not decrypt or call Gmail for disconnected accounts", async () => {
  const limit = vi.fn().mockResolvedValue([]);
  const chain = { from: vi.fn(), where: vi.fn(), limit }; chain.from.mockReturnValue(chain); chain.where.mockReturnValue(chain);
  mocks.requireDb.mockReturnValue({ select: () => chain });
  expect(await (await POST(request("gmail"))).json()).toMatchObject({ status: "attention" });
  expect(mocks.decryptToken).not.toHaveBeenCalled(); expect(mocks.checkGmailHealth).not.toHaveBeenCalled();
});
it("does not return credential or database errors", async () => {
  mocks.requireDb.mockImplementation(() => { throw new Error("private database connection"); });
  const data = await (await POST(request("gmail"))).json();
  expect(data.status).toBe("unavailable"); expect(JSON.stringify(data)).not.toContain("private");
});

afterEach(() => vi.unstubAllEnvs());
it("tests the public HTTPS origin behind an internal container address", async () => {
  vi.stubEnv("APP_URL", "https://acquire.mlai.au");
  mocks.checkHostedHealth.mockResolvedValue({ status: "healthy" });
  const response = await POST(new Request("http://0.0.0.0:3000/api/channels/health?provider=linkedin", { method: "POST", headers: { origin: "https://acquire.mlai.au" } }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "healthy" });
  expect(mocks.checkHostedHealth).toHaveBeenCalledWith("linkedin", { organizationId: "org", userId: "owner" });
});
