import { expect, it, vi } from "vitest";
import { productionPolicy, researchFetch } from "./local-policy";
import { browserMarkdown } from "./browser-reader";
import { requestBudgetStop } from "./runtime-policy";

const local = { LOCAL_DEVELOPMENT: "true", LOCAL_RESEARCH_POLICY: "production", APP_ORIGIN: "http://127.0.0.1:3010" };
it("separates production policies from local connection safety", () => {
  expect(productionPolicy(local)).toBe(true);
  expect(requestBudgetStop(32, !productionPolicy(local))).toContain("request budget");
  expect(productionPolicy({ LOCAL_DEVELOPMENT: "true" })).toBe(false);
  expect(productionPolicy({ LOCAL_RESEARCH_POLICY: "development" })).toBe(true);
});

it("blocks real CF, hosted fallbacks, alternate local search and remote callbacks before fetch", async () => {
  const fetcher = vi.fn<typeof fetch>();
  const request = researchFetch(local, fetcher);
  for (const url of ["https://api.cloudflare.com/client/v4/accounts/test/browser-rendering/markdown", "https://reader.workers.dev/crawl", "https://production.example.com/api/research/internal/test", "http://127.0.0.1:7000/google/search", "https://openrouter.ai/redirect"]) {
    await expect(request(url)).rejects.toThrow("blocked");
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("disallows redirects from allowed destinations", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
  await researchFetch(local, fetcher)("http://127.0.0.1:18083/crawl", { redirect: "follow" });
  expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:18083/crawl", { redirect: "manual" });
});

it.each([301, 302, 303, 307, 308])("rejects HTTP %s redirects without a second request", async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
    status, headers: { location: "https://api.cloudflare.com/client/v4/" },
  }));
  await expect(researchFetch(local, fetcher)("http://127.0.0.1:18083/crawl"))
    .rejects.toThrow("Redirect blocked");
  expect(fetcher).toHaveBeenCalledOnce();
});

it("uses production admission/accounting but only the OrbStack transport, even with CF secrets", async () => {
  const permit = vi.fn(async () => ({ granted: true, retryAfterMs: 0 }));
  const count = vi.fn();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ url: "https://example.com/", markdown: "Source evidence" }));
  await expect(browserMarkdown({ ...local, CF_ACCOUNT_ID: "do-not-use", CF_BROWSER_TOKEN: "do-not-send" }, "https://example.com/", { operation: "markdown", permit, onRequest: count }, fetcher)).resolves.toBe("Source evidence");
  expect(permit).toHaveBeenCalledOnce();
  expect(count).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:18083/crawl");
  expect(new Headers(fetcher.mock.calls[0][1]?.headers).has("authorization")).toBe(false);
  expect(fetcher.mock.calls[0][1]?.signal).toBeDefined();
});

it("fails closed on a remote local-reader URL and never tries a CF fallback", async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(browserMarkdown({ ...local, LOCAL_CRAWL4AI_URL: "https://reader.workers.dev" }, "https://example.com/", { operation: "markdown", permit: async () => ({ granted: true, retryAfterMs: 0 }) }, fetcher)).rejects.toThrow("OrbStack");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([429, 422, 503])("preserves local provider HTTP %s without a cloud fallback", async status => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "Reader unavailable" }, { status }));
  await expect(browserMarkdown(local, "https://example.com/", { operation: "markdown", permit: async () => ({ granted: true, retryAfterMs: 0 }) }, fetcher)).rejects.toMatchObject({ status });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('allows a separate loopback reader only for explicit benchmark mode', async () => {
 const env = { LOCAL_DEVELOPMENT: 'true', LOCAL_RESEARCH_POLICY:'production', LOCAL_RESEARCH_BENCHMARK: 'true', LOCAL_CRAWL4AI_URL:'http://127.0.0.1:18483' };
 const fetcher = vi.fn(async () => new Response('{}'));
 await researchFetch(env, fetcher)('http://127.0.0.1:18483/crawl');
 expect(fetcher).toHaveBeenCalledTimes(1);
 await expect(researchFetch({...env, LOCAL_CRAWL4AI_URL:'https://example.com'},fetcher)('https://example.com/crawl')).rejects.toThrow();
 await expect(researchFetch({...env, LOCAL_RESEARCH_BENCHMARK:undefined},fetcher)('http://127.0.0.1:18483/crawl')).rejects.toThrow();
});

it("permits only the exact direct OpenAI completion endpoint for configured local research",async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
 await researchFetch(local,fetcher)('https://api.openai.com/v1/chat/completions');
 for(const url of ['https://api.openai.com/v1/files','https://api.openai.com/redirect','https://api.openai.com.evil.invalid/v1/chat/completions'])await expect(researchFetch(local,fetcher)(url)).rejects.toThrow('blocked');
 expect(fetcher).toHaveBeenCalledOnce();
});
