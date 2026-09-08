import { publicResearchUrl } from "@/domain/research";
export async function businessWebSeeds(terms: string[], geography: string, fetcher: typeof fetch = fetch) {
  if (!process.env.TAVILY_API_KEY) throw new Error("Web discovery unavailable");
  const results = await Promise.allSettled(terms.slice(0, 3).map(async term => {
    const response = await fetcher("https://api.tavily.com/search", { method: "POST", headers: { authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: `${term} manufacturers suppliers businesses ${/^national$/i.test(geography) ? "Australia" : geography}`, search_depth: "basic", max_results: 6, auto_parameters: false, include_answer: false, include_raw_content: false }), signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error("Web search failed");
    const data = await response.json() as { results?: { url?: string }[] };
    return (data.results || []).flatMap(r => { const url = r.url && publicResearchUrl(r.url); return url ? [url] : []; });
  }));
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "" };
}
