import { providerJsonRequest } from "./observability/provider-request";
import { publicResearchUrl } from "@/domain/research";
import type { WebSearchResult } from "@/domain/cloudflare-search";
export async function cloudflareSearchResults(query: string, fetcher: typeof fetch = fetch, jobId?: string): Promise<WebSearchResult[]> {
  const base = process.env.RESEARCH_WORKER_URL, secret = process.env.RESEARCH_SERVICE_SECRET;
  if (!base || !secret) throw new Error("Public web search is not configured");
  const requestId = crypto.randomUUID();
  const { response: r, data } = await providerJsonRequest<{ seeds?: unknown; results?: unknown }>(fetcher,`${base.replace(/\/$/, "")}/search`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "Content-Type": "application/json", "x-research-request-id": requestId, ...(jobId ? { "x-research-job-id": jobId } : {}) },
    body: JSON.stringify({ query: query.slice(0, 500) }), signal: AbortSignal.timeout(50000), cache: "no-store",
  }, { provider: "research-worker", operation: "web_search", requestId, jobId });
  if (!r.ok) throw new Error(`Public web search failed (HTTP ${r.status})`);
  console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), jobId, requestId, event: "search_response", results: Array.isArray(data.results) ? data.results.length : null, seeds: Array.isArray(data.seeds) ? data.seeds.length : null }));
  if (!Array.isArray(data.seeds)) throw new Error("Invalid search response");
  if (Array.isArray(data.results)) return data.results.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const r = value as Record<string, unknown>, url = typeof r.url === "string" && publicResearchUrl(r.url);
    return url && typeof r.title === "string" && typeof r.snippet === "string" ? [{ url, title: r.title.slice(0, 300), snippet: r.snippet.slice(0, 1200) }] : [];
  }).slice(0, 12);
  return [...new Set(data.seeds.flatMap(value => { const url = typeof value === "string" && publicResearchUrl(value); return url ? [url] : []; }))].slice(0, 6).map(url => ({ url, title: "", snippet: "" }));
}

export async function cloudflareWebSearch(query: string, fetcher: typeof fetch = fetch, jobId?: string): Promise<string[]> {
  return (await cloudflareSearchResults(query, fetcher, jobId)).map(r => r.url).slice(0, 6);
}
