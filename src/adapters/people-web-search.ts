import { publicResearchUrl } from "@/domain/research";
export async function peopleWebSeeds(company: string, domain: string, fetcher: typeof fetch = fetch) {
  if (!process.env.TAVILY_API_KEY) throw new Error("Public web search is not configured");
  const response = await fetcher("https://api.tavily.com/search", {
    method: "POST", headers: { authorization: `Bearer ${process.env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `"${company.slice(0, 160)}" "${domain}" owner founder director management team`, search_depth: "basic", auto_parameters: false, max_results: 6, include_answer: false, include_raw_content: false, topic: "general" }), signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error("Web search unavailable");
  const data = await response.json() as { results?: { url?: string }[] };
  return (data.results || []).flatMap(r => {
    const url = r.url && publicResearchUrl(r.url);
    return url && !/rocketreach|zoominfo|signalhire|contactout|whitepages|spokeo|truepeoplesearch/i.test(new URL(url).hostname) ? [url] : [];
  }).slice(0, 6);
}
