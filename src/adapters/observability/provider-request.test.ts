import { afterEach, expect, it, vi } from "vitest";
import { providerDiagnostics, providerJsonRequest } from "./provider-request";
afterEach(() => vi.restoreAllMocks());
it.each([
  ["Rate limit exceeded: free-models-per-day", "daily_quota"],
  ["Rate limit exceeded: free-models-per-min", "request_rate"],
  ["Browser time limit exceeded for today", "daily_quota"],
  ["Too many concurrent browsers", "concurrency"],
  ["Model temporarily rate-limited upstream", "upstream_capacity"],
  ["Unknown limit", "rate_limit_unspecified"],
])("classifies provider limit signals without copying raw messages", (message, category) => {
  const result = providerDiagnostics(429, new Headers(), { error: { code: 429, message: `${message} private buyer content` } });
  expect(result.category).toBe(category);
  expect(JSON.stringify(result)).not.toContain("private buyer content");
});
it("retains safe limit/reset headers and Cloudflare request IDs, rejecting arbitrary metadata", () => {
  const result = providerDiagnostics(429, new Headers({ "retry-after": "10", "cf-ray": "0123456789abcdef-MEL" }), { error: { code: 429, metadata: { headers: { "X-RateLimit-Limit": "1000", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1788998400000", Authorization: "secret" }, raw: "free-models-per-day secret", provider_name: "secret" } } });
  expect(result).toMatchObject({ category: "daily_quota", errorCodes: [429], limits: { "retry-after": 10, "x-ratelimit-limit": 1000, "x-ratelimit-remaining": 0, "x-ratelimit-reset": 1788998400000 }, providerRequestIds: { "cf-ray": "0123456789abcdef-MEL" } });
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("emits correlated starts and failures with timing and no request data or retries", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValue(Response.json({ errors: [{ code: 2001, message: "Too many concurrent browsers. secret" }], success: false }, { status: 429 }));
  const response = await providerJsonRequest(fetcher, "https://example.com?secret=secret", { body: "private mandate", headers: { Authorization: "secret" } }, { provider: "cloudflare-browser", operation: "web_search", jobId: "job-1", requestId: "request-1" });
  expect(response.response.status).toBe(429);
  expect(fetcher).toHaveBeenCalledTimes(1);
  const events = log.mock.calls.map(([, value]) => JSON.parse(value));
  expect(events).toEqual([expect.objectContaining({ event: "request_started", jobId: "job-1", requestId: "request-1" }), expect.objectContaining({ event: "request_failed", category: "concurrency", httpStatus: 429, elapsedMs: expect.any(Number), requestId: "request-1" })]);
  expect(JSON.stringify(events)).not.toMatch(/secret|private mandate/);
});
it("distinguishes timeout, transport, malformed JSON and HTTP-200 provider failures", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  for (const [fetcher, init, category] of [
    [vi.fn().mockRejectedValue(new DOMException("private", "TimeoutError")), {}, "timeout"],
    [vi.fn().mockRejectedValue(new Error("secret")), {}, "transport"],
    [vi.fn().mockResolvedValue(new Response("private")), {}, "invalid_json_or_interrupted_body"],
  ] as const) {
    await expect(providerJsonRequest(fetcher, "https://example.com", init, { provider: "openrouter", operation: "test", verbose: false })).rejects.toThrow();
    expect(JSON.parse(log.mock.calls.at(-1)![1]).category).toBe(category);
  }
  await providerJsonRequest(vi.fn().mockResolvedValue(Response.json({ error: { code: 429, message: "free-models-per-day" } })), "https://example.com", {}, { provider: "openrouter", operation: "test", verbose: false });
  expect(JSON.parse(log.mock.calls.at(-1)![1])).toMatchObject({ event: "request_failed", httpStatus: 200, category: "daily_quota" });
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/secret|private/);
});

it("classifies an aborted HTTP-200 response body as a timeout without logging content", async () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const controller = new AbortController();
  const response = new Response();
  vi.spyOn(response, "json").mockImplementation(async () => {
    controller.abort();
    throw new DOMException("private content", "AbortError");
  });
  await expect(providerJsonRequest(vi.fn().mockResolvedValue(response), "https://example.com", { signal: controller.signal }, { provider: "openrouter", operation: "mandate_generation" })).rejects.toThrow();
  expect(JSON.parse(log.mock.calls.at(-1)![1])).toMatchObject({ event: "request_failed", httpStatus: 200, category: "timeout", classificationBasis: "abort_signal" });
  expect(JSON.stringify(log.mock.calls)).not.toContain("private content");
});
