import { publicResearchUrl, researchDomain } from "./research";

const decodeXml = (value: string) => value
  .replace(/&amp;/gi, "&")
  .replace(/&lt;/gi, "<")
  .replace(/&gt;/gi, ">")
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'");

export function sitemapUrls(content: string, source: string): string[] {
  const domain = researchDomain(source);
  const candidates = [
    ...[...content.matchAll(/<loc\b[^>]*>\s*([^<]+?)\s*<\/loc>/gi)].map(match => decodeXml(match[1].trim())),
    ...[...content.matchAll(/(?:^|\n)\s*Sitemap:\s*(https:\/\/[^\s<]+)/gi)].map(match => decodeXml(match[1].trim())),
    ...[...content.matchAll(/\[[^\]\n]{0,200}\]\(<?(https:\/\/[^\s)>]+)>?(?:\s+"[^"]*")?\)/gi)].map(match => decodeXml(match[1].trim())),
    ...[...content.matchAll(/https:\/\/[^\s<>'")\]]+/gi)].map(match => decodeXml(match[0].trim())),
  ];
  return [...new Map(candidates.flatMap(value => {
    const safe = publicResearchUrl(value.replace(/[.,;]+$/, ""));
    return safe && researchDomain(safe) === domain ? [[safe, safe] as const] : [];
  })).values()].slice(0, 1000);
}

export function sitemapDocument(url: string) {
  return /(?:sitemap|site-map)[^/]*\.xml$|\/sitemap(?:[_-]index)?\/?$/i.test(new URL(url).pathname);
}

export function sitemapMarkdown(urls: string[]) {
  return urls.filter(url => !sitemapDocument(url)).map(url => `[${new URL(url).pathname}](${url})`).join("\n");
}
