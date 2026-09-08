import { publicResearchUrl } from "@/domain/research";
export async function cloudflareWebSearch(query: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const base = process.env.RESEARCH_WORKER_URL, secret = process.env.RESEARCH_SERVICE_SECRET;
  if (!base || !secret) throw new Error("Public web search is not configured");
  const r = await fetcher(`${base.replace(/\/$/, "")}/search`, {
    method: "POST", headers: { authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: query.slice(0, 500) }), signal: AbortSignal.timeout(50000), cache: "no-store",
  });
  if (!r.ok) throw new Error("Public web search failed");
  const data = await r.json() as { seeds?: unknown };
  if (!Array.isArray(data.seeds)) throw new Error("Invalid search response");
  return [...new Set(data.seeds.flatMap(value => { const url = typeof value === "string" && publicResearchUrl(value); return url ? [url] : []; }))].slice(0, 6);
}
