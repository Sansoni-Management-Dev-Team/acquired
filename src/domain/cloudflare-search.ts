import { publicResearchUrl } from "./research";
// Only result headings are seeds. Search snippets never become company evidence.
export function searchResultUrls(markdown: string): string[] {
  const results: string[] = [];
  for (const match of markdown.matchAll(/^##\s+\[[^\n]+?\]\(([^\s)]+)\)/gm)) {
    try {
      let url = new URL(match[1].replaceAll("&amp;", "&"));
      if (/(^|\.)duckduckgo\.com$/.test(url.hostname)) {
        const destination = url.searchParams.get("uddg");
        if (!destination) continue;
        url = new URL(destination);
      }
      const safe = publicResearchUrl(url.href);
      if (safe && !/(^|\.)duckduckgo\.com$/.test(url.hostname)) results.push(safe);
    } catch { /* Malformed search results are not crawl seeds. */ }
  }
  return [...new Set(results)].slice(0, 6);
}
