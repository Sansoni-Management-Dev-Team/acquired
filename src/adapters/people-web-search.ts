import { cloudflareSearchResults } from "./cloudflare-web-search";
import { allowedPeopleSource, peopleSearchLeads, companySearchName, cleanLegalEntity } from "@/domain/people-search-results";
export async function peopleWebSearch(company: string, domain: string, fetcher: typeof fetch = fetch, query?: string, legalEntity?: string) {
  query ||= `"${companySearchName(company).slice(0, 160)}" ${companySearchName(company).includes(" ") ? "" : domain} owner founder director`.replace(/\s+/g, " ");
  const results = (await cloudflareSearchResults(query, fetcher)).filter(r => allowedPeopleSource(r.url));
  return { seeds: results.map(r => r.url), leads: peopleSearchLeads(results, legalEntity ? `${company} / ${cleanLegalEntity(legalEntity)}` : company, query, new Date().toISOString(), domain) };
}
export async function peopleWebSeeds(company: string, domain: string, fetcher: typeof fetch = fetch, legalEntity?: string) {
  return (await peopleWebSearch(company, domain, fetcher, legalEntity ? `"${legalEntity.slice(0, 160)}" director owner company profile Australia` : undefined)).seeds;
}
