import { env } from "cloudflare:workers";
import { introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import worker from "../index";
import type { ResearchConfig } from "../../../src/domain/research";
import type { ResearchServices } from "../../../src/domain/research-runner";
import { automaticContinuation } from "../../../src/domain/research-continuation";
import { researchFetch } from "../local-policy";

type Progress = Parameters<ResearchServices["progress"]>[0];
const bindings = env as unknown as Parameters<typeof worker.fetch>[1];
// Synthetic public-company fixture: stable, no captured customer data or credentials.
const markdown = "# Example Instruments\nExample Instruments makes sensors for Australian manufacturers. Our sensor products are designed and manufactured in Australia. We provide calibration and technical support for industrial sensors.";
afterEach(() => vi.restoreAllMocks());

it("uses redirect options supported by the real Worker fetch implementation", async () => {
  // Keep fetch unmocked: the configured outbound service blocks actual traffic.
  const response = await researchFetch(bindings)("http://127.0.0.1:18083/crawl");
  expect(response.status).toBe(503);
  expect(await response.text()).toBe("Unmocked network request blocked");
});

function replay(options: { pages?: number; cancelled?: boolean; failProgress?: boolean; denyPermit?: boolean; config?: ResearchConfig } = {}) {
  const id = crypto.randomUUID();
  const config: ResearchConfig = options.config || {
    seeds: Array.from({ length: options.pages || 1 }, (_, i) => `https://instruments${i || ""}.example.com/`),
    searchTerms: ["sensors"], geography: "Australia", approved: true, discover: false,
    budget: { maxPages: options.pages || 1, maxDomains: 10, maxMinutes: 10, maxModelCalls: 10 },
  };
  let status = options.cancelled ? "cancelled" : "queued";
  let failed = false;
  const progress: Progress[] = [];
  const requests: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    if (url === `http://127.0.0.1:3010/api/research/internal/${id}`) {
      if (!init?.body) return Response.json({ status, config, seeds: config.seeds, deadline: Date.now() + 600000 });
      const data = JSON.parse(String(init.body));
      if (data.action === "discover") return Response.json({ seeds: [] });
      if (data.action === "provider-reserve") return Response.json({ granted: !options.denyPermit, retryAfterMs: 0, after: Date.now(), until: Date.now() + 2000, token: data.token });
      if (data.action === "browser-permit") return Response.json({ granted: !options.denyPermit, retryAfterMs: 0 });
      // Model the app's revision check after a write succeeds but its response is lost.
      if (!progress.some(p => p.revision === data.revision)) { progress.push(data); status = data.status; }
      if (options.failProgress && !failed) { failed = true; return new Response("Temporary failure", { status: 503 }); }
      return Response.json({ ok: true });
    }
    if (url === "http://127.0.0.1:18083/crawl") {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Response.json({ url: JSON.parse(String(init?.body)).url, markdown });
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") return Response.json({
      model: "replay", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ findings: [] }) } }],
    });
    throw new Error(`Unmocked request: ${url}`);
  });
  return { id, config, progress, requests };
}

it("runs a real Workflow with local reads, extraction and persisted progress, without CF requests", async () => {
  const t = replay();
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  const response = await worker.fetch(new Request(`http://worker/jobs/${t.id}`, {
    method: "POST", headers: { authorization: "Bearer replay-only" },
  }), bindings);
  expect(response.status).toBe(202);
  await instance.waitForStatus("complete");
  expect(t.progress.at(-1)).toMatchObject({ status: "complete", pages: 1, modelCalls: 1 });
  expect(t.requests).toContain("http://127.0.0.1:18083/crawl");
  expect(t.requests.some(url => url.includes("api.cloudflare.com"))).toBe(false);
  const persisted = JSON.parse(await instance.waitForStepResult({ name: "read-people-1-admitted-0" }) as string);
  expect(persisted.value.page.markdown).toBe(markdown);
});

it("honours cancellation before issuing a browser or AI request", async () => {
  const t = replay({ cancelled: true });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.progress).toEqual([]);
  expect(t.requests).toHaveLength(1);
});

