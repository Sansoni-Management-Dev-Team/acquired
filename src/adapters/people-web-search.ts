import { companyPeopleQuery, companyResultMatches } from "@/domain/company-research-routing";
import { cloudflareSearchResults } from "./cloudflare-web-search";
import { peopleSearchLeads, cleanLegalEntity } from "@/domain/people-search-results";
export async function peopleWebSearch(company: string, domain: string, fetcher: typeof fetch = fetch, query?: string, legalEntity?: string, jobId?: string) {
  query ||= companyPeopleQuery(company, domain);
  const candidates = await cloudflareSearchResults(query, fetcher, jobId);
  const results = candidates.filter(r => companyResultMatches(r, company, domain, legalEntity));
  console.info("research-diagnostic", JSON.stringify({ timestamp: new Date().toISOString(), jobId, event: "people_search_identity_filter", candidates: candidates.length, accepted: results.length, rejected: candidates.length - results.length, reason: "company_identity_match_required" }));
  return { seeds: results.map(r => r.url), leads: peopleSearchLeads(results, legalEntity ? `${company} / ${cleanLegalEntity(legalEntity)}` : company, query, new Date().toISOString(), domain) };
}
export async function peopleWebSeeds(company: string, domain: string, fetcher: typeof fetch = fetch, legalEntity?: string) {
  return (await peopleWebSearch(company, domain, fetcher, legalEntity ? `"${legalEntity.slice(0, 160)}" director owner company profile Australia` : undefined)).seeds;
}
