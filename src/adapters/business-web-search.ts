import { cloudflareWebSearch } from "./cloudflare-web-search";
export async function businessWebSeeds(terms: string[], geography: string, fetcher: typeof fetch = fetch, jobId?: string) {
  const results = await Promise.allSettled(terms.slice(0, 3).map(term => cloudflareWebSearch(`${term} manufacturers suppliers businesses ${/^national$/i.test(geography) ? "Australia" : geography}`, fetcher, jobId)));
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "" };
}
