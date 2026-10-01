import type { WebSearchResult } from "./cloudflare-search";
import { companyResultMatches } from "./company-research-routing";
import { parseHeadcount } from "./company-facts";
import { publicResearchUrl, type ResearchConfig, type ResearchFinding } from "./research";

// Search-result snippets often carry a directory's size estimate ("employs 39
// employees", "Company size 51-200 employees") for companies whose profile pages
// cannot be opened. These are recorded as search-snippet estimates: the quote is
// the snippet sentence verbatim, the source is the result URL, and they never
// stand in for a page-sourced count when deciding what still needs research.
const plain = (text: string) => text.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
const sentenceAround = (text: string, index: number) => {
  const starts = [text.lastIndexOf(". ", index), text.lastIndexOf("; ", index)].filter(i => i >= 0).map(i => i + 2);
  const start = starts.length ? Math.max(...starts) : 0;
  const endCandidates = [text.indexOf(". ", index), text.indexOf("; ", index)].filter(i => i >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) + 1 : text.length;
  return text.slice(start, end).trim();
};
const excluded = /\b(?:followers?|by seniority|by department|c-level|non-managers|reviews? by employees|verified contacts?|contact records?|similar companies)\b/i;

export function snippetSizeEstimates(results: WebSearchResult[], config: Pick<ResearchConfig, "companyName" | "companyDomain" | "legalEntity">): (ResearchFinding & { sourceUrl: string })[] {
  if (!config.companyName || !config.companyDomain) return [];
  const out: (ResearchFinding & { sourceUrl: string })[] = [];
  for (const result of results) {
    const sourceUrl = publicResearchUrl(result.url);
    if (!sourceUrl || !companyResultMatches(result, config.companyName, config.companyDomain, config.legalEntity)) continue;
    const text = plain(result.snippet);
    if (!text) continue;
    const size = text.match(/(?:company size|employs|has|with|of)\s*:?\s*((?:(?:over|more than|about|around|approximately)\s+)?\d[\d,]*(?:\s*[-–]\s*\d[\d,]*)?\+?)\s+employees\b/i) || text.match(/\b(\d[\d,]*(?:\s*[-–]\s*\d[\d,]*)?\+?)\s+employees\b/i);
    if (size && parseHeadcount(`${size[1]} employees`)) {
      const quote = sentenceAround(text, size.index!);
      if (!excluded.test(quote) && quote.length >= 8) out.push({ kind: "headcount", name: "Headcount", value: `${size[1]} employees`, quote: quote.slice(0, 800), website: sourceUrl, subject: config.companyName, relevance: "unclear", sourceUrl, factMetadata: { sourceKind: "third_party_directory", basis: "search_snippet", scope: "unspecified", identityNote: null, period: null, currency: null } });
    }
    const revenue = text.match(/((?:AUD|USD|A\$|US\$|\$)\s?\d[\d,.]*\s?(?:million|billion|thousand|[MBK])?)\s+(?:in\s+)?(?:annual\s+)?revenue\b|\brevenue(?:\s+(?:of|is))?\s*:?\s*((?:AUD|USD|A\$|US\$|\$)\s?\d[\d,.]*\s?(?:million|billion|thousand|[MBK])?)/i);
    const amount = revenue?.[1] || revenue?.[2];
    if (amount) {
      const quote = sentenceAround(text, revenue!.index!);
      const names = [...config.companyName.split(/\s+\/\s+/), ...(config.legalEntity ? [config.legalEntity] : [])];
      // A profile title is not enough: the sentence must identify the target
      // before its metric, and comparisons/per-employee metrics are excluded.
      const beforeMetric = text.slice(Math.max(0, text.indexOf(quote)), revenue!.index!);
      const targetSubject = names.some(name => {
        const at = beforeMetric.toLowerCase().indexOf(name.toLowerCase());
        if (at < 0) return false;
        const predicate = beforeMetric.slice(at + name.length).trim();
        return /^(?:['’]s\s*)?(?:(?:estimated|annual|yearly|total|reported)\s*)*$/i.test(predicate)
          || /^(?:['’]s\s*)?(?:generates|reports|has|earns)(?:\s+(?:about|approximately|estimated))?$/i.test(predicate)
          || /^is\s+(?:a|an)\s+[^.;]+\b(?:company|business)\b[^.;]*\bwith$/i.test(predicate);
      });
      const wrongMetric = /(?:revenue\s+per|per\s+(?:employee|worker|person)|competitors?|compared|comparison|versus|\bvs\b)/i.test(quote);
      if (targetSubject && !wrongMetric && !excluded.test(quote) && quote.length >= 8) out.push({ kind: "revenue", name: "Revenue", value: amount.trim(), quote: quote.slice(0, 800), website: sourceUrl, subject: config.companyName, relevance: "unclear", sourceUrl, factMetadata: { sourceKind: "third_party_directory", basis: "search_snippet", scope: "unspecified", identityNote: null, period: null, currency: /AUD|A\$/.test(amount) ? "AUD" : /USD|US\$/.test(amount) ? "USD" : null } });
    }
  }
  return out.slice(0, 8);
}

export const isSearchSnippet = (finding: { factMetadata?: { basis?: string } | null }) => finding.factMetadata?.basis === "search_snippet";
