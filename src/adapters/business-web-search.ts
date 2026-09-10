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
const exclusions = '-"funeral director" -"funeral home" -"funeral services" -"cremation services" -"cremation service"';
const australianStates = ["Victoria", "New South Wales", "Queensland", "Western Australia", "South Australia"];
export function supplierSearchQueries(terms: string[], geography: string) {
  const place = /^national$/i.test(geography) ? "Australia" : geography;
  return researchQueries(terms).slice(0, 6).map(q => `${q} manufacturer OR wholesaler ${place} ${exclusions}`);
}
// Once the direct phrasings are exhausted, vary the vocabulary and the region so a
// different slice of the index surfaces. Sector words come from the brief itself.
export function expandedSupplierQueries(terms: string[], geography: string) {
  const national = /^national$/i.test(geography);
  const place = national ? "Australia" : geography;
  const words = sectorLexicon(terms).slice(0, 4);
  const regions = national ? australianStates : [geography];
  const queries = words.flatMap(word => [
    `${word} manufacturer ${place} ${exclusions}`,
    `${word} supplies wholesale ${place} ${exclusions}`,
    ...regions.map(region => `${word} manufacturers ${region} ${exclusions}`),
  ]);
  return [...new Set(queries)].slice(0, 28);
}
export type DiscoveryQuery = { query: string; page: number; engine?: "google" };
export function discoveryQueryPlan(terms: string[], geography: string): DiscoveryQuery[] {
  return [
    ...supplierSearchQueries(terms, geography).flatMap(query => [{ query, page: 1 }, { query, page: 2 }]),
    // Expansion queries go to the second engine so a different index answers them.
    ...expandedSupplierQueries(terms, geography).map(query => ({ query, page: 1, engine: "google" as const })),
  ];
}
// Every result of every query is a seed; the mandate's known websites are removed afterwards, so depth matters more than rank.
// Queries run one at a time with a short gap: the search engine throttles a burst. Callers run the plan in slices so no
// single callback outlives the worker's request limit.
export async function runDiscoveryQueries(plan: DiscoveryQuery[], terms: string[], fetcher: typeof fetch = fetch, jobId?: string, spacingMs = 1500) {
  const results: PromiseSettledResult<string[]>[] = [];
  for (const [index, { query, page, engine }] of plan.entries()) {
    if (index && spacingMs) await new Promise(resolve => setTimeout(resolve, spacingMs));
    results.push(await Promise.allSettled([cloudflareSearchResults(query, fetcher, jobId, page, engine).then(rows => rows.filter(r => seedRelevant(r, terms)).map(r => r.url))]).then(([r]) => r));
  }
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "" };
}
export async function businessWebSeeds(terms: string[], geography: string, fetcher: typeof fetch = fetch, jobId?: string, spacingMs = 1500) {
  const results = await runDiscoveryQueries(discoveryQueryPlan(terms, geography), terms, fetcher, jobId, spacingMs).then(r => [{ status: "fulfilled" as const, value: r.seeds }, ...(r.warning ? [{ status: "rejected" as const, reason: r.warning }] : [])]);
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "" };
}
