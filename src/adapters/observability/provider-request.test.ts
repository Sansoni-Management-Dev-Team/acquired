import { afterEach, expect, it, vi } from "vitest";
import { providerDiagnostics, providerJsonRequest } from "./provider-request";
afterEach(() => vi.restoreAllMocks());
it.each(["reader_busy", "domain_backoff", "origin_rate_limit", "origin_http_error", "page_unavailable", "reader_timeout", "reader_failure"])("retains the local reader reason %s with bounded diagnostics", reason => {
  const body = { category: reason, error: "private page", reader: { activeReads: 5, maxReads: 5, availableReads: 0, retryAfterMs: 3000, domainActive: true, domainKey: "abcdef012345", secret: "secret", elapsedMs: -1 } };
  expect(providerDiagnostics(429, new Headers(), body, "local-crawl4ai")).toMatchObject({ category: reason, classificationBasis: "reader_category", reader: { activeReads: 5, maxReads: 5, availableReads: 0, retryAfterMs: 3000, domainActive: true, domainKey: "abcdef012345" } });
  expect(JSON.stringify(providerDiagnostics(429, new Headers(), body, "local-crawl4ai"))).not.toMatch(/secret|private page|elapsedMs/);
  expect(providerDiagnostics(429, new Headers(), body, "openrouter").category).toBe("rate_limit_unspecified");
});
it("rejects arbitrary reader categories and domain keys", () => {
  const result = providerDiagnostics(429, new Headers(), { category: "private data", reader: { domainKey: "https://private.example/path", activeReads: -5 } }, "local-crawl4ai");
  expect(result.category).toBe("rate_limit_unspecified");
  expect(JSON.stringify(result)).not.toMatch(/private|activeReads/);
});
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

it('correlates worker callback headers and logs allowlisted server measurements', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const headers = new Headers({ authorization: 'private-token', 'x-request-id': 'unrelated-old-id' });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }, { headers: { 'server-timing': 'app;dur=123.4, db;dur=45.6, secret;dur=999;desc="private"', 'x-research-db-calls': '4', 'x-private': 'private' } }));
  await providerJsonRequest(fetcher, 'https://example.com/internal', { headers }, { provider: 'research-worker', operation: 'progress', requestId: 'correlation-1234' });
  const sent = new Headers(fetcher.mock.calls[0][1].headers);
  expect(sent.get('x-request-id')).toBe('correlation-1234');
  expect(sent.get('authorization')).toBe('private-token');
  expect(headers.get('x-request-id')).toBe('unrelated-old-id');
  const completed = JSON.parse(log.mock.calls.at(-1)![1]);
  expect(completed).toMatchObject({ requestId: 'correlation-1234', responseServerTiming: { appMs: 123.4, dbMs: 45.6 }, databaseCalls: 4 });
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});
it.each([500, 200])('retains worker server measurements on HTTP %s failures including malformed response bodies', async status => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValue(new Response('private non-json', { status, headers: { 'server-timing': 'app;dur=15,db;dur=3', 'x-research-db-calls': '2' } }));
  const result = providerJsonRequest(fetcher, 'https://example.com', {}, { provider: 'research-worker', operation: 'progress', verbose: false });
  if (status === 200) await expect(result).rejects.toThrow(); else await result;
  expect(JSON.parse(log.mock.calls.at(-1)![1])).toMatchObject({ event: 'request_failed', responseServerTiming: { appMs: 15, dbMs: 3 }, databaseCalls: 2 });
});
it('generates safe correlation IDs and rejects malformed measurements without exposing headers', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }, { headers: { 'server-timing': 'app;dur=-1,db;dur=Infinity,other;dur=12;desc="private"', 'x-research-db-calls': '1.5' } }));
  await providerJsonRequest(fetcher, 'https://example.com', {}, { provider: 'research-worker', operation: 'progress', requestId: 'private; invalid' });
  const requestId = new Headers(fetcher.mock.calls[0][1].headers).get('x-request-id');
  expect(requestId).toMatch(/^[a-f0-9-]{36}$/);
  const event = JSON.parse(log.mock.calls.at(-1)![1]);
  expect(event.requestId).toBe(requestId);
  expect(event.responseServerTiming).toBeUndefined();
  expect(event.databaseCalls).toBeUndefined();
  expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});
it('does not send internal correlation headers or accept database diagnostics from external providers', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }, { headers: { 'server-timing': 'app;dur=15,db;dur=3', 'x-research-db-calls': '2' } }));
  await providerJsonRequest(fetcher, 'https://example.com', {}, { provider: 'openrouter', operation: 'test' });
  expect(new Headers(fetcher.mock.calls[0][1].headers).has('x-request-id')).toBe(false);
  expect(JSON.parse(log.mock.calls.at(-1)![1]).responseServerTiming).toBeUndefined();
});

it('logs callback body sizes from the sent body and bounded application response measurements', async () => {
 const log = vi.spyOn(console, 'info').mockImplementation(() => {});
 const body = JSON.stringify({ message: 'private café 🦘' });
 const fetcher = vi.fn().mockResolvedValue(Response.json({ ok: true }, { headers: { 'x-research-response-body-bytes': '11', 'x-research-request-body-bytes': '99999999' } }));
 await providerJsonRequest(fetcher, 'https://example.com', { method: 'POST', body }, { provider: 'research-worker', operation: 'progress' });
 expect(JSON.parse(log.mock.calls.at(-1)![1])).toMatchObject({ requestBodyBytes: new TextEncoder().encode(body).byteLength, responseBodyBytes: 11, bodyByteMeasurement: 'application_utf8_body' });
 expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});

it.each(['-1', 'Infinity', '1.5', '9007199254740992', 'private'])('rejects invalid callback body size %s without logging it', async value => {
 const log = vi.spyOn(console, 'info').mockImplementation(() => {});
 await providerJsonRequest(vi.fn().mockResolvedValue(Response.json({ ok: true }, { headers: { 'x-research-response-body-bytes': value } })), 'https://example.com', {}, { provider: 'research-worker', operation: 'control' });
 expect(JSON.parse(log.mock.calls.at(-1)![1]).responseBodyBytes).toBeUndefined();
 expect(JSON.stringify(log.mock.calls)).not.toContain('private');
});

it('keeps the Worker admission category without copying arbitrary response data', () => {
 const result=providerDiagnostics(503,new Headers(),{category:'browser_admission',error:'private payload'},'research-worker');
 expect(result).toMatchObject({category:'browser_admission',classificationBasis:'worker_category'});
 expect(JSON.stringify(result)).not.toContain('private');
 expect(providerDiagnostics(503,new Headers(),{category:'private payload'},'research-worker').category).toBe('provider_error');
});
