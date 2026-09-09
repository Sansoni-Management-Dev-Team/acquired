import { peopleExtractionSchema } from "../../src/domain/people-research";
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
  AI: Ai;
  SERVICE_SECRET: string;
  APP_ORIGIN: string;
  CF_ACCOUNT_ID: string;
  CF_BROWSER_TOKEN: string;
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
async function callback(env: Env, id: string, body?: unknown, budget?: { used: number }) {
  const origin = new URL(env.APP_ORIGIN);
  if (origin.protocol !== "https:") throw new Error("HTTPS callback required");
  if (budget) budget.used++;
  const r = await fetch(`${origin.origin}/api/research/internal/${id}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${env.SERVICE_SECRET}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(55000),
  });
  if (!r.ok) throw new Error(`Callback failed (${r.status})`);
  return r.json();
}
async function browser(env: Env, path: string, method = "GET", body?: unknown, budget?: { used: number }) {
  if (budget) budget.used++;
  const r = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/crawl${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${env.CF_BROWSER_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    },
  );
  const data = (await r.json()) as { success: boolean; result: unknown };
  if (!r.ok || !data.success)
    throw new Error(`Crawler unavailable (${r.status})`);
  return data.result;
}
export class AcquireResearch extends WorkflowEntrypoint<
  Env,
  { jobId: string }
> {
  async run(event: WorkflowEvent<{ jobId: string }>, step: WorkflowStep) {
    const id = event.payload.jobId;
    // Leave room for cancellation and final progress below the free-plan limit of 50 external requests.
    const requestBudget = { used: 0 };
    return runResearch(
      {
        // Persist JSON values explicitly across Workflow step checkpoints.
        do: async <T>(
          name: string,
          run: () => Promise<T>,
          retry = true,
        ): Promise<T> => {
          const serialized = await step.do(
            name,
            {
              retries: {
                limit: retry ? 2 : 0,
                delay: "12 seconds",
                backoff: "exponential",
              },
              timeout: "60 seconds",
            },
            async () => JSON.stringify(await run()) ?? "null",
          );
          return JSON.parse(serialized) as T;
        },
        sleep: (name, ms) => step.sleep(name, ms),
      },
      {
        control: async () => {
          const state = await callback(this.env, id, undefined, requestBudget) as ResearchControl;
          return requestBudget.used >= 32 ? { ...state, deadline: 0, stopReason: "Worker request budget reached; saved evidence retained. Start another research run to continue." } : state;
        },
        discover: () =>
          callback(this.env, id, { action: "discover" }, requestBudget) as Promise<{
            seeds: string[];
            warning?: string;
          }>,
        progress: async (event) => {
          await callback(this.env, id, event, requestBudget);
        },
        readPeoplePage: async (url) => {
          if (!publicResearchUrl(url)) throw new Error("Unsupported URL");
          requestBudget.used++;
          const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/browser-rendering/markdown`, {
            method: "POST", headers: { authorization: `Bearer ${this.env.CF_BROWSER_TOKEN}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url, gotoOptions: { waitUntil: "networkidle2", timeout: 25000 } }), signal: AbortSignal.timeout(40000),
          });
          const data = await response.json() as { success?: boolean; result?: unknown };
          if (!response.ok || !data.success || typeof data.result !== "string") throw new Error(`Page reader unavailable (${response.status})`);
          return { status: "completed", page: { url, markdown: data.result.slice(0, 30000) } };
        },
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
              : `Crawler ${data.records?.[0]?.status || data.status}; HTTP ${data.records?.[0]?.metadata?.status || "not reported"}${data.records?.[0]?.status === "completed" ? "; no extractable content" : ""}`,
          };
        },
        cancel: async (crawlId) => {
          await browser(this.env, `/${crawlId}`, "DELETE", undefined, requestBudget);
        },
        extract: async (messages) => {
          const output = await this.env.AI.run(
            "@cf/meta/llama-3.1-8b-instruct-fast",
            {
              messages,
              max_tokens: 1200,
              temperature: 0,
              response_format: {
                type: "json_schema",
                json_schema: messages[0].content.startsWith("Find named business decision-makers") ? peopleExtractionSchema : {
                  type: "object",
                  properties: {
                    findings: {
                      type: "array",
                      maxItems: 4,
                      items: {
                        type: "object",
                        properties: {
                          kind: {
                            type: "string",
                            enum: [
                              "company",
                              "business_role",
                              "product",
                              "customer",
                              "person",
                              "capability",
                              "accreditation",
                              "identifier",
                            ],
                          },
                          name: { type: "string" },
                          value: { type: "string" },
                          quote: { type: "string" },
                          website: { type: "string" },
                          subject: { type: "string" },
                          email: { type: "string" },
                          relevance: {
                            type: "string",
                            enum: ["relevant", "adjacent", "unclear"],
                          },
                        },
                        required: [
                          "kind",
                          "name",
                          "value",
                          "quote",
                          "website",
                          "relevance",
                        ],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["findings"],
                  additionalProperties: false,
                },
              },
            },
          );
          return parseResearchExtraction(output);
        },
        extractHeadcount: async (messages) => {
          const output = await this.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast", {
            messages, max_tokens: 300, temperature: 0,
            response_format: { type: "json_schema", json_schema: {
              type: "object", properties: { value: { type: ["string", "null"] }, quote: { type: ["string", "null"] } },
              required: ["value", "quote"], additionalProperties: false,
            } },
          });
          const result = output as { response?: unknown };
          return typeof result.response === "string" ? JSON.parse(result.response) : result.response ?? output;
        },
        peopleFollowup: () => callback(this.env, id, { action: "people-followup" }, requestBudget) as Promise<{ seeds: string[]; warning?: string }>,
        now: () => Date.now(),
      },
    );
  }
}
const worker = {
  async fetch(request: Request, env: Env) {
    if (!(await authorized(request, env.SERVICE_SECRET)))
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    if (new URL(request.url).pathname === "/search" && request.method === "POST") {
      const body = await request.json().catch(() => null) as { query?: unknown } | null;
      if (typeof body?.query !== "string" || body.query.trim().length < 2 || body.query.length > 500)
        return Response.json({ error: "Invalid search" }, { status: 400 });
      try {
        const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/browser-rendering/markdown`, {
          method: "POST", headers: { authorization: `Bearer ${env.CF_BROWSER_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(body.query)}`, gotoOptions: { waitUntil: "domcontentloaded", timeout: 20000 } }),
          signal: AbortSignal.timeout(40000),
        });
        const data = await response.json() as { success?: boolean; result?: unknown };
        if (!response.ok || !data.success) return Response.json({ error: "Public search unavailable" }, { status: response.status === 429 ? 429 : 502 });
        if (typeof data.result !== "string") throw new Error("Search unavailable");
        const results = searchResults(data.result);
        const seeds = results.map(r => r.url).slice(0, 6);
        if (!seeds.length && !/no results found|no more results/i.test(data.result)) throw new Error("Search could not be read");
        return Response.json({ seeds, results });
      } catch { return Response.json({ error: "Public search unavailable" }, { status: 502 }); }
    }
    const match = new URL(request.url).pathname.match(
      /^\/jobs\/([0-9a-f-]{36})$/i,
    );
    if (!match) return Response.json({ error: "Not found" }, { status: 404 });
    const id = match[1];
    if (request.method === "POST") {
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
      if (state.crawlId) await browser(env, `/${state.crawlId}`, "DELETE");
      // Keep the workflow alive long enough to observe cancellation and clean up a racing submission.
      return Response.json({ ok: true });
    }
    if (request.method === "GET")
      return Response.json(await (await env.RESEARCH.get(id)).status());
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  },
};

export default worker;
