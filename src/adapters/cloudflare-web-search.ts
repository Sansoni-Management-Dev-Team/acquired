import { publicResearchUrl } from "@/domain/research";
import type { WebSearchResult } from "@/domain/cloudflare-search";
export async function cloudflareSearchResults(query: string, fetcher: typeof fetch = fetch): Promise<WebSearchResult[]> {
  const base = process.env.RESEARCH_WORKER_URL, secret = process.env.RESEARCH_SERVICE_SECRET;
  if (!base || !secret) throw new Error("Public web search is not configured");
  const r = await fetcher(`${base.replace(/\/$/, "")}/search`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.slice(0, 500) }), signal: AbortSignal.timeout(50000), cache: "no-store",
  });
  if (!r.ok) throw new Error(`Public web search failed (HTTP ${r.status})`);
  const data = await r.json() as { seeds?: unknown; results?: unknown };
  if (!Array.isArray(data.seeds)) throw new Error("Invalid search response");
  if (Array.isArray(data.results)) return data.results.flatMap((value: unknown) => {
    if (!value || typeof value !== "object") return [];
    const r = value as Record<string, unknown>, url = typeof r.url === "string" && publicResearchUrl(r.url);
    return url && typeof r.title === "string" && typeof r.snippet === "string" ? [{ url, title: r.title.slice(0, 300), snippet: r.snippet.slice(0, 1200) }] : [];
  }).slice(0, 12);
  return [...new Set(data.seeds.flatMap(value => { const url = typeof value === "string" && publicResearchUrl(value); return url ? [url] : []; }))].slice(0, 6).map(url => ({ url, title: "", snippet: "" }));
}

export async function cloudflareWebSearch(query: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  return (await cloudflareSearchResults(query, fetcher)).map(r => r.url).slice(0, 6);
}
