import { providerStep, type Admission } from "./provider-step";
import type { ResearchProvider } from "../../src/domain/research-provider-queue";
import { productionPolicy, researchFetch } from "./local-policy";
import { browserMarkdown } from "./browser-reader";
import { cachedPage, lookupCachedPage } from "./page-cache";
import { providerFailure, BrowserAdmissionDeferred } from "../../src/domain/research-provider-error";
import { localRead } from "./local-reader";
import { localSearch } from "./local-search";
import { providerJsonRequest } from "../../src/adapters/observability/provider-request";
import { researchExtractionRequest } from "../../src/domain/research-extraction-schema";
import { FreeOpenRouter } from "../../src/adapters/ai/free-openrouter";
import { callbackOrigin } from "./callback-origin";
import { cancelCrawl, crawlRetryUrl, CrawlerRequestError, requestBudgetStop, stalledResearch } from "./runtime-policy";
import { targetedPrompt, targetedSchema } from "../../src/domain/targeted-research";
import { readFallback } from "./fallback";
import { searchResults } from "../../src/domain/cloudflare-search";
import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  runResearch,
  type ResearchControl,
} from "../../src/domain/research-runner";
import {
  publicResearchUrl,
  parseResearchExtraction,
} from "../../src/domain/research";
interface Env {
  RESEARCH: Workflow;
  OPENROUTER_API_KEY: string;
  SERVICE_SECRET: string;
  APP_ORIGIN: string;
  LOCAL_DEVELOPMENT?: string;
  LOCAL_RESEARCH_POLICY?: string;
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_TOKEN?: string;
  LOCAL_CRAWL4AI_URL?: string;
  LOCAL_SEARCH_URL?: string;
  CRAWL4AI_URL?: string;
  CRAWL4AI_SECRET?: string;
}
async function authorized(request: Request, secret: string) {
  if (!secret) return false;
  const digest = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([
    digest(request.headers.get("authorization") || ""),
    digest(`Bearer ${secret}`),
  ]);
  const x = new Uint8Array(a),
    y = new Uint8Array(b);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i];
  return difference === 0;
}
async function callback(env: Env, id: string, body?: unknown, budget?: { used: number; jobId?: string }) {
  const origin = callbackOrigin(env.APP_ORIGIN, env.LOCAL_DEVELOPMENT === "true");
  if (budget) budget.used++;
  const r = await researchFetch(env)(`${origin}/api/research/internal/${id}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${env.SERVICE_SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout((body as { action?: string } | undefined)?.action === "browser-permit" ? 5000 : body ? 55000 : 10000),
  });
  if (!r.ok) throw new Error(`Callback failed (${r.status})`);
  return r.json();
}
async function browser(env: Env, path: string, method = "GET", body?: unknown, budget?: { used: number; jobId?: string }) {
  if (env.LOCAL_DEVELOPMENT === "true") throw new Error("Cloudflare browser API is disabled in local development");
  if (budget) budget.used++;
  const { response: r, data } = await providerJsonRequest<{ success: boolean; result: unknown }>(fetch,
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/crawl${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${env.CF_BROWSER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    }, { provider: "cloudflare-browser", operation: `crawl_${method.toLowerCase()}`, jobId: budget?.jobId },
  );
  if (!r.ok || !data.success)
    throw new CrawlerRequestError(r.status);
  return data.result;
}
async function readMarkdown(env: Env, url: string, budget: { used: number; jobId?: string }, fallback = false, reservation?: string) {
  if (!publicResearchUrl(url)) throw new Error("Unsupported URL");
  if (!productionPolicy(env)) {
    // The local reader is shared by concurrent jobs; a transient failure gets one retry.
    try { return await localRead(env, url, { jobId: budget.jobId }, researchFetch(env)); }
    catch { await new Promise(resolve => setTimeout(resolve, 4000)); return localRead(env, url, { jobId: budget.jobId }, researchFetch(env)); }
  }
  const markdown = await browserMarkdown(env, url, {
    jobId: budget.jobId, operation: fallback ? "markdown_fallback" : "markdown",
    onRequest: () => { budget.used++; },
    permit: () => callback(env, budget.jobId!, { action: "browser-permit", token: reservation }) as Promise<{ granted: boolean; retryAfterMs: number }>,
  });
  return { status: "completed", page: { url, markdown: markdown.slice(0, 30000), observedAt: new Date().toISOString() } };
}
export class AcquireResearch extends WorkflowEntrypoint<
  Env,
  { jobId: string }
> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    const id = event.payload.jobId;
    // Leave room for cancellation and final progress below the free-plan limit of 50 external requests.
    const requestBudget = { used: 0, jobId: id };
    let stateCache: { value: ResearchControl; at: number } | undefined;
    let browserReservation: string | undefined;
    const control = async () => {
      // Adjacent goal, page and extraction guards reuse a freshly checked state.
      // After network work or durable waiting, cancellation is checked again.
      if (!stateCache || Date.now() - stateCache.at >= 1000) stateCache = { value: await callback(this.env, id, undefined, requestBudget) as ResearchControl, at: Date.now() };
      const stopReason = requestBudgetStop(requestBudget.used, !productionPolicy(this.env));
      return stopReason ? { ...stateCache.value, deadline: 0, stopReason } : stateCache.value;
    };
    const checkpoint = async <T>(name: string, run: () => Promise<T>, retry = true): Promise<T> => {
      const serialized = await step.do(name, { retries: { limit: retry ? 2 : 0, delay: "12 seconds", backoff: "exponential" }, timeout: "120 seconds" }, async () => JSON.stringify(await run()) ?? "null");
      return JSON.parse(serialized) as T;
    };
    const ai = new FreeOpenRouter({
      apiKey: this.env.OPENROUTER_API_KEY,
      fetch: researchFetch(this.env),
      jobId: id,
      onRequest: () => { requestBudget.used++; },
      onUsage: usage => console.info("research-ai", JSON.stringify({ jobId: id, ...usage })),
    });
    return runResearch(
      {
        // Persist JSON values explicitly across Workflow step checkpoints.
        do: async <T>(
          name: string,
          run: () => Promise<T>,
          retry = true,
        ): Promise<T> => {
          const config = stateCache?.value.config;
          const provider: ResearchProvider | undefined = /^read-people-/.test(name) ? 'page'
            : /^(extract-|company-identity-|headcount-|targeted-plan$)/.test(name) ? 'ai'
            : /^(targeted-search-|people-followup$)/.test(name) || (/^discover(?:-\d+)?$/.test(name) && config?.discover && !config.targetedFollowup) ? 'search' : undefined;
          if (!provider) return checkpoint(name, run, retry);
          const exhausted = requestBudgetStop(requestBudget.used, !productionPolicy(this.env));
          if (exhausted) throw new BrowserAdmissionDeferred(exhausted);
          return providerStep({ do: checkpoint, sleep: (label, ms) => step.sleep(label, ms) }, name, provider,
            token => callback(this.env, id, { action: "provider-reserve", provider, token: `${id}:${token}` }, requestBudget) as Promise<Admission>,
            async token => {
              const current = await control();
              if (["cancelled", "complete", "partial", "failed"].includes(current.status) || Date.now() >= current.deadline) throw new BrowserAdmissionDeferred();
              browserReservation = provider === 'ai' ? undefined : token;
              try { return await run(); } finally { browserReservation = undefined; }
            });
        },
        sleep: (name, ms) => step.sleep(name, ms),
      },
      {
        diagnostic: event => console.info("research-diagnostic", JSON.stringify({ ...event, timestamp: new Date().toISOString(), jobId: id })),
        control,
        discover: () =>
          callback(this.env, id, { action: "discover", browserReservation }, requestBudget) as Promise<{
            seeds: string[];
            warning?: string;
          }>,
        progress: async (event) => {
          const response = await callback(this.env, id, event, requestBudget) as { control?: ResearchControl };
          stateCache = response.control ? { value: { ...response.control, findings: stateCache?.value.findings }, at: Date.now() } : undefined;
          console.info("research-progress", JSON.stringify({ timestamp: new Date().toISOString(), jobId: id, status: event.status, revision: event.revision, pages: event.pages, modelCalls: event.modelCalls, savedPageFindings: event.page?.findings.length, remainingUrls: event.runtime?.remaining.length }));
        },
        cachedPage: async (url) => !productionPolicy(this.env) ? null : lookupCachedPage(caches.default, stateCache?.value.config.researchRunId || id, url),
        readPeoplePage: (url) => readMarkdown(this.env, url, requestBudget, false, browserReservation),
        // Every page read is one synchronous request. The asynchronous crawl job needed a submit
        // plus repeated polls, and a queued crawl could consume an instance's whole request budget
        // before its first page arrived; the crawl path remains only as the fallback below.
        readPage: async (url: string) => {
          const state = await control();
          const read = () => readMarkdown(this.env, url, requestBudget, false, browserReservation);
          return !productionPolicy(this.env) ? read() : cachedPage(caches.default, state.config.researchRunId || id, url, read);
        },
        ...(this.env.LOCAL_DEVELOPMENT !== "true" && this.env.CRAWL4AI_URL ? { readFallbackPage: async (url: string) => {
          requestBudget.used++;
          return readFallback(url, this.env.CRAWL4AI_URL!, this.env.CRAWL4AI_SECRET || "");
        } } : {}),
        submit: async (url) => {
          if (!publicResearchUrl(url)) throw new Error("Unsupported URL");
          return (await browser(this.env, "", "POST", {
            url,
            limit: 1,
            depth: 1,
            formats: ["markdown"],
            render: true,
            maxAge: 86400,
            source: "links",
            crawlPurposes: ["search", "ai-input"],
            gotoOptions: { waitUntil: "networkidle2", timeout: 30000 },
          }, requestBudget)) as string;
        },
        poll: async (crawlId) => {
          const data = (await browser(this.env, `/${crawlId}`, "GET", undefined, requestBudget)) as {
            status: string;
            records?: {
              url: string;
              status: string;
              markdown?: string;
              metadata?: { status?: number; title?: string };
            }[];
          };
          const record = data.records?.find(
            (r) => r.status === "completed" && r.markdown,
          );
          // A 422 crawl navigation failure may still be readable by the direct
          // reader. Do not retry disallowed/skipped pages or access denials.
          const retryUrl = !record && data.status !== "running" ? crawlRetryUrl(data.records || []) : undefined;
          let fallbackFailed = false;
          if (retryUrl) {
            try {
              const result = await readMarkdown(this.env, retryUrl, requestBudget, true);
              console.info("research-reader", JSON.stringify({ jobId: id, fallback: "markdown", reason: "crawl_http_422" }));
              return result;
            } catch { fallbackFailed = true; }
          }
          return {
            status: data.status,
            ...(record
              ? {
                  page: {
                    url: record.url,
                    markdown: record.markdown!.slice(0, 30000),
                    title: record.metadata?.title,
                  },
                }
              : {}),
            warning: record
              ? undefined
              : `Crawler ${data.records?.[0]?.status || data.status}; HTTP ${data.records?.[0]?.metadata?.status || "not reported"}${data.records?.[0]?.status === "completed" ? "; no extractable content" : ""}${fallbackFailed ? "; direct page reader also failed" : ""}`,
          };
        },
        cancel: async (crawlId) => {
          await cancelCrawl(crawlId, (path, method) => browser(this.env, path, method, undefined, requestBudget));
        },
        extract: async (messages) => {
          const output = await ai.complete(researchExtractionRequest(messages));
          return parseResearchExtraction(output);
        },
        extractHeadcount: async (messages) => {
          const output = await ai.complete({
            messages, operation: "headcount_extraction", max_tokens: 300, reasoning_effort: "none", temperature: 0,
            response_format: { type: "json_schema", json_schema: {
              type: "object", properties: { value: { type: ["string", "null"] }, quote: { type: ["string", "null"] } },
              required: ["value", "quote"], additionalProperties: false,
            } },
          });
          const result = output as { response?: unknown };
          return typeof result.response === "string" ? JSON.parse(result.response) : result.response ?? output;
        },
        planFollowup: async (plan) => {
          const output = await ai.complete({
            messages: targetedPrompt(plan), operation: "followup_planning", max_tokens: 100, reasoning_effort: "none", temperature: 0,
            response_format: { type: "json_schema", json_schema: targetedSchema(plan) },
          }) as { response?: unknown };
          return typeof output.response === "string" ? JSON.parse(output.response) : output.response;
        },
        targetedSearch: (field) => callback(this.env, id, { action: "targeted-followup", field, browserReservation }, requestBudget) as Promise<{ seeds: string[]; warning?: string }>,
        peopleFollowup: () => callback(this.env, id, { action: "people-followup", browserReservation }, requestBudget) as Promise<{ seeds: string[]; warning?: string }>,
        now: () => Date.now(),
      },
    ).finally(() => {
      console.info("research-runtime", JSON.stringify({ jobId: id, requests: requestBudget.used, local: this.env.LOCAL_DEVELOPMENT === "true" }));
    });
  }
}
const worker = {
  async fetch(request: Request, env: Env) {
    if (!(await authorized(request, env.SERVICE_SECRET)))
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (new URL(request.url).pathname === "/search" && request.method === "POST") {
      const body = await request.json().catch(() => null) as { query?: unknown; page?: unknown; engine?: unknown } | null;
      if (typeof body?.query !== "string" || body.query.trim().length < 2 || body.query.length > 500)
        return Response.json({ error: "Invalid search" }, { status: 400 });
      // Deeper result pages are available from the local search container only.
      const page = typeof body.page === "number" && Number.isInteger(body.page) && body.page >= 1 && body.page <= 3 ? body.page : 1;
      if ((page > 1 || body.engine && body.engine !== "duckduckgo") && productionPolicy(env)) return Response.json({ error: "Production search supports DuckDuckGo page 1 only", category: "unsupported_search" }, { status: 422 });
      try {
        if (!productionPolicy(env)) {
          const ids = {
            requestId: /^[0-9a-f-]{36}$/i.test(request.headers.get("x-research-request-id") || "") ? request.headers.get("x-research-request-id")! : undefined,
            jobId: /^[0-9a-f-]{36}$/i.test(request.headers.get("x-research-job-id") || "") ? request.headers.get("x-research-job-id")! : undefined,
          };
          // OpenSERP returns full snippets; fall back to the rendered HTML endpoint when it is unavailable.
          try {
            const local = await localSearch(env, body.query, { ...ids, start: (page - 1) * 10, engine: body.engine === "google" ? "google" : undefined }, researchFetch(env));
            if (local) return Response.json({ seeds: local.map(r => r.url).slice(0, 6), results: local });
          } catch (error) { console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), ...ids, event: "local_search_fallback", reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" })); }
          if (page > 1 || body.engine === "google") return Response.json({ error: "Requested search backend unavailable", category: "unsupported_search" }, { status: 502 });
          const result = await localRead(env, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(body.query)}`, {
            operation: "web_search",
            requestId: /^[0-9a-f-]{36}$/i.test(request.headers.get("x-research-request-id") || "") ? request.headers.get("x-research-request-id")! : undefined,
            jobId: /^[0-9a-f-]{36}$/i.test(request.headers.get("x-research-job-id") || "") ? request.headers.get("x-research-job-id")! : undefined,
          }, researchFetch(env));
          const results = searchResults(result.page.markdown);
          if (!results.length && !/no results found|no more results/i.test(result.page.markdown)) return Response.json({ error: "Local search could not be read" }, { status: 502 });
          return Response.json({ seeds: results.map(r => r.url).slice(0, 6), results });
        }
        const jobId = request.headers.get("x-research-job-id") || "";
        if (!/^[0-9a-f-]{36}$/i.test(jobId)) return Response.json({ error: "A research job is required for rate-controlled search" }, { status: 400 });
        const markdown = await browserMarkdown(env, `https://html.duckduckgo.com/html/?q=${encodeURIComponent(body.query)}`, {
          jobId, operation: "web_search",
          permit: () => callback(env, jobId, { action: "browser-permit", token: request.headers.get("x-research-browser-reservation") }) as Promise<{ granted: boolean; retryAfterMs: number }>,
        });
        const results = searchResults(markdown);
        const seeds = results.map(r => r.url).slice(0, 6);
        if (!seeds.length && !/no results found|no more results/i.test(markdown)) throw new Error("Search could not be read");
        return Response.json({ seeds, results });
      } catch (error) { const failure = providerFailure(error); return Response.json({ error: failure.message, category: failure.category }, { status: failure.status >= 400 ? failure.status : 502 }); }
    }
    const match = new URL(request.url).pathname.match(
      /^\/jobs\/([0-9a-f-]{36})$/i,
    );
    if (!match) return Response.json({ error: "Not found" }, { status: 404 });
    const id = match[1];
    if (request.method === "POST") {
      const payload = await request.json().catch(() => null) as { action?: string } | null;
      if (payload?.action === "recover-stalled") {
        const state = await callback(env, id) as { status: string; updatedAt?: string };
        if (!stalledResearch(state)) return Response.json({ recovered: false });
        await (await env.RESEARCH.get(id)).terminate();
        console.info("research-diagnostic", JSON.stringify({ event: "stalled_workflow_terminated", jobId: id, lastProgress: state.updatedAt }));
        return Response.json({ recovered: true });
      }
      // Named instances and createBatch make re-dispatch idempotent.
      await env.RESEARCH.createBatch([{ id, params: { jobId: id } }]);
      return Response.json({ id }, { status: 202 });
    }
    if (request.method === "DELETE") {
      const state = (await callback(env, id)) as ResearchControl & {
        crawlId?: string;
      };
      if (state.status !== "cancelled")
        return Response.json(
          { error: "Cancel the saved job first" },
          { status: 409 },
        );
      if (state.crawlId && env.LOCAL_DEVELOPMENT !== "true") await cancelCrawl(state.crawlId, (path, method) => browser(env, path, method));
      // Keep the workflow alive long enough to observe cancellation and clean up a racing submission.
      return Response.json({ ok: true });
    }
    if (request.method === "GET")
      return Response.json(await (await env.RESEARCH.get(id)).status());
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  },
};

export default worker;
