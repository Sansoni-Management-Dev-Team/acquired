import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
import { GET, POST } from "./route";
beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "owner" }, session: { activeOrganizationId: "org" } });
  process.env.LINKEDIN_SERVICE_URL = "http://localhost:18096";
  process.env.LINKEDIN_SERVICE_SECRET = "private-service-secret";
});
it("requires authenticated ownership and rejects foreign origins", async () => {
  mocks.getSession.mockResolvedValueOnce(null);
  expect((await GET(new Request("http://localhost/api/channels/linkedin"))).status).toBe(401);
  expect((await POST(new Request("http://localhost/api/channels/linkedin", { method: "POST", headers: { origin: "https://another.example" } }))).status).toBe(403);
});
it("derives ownership from the session and strips provider credentials", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "connected", cookies: "private", browserState: "private", keys: "private" }));
  const response = await GET(new Request("http://localhost/api/channels/linkedin?userId=attacker&organizationId=attacker"));
  expect(String(fetch.mock.calls[0][0])).toContain("userId=owner");
  expect(String(fetch.mock.calls[0][0])).toContain("organizationId=org");
  expect(await response.json()).toEqual({ status: "connected" });
  expect(response.headers.get("cache-control")).toBe("no-store");
});
it("rejects unknown operations and invalid JSON before contacting service", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  expect((await GET(new Request("http://localhost/api/channels/linkedin?op=arbitrary"))).status).toBe(400);
  expect((await POST(new Request("http://localhost/api/channels/linkedin", { method: "POST", headers: { origin: "http://localhost" }, body: "{" }))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
it("proxies settings with session ownership and preserves cooldown headers", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ detail: "Cooling down", cookies: "private" }, { status: 429, headers: { "Retry-After": "900" } }));
  const response = await POST(new Request("http://localhost/api/channels/linkedin?op=settings&userId=another", { method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ messagesDaily: 10 }) }));
  expect(String(fetch.mock.calls[0][0])).toContain("/settings");
  expect(String(fetch.mock.calls[0][0])).toContain("userId=owner");
  expect(response.status).toBe(429);
  expect(response.headers.get("retry-after")).toBe("900");
  expect(await response.json()).toEqual({ detail: "Cooling down", error: "Cooling down" });
});
