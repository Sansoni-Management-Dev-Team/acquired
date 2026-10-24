import { env } from "cloudflare:workers";
import { introspectWorkflowInstance } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import worker from "../index";
import type { ResearchConfig } from "../../../src/domain/research";
import type { ResearchServices } from "../../../src/domain/research-runner";
import { automaticContinuation } from "../../../src/domain/research-continuation";
import { researchFetch } from "../local-policy";
import {buildAllDiscoveredCompanyPolicy,buildAllDiscoveredCompanyPeoplePolicy,buildCompanyDiscoveryPolicy,reviewedCompanyDiscoveryPolicy} from '../../../src/domain/research-discovery-policy';

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

function replay(options: { searchReservationDelayMs?: number; read?: (url: string) => string; targetedSeeds?: string[]; pages?: number; cancelled?: boolean; failProgress?: boolean; denyPermit?: boolean; expireFirstPermit?: boolean; parallelDiscoveryGate?: boolean; lookaheadGate?: boolean; leanControls?: boolean; callbackTiming?: boolean; config?: ResearchConfig } = {}) {
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
  const callbackTimes: { action: string; at: number }[] = [];
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
      callbackTimes.push({ action: data.action, at: Date.now() });
      if(data.action==='company-background-research'){status='complete';return Response.json({ok:true,saved:true});}
      if(data.action==='e-plan')return Response.json([{query:'cleaning Australia',page:1}]);
      if(data.action==='e-search')return Response.json({ok:true,rows:[{domain:'instruments.example.com',name:'Example Instruments',website:'https://instruments.example.com',discovery:{url:'https://instruments.example.com',title:'Example Instruments',snippet:'cleaning services'}}]});
      if(data.action==='e-company')return Response.json({ok:true,matched:true});
      if(data.action==='e-finish'){status='complete';return Response.json({ok:true});}
      if(data.action==='d-search')return Response.json({records:[{id:'f000000000001',name:'Example Instruments',website:'https://instruments.example.com'}],totalCompany:1,predictedFilters:{filters:{},operators:{},excluded:{}}});
      if(data.action==='d-company')return Response.json({ok:true,matched:true});
      if(data.action==='f-finish'){status='complete';return Response.json({ok:true});}
      if(data.action==='d-finish'){status='complete';return Response.json({ok:true});}
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
      if (data.action === "provider-reserve") return Response.json({ granted: !options.denyPermit, retryAfterMs: 0, after: Date.now() + (options.searchReservationDelayMs || 0), until: Date.now() + (options.searchReservationDelayMs || 0) + 2000, token: data.token });
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
  return { id, config, progress, requests, callbacks, timings, callbackHeaders, callbackTimes };
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

it('routes a snapshotted D root without changing the Worker environment design',async()=>{const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'firmable-v1',researchRunId:t.id,automaticDeadline:Date.now()+600000});await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');expect(t.callbacks.filter(c=>c.action==='d-search')).toHaveLength(1);expect(t.callbacks.filter(c=>c.action==='d-company')).toHaveLength(1);expect(t.callbacks).toContainEqual(expect.objectContaining({action:'d-finish',result:expect.objectContaining({saved:1,failed:0})}));expect(t.requests.some(url=>url.endsWith('/crawl'))).toBe(false);});

it('runs E web discovery with a browser reservation then company-only enrichment',async()=>{const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'web-firmable-v1',researchRunId:t.id,automaticDeadline:Date.now()+600000});await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');expect(t.callbacks).toContainEqual(expect.objectContaining({action:'e-search',browserReservation:`${t.id}:e-search-0-0`}));expect(t.callbacks.filter(c=>c.action==='e-company')).toHaveLength(1);expect(t.callbacks).toContainEqual(expect.objectContaining({action:'e-finish',result:expect.objectContaining({saved:1,matched:1,failed:0})}));expect(t.callbacks.some(c=>c.action==='d-search')).toBe(false);expect(t.timings.length).toBeGreaterThan(0);});

it('runs F discovery branches and deduplicates their shared company in a real Workflow',async()=>{const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'hybrid-firmable-v1',researchRunId:t.id,automaticDeadline:Date.now()+600000});await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');expect(t.callbacks.filter(c=>c.action==='d-search')).toHaveLength(1);expect(t.callbacks.filter(c=>c.action==='e-search')).toHaveLength(1);expect(t.callbacks.filter(c=>['d-company','e-company'].includes(String(c.action)))).toHaveLength(1);expect(t.callbacks).toContainEqual(expect.objectContaining({action:'f-finish',result:expect.objectContaining({saved:1,failed:0,overlap:1,selection:[expect.objectContaining({sources:['firmable','web']})]})}));});
it('loads server-verified continuation candidates in a fresh Workflow and performs profiling without discovery',async()=>{
 const t=replay(),sourceRootId=crypto.randomUUID(),sourceDigest='a'.repeat(64),firmableRow={id:'f222',name:'Original no-website company'},webRow={domain:'continued.example.com',name:'Original web company',website:'https://continued.example.com',discovery:{url:'https://continued.example.com',title:'Original web company',snippet:'Synthetic company source'}};
 Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'hybrid-firmable-v1',researchRunId:t.id,automaticDeadline:Date.now()+600000,companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy(),nativeAgent:{version:1},companyContinuation:{version:1,sourceRootId,sourceDigest,candidateKeys:['firmable:f222','domain:continued.example.com']}});
 const original=vi.mocked(globalThis.fetch).getMockImplementation()!;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const url=String(input instanceof Request?input.url:input);if(url.endsWith(`/api/research/internal/${t.id}`)&&init?.body){const p=JSON.parse(String(init.body));if(p.action==='f-continuation-plan'){t.callbacks.push(p);return Response.json({version:1,sourceRootId,sourceDigest,candidates:[{candidateKey:'firmable:f222',domain:'',sources:['firmable'],firmableRow},{candidateKey:'domain:continued.example.com',domain:'continued.example.com',sources:['web'],webRow}]});}}return original(input,init);});
 await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');
 expect(t.callbacks.filter(c=>c.action==='f-continuation-plan')).toHaveLength(1);expect(t.callbacks.some(c=>['e-plan','d-search','e-search','provider-reserve'].includes(String(c.action)))).toBe(false);expect(t.callbacks.filter(c=>['d-company','e-company'].includes(String(c.action)))).toEqual([expect.objectContaining({action:'d-company',row:firmableRow,candidateKey:'firmable:f222',expectedDomain:'',sources:['firmable']}),expect.objectContaining({action:'e-company',row:webRow,candidateKey:'domain:continued.example.com',expectedDomain:'continued.example.com',sources:['web']})]);expect(t.callbacks).toContainEqual(expect.objectContaining({action:'f-finish',result:expect.objectContaining({saved:2,searches:0,continuation:{version:1,sourceRootId,sourceDigest}})}));
 expect(JSON.parse(await instance.waitForStepResult({name:'f-continuation-plan'}) as string)).toMatchObject({sourceRootId,sourceDigest});expect(JSON.parse(await instance.waitForStepResult({name:'f-company-firmable:f222'}) as string)).toMatchObject({ok:true});expect(t.requests.some(url=>url.endsWith('/crawl'))).toBe(false);
});
it('sends the V5 candidate identity required by the app for both discovery sources',async()=>{
 const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'hybrid-firmable-v1',researchRunId:t.id,automaticDeadline:Date.now()+600000,companyIdentityPolicyVersion:1,companyDiscoveryPolicy:buildAllDiscoveredCompanyPeoplePolicy(),includeCompanyPeople:true,includePhones:false,findPeople:false});
 const original=vi.mocked(globalThis.fetch).getMockImplementation()!;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.endsWith(`/api/research/internal/${t.id}`)&&init?.body){
   const p=JSON.parse(String(init.body));
   if(p.action==='e-search')return Response.json({ok:true,rows:[{domain:'web-only.example.com',name:'Web company',website:'https://web-only.example.com'}]});
   if(['d-company','e-company'].includes(p.action)){
    const expected=p.action==='d-company'?`firmable:${p.row.id}`:`domain:${p.row.domain}`;
    if(p.candidateKey!==expected)return Response.json({error:'Company candidate identity differs from discovery'},{status:500});
   }
  }
  return original(input,init);
 });
 await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');
 expect(t.callbacks.filter(c=>['d-company','e-company'].includes(String(c.action)))).toEqual(expect.arrayContaining([expect.objectContaining({action:'d-company',candidateKey:'firmable:f000000000001'}),expect.objectContaining({action:'e-company',candidateKey:'domain:web-only.example.com'})]));
 expect(t.callbacks).toContainEqual(expect.objectContaining({action:'f-finish',result:expect.objectContaining({saved:2,failed:0})}));
 expect(t.callbacks.some(c=>c.action==='f-fail')).toBe(false);
});

