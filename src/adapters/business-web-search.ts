import { cloudflareSearchResults } from "./cloudflare-web-search";
import { researchQueries } from "@/domain/research";
import type { WebSearchResult } from "@/domain/cloudflare-search";
// Sector words from the brief (the vertical and its product nouns, minus generic parts
// vocabulary). A result is a discovery seed only when it names the sector somewhere.
const genericVocabulary = new Set(["fittings", "handles", "linings", "components", "hardware", "materials", "plastics", "businesses", "serving", "supply", "chain", "associated", "manufacturers", "manufacturer", "distributors", "distributor", "consumables", "products", "product", "industry", "industries", "services", "business", "suppliers", "supplier", "specialist", "wholesale"]);
export function sectorLexicon(terms: string[]) {
  const tokens = terms.flatMap(term => term.toLowerCase().match(/[a-z]{4,}/g) || []);
  return [...new Set(tokens.filter(t => !genericVocabulary.has(t)).map(t => t.replace(/s$/, "")))];
}
export function seedRelevant(result: WebSearchResult, terms: string[]) {
  const text = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  return sectorLexicon(terms).some(stem => new RegExp(`\\b${stem}s?\\b`).test(text));
}
// One focused query per target type (split from the brief's "Type: a, b, c" terms),
// aimed at suppliers and excluding the service businesses that share the vocabulary.
export function supplierSearchQueries(terms: string[], geography: string) {
  const place = /^national$/i.test(geography) ? "Australia" : geography;
  return researchQueries(terms).slice(0, 6).map(q => `${q} manufacturer OR wholesaler ${place} -"funeral director" -"funeral home" -"funeral services" -"cremation services" -"cremation service"`);
}
export async function businessWebSeeds(terms: string[], geography: string, fetcher: typeof fetch = fetch, jobId?: string, spacingMs = 1500) {
  // Every result of every query is a seed; the mandate's known websites are removed afterwards, so depth matters more than rank.
  // Queries run one at a time with a short gap: the search engine throttles a burst.
  const results: PromiseSettledResult<string[]>[] = [];
  for (const [index, query] of supplierSearchQueries(terms, geography).entries()) {
    for (const page of [1, 2]) {
      if ((index || page > 1) && spacingMs) await new Promise(resolve => setTimeout(resolve, spacingMs));
      results.push(await Promise.allSettled([cloudflareSearchResults(query, fetcher, jobId, page).then(rows => rows.filter(r => seedRelevant(r, terms)).map(r => r.url))]).then(([r]) => r));
    }
  }
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "" };
}
