import { publicResearchUrl } from "../../src/domain/research";
import { canonicalSearchUrl, type WebSearchResult } from "../../src/domain/cloudflare-search";
import { providerJsonRequest } from "../../src/adapters/observability/provider-request";

// Local development searches through an OpenSERP container on OrbStack. Its
// DuckDuckGo results carry full snippets, unlike the HTML endpoint we render.
export type LocalSearchEnv = { LOCAL_DEVELOPMENT?: string; LOCAL_SEARCH_URL?: string };

export function localSearchEndpoint(env: LocalSearchEnv, engine = "duckduckgo") {
  if (env.LOCAL_DEVELOPMENT !== "true" || !env.LOCAL_SEARCH_URL) return null;
  const base = new URL(env.LOCAL_SEARCH_URL);
  if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.username || base.password || base.search || base.hash) throw new Error("Local search must use OrbStack on http://127.0.0.1");
  return new URL(`/${engine}/search`, base).href;
}

type OpenSerpResult = { title?: unknown; url?: unknown; snippet?: unknown; description?: unknown; engine?: unknown };

/** Normalise OpenSERP output into research search results; redirect wrappers are dropped. */
export function normaliseLocalSearch(payload: unknown): WebSearchResult[] {
  const rows: OpenSerpResult[] = Array.isArray(payload) ? payload : Array.isArray((payload as { results?: unknown })?.results) ? (payload as { results: OpenSerpResult[] }).results : [];
  const results = new Map<string, WebSearchResult>();
  for (const row of rows) {
    if (typeof row?.url !== "string" || /(^|\.)google\.com$/.test(new URL(row.url, "https://invalid.example").hostname) && /\/goto/.test(row.url)) continue;
    const safe = canonicalSearchUrl(row.url)?.replace(/\/$/, "");
    if (!safe || !publicResearchUrl(safe) || results.has(safe)) continue;
    const snippet = typeof row.snippet === "string" ? row.snippet : typeof row.description === "string" ? row.description : "";
    results.set(safe, { url: safe, title: (typeof row.title === "string" ? row.title : "").replace(/\s+/g, " ").trim().slice(0, 300), snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 1200) });
  }
  return [...results.values()].slice(0, 12);
}

export async function localSearch(env: LocalSearchEnv, query: string, context: { jobId?: string; requestId?: string } = {}, fetcher: typeof fetch = fetch): Promise<WebSearchResult[] | null> {
  const endpoint = localSearchEndpoint(env);
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.searchParams.set("text", query);
  url.searchParams.set("limit", "10");
  const { response, data } = await providerJsonRequest<unknown>(fetcher, url.href, { method: "GET", signal: AbortSignal.timeout(45000) }, { provider: "local-openserp", operation: "web_search", jobId: context.jobId, requestId: context.requestId });
  if (!response.ok) throw new Error(`Local search unavailable (${response.status})`);
  return normaliseLocalSearch(data);
}
