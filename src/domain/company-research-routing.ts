import type { WebSearchResult } from "./cloudflare-search";
import { allowedPeopleSource } from "./people-search-results";
import { publicResearchUrl, researchDomain } from "./research";
const normalized = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
export const publicCompanyName = (name: string) => name.replace(/["\\\r\n]/g, " ").trim().slice(0, 160);

// Search snippets may justify reading a page, never saving a fact. Single-word
// company names require a domain match to avoid unrelated same-name businesses.
export function companyResultMatches(result: WebSearchResult, company: string, domain: string, legalEntity?: string) {
  const url = publicResearchUrl(result.url);
  if (!url || !allowedPeopleSource(url) || /\/(?:aclick|login|sign-in)(?:[/?]|$)/i.test(url)) return false;
  if (researchDomain(url) === domain) return true;
  const text = `${result.title} ${result.snippet} ${url}`;
  const domainPattern = new RegExp(`(?<![a-z0-9.-])(?:www\\.)?${domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9.-])`, "i");
  if (domainPattern.test(text)) return true;
  const haystack = ` ${normalized(text)} `;
  return [...company.split(/\s+\/\s+/), ...(legalEntity ? [legalEntity] : [])].some(name => {
    const needle = normalized(name);
    return needle.includes(" ") && haystack.includes(` ${needle} `);
  });
}
export function companyPeopleQuery(company: string, domain: string) {
  const name = publicCompanyName(company.split(/\s+\/\s+/).at(-1)!);
  return `"${name}" "${domain}" founder director`;
}
