import { pageLinks, researchDomain } from "./research";

// Directories, registers, associations, social networks and people-finder
// sites are sources for discovering businesses, never businesses themselves.
const directoryHosts = /(^|\.)(?:ensun\.io|poidata\.io|yellowpages\.com\.au|yellow\.com\.au|hotfrog\.com(?:\.au)?|truelocal\.com\.au|localsearch\.com\.au|aussieweb\.com\.au|dnb\.com|zoominfo\.com|rocketreach\.co|datanyze\.com|linkedin\.com|facebook\.com|instagram\.com|kompass\.com|thomasnet\.com|industrysearch\.com\.au|ferret\.com\.au|australianmanufacturing\.com\.au|manufacturingdirectory\.com\.au|wikipedia\.org|indeed\.com|seek\.com\.au|glassdoor\.com(?:\.au)?|cylex(?:-australia)?\.com(?:\.au)?|brownbook\.net|startlocal\.com\.au|whereis\.com|business\.gov\.au|asic\.gov\.au|google\.com|bing\.com|duckduckgo\.com|yelp\.com|productreview\.com\.au|amazon\.com(?:\.au)?|ebay\.com(?:\.au)?|alibaba\.com|made-in-china\.com|europages\.[a-z.]+|globalsources\.com|tradeindia\.com|indiamart\.com|reddit\.com|youtube\.com|prospeo\.io|signalhire\.com|contactout\.com|apollo\.io|crunchbase\.com|opencorporates\.com|pinterest\.com|twitter\.com|x\.com|tiktok\.com|amtil\.com\.au|ausindustry\.gov\.au|manufacturershub\.com\.au|supplierdirectory\.com\.au|industrytoday\.com|company-information\.service\.gov\.uk)$/i;
const listingLanguage = /\b(?:directory|listings?|browse (?:all )?(?:companies|suppliers|businesses|members)|\d+ (?:results|companies|suppliers|businesses|members)|find (?:a |an )?(?:suppliers?|manufacturers?|members?)|member directory|supplier search|search results)\b/i;

// Search engines, social networks and people-finder sites are never worth a page read in discovery.
const unreadableHosts = /(^|\.)(?:duckduckgo\.com|google\.com|bing\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|tiktok\.com|pinterest\.com|linkedin\.com|zoominfo\.com|rocketreach\.co|signalhire\.com|contactout\.com|apollo\.io|prospeo\.io|getprospect\.com|aeroleads\.com|clodura\.ai)$/i;
export function unreadableDiscoverySource(url: string): boolean {
  try { return unreadableHosts.test(researchDomain(url)); } catch { return true; }
}
// Funeral homes and crematoria share the vocabulary of funeral suppliers but are
// customers, not targets. A domain naming the service without a supply word is skipped.
export function serviceBusinessDomain(url: string): boolean {
  let domain: string;
  try { domain = researchDomain(url).toLowerCase(); } catch { return false; }
  const label = domain.split(".")[0];
  return /(?:funerals?|cremations?|crematorium|memorials|cemetery|cemeteries|burials?)/.test(label) && !/(?:product|supplies|supply|wholesale|hardware|casket|coffin|urn|manufactur|fittings?)/.test(label);
}
export function directorySource(url: string, markdown = ""): boolean {
  let hostname: string;
  try { hostname = researchDomain(url); } catch { return true; }
  if (directoryHosts.test(hostname)) return true;
  if (!markdown) return false;
  // A listing page links out to many distinct businesses and uses listing vocabulary.
  const external = new Set<string>();
  for (const link of pageLinks(markdown, url)) {
    const domain = researchDomain(link.url);
    if (domain !== hostname && !/^(?:[a-z]{2,3}\.)?(?:linkedin|facebook|instagram|twitter|youtube|google)\./i.test(domain)) external.add(domain);
  }
  return external.size >= 8 && listingLanguage.test(markdown);
}
