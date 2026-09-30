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

function replay(options: { read?: (url: string) => string; targetedSeeds?: string[]; pages?: number; cancelled?: boolean; failProgress?: boolean; denyPermit?: boolean; expireFirstPermit?: boolean; parallelDiscoveryGate?: boolean; lookaheadGate?: boolean; leanControls?: boolean; callbackTiming?: boolean; config?: ResearchConfig } = {}) {
  const id = crypto.randomUUID();
  const config: ResearchConfig = options.config || {
    seeds: Array.from({ length: options.pages || 1 }, (_, i) => `https://instruments${i || ""}.example.com/fixture-${id}/`),
    searchTerms: ["sensors"], geography: "Australia", approved: true, discover: false,
    budget: { maxPages: options.pages || 1, maxDomains: 10, maxMinutes: 10, maxModelCalls: 10 },
  };
  let status = options.cancelled ? "cancelled" : "queued";
  let failed = false;
  let expiredPermit = false;
  const progress: Progress[] = [];
  const requests: string[] = [];
  const callbacks: Record<string, unknown>[] = [];
  const callbackHeaders: { action:string; headers:Headers }[] = [];
  const timings: { spans: { segment: string; step: string; elapsedMs: number; outcome: string }[] }[] = [];
  let releaseLookahead!: () => void;
  const lookaheadStarted = new Promise<void>(resolve => { releaseLookahead = resolve; });
  let releaseExtraction!: () => void;
  const extractionStarted = new Promise<void>(resolve => { releaseExtraction = resolve; });
  let releaseDiscovery!: () => void;
  const discoveryGate = new Promise<void>(resolve => { releaseDiscovery = resolve; });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    if (url === `http://127.0.0.1:3010/api/research/internal/${id}/timings`) {
      timings.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true });
    }
    if (url === `http://127.0.0.1:3010/api/research/internal/${id}` || url === `http://127.0.0.1:3010/api/research/internal/${id}?control=1`) {
      callbackHeaders.push({action:init?.body ? typeof JSON.parse(String(init.body)).revision === 'number' ? 'progress' : JSON.parse(String(init.body)).action : 'control',headers:new Headers(init?.headers)});
      if (!init?.body) return Response.json({ status, config: url.endsWith("?control=1") ? { budget: config.budget, performanceFlags: config.performanceFlags } : config, seeds: config.seeds, deadline: Date.now() + 600000 }, {headers:options.callbackTiming ? {"server-timing":"app;dur=12.5, db;dur=4", "x-research-db-calls":"2"} : {}});
      const data = JSON.parse(String(init.body));
      callbacks.push(data);
      if (data.action === "discovery-context") return Response.json({ scope: "industrial cleaning", startingTerms: [], regions: ["Victoria"], target: 20, found: 0, remainingSearches: 12, attempts: [], candidates: [] });
      if (data.action === "discovery-sources") return Response.json({ pending: true });
      if (data.action === "discovery-persist") return Response.json({ pending: callbacks.filter(c => c.action === "discovery-persist").length < 2 });
      if (data.action === "discover") {
        if (options.parallelDiscoveryGate) {
          if (callbacks.filter(c => c.action === "discover").length === 3) releaseDiscovery();
          await discoveryGate;
        }
        return Response.json({ seeds: [] });
      }
      if (data.action === 'website-pages') return Response.json({ ok: true });
      if (data.action === 'targeted-followup') return Response.json({ seeds: options.targetedSeeds || [], exhausted: true });
      if (data.action === "provider-release") return Response.json({ ok: true });
      if (data.action === "provider-reserve") return Response.json({ granted: !options.denyPermit, retryAfterMs: 0, after: Date.now(), until: Date.now() + 2000, token: data.token });
      if (data.action === "browser-permit" && options.expireFirstPermit && !expiredPermit) { expiredPermit = true; return Response.json({ granted: false, retryAfterMs: 0, expired: true }); }
      if (data.action === "browser-permit") return Response.json({ granted: !options.denyPermit, retryAfterMs: 0 });
      // Model the app's revision check after a write succeeds but its response is lost.
      if (!progress.some(p => p.revision === data.revision)) { progress.push(data); status = data.status; }
      if (options.failProgress && !failed) { failed = true; return new Response("Temporary failure", { status: 503 }); }
      return Response.json({ ok: true, ...(options.leanControls ? { control: { status, config, seeds: config.seeds, deadline: Date.now() + 600000 } } : {}), ...(data.timingSpans ? { timingAcceptedIds: data.timingSpans.map((span: { id: string }) => span.id) } : {}) }, {headers:options.callbackTiming ? {"server-timing":"app;dur=12.5, db;dur=4", "x-research-db-calls":"2"} : {}});
    }
    if (url === "http://127.0.0.1:18083/crawl") {
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      const requestedUrl = JSON.parse(String(init?.body)).url as string;
      if (options.read) return Response.json({ url: requestedUrl, markdown: options.read(requestedUrl) });
      if (options.lookaheadGate) {
        if (requestedUrl.endsWith('/leadership')) {
          releaseLookahead();
          await extractionStarted;
          return Response.json({ url: requestedUrl, markdown: '# Our team\n#### Alex Example\n##### Managing Director\nalex@instruments.example.com' });
        }
        return Response.json({ url: requestedUrl, markdown: '# Our company\nWe make precision instruments in Australia.\n[Leadership](/leadership)' });
      }
      if (options.leanControls) await new Promise(resolve => setTimeout(resolve, 1050));
      return Response.json({ url: requestedUrl, markdown });
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      if (options.lookaheadGate) { releaseExtraction(); await lookaheadStarted; }
      return Response.json({
      model: "replay", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(config.adaptiveDiscovery ? { decisions: ["decontamination contractors", "industrial pressure cleaning", "factory sanitation"].map(query => ({ query, region: "Victoria", reason: "Explore specialist services", stop: false })) } : { findings: [] }) } }],
    });
    }
    throw new Error(`Unmocked request: ${url}`);
  });
  return { id, config, progress, requests, callbacks, timings, callbackHeaders };
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
  expect(t.requests).toHaveLength(2);
  expect(t.timings.flatMap(batch => batch.spans).map(span => span.segment)).toEqual(["control"]);
});

