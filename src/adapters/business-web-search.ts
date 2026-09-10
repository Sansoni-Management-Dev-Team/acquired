import { cloudflareSearchResults } from "./cloudflare-web-search";
import { researchQueries } from "@/domain/research";
// One focused query per target type (split from the brief's "Type: a, b, c" terms),
// aimed at suppliers and excluding the service businesses that share the vocabulary.
export function supplierSearchQueries(terms: string[], geography: string) {
  const place = /^national$/i.test(geography) ? "Australia" : geography;
  return researchQueries(terms).slice(0, 6).map(q => `${q} manufacturer OR wholesaler ${place} -"funeral director" -"funeral home" -"funeral services" -"cremation services" -"cremation service"`);
}
export async function businessWebSeeds(terms: string[], geography: string, fetcher: typeof fetch = fetch, jobId?: string) {
  // Every result of every query is a seed; the mandate's known websites are removed afterwards, so depth matters more than rank.
  // Queries run one at a time with a short gap: the search engine throttles a burst.
  const results: PromiseSettledResult<string[]>[] = [];
  for (const [index, query] of supplierSearchQueries(terms, geography).entries()) {
    if (index) await new Promise(resolve => setTimeout(resolve, 1500));
    results.push(await Promise.allSettled([cloudflareSearchResults(query, fetcher, jobId).then(rows => rows.map(r => r.url))]).then(([r]) => r));
  }
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "" };
}
