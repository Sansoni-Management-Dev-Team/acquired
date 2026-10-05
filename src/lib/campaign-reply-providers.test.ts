import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readChannelReplies } from "./campaign-reply-providers";
const fetcher = vi.fn();
const actor = { organizationId: "org", userId: "owner" };
beforeEach(() => { vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); vi.stubEnv("WHATSAPP_SERVICE_URL", "https://wa.test"); vi.stubEnv("WHATSAPP_SERVICE_SECRET", "private"); vi.stubEnv("LINKEDIN_SERVICE_URL", "https://li.test"); vi.stubEnv("LINKEDIN_SERVICE_SECRET", "private-li"); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(["whatsapp", "linkedin"] as const)("reads %s replies with owner scope and a durable cursor without retrying or exposing credentials", async channel => {
  fetcher.mockResolvedValue(new Response(JSON.stringify({ accountIdentity: "account", events: [], nextCursor: "2", complete: true, checkedAt: new Date().toISOString() })));
  const result = await readChannelReplies(actor, channel, "1");
  expect(result.complete).toBe(true);
  const [url, options] = fetcher.mock.calls[0];
  expect(url.pathname).toBe("/replies"); expect(url.searchParams.get("organizationId")).toBe("org"); expect(url.searchParams.get("userId")).toBe("owner"); expect(url.searchParams.get("cursor")).toBe("1");
  expect(options.method).toBe("GET"); expect(options.cache).toBe("no-store"); expect(fetcher).toHaveBeenCalledOnce();
});
it("rejects raw inbox caches, failed and incomplete contracts rather than claiming a successful check", async () => {
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok", cache: { stale: false }, response: {} })));
  await expect(readChannelReplies(actor, "linkedin", null)).rejects.toThrow();
  fetcher.mockResolvedValueOnce(new Response("{}", { status: 503 }));
  await expect(readChannelReplies(actor, "whatsapp", null)).rejects.toThrow("WhatsApp reply monitor unavailable");
});
it("bounds LinkedIn history by the oldest monitored enrolment", async () => {
  vi.stubEnv("LINKEDIN_SERVICE_URL", "https://linkedin.example.test"); vi.stubEnv("LINKEDIN_SERVICE_SECRET", "secret");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ accountIdentity: "account", events: [], nextCursor: null, complete: true, checkedAt: new Date().toISOString() }))));
  await readChannelReplies(actor, "linkedin", null, new Date("2026-10-06T00:00:00Z"));
  expect(new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get("since")).toBe("2026-10-06T00:00:00.000Z");
});