it.each([false, true])("retries failed progress through real Workflow step retries with batching=%s", async batching => {
  const t = replay({ failProgress: true });
  t.config.performanceFlags = { telemetryBatching: batching };
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.progress.at(-1)?.status).toBe("complete");
  expect(t.requests.filter(url => url.endsWith("/crawl"))).toHaveLength(1);
  expect(new Set(t.progress.map(p => p.revision)).size).toBe(t.progress.length);
  if (batching) {
    const attempts = t.callbacks.filter(c => c.revision === 1) as { timingSpans: { id: string }[] }[];
    expect(attempts).toHaveLength(2);
    expect(attempts[1].timingSpans.map(span => span.id)).toEqual(expect.arrayContaining(attempts[0].timingSpans.map(span => span.id)));
  }
});

it("allows a normal paid-plan Workflow to finish below its request guard", async () => {
  const t = replay({ pages: 8 });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.progress.at(-1)).toMatchObject({ status: "complete", pages: 8, modelCalls: 8 });
  expect(t.requests.length).toBeLessThan(512);
});

it("retains unprocessed URLs when the paid request guard is reached", async () => {
  // About seven requests per page after the heartbeat change; 90 pages exceed the 512 budget.
  const pages = 90;
  const t = replay({ config: {
    seeds: Array.from({ length: pages }, (_, i) => `https://instruments${i}.example.com/`),
    searchTerms: ["sensors"], geography: "Australia", approved: true, discover: false,
    budget: { maxPages: pages, maxDomains: pages, maxMinutes: 10, maxModelCalls: pages },
  } });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  const last = t.progress.at(-1)!;
  expect(last.status).toBe("partial");
  // The guard can trip in the admission wrapper or in a control check; either way
  // unread seeds stay queued and unvisited for the continuation.
  expect(last.message).toMatch(/Browser admission deferred|Worker request budget reached/);
  expect(last.pages).toBeLessThan(pages);
  const pending = last.runtime!.remaining[0];
  expect(pending).toMatch(/^https:\/\/instruments\d+\.example\.com\/$/);
  expect(last.runtime?.visited).not.toContain(pending);
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
  expect(resumed.requests).toContain("http://127.0.0.1:18083/crawl");
  expect(resumed.progress.some(p => p.page?.url === pending)).toBe(true);
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

it("recovers an expired browser handoff inside the same real Workflow", async () => {
  const t = replay({ expireFirstPermit: true });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.progress.at(-1)).toMatchObject({status:"complete",pages:1});
  expect(t.requests.filter(url => url === "http://127.0.0.1:18083/crawl")).toHaveLength(1);
  const first = JSON.parse(await instance.waitForStepResult({name:"read-people-1-admitted-0"}) as string);
  expect(first.value.deferred).toBe(true);
  const second = JSON.parse(await instance.waitForStepResult({name:"read-people-1-admitted-1"}) as string);
  expect(second.value.status).toBe("completed");
});


it("plans adaptive discovery in a real Workflow with AI admission and model accounting", async () => {
  const t = replay({ parallelDiscoveryGate: true, config: { seeds: [], searchTerms: ["industrial cleaning"], researchScope: "industrial cleaning", geography: "VIC", approved: true, discover: true, adaptiveDiscovery: true, workflow: "business", mode: "automatic", parallelDiscovery: true, budget: { maxPages: 2, maxDomains: 2, maxMinutes: 10, maxModelCalls: 2 } } });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.progress.at(-1)).toMatchObject({ status: "complete", pages: 0, modelCalls: 1 });
  const searches = t.callbacks.filter(c => c.action === "discover");
  expect(searches).toHaveLength(3);
  expect(searches[0]).toMatchObject({ decision: { query: "decontamination contractors Victoria", batchStartIndex: 0 } });
  expect(new Set(searches.map(search => search.browserReservation)).size).toBe(3);
  expect(searches.every(search => typeof search.browserReservation === "string")).toBe(true);
  const spans = t.timings.flatMap(batch => batch.spans);
  expect(spans.filter(span => span.segment === "discovery_callback")).toHaveLength(3);
  expect(spans.every(span => span.elapsedMs >= 0)).toBe(true);
  expect(t.callbacks.filter(c => c.action === "discovery-persist")).toHaveLength(2);
  expect(t.callbacks.findIndex(c => c.action === "discovery-persist")).toBeLessThan(t.callbacks.findIndex(c => c.action === "discover"));
  expect(t.callbacks.some(c => c.action === "provider-reserve" && c.provider === "ai")).toBe(true);
  expect(t.requests.filter(url => url.includes("openrouter.ai"))).toHaveLength(1);
});

