import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkGmailHealth, checkHostedHealth } from "./channel-health";
const owner = { organizationId: "org", userId: "owner" };
beforeEach(() => { vi.restoreAllMocks(); process.env.LINKEDIN_SERVICE_URL = "https://service.example"; process.env.LINKEDIN_SERVICE_SECRET = "private-secret"; process.env.WHATSAPP_SERVICE_URL = "https://whatsapp.example"; process.env.WHATSAPP_SERVICE_SECRET = "private-secret"; });
it("checks service and owner session without writes or leaking provider data", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ status: "connected", cookie: "secret", qr: "secret" }));
  const result = await checkHostedHealth("linkedin", owner, fetcher);
  expect(result.status).toBe("healthy");
  expect(String(fetcher.mock.calls[1][0])).toContain("userId=owner");
  expect(String(fetcher.mock.calls[1][0])).toContain("organizationId=org");
  expect(fetcher.mock.calls.every((call) => !call[1].method)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("secret");
});
it.each(["paused", "disconnected", "login_required", "reconnecting"])("does not report %s sessions as healthy", async status => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ status }));
  expect((await checkHostedHealth("whatsapp", owner, fetcher)).status).toBe("attention");
});
it("distinguishes an unreachable service from a disconnected account", async () => {
  const fetcher = vi.fn().mockRejectedValue(new Error("private stack"));
  expect(await checkHostedHealth("linkedin", owner, fetcher)).toMatchObject({ status: "unavailable" });
  delete process.env.LINKEDIN_SERVICE_SECRET;
  expect((await checkHostedHealth("linkedin", owner, fetcher)).message).toContain("not configured");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("verifies Gmail profile with refreshed access without reading messages or returning credentials", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "private-access" })).mockResolvedValueOnce(Response.json({ emailAddress: "OWNER@example.com", historyId: "private" }));
  expect((await checkGmailHealth("private-refresh", "owner@example.com", fetcher)).status).toBe("healthy");
  expect(fetcher.mock.calls[1][0]).toBe("https://gmail.googleapis.com/gmail/v1/users/me/profile");
  expect(fetcher.mock.calls[1][1].method).toBeUndefined();
});
it("requires attention for revoked Gmail authorization and mismatched identities", async () => {
  const revoked = vi.fn().mockResolvedValue(Response.json({ error: "invalid_grant" }, { status: 400 }));
  expect((await checkGmailHealth("refresh", "owner@example.com", revoked)).status).toBe("attention");
  const mismatch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "token" })).mockResolvedValueOnce(Response.json({ emailAddress: "another@example.com" }));
  expect((await checkGmailHealth("refresh", "owner@example.com", mismatch)).status).toBe("attention");
});
it("handles Google permission failures and timeouts without exposing errors", async () => {
  const denied = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "token" })).mockResolvedValueOnce(Response.json({}, { status: 403 }));
  expect((await checkGmailHealth("refresh", "owner@example.com", denied)).status).toBe("attention");
  const timeout = vi.fn().mockRejectedValue(new Error("private details"));
  const result = await checkGmailHealth("refresh", "owner@example.com", timeout);
  expect(result.status).toBe("unavailable"); expect(result.message).not.toContain("private");
});

it.each(["browser_crashed", "browser_unresponsive", "browser_closed"])("reports %s LinkedIn browsers as needing recovery", async status => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ status }));
  const result = await checkHostedHealth("linkedin", owner, fetcher);
  expect(result.status).toBe("attention");
  expect(result.message).toContain("Open the browser to recover");
  expect(result.message).not.toContain("session is connected");
});


afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("allows a 12-second LinkedIn browser check through the production fetch wrapper", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  const network = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/health")) return Promise.resolve(Response.json({ ok: true }));
    return new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      setTimeout(() => resolve(Response.json({ status: "connected" })), 12000);
    });
  });
  vi.stubGlobal("fetch", network);
  const pending = checkHostedHealth("linkedin", owner);
  await vi.advanceTimersByTimeAsync(12000);
  expect((await pending).status).toBe("healthy");
  expect(network.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});
it("reports a slow session separately from an unreachable service", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/health")) return Promise.resolve(Response.json({ ok: true }));
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
  }));
  const pending = checkHostedHealth("linkedin", owner);
  await vi.advanceTimersByTimeAsync(20000);
  expect(await pending).toMatchObject({ status: "attention", message: expect.stringContaining("service is reachable") });
});
it('reports a temporary Gmail user quota as unavailable rather than asking for reconnection',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({access_token:'fixture-token'})).mockResolvedValueOnce(Response.json({error:{errors:[{reason:'userRateLimitExceeded'}]}},{status:403}));
 expect(await checkGmailHealth('fixture-refresh','owner@example.invalid',fetcher)).toMatchObject({status:'unavailable'});
});
