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
async function callback(env: Env, id: string, body?: unknown) {
  const origin = new URL(env.APP_ORIGIN);
  if (origin.protocol !== "https:") throw new Error("HTTPS callback required");
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
async function browser(env: Env, path: string, method = "GET", body?: unknown) {
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
        control: () => callback(this.env, id) as Promise<ResearchControl>,
        discover: () =>
          callback(this.env, id, { action: "discover" }) as Promise<{
            seeds: string[];
            warning?: string;
          }>,
        progress: async (event) => {
          await callback(this.env, id, event);
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
          })) as string;
        },
        poll: async (crawlId) => {
          const data = (await browser(this.env, `/${crawlId}`)) as {
            status: string;
            records?: { url: string; status: string; markdown?: string }[];
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
                  },
                }
              : {}),
            warning: record
              ? undefined
              : "Page failed, disallowed or had no extractable content",
          };
        },
        cancel: async (crawlId) => {
          await browser(this.env, `/${crawlId}`, "DELETE");
        },
        extract: async (messages) => {
          const output = await this.env.AI.run(
            "@cf/meta/llama-3.1-8b-instruct-fast",
            { messages, max_tokens: 1200, temperature: 0, response_format: { type: "json_object" } },
          );
          return parseResearchExtraction(output);
        },
        now: () => Date.now(),
      },
    );
  }
}
const worker = {
  async fetch(request: Request, env: Env) {
    if (!(await authorized(request, env.SERVICE_SECRET)))
      return Response.json({ error: "Unauthorized" }, { status: 401 });
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