it("retries a failed progress callback through real Workflow step retries", async () => {
  const t = replay({ failProgress: true });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.progress.at(-1)?.status).toBe("complete");
  expect(t.requests.filter(url => url.endsWith("/crawl"))).toHaveLength(1);
  expect(new Set(t.progress.map(p => p.revision)).size).toBe(t.progress.length);
});

it("keeps the production request guard enabled in a local Workflow", async () => {
  const t = replay({ pages: 8 });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.progress.at(-1)?.status).toBe("partial");
  expect(t.progress.at(-1)?.message).toContain("Worker request budget reached");
  expect(t.progress.at(-1)?.runtime?.remaining.length).toBeGreaterThan(0);
});

it("retains a page whose extraction is interrupted by the request guard", async () => {
  const t = replay({ pages: 8, failProgress: true });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  const last = t.progress.at(-1)!;
  expect(last.runtime).toHaveProperty("pendingPage");
  expect(last.runtime?.remaining).toContain("https://instruments2.example.com/");
  expect(last.runtime?.visited).not.toContain("https://instruments2.example.com/");
  const config = automaticContinuation({
    id: t.id, status: last.status, message: last.message, createdAt: new Date(),
    modelCalls: last.modelCalls, config: { ...t.config, runtime: last.runtime },
  })!;
  expect(config).not.toBeNull();
  const resumed = replay({ config });
  await using next = await introspectWorkflowInstance(bindings.RESEARCH, resumed.id);
  await next.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: resumed.id, params: { jobId: resumed.id } });
  await next.waitForStatus("complete");
  // The first resumed page is extracted from persisted content before any read.
  expect(resumed.requests.indexOf("https://openrouter.ai/api/v1/chat/completions"))
    .toBeLessThan(resumed.requests.indexOf("http://127.0.0.1:18083/crawl"));
  expect(resumed.progress.some(p => p.page?.url === last.runtime?.pendingPage?.page.url)).toBe(true);
});

it("defers admission contention and completes the page when admission is available", async () => {
  const t = replay({ denyPermit: true });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  const last = t.progress.at(-1)!;
  expect(last.status).toBe("partial");
  expect(last.runtime?.attempts[0].status).toBe("pending");
  expect(t.requests).not.toContain("http://127.0.0.1:18083/crawl");
  const config = automaticContinuation({ id: t.id, status: last.status, message: last.message,
    createdAt: new Date(), modelCalls: last.modelCalls, config: { ...t.config, runtime: last.runtime } })!;
  expect(config.budget.maxPages).toBe(1);
  const resumed = replay({ config });
  await using next = await introspectWorkflowInstance(bindings.RESEARCH, resumed.id);
  await next.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: resumed.id, params: { jobId: resumed.id } });
  await next.waitForStatus("complete");
  expect(resumed.progress.at(-1)).toMatchObject({ status: "complete", pages: 1, modelCalls: 1 });
});

it("rejects Google and page two in local production-policy mode without a provider call", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch");
  for (const parameters of [{ engine: "google" }, { page: 2 }]) {
    const response = await worker.fetch(new Request("http://worker/search", {
      method: "POST", headers: { authorization: "Bearer replay-only" },
      body: JSON.stringify({ query: "sensors Australia", ...parameters }),
    }), bindings);
    expect(response.status).toBe(422);
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("terminates an unresponsive workflow only after checking fresh saved progress", async () => {
  const id = crypto.randomUUID();
  const terminate = vi.fn().mockResolvedValue(undefined);
  const recoveryBindings = { ...bindings, RESEARCH: { get: vi.fn().mockResolvedValue({ terminate }) } } as unknown as typeof bindings;
  let updatedAt = new Date(Date.now() - 11 * 60000).toISOString();
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({ status: "crawling", updatedAt }));
  const request = () => new Request(`http://worker/jobs/${id}`, {
    method: "POST", headers: { authorization: "Bearer replay-only", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "recover-stalled" }),
  });
  expect(await (await worker.fetch(request(), recoveryBindings)).json()).toEqual({ recovered: true });
  expect(terminate).toHaveBeenCalledOnce();
  updatedAt = new Date().toISOString();
  expect(await (await worker.fetch(request(), recoveryBindings)).json()).toEqual({ recovered: false });
  expect(terminate).toHaveBeenCalledOnce();
});
