import { providerFailure } from "@/domain/research-provider-error";
import { cloudflareSearchResults } from "./cloudflare-web-search";
import { focusedDiscoveryPhrases, discoveryRole } from "@/domain/discovery-queries";
import type { WebSearchResult } from "@/domain/cloudflare-search";
// Sector words from the brief (the vertical and its product nouns, minus generic parts
// vocabulary). A result is a discovery seed only when it names the sector somewhere.
const genericVocabulary = new Set(["fittings", "handles", "linings", "components", "hardware", "materials", "plastics", "businesses", "serving", "supply", "chain", "associated", "manufacturers", "manufacturer", "distributors", "distributor", "consumables", "products", "product", "industry", "industries", "services", "business", "suppliers", "supplier", "specialist", "wholesale", "servicing", "supplying", "including", "clients", "customers", "testing"]);
export function sectorLexicon(terms: string[]) {
  const tokens = terms.flatMap(term => term.toLowerCase().match(/[a-z]{4,}/g) || []);
  return [...new Set(tokens.filter(t => !genericVocabulary.has(t)).map(t => t.replace(/ies$/, "y").replace(/s$/, "")))];
}
export function seedRelevant(result: WebSearchResult, terms: string[]) {
  const text = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
  return sectorLexicon(terms).some(stem => new RegExp(`\\b${stem.endsWith("y") ? stem.slice(0, -1) + "(?:y|ies)" : stem + "s?"}\\b`).test(text));
}
const australianStates = ["Victoria", "New South Wales", "Queensland", "Western Australia", "South Australia", "Tasmania", "Northern Territory", "Australian Capital Territory"];
const placeName = (geography: string) => /^national$/i.test(geography) ? "Australia" : geography;
const phraseQuery = (phrase: string, place: string) => [phrase, discoveryRole(phrase), place].filter(Boolean).join(" ");
export function supplierSearchQueries(terms: string[], geography: string) {
  return focusedDiscoveryPhrases(terms).map(phrase => phraseQuery(phrase, placeName(geography)));
}
export function expandedSupplierQueries(terms: string[], geography: string) {
  const phrases = focusedDiscoveryPhrases(terms);
  const regions = /^(national|Australia)$/i.test(geography) ? australianStates : [geography];
  // Rotate regions across phrases; never spend the entire budget on the first subsector.
  return regions.flatMap(region => phrases.map(phrase => `${phraseQuery(phrase, region)} companies`)).slice(0, 18);
}
export type DiscoveryQuery = { query: string; page: number; engine?: "google" };
export function discoveryQueryPlan(terms: string[], geography: string): DiscoveryQuery[] {
  // The deployed DDG HTML reader supports first-page results only. Use distinct
  // phrases instead of silently requesting unsupported pages or another engine.
  return [...new Set([...supplierSearchQueries(terms, geography), ...expandedSupplierQueries(terms, geography)])]
    .map(query => ({ query, page: 1 }));
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
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "", attempts: results.map((result, i) => ({ query: plan[i].query, status: result.status === "fulfilled" ? "succeeded" as const : "failed" as const, ...(result.status === "rejected" ? { category: providerFailure(result.reason).category } : {}) })) };
}
export async function businessWebSeeds(terms: string[], geography: string, fetcher: typeof fetch = fetch, jobId?: string, spacingMs = 1500) {
  const results = await runDiscoveryQueries(discoveryQueryPlan(terms, geography), terms, fetcher, jobId, spacingMs).then(r => [{ status: "fulfilled" as const, value: r.seeds }, ...(r.warning ? [{ status: "rejected" as const, reason: r.warning }] : [])]);
  return { seeds: [...new Set(results.flatMap(r => r.status === "fulfilled" ? r.value : []))], warning: results.some(r => r.status === "rejected") ? "Some web searches failed; available sources retained." : "" };
}