it("overlaps a known-page read with extraction through real Workflow checkpoints", async () => {
  const seed = `https://instruments.example.com/fixture-${crypto.randomUUID()}/`;
  const t = replay({ lookaheadGate: true, config: { seeds: [seed], searchTerms: ["sensors"], geography: "Australia", approved: true, discover: false, mode: "automatic", purpose: "people", companyDomain: "instruments.example.com", companyName: "Example Instruments", budget: { maxPages: 2, maxDomains: 1, maxMinutes: 10, maxModelCalls: 2 } } });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.progress.at(-1)).toMatchObject({ status: "complete", pages: 2, modelCalls: 1 });
  const read = JSON.parse(await instance.waitForStepResult({ name: "lookahead-read-2-admitted-0" }) as string);
  expect(read.value.page.url).toBe("https://instruments.example.com/leadership");
  const permits = t.callbacks.filter(callback => callback.action === "browser-permit");
  expect(new Set(permits.map(permit => permit.token)).size).toBe(permits.length);
  expect(t.timings.flatMap(batch => batch.spans).some(span => span.step === "lookahead-read-2-admitted-0" && span.outcome === "succeeded")).toBe(true);
});

it("runs a Firmable refresh as bounded, resumable callback steps", async () => {
  const id = crypto.randomUUID();
  const mandateId = crypto.randomUUID();
  const actions: Array<{ action: string; offset?: number }> = [];
  let profileCalls = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== `http://127.0.0.1:3010/api/firmable/internal/${id}`) throw new Error(`Unmocked request: ${url}`);
    const body = JSON.parse(String(init?.body)) as { action: string; offset?: number };
    actions.push(body);
    if (body.action === "company") return Response.json({ companyId: "firmable-company" });
    if (body.action === "people-page") return Response.json({ complete: true, nextOffset: 100, found: 7 });
    if (body.action === "finalize-search") return Response.json({ found: 7, nextOffset: 7, complete: true });
    if (body.action === "profiles") {
      profileCalls++;
      if (profileCalls === 1) return new Response("Temporary failure", { status: 503 });
      const nextOffset = Math.min((body.offset || 0) + 5, 7);
      return Response.json({ nextOffset, complete: nextOffset >= 7 });
    }
    if (body.action === "complete") return Response.json({ found: 7, saved: 7, failed: 0 });
    return Response.json({ ok: true });
  });
  await using instance = await introspectWorkflowInstance(bindings.FIRMABLE, id);
  await instance.modify(m => m.disableSleeps());
  const response = await worker.fetch(new Request(`http://worker/firmable/${id}`, {
    method: "POST",
    headers: { authorization: "Bearer replay-only", "Content-Type": "application/json" },
    body: JSON.stringify({ mandateId }),
  }), bindings);
  expect(response.status).toBe(202);
  await instance.waitForStatus("complete");
  expect(actions.map(action => `${action.action}:${action.offset ?? ""}`)).toEqual([
    "company:",
    "people-page:0",
    "finalize-search:0",
    "profiles:0",
    "profiles:0",
    "profiles:5",
    "complete:",
  ]);
  expect(JSON.parse(await instance.waitForStepResult({ name: "complete" }) as string)).toEqual({ found: 7, saved: 7, failed: 0 });
});