it.each([2,3,4])('uses first-pass supplemental web queries only for V4, preserving V%s retry behavior',async version=>{
 const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'hybrid-firmable-v1',researchRunId:t.id,automaticDeadline:Date.now()+600000,companyDiscoveryPolicy:version===4?buildAllDiscoveredCompanyPolicy():version===3?buildCompanyDiscoveryPolicy():reviewedCompanyDiscoveryPolicy,...(version===2?{nativeAgent:{version:1}}:{})});
 const original=vi.mocked(globalThis.fetch).getMockImplementation()!,searches:Record<string,unknown>[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const url=String(input instanceof Request?input.url:input);if(url.endsWith(`/api/research/internal/${t.id}`)&&init?.body){const p=JSON.parse(String(init.body));if(p.action==='e-plan')return Response.json([{query:'first query',page:1},{query:'second query',page:1}]);if(p.action==='e-search'){searches.push(p);return Response.json({rows:[],ok:false,category:'page_unavailable'});}}return original(input,init);});
 await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');
 expect(searches.map(p=>p.browserReservation)).toEqual(version===4?[`${t.id}:f-search-0-0`,`${t.id}:f-search-1-0`]:[0,1].flatMap(index=>[0,1,2].map(attempt=>`${t.id}:f-search-${index}-${attempt}`)));expect(t.callbacks).toContainEqual(expect.objectContaining({action:'f-finish',result:expect.objectContaining({saved:1,searchFailed:2})}));
});
it('finishes V4 with honest web budget coverage after five reader admissions while retaining company saves',async()=>{
 const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'hybrid-firmable-v1',researchRunId:t.id,automaticDeadline:Date.now()+600000,companyDiscoveryPolicy:buildAllDiscoveredCompanyPolicy()});
 const original=vi.mocked(globalThis.fetch).getMockImplementation()!,searches:Record<string,unknown>[]=[];let readerAdmissions=0;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const url=String(input instanceof Request?input.url:input);if(url.endsWith(`/api/research/internal/${t.id}`)&&init?.body){const p=JSON.parse(String(init.body));if(p.action==='e-plan')return Response.json(Array.from({length:6},(_,i)=>({query:`distinct query ${i}`,page:1})));if(p.action==='e-search'){searches.push(p);if(readerAdmissions===5)return Response.json({rows:[],ok:false,category:'native_budget_admission_required'});readerAdmissions++;return Response.json({rows:[],ok:true});}}return original(input,init);});
 await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');
 expect(readerAdmissions).toBe(5);expect(searches).toHaveLength(6);expect(searches.every((p,i)=>p.browserReservation===`${t.id}:f-search-${i}-0`)).toBe(true);expect(t.callbacks).toContainEqual(expect.objectContaining({action:'f-finish',result:expect.objectContaining({saved:1,searchFailed:1,stopReason:'web_budget_limited',discoveryCoverage:expect.objectContaining({webQueries:{planned:6,attempted:6,unattempted:0,stopCategory:'native_budget_admission_required'}})})}));expect(t.callbacks.some(p=>p.action==='f-fail')).toBe(false);
});

