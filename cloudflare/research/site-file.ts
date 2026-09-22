import { publicResearchUrl } from "../../src/domain/research";
import { ResearchProviderError } from "../../src/domain/research-provider-error";

// robots.txt and sitemap documents are static text. Reading them with a plain
// request avoids a rendered browser session and its admission queue entirely.
export const SITE_FILE_MAX_CHARACTERS = 512000;
export async function readSiteText(url: string, fetcher: typeof fetch = fetch, onRequest?: () => void) {
  if (!publicResearchUrl(url)) throw new Error("Unsupported public URL");
  onRequest?.();
  const response = await fetcher(url, {
    method: "GET", redirect: "follow", signal: AbortSignal.timeout(10000),
    headers: { accept: "text/plain, application/xml, text/xml;q=0.9, */*;q=0.1" },
  });
  if (!response.ok) { await response.body?.cancel(); throw new ResearchProviderError("provider_error", response.status); }
  const finalUrl = publicResearchUrl(response.url || url);
  if (!finalUrl) { await response.body?.cancel(); throw new ResearchProviderError("provider_error"); }
  // A rendered HTML page means the site has no such file; treat it like a missing document.
  if (/text\/html/i.test(response.headers.get("content-type") || "")) { await response.body?.cancel(); throw new ResearchProviderError("provider_error", 404); }
  const text = (await response.text()).slice(0, SITE_FILE_MAX_CHARACTERS);
  if (!text.trim()) throw new ResearchProviderError("provider_error", 404);
  return { status: "completed", page: { url: finalUrl, markdown: text, observedAt: new Date().toISOString() } };
}
