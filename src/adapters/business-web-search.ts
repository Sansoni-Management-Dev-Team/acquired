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
  const results = await Promise.allSettled(supplierSearchQueries(terms, geography).map(query => cloudflareSearchResults(query, fetcher, jobId).then(rows => rows.map(r => r.url))));
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "" };
}
