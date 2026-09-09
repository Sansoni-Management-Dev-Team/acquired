import { publicResearchUrl } from "./research";
export type WebSearchResult = { url: string; title: string; snippet: string };
export function canonicalSearchUrl(value: string): string | null {
  const safe = publicResearchUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (/(^|\.)linkedin\.com$/.test(url.hostname) && /^\/in\/[^/]+(?:\/[a-z]{2})?\/?$/.test(url.pathname)) {
    url.hostname = "www.linkedin.com";
    url.pathname = url.pathname.replace(/^(\/in\/[^/]+)\/[a-z]{2}\/?$/, "$1").replace(/\/$/, "");
  }
  return url.href;
}
const plain = (text: string) => text.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
// Snippets are discovery leads, never source-page evidence.
export function searchResults(markdown: string): WebSearchResult[] {
  const results = new Map<string, WebSearchResult>();
  const headings = [...markdown.matchAll(/^##\s+\[([^\n]+?)\]\(([^\s)]+)\)/gm)];
  for (const [index, match] of headings.entries()) {
    try {
      let url = new URL(match[2].replaceAll("&amp;", "&"));
      if (/(^|\.)duckduckgo\.com$/.test(url.hostname)) {
        const destination = url.searchParams.get("uddg");
        if (!destination) continue;
        url = new URL(destination);
      }
      const safe = canonicalSearchUrl(url.href);
      if (!safe || /(^|\.)duckduckgo\.com$/.test(url.hostname) || results.has(safe)) continue;
      const block = markdown.slice(match.index! + match[0].length, headings[index + 1]?.index ?? markdown.length);
      const snippets = [...block.matchAll(/^\[([^\n\[\]]+)\]\(([^\s)]+)\)/gm)];
      // Only text linked to this result can describe this result.
      const snippet = snippets.filter(m => {
        try { const link = new URL(m[2].replaceAll("&amp;", "&")); return canonicalSearchUrl(link.searchParams.get("uddg") || link.href) === safe; } catch { return false; }
      }).map(m => plain(m[1])).filter(t => t.includes(" ")).sort((a,b) => b.length-a.length)[0] || "";
      results.set(safe, { url: safe, title: plain(match[1]).slice(0, 300), snippet: snippet.slice(0, 1200) });
    } catch { /* Malformed results cannot become seeds. */ }
  }
  return [...results.values()].slice(0, 12);
}
export function searchResultUrls(markdown: string): string[] {
  return searchResults(markdown).map(r => r.url).slice(0, 6);
}
