import { publicResearchUrl } from "../../src/domain/research";
import { unusablePage } from "../../src/domain/page-quality";
export async function readFallback(url: string, endpoint: string, secret: string, fetcher: typeof fetch = fetch) {
  if (!publicResearchUrl(url) || !secret) return { status: "failed", warning: "Fallback reader is not configured" };
  try {
    const base = new URL(endpoint);
    if (base.protocol !== "https:") throw new Error("HTTPS required");
    const response = await fetcher(new URL("/crawl", base), {
      method: "POST", headers: { authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }), signal: AbortSignal.timeout(45000), redirect: "error",
    });
    if (response.status === 429) {
      const seconds = Number(response.headers.get("retry-after") || 3);
      return { status: "failed", deferred: true, retryAfterMs: Math.max(1000, Math.min(60000, Number.isFinite(seconds) ? seconds * 1000 : 3000)), warning: "Fallback reader busy or domain cooling down" };
    }
    if (!response.ok) return { status: "failed", warning: `Fallback reader unavailable (${response.status})` };
    const result = await response.json() as { url?: string; markdown?: string };
    const finalUrl = result.url && publicResearchUrl(result.url);
    if (!finalUrl || typeof result.markdown !== "string" || unusablePage(result.markdown)) return { status: "failed", warning: "Fallback returned no usable public content" };
    return { status: "completed", page: { url: finalUrl, markdown: result.markdown.slice(0, 30000) } };
  } catch { return { status: "failed", warning: "Fallback page read failed" }; }
}