it('waits for a known Firmable cooldown and resumes the same company with a distinct bounded attempt', async()=>{
 const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'hybrid-firmable-v1',researchRunId:t.id,automaticDeadline:Date.now()+600000});
 const original=vi.mocked(globalThis.fetch).getMockImplementation()!,attempts:{attempt:unknown;at:number}[]=[];
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.endsWith(`/api/research/internal/${t.id}`)&&init?.body){const p=JSON.parse(String(init.body));if(['d-company','e-company'].includes(p.action)){
   attempts.push({attempt:p.firmableAttempt,at:Date.now()});
   if(attempts.length===1)return Response.json({provider:'firmable',category:'rate_limited',retryAfterMs:1000},{status:429,headers:{'Retry-After':'1'}});
  }}return original(input,init);
 });
 await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);
 await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');
 expect(attempts.map(p=>p.attempt)).toEqual([undefined,1]);expect(attempts[1].at-attempts[0].at).toBeGreaterThanOrEqual(990);
 const first=await instance.waitForStepResult({name:'f-company-instruments.example.com'});
 expect(first).toBe('acquire:firmable-cooldown:v1:{"retryAfterMs":1000}');
 expect(t.callbacks).toContainEqual(expect.objectContaining({action:'f-finish',result:expect.objectContaining({saved:1,failed:0})}));
 expect(t.callbacks.some(p=>p.action==='f-fail')).toBe(false);
});

