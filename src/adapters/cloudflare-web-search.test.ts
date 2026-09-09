import { afterEach, expect, it, vi } from "vitest";
import { cloudflareSearchResults } from "./cloudflare-web-search";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("correlates app search with worker requests and job IDs without logging query content", async () => {
  vi.stubEnv("RESEARCH_WORKER_URL", "http://127.0.0.1:8787");
  vi.stubEnv("RESEARCH_SERVICE_SECRET", "test-secret");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const fetcher = vi.fn().mockResolvedValue(Response.json({ seeds: ["https://example.com/"] }));
  await cloudflareSearchResults("private test query", fetcher, "00000000-0000-4000-8000-000000000001");
  const headers = fetcher.mock.calls[0][1].headers;
  const events = log.mock.calls.map(([, value]) => JSON.parse(value));
  expect(events[0].requestId).toBe(headers["x-research-request-id"]);
  expect(events[0].jobId).toBe(headers["x-research-job-id"]);
  expect(events.at(-1).event).toBe("request_completed");
  expect(JSON.stringify(events)).not.toMatch(/private test query|test-secret/);
});