it("records failure and stops after a later Firmable people page exhausts retries", async () => {
  const id = crypto.randomUUID();
  const mandateId = crypto.randomUUID();
  const actions: Array<{ action: string; offset?: number }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url !== `http://127.0.0.1:3010/api/firmable/internal/${id}`) throw new Error(`Unmocked request: ${url}`);
    const body = JSON.parse(String(init?.body)) as { action: string; offset?: number };
    actions.push(body);
    if (body.action === "company") return Response.json({ companyId: "firmable-company" });
    if (body.action === "people-page" && body.offset === 0) return Response.json({ complete: false, nextOffset: 100, found: 100 });
    if (body.action === "people-page") return new Response("Temporary failure", { status: 503 });
    if (body.action === "fail") return Response.json({ ok: true });
    throw new Error(`Unexpected Firmable action: ${body.action}`);
  });
  await using instance = await introspectWorkflowInstance(bindings.FIRMABLE, id);
  await instance.modify(m => m.disableSleeps());
  await bindings.FIRMABLE.create({ id, params: { runId: id, mandateId } });
  await instance.waitForStatus("complete");
  expect(actions.filter(action => action.action === "people-page" && action.offset === 100)).toHaveLength(3);
  expect(actions.at(-1)?.action).toBe("fail");
  expect(actions.some(action => ["finalize-search", "profiles", "complete"].includes(action.action))).toBe(false);
}, 45_000);


it("piggybacks acknowledged timing batches on progress throughout a real Workflow", async () => {
  const t = replay();
  t.config.performanceFlags = { telemetryBatching: true, progressCoalescing: true };
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await worker.fetch(new Request(`http://worker/jobs/${t.id}`, {
    method: "POST", headers: { authorization: "Bearer replay-only" },
  }), bindings);
  await instance.waitForStatus("complete");
  const progressBatches = t.callbacks.filter(c => c.timingSpans) as { timingSpans: { id: string }[] }[];
  expect(progressBatches.length).toBeGreaterThanOrEqual(3);
  const ids = progressBatches.flatMap(batch => batch.timingSpans.map(span => span.id));
  expect(new Set(ids).size).toBe(ids.length);
  // Only spans finished after the last progress callback use final delivery.
  expect(t.timings).toHaveLength(1);
  expect(t.timings.flatMap(batch => batch.spans).every(span => span.step.startsWith('progress-'))).toBe(true);
  expect(t.progress.some(e => e.page?.markdown === markdown)).toBe(true);
  expect(t.progress.at(-1)?.status).toBe('complete');
});


