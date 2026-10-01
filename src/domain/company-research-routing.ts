import { companyIdentifierNameMatches } from "./company-identifiers";
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
  const path = new URL(url).pathname;
  const otherCompanyPage = path === "/" || /^\/(?:about(?:-us)?|contact(?:-us)?|team|our-team)(?:\/|$)/i.test(path);
  const haystack = ` ${normalized(otherCompanyPage ? result.title : text)} `;
  return [...company.split(/\s+\/\s+/), ...(legalEntity ? [legalEntity] : [])].some(name => {
    const needle = normalized(name);
    return needle.includes(" ") && haystack.includes(` ${needle} `);
  });
}
export function companyPeopleQuery(company: string, domain: string) {
  const name = publicCompanyName(company.split(/\s+\/\s+/).at(-1)!);
  return `"${name}" ${name.includes(" ") ? "" : `"${domain}" `}owner`;
}

// Registry titles often contain only an ABN. Route these bounded official
// record leads ahead of directories; verification still requires page evidence.
export function abnResearchResults(results: WebSearchResult[], config: {companyName?: string; companyDomain?: string; legalEntity?: string}) {
  if (!config.companyName || !config.companyDomain) return [];
  const registry: WebSearchResult[] = [], other: WebSearchResult[] = [];
  for (const result of results) {
    const url = publicResearchUrl(result.url);
    if (!url) continue;
    if (new URL(url).hostname === 'abr.business.gov.au' && /^\d{11}$/.test(new URL(url).searchParams.get('abn') || '')) {
      const entity = result.snippet.match(/Entity name[\s:|*]*([^\n|]+?)(?=\s+(?:ABN status|Entity type|Main business location|Goods.*Services|Business names)|$)/i)?.[1]?.trim();
      if (!entity || companyIdentifierNameMatches(entity, [config.companyName, config.legalEntity])) registry.push(result);
    } else if (companyResultMatches(result, config.companyName, config.companyDomain, config.legalEntity)) other.push(result);
  }
  return [...registry.slice(0, 5), ...other];
}
