import { canonicalSearchUrl, type WebSearchResult } from "./cloudflare-search";
export type PeopleSearchLead = WebSearchResult & { observedAt: string; query: string; basis: "search-result" };
export const cleanLegalEntity = (name: string) => name.match(/^.*?\b(?:pty\.?\s+ltd\.?|limited)\b/i)?.[0] || name;
export const companySearchName = (company: string) => company.split(/\s+\/\s+/).at(-1)!.trim();
export const companyMentioned = (text: string, company: string) => company.split(/\s+\/\s+/).some(name => text.toLowerCase().includes(name.trim().toLowerCase()));
export const allowedPeopleSource = (url: string) => !/rocketreach|zoominfo|signalhire|contactout|whitepages|spokeo|truepeoplesearch/i.test(new URL(url).hostname);
const personProfile = (url: string) => /(^|\.)linkedin\.com$/.test(new URL(url).hostname) && /^\/in\//.test(new URL(url).pathname);
const role = /\b(owner|founder|director|president|chief|ceo|managing|general manager|principal|partner)\b/i;
export function peopleSearchLeads(results: WebSearchResult[], company: string, query: string, observedAt: string, domain?: string): PeopleSearchLead[] {
  return results.filter(r => allowedPeopleSource(r.url) && companyMentioned(r.title + " " + r.snippet, company) && (companySearchName(company).includes(" ") || Boolean(domain && (r.title + " " + r.snippet + " " + r.url).toLowerCase().includes(domain.toLowerCase()))) && (role.test(r.title + " " + r.snippet) || personProfile(r.url)) && !/\b(former|previous|retired|stepped down|resigned)\b/i.test(r.title + " " + r.snippet))
    .map(r => ({ ...r, basis: "search-result" as const, query, observedAt }));
}
// Names guide another search only; they are not supported findings or saved contacts.
export function peopleFollowupQuery(company: string, leads: PeopleSearchLead[], legalEntity?: string, domain?: string): string | undefined {
  for (const lead of leads) {
    if (!/(^|\.)linkedin\.com$/.test(new URL(lead.url).hostname) || !/^\/in\//.test(new URL(lead.url).pathname)) continue;
    const name = lead.title.split(/\s[-–|]\s/)[0].trim();
    if (!/^[\p{L}'’-]+(?:\s[\p{L}'’.-]+){1,3}$/u.test(name)) continue;
    const searchName = name.split(/\s+/).filter(part => !/^[\p{L}]\.?$/u.test(part)).join(" ");
    if (searchName.length > 1) return `"${searchName}" "${companySearchName(company).slice(0, 160)}"`;
  }
  return legalEntity ? `"${cleanLegalEntity(legalEntity).slice(0, 160)}" director owner company profile Australia` : `"${companySearchName(company).slice(0, 160)}" ${companySearchName(company).includes(" ") ? "" : domain || ""} LinkedIn`.replace(/\s+/g, " ");
}
export function mergePeopleSearchLeads(leads: PeopleSearchLead[]) {
  const seen = new Set<string>();
  return leads.filter(l => { const key = canonicalSearchUrl(l.url); if (!key || seen.has(key)) return false; seen.add(key); return true; }).slice(0, 12);
}
