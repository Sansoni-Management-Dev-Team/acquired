import {safeResearchTrace,type ResearchTraceContext} from '../../src/domain/research-trace-context';
import { publicResearchUrl } from "../../src/domain/research";
import { providerJsonRequest, providerDiagnostics } from "../../src/adapters/observability/provider-request";
import {ResearchProviderError} from '../../src/domain/research-provider-error';
export type LocalReaderEnv = { LOCAL_DEVELOPMENT?: string; LOCAL_RESEARCH_BENCHMARK?: string; LOCAL_CRAWL4AI_URL?: string };

export function localReaderEndpoint(env: LocalReaderEnv) {
  if (env.LOCAL_DEVELOPMENT !== "true") throw new Error("Local reader requires local development mode");
  const base = new URL(env.LOCAL_CRAWL4AI_URL || "http://127.0.0.1:18083");
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || (!["18083","18084"].includes(base.port) && !(env.LOCAL_RESEARCH_BENCHMARK === "true" && Number(base.port) >= 1024 && Number(base.port) <= 65535)) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("Local reader must use the fixed OrbStack loopback reader endpoint");
  return new URL("/crawl", base).href;
}

export async function localRead(env: LocalReaderEnv, url: string, context: ResearchTraceContext & { operation?: string } = {}, fetcher: typeof fetch = fetch) {
  const endpoint = localReaderEndpoint(env);
  if (!publicResearchUrl(url)) throw new Error("Unsupported public URL");
  const trace=safeResearchTrace(context);
  const requestId=trace.requestId&&/^[a-zA-Z0-9_-]{8,100}$/.test(trace.requestId)?trace.requestId:crypto.randomUUID();
  const { response, data } = await providerJsonRequest<{ url?: string; markdown?: string }>(fetcher, endpoint, {
    method: "POST", headers: { "Content-Type": "application/json",'x-request-id':requestId,...(trace.jobId&&/^[a-zA-Z0-9_-]{8,100}$/.test(trace.jobId)?{'x-research-job-id':trace.jobId}:{}) },
    body: JSON.stringify({ url }), signal: AbortSignal.timeout(45000),
  }, { ...trace, provider: "local-crawl4ai", operation: context.operation || "markdown", requestId });
  if (!response.ok) throw new ResearchProviderError(providerDiagnostics(response.status,response.headers,data,'local-crawl4ai').category,response.status);
  if (!data.url || !publicResearchUrl(data.url) || typeof data.markdown !== "string" || !data.markdown.trim()) throw new Error("Local Crawl4AI returned no usable public page");
  return { status: "completed", page: { url: data.url, markdown: data.markdown.slice(0, 30000) } };
}
