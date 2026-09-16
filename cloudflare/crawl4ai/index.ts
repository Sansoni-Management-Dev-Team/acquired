import { Container } from "@cloudflare/containers";
import { publicResearchUrl } from "../../src/domain/research";
interface Env { READER: DurableObjectNamespace<CrawlReader>; SERVICE_SECRET: string }
export class CrawlReader extends Container {
  defaultPort = 8080;
  sleepAfter = "1m";
  envVars = { CRAWL4AI_CONCURRENCY: "3", CRAWL4AI_DOMAIN_DELAY: "3" };
}
async function authorized(request: Request, secret: string) {
  if (!secret) return false;
  const digest = (s: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  const [a,b] = await Promise.all([digest(request.headers.get("authorization") || ""),digest(`Bearer ${secret}`)]);
  const x = new Uint8Array(a), y = new Uint8Array(b);
  return x.reduce((difference, byte, i) => difference | (byte ^ y[i]),0) === 0;
}
const worker = {
  async fetch(request: Request, env: Env) {
    if (!await authorized(request, env.SERVICE_SECRET)) return new Response("Unauthorized", {status:401});
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return env.READER.getByName("public-reader").fetch(new Request("http://container/health"));
    }
    if (request.method !== "POST" || new URL(request.url).pathname !== "/crawl") return new Response("Not found", {status:404});
    const body = await request.json().catch(() => null) as { url?: unknown } | null;
    const url = typeof body?.url === "string" ? publicResearchUrl(body.url) : null;
    if (!url) return Response.json({error:"Unsupported public URL"},{status:400});
    // One on-demand instance with a bounded pool of three isolated browser reads.
    return env.READER.getByName("public-reader").fetch(new Request("http://container/crawl", {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({url}),
    }));
  },
};

export default worker;
