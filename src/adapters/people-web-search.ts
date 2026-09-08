import { cloudflareWebSearch } from "./cloudflare-web-search";
export async function peopleWebSeeds(company: string, domain: string, fetcher: typeof fetch = fetch, legalEntity?: string) {
  const seeds = await cloudflareWebSearch(legalEntity ? `"${legalEntity.slice(0, 160)}" director owner company profile Australia` : `"${company.slice(0, 160)}" ${domain} owner founder director management team Australia`, fetcher);
  return seeds.filter(url => !/rocketreach|zoominfo|signalhire|contactout|whitepages|spokeo|truepeoplesearch/i.test(new URL(url).hostname));
}
