import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
import { GET, POST } from "./route";
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getSession.mockResolvedValue({ user: { id: "owner" }, session: { activeOrganizationId: "org" } });
  process.env.LINKEDIN_SERVICE_URL = "http://localhost:18096";
  process.env.LINKEDIN_SERVICE_SECRET = "private-service-secret";
});
it("proxies browser controls from the public origin behind a container proxy", async () => {
  vi.stubEnv("APP_URL", "https://acquire.mlai.au");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ status: "connected" }));
  const response = await POST(new Request("http://0.0.0.0:3000/api/channels/linkedin", { method: "POST", headers: { origin: "https://acquire.mlai.au" }, body: "{}" }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "connected" });
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
it.each(["LINKEDIN_SERVICE_URL", "LINKEDIN_SERVICE_SECRET"])("returns a traced unavailable response when %s is missing", async (name) => {
  vi.stubEnv(name, "");
  const fetch = vi.spyOn(globalThis, "fetch");
  const response = await GET(new Request("http://localhost/api/channels/linkedin"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "LinkedIn service is not configured", status: "unavailable" });
  expect(response.headers.get("x-linkedin-trace-id")).toMatch(/^[a-f0-9]{32}$/);
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


it("logs a correlated request before fetch and after response without message content", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    expect(info).toHaveBeenCalledTimes(1);
    return Response.json({ action: { id: "a".repeat(32), status: "submitted", text: "private-message", recipient: "private-recipient" } });
  });
  const response = await POST(new Request("http://localhost/api/channels/linkedin?op=actions", {
    method: "POST", headers: { origin: "http://localhost" }, body: JSON.stringify({ text: "private-message" }),
  }));
  const rows = info.mock.calls.map(([line]) => JSON.parse(line));
  const trace = response.headers.get("x-linkedin-trace-id");
  expect(trace).toMatch(/^[a-f0-9]{32}$/);
  expect((fetch.mock.calls[0][1]?.headers as Record<string, string>)["X-LinkedIn-Trace-Id"]).toBe(trace);
  expect(rows.map(row => row.event)).toEqual(["linkedin.service_request.start", "linkedin.service_request.end"]);
  expect(rows.every(row => row.traceId === trace)).toBe(true);
  expect(rows[1]).toMatchObject({ httpStatus: 200, actionId: "a".repeat(32), actionStatus: "submitted" });
  expect(rows[1].durationMs).toBeGreaterThanOrEqual(0);
  for (const privateValue of ["private-message", "private-recipient", "private-service-secret"]) expect(JSON.stringify(rows)).not.toContain(privateValue);
});
it("logs transport failure with the trace and error type without raw error details", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("private-secret in diagnostic detail", "TimeoutError"));
  const response = await GET(new Request("http://localhost/api/channels/linkedin"));
  const rows = info.mock.calls.map(([line]) => JSON.parse(line));
  expect(response.status).toBe(503);
  expect(rows[1]).toMatchObject({ event: "linkedin.service_request.error", errorType: "TimeoutError", traceId: response.headers.get("x-linkedin-trace-id") });
  expect(JSON.stringify(rows)).not.toContain("private-secret");
});