it("refreshes lean controls during real Workflow reads while retaining execution configuration and batching flags", async () => {
  const t = replay({ leanControls: true });
  t.config.performanceFlags = { telemetryBatching: true, progressCoalescing: true };
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus("complete");
  expect(t.requests.some(url => url.endsWith('?control=1'))).toBe(true);
  expect(t.progress.at(-1)).toMatchObject({ status: 'complete', pages: 1, modelCalls: 1 });
  expect(t.callbacks.filter(c => c.timingSpans)).toHaveLength(3);
  expect(t.timings).toHaveLength(1);
});


it('correlates real Workflow control and progress callbacks with app/database response durations', async () => {
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  const t=replay({callbackTiming:true});
  await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);
  await instance.modify(m=>m.disableSleeps());
  await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});
  await instance.waitForStatus('complete');
  for(const request of t.callbackHeaders) expect(request.headers.get('x-request-id')).toMatch(/^[a-f0-9-]{36}$/);
  const events=log.mock.calls.filter(([prefix])=>prefix==='research-provider').map(([,value])=>JSON.parse(String(value)));
  for(const action of ['control','progress']) {
    const header=t.callbackHeaders.find(request=>request.action===action)!.headers.get('x-request-id');
    expect(events).toContainEqual(expect.objectContaining({provider:'research-worker',operation:`callback_${action}`,jobId:t.id,requestId:header,event:'request_completed',responseServerTiming:{appMs:12.5,dbMs:4},databaseCalls:2}));
  }
  expect(t.requests.filter(url=>url.endsWith('/crawl'))).toHaveLength(1);
});


it('checkpoints a website sitemap fanout in a real Workflow and reads only the homepage', async () => {
  // Public page caching spans runs; each fixture website needs its own identity.
  const domain = `sitemap-${crypto.randomUUID()}.example.com`;
  const t = replay({ read: url => url.endsWith('/robots.txt') ? `Sitemap: https://${domain}/sitemap.xml` : url.endsWith('.xml') ? `<urlset><url><loc>https://${domain}/team</loc></url><url><loc>https://${domain}/contact</loc></url></urlset>` : markdown });
  Object.assign(t.config, { seeds: [`https://${domain}/`], researchTask: 'website', parallelBusinessResearch: true, discoveryCandidate: true, workflow: 'business', companyName: 'Example Instruments', companyDomain: domain });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus('complete');
  expect(t.callbacks.filter(c => c.action === 'website-pages')).toEqual([expect.objectContaining({ urls: expect.arrayContaining([`https://${domain}/team`, `https://${domain}/contact`]) })]);
  expect(t.progress.at(-1)?.pages).toBe(1);
  const fanout = JSON.parse(await instance.waitForStepResult({ name: 'fanout-pages-1' }) as string);
  expect(fanout).toBeNull();
});
it('runs and checkpoints the independent ABN branch with the registry record parameter intact', async () => {
  const registry = 'https://abr.business.gov.au/ABN/View?abn=56663118241';
  const reads: string[] = [];
  const t = replay({ targetedSeeds: [registry], read: url => { reads.push(url); return '# Current details for ABN 56 663 118 241\nEntity name: FIRE CENTRAL PTY LTD\nMain business location: VIC 3053'; } });
  Object.assign(t.config, { mode: 'automatic', purpose: 'firmographics', researchTask: 'field', researchField: 'abn', targetedFollowup: true, companyName: 'Fire Central Pty Ltd', companyDomain: 'firecentral.com.au', companyLocation: 'VIC', seeds: [], budget: { maxPages: 3, maxDomains: 3, maxMinutes: 10, maxModelCalls: 0 } });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus('complete');
  expect(t.callbacks).toContainEqual(expect.objectContaining({ action: 'targeted-followup', field: 'abn' }));
  expect(reads).toEqual([registry]);
  expect(t.progress.flatMap(p => p.page?.findings || [])).toContainEqual(expect.objectContaining({ name: 'ABN', value: '56663118241' }));
  expect(t.progress.at(-1)).toMatchObject({ status: 'complete', pages: 1, modelCalls: 0 });
});