it.each(['web-firmable-v1', 'hybrid-firmable-v1'] as const)('waits durably for future search reservations in %s', async pipelineDesign => {
  const t = replay({ searchReservationDelayMs: 50 });
  Object.assign(t.config, { mode: 'automatic', workflow: 'business', discover: true, pipelineDesign, researchRunId: t.id, automaticDeadline: Date.now() + 600000 });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus('complete');
  const reserved = t.callbackTimes.find(c => c.action === 'provider-reserve')!;
  const searched = t.callbackTimes.find(c => c.action === 'e-search')!;
  expect(searched.at - reserved.at).toBeGreaterThanOrEqual(45);
  expect(t.callbacks).toContainEqual(expect.objectContaining({ action: 'e-search' }));
});
it('finishes company discovery while optional people research remains unsettled', async () => {
 const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',discover:true,pipelineDesign:'hybrid-firmable-v1',includeCompanyPeople:true,researchRunId:t.id,automaticDeadline:Date.now()+600000});
 const original=vi.mocked(globalThis.fetch).getMockImplementation()!;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{if(init?.body&&JSON.parse(String(init.body)).action==='company-people-status')throw Error('Company discovery must not wait for optional people');return original(input,init);});
 await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');
 expect(t.callbacks.filter(c=>c.action==='company-people-status')).toHaveLength(0);expect(t.callbacks.filter(c=>c.action==='f-finish')).toHaveLength(1);expect(t.callbacks.some(c=>c.action==='f-fail')).toBe(false);
});
it('routes durable background company fields to their dedicated callback without discovery or AI',async()=>{
 const t=replay();Object.assign(t.config,{mode:'automatic',workflow:'business',researchTask:'field',purpose:'firmographics',parentJobId:'company-root',companyBackgroundResearch:{version:1,fields:['description','companyPhone'],sourceRootId:'company-root',verifyAbn:false,profileCapturedAt:'2026-10-08T00:00:00Z'}});
 await using instance=await introspectWorkflowInstance(bindings.RESEARCH,t.id);await instance.modify(m=>m.disableSleeps());await bindings.RESEARCH.create({id:t.id,params:{jobId:t.id}});await instance.waitForStatus('complete');
 expect(t.callbacks.filter(c=>c.action==='company-background-research')).toHaveLength(1);expect(t.callbacks.some(c=>['e-search','d-search','discover','targeted-followup'].includes(String(c.action)))).toBe(false);expect(t.requests.some(url=>url.includes('openrouter')||url.endsWith('/crawl'))).toBe(false);
 expect(JSON.parse(await instance.waitForStepResult({name:'company-background-research'}) as string)).toEqual({ok:true,saved:true});
});
it('manual phone enrichment uses the phone branch without discovering people again', async () => {
 const t = replay(); const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
 vi.spyOn(globalThis,'fetch').mockImplementation(async (input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.endsWith(`/api/firmable/internal/${t.id}`)&&init?.body){const data=JSON.parse(String(init.body));t.callbacks.push(data);return Response.json(data.action==='company'?{companyId:'f123',phoneOnly:true}:{complete:true,nextOffset:5,saved:2});}
  return original(input,init);
 });
 await using instance=await introspectWorkflowInstance(bindings.FIRMABLE,t.id);await instance.modify(m=>m.disableSleeps());await bindings.FIRMABLE.create({id:t.id,params:{runId:t.id,mandateId:crypto.randomUUID()}});await instance.waitForStatus('complete');
 expect(t.callbacks.map(c=>c.action)).toEqual(['company','phones']);
});
it('RC-12-integration: retryable application callback failure preserves sanitized origin diagnostics', async () => {
 const t=replay();const original=vi.mocked(globalThis.fetch).getMockImplementation()!;let companyAttempts=0;
 const errors=vi.spyOn(console,'error').mockImplementation(()=>{});
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=String(input instanceof Request?input.url:input);
  if(url.endsWith(`/api/firmable/internal/${t.id}`)&&init?.body){
   const data=JSON.parse(String(init.body));t.callbacks.push(data);
   if(data.action==='company'&&++companyAttempts===1)return Response.json({code:'DATABASE_UNAVAILABLE',error:'private details'},{status:502,headers:{'x-request-id':'fixture-request'}});
   return Response.json(data.action==='company'?{companyId:'fixture-company'}:data.action==='people-page'?{complete:true,nextOffset:100,found:0}:data.action==='finalize-search'?{complete:true,nextOffset:0,found:0}:{found:0,saved:0,failed:0});
  }return original(input,init);
 });
 await using instance=await introspectWorkflowInstance(bindings.FIRMABLE,t.id);await instance.modify(m=>m.disableSleeps());
 await bindings.FIRMABLE.create({id:t.id,params:{runId:t.id,mandateId:crypto.randomUUID()}});await instance.waitForStatus('complete');
 expect(companyAttempts).toBe(2);
 expect(errors).toHaveBeenCalledWith('firmable_callback_failure',expect.objectContaining({origin:'application-callback',action:'company',status:502,requestId:'fixture-request',errorCode:'DATABASE_UNAVAILABLE'}));
 expect(JSON.stringify(errors.mock.calls)).not.toContain('private details');
 expect(t.callbacks.at(-1)?.action).toBe('complete');
},30000);

it('scheduled recovery invokes the authenticated background dispatcher independently of a workflow', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json({ dispatched: 2 });
  });
  await worker.scheduled({} as ScheduledController, bindings);
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe('http://127.0.0.1:3010/api/research/internal/background');
  expect(calls[0].init?.method).toBe('POST');
  expect(new Headers(calls[0].init?.headers).get('authorization')).toBe(`Bearer ${bindings.SERVICE_SECRET}`);
  expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
});
it('scheduled recovery reports dispatcher failures for the next durable retry', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('unavailable', { status: 503 }));
  await expect(worker.scheduled({} as ScheduledController, bindings)).rejects.toThrow('Background research recovery failed (503)');
});
it('does not execute a cancelled background company field job', async () => {
  const t = replay({ cancelled: true });
  Object.assign(t.config, { researchTask: 'field', purpose: 'firmographics', companyBackgroundResearch: { version: 1, fields: ['companyPhone'], sourceRootId: 'root', verifyAbn: false, profileCapturedAt: '2026-10-08T00:00:00Z' } });
  await using instance = await introspectWorkflowInstance(bindings.RESEARCH, t.id);
  await instance.modify(m => m.disableSleeps());
  await bindings.RESEARCH.create({ id: t.id, params: { jobId: t.id } });
  await instance.waitForStatus('complete');
  expect(t.callbacks.some(c => c.action === 'company-background-research')).toBe(false);
  expect(t.requests.some(url => url.includes('openrouter') || url.endsWith('/crawl'))).toBe(false);
});
it('authenticates full-page company proxy before accepting a public URL', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ url: 'https://instruments.example.com', html: '<html>Public company evidence</html>', only_main_content: false }));
  const denied = await worker.fetch(new Request('https://worker.example/company-page', { method: 'POST', body: JSON.stringify({ url: 'https://instruments.example.com' }) }), bindings);
  expect(denied.status).toBe(401); expect(fetcher).not.toHaveBeenCalled();
  const allowed = await worker.fetch(new Request('https://worker.example/company-page', { method: 'POST', headers: { authorization: `Bearer ${bindings.SERVICE_SECRET}` }, body: JSON.stringify({ url: 'https://instruments.example.com' }) }), bindings);
  expect(allowed.status).toBe(200); expect(await allowed.json()).toMatchObject({ html: '<html>Public company evidence</html>', only_main_content: false });
});
