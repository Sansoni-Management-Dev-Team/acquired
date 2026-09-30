import { ResearchProviderError } from '../../src/domain/research-provider-error';
import { publicResearchUrl } from '../../src/domain/research';

// Only public unauthenticated page content is shared. Never cache mandate-specific
// relevance, prompts, credentials or extraction output under this public key.
const inflight = new WeakMap<object, Map<string, Promise<unknown>>>();
export const PUBLIC_PAGE_TTL_MS = 60 * 60 * 1000;
export const ORIGIN_FAILURE_TTL_MS = 15000;
export const MISSING_PAGE_TTL_MS = 5 * 60 * 1000;
export type PageCacheEvent = 'hit' | 'miss' | 'coalesced' | 'expired' | 'missing' | 'origin_failure';
export function canonicalPublicPageUrl(value: string): string | null {
  if (!publicResearchUrl(value)) return null;
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  }
  // Preserve meaningful query parameters and www: these can serve distinct pages.
  url.searchParams.sort();
  return url.href;
}
async function pageKey(url: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`public-page-v2:${url}`));
  return new Request(`https://research-cache.invalid/${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`);
}
export async function lookupCachedPage<T>(cache: Pick<Cache, 'match'>, _runId: string, url: string, onEvent?: (event: PageCacheEvent) => void): Promise<T | null> {
  const canonical = canonicalPublicPageUrl(url);
  if (!canonical) { onEvent?.('miss'); return null; }
  const hit = await cache.match(await pageKey(canonical)).catch(() => undefined);
  if (!hit) { onEvent?.('miss'); return null; }
  const expiresAt = Number(hit.headers.get('x-research-expires-at'));
  // Explicit expiry protects correctness even when a cache implementation retains
  // expired entries; a hit never refreshes the original observation timestamp.
  if (!expiresAt || Date.now() >= expiresAt) { onEvent?.('expired'); return null; }
  if (hit.headers.get('x-research-origin-failure')) { onEvent?.('origin_failure'); throw new ResearchProviderError('origin_http_error', Number(hit.headers.get('x-research-origin-failure'))); }
  if (hit.headers.get('x-research-missing-page')) { onEvent?.('missing'); throw new ResearchProviderError('provider_error', Number(hit.headers.get('x-research-missing-page'))); }
  try { const value = await hit.json() as T; onEvent?.('hit'); return value; }
  catch { onEvent?.('miss'); return null; }
}
export async function cachedPage<T>(cache: Pick<Cache, 'match' | 'put'>, runId: string, url: string, read: () => Promise<T>, onEvent?: (event: PageCacheEvent) => void): Promise<T> {
  const identity = canonicalPublicPageUrl(url);
  if (!identity) { onEvent?.('miss'); return read(); }
  const pending = inflight.get(cache) || new Map<string, Promise<unknown>>();
  inflight.set(cache, pending);
  const previous = pending.get(identity);
  if (previous) { onEvent?.('coalesced'); return previous as Promise<T>; }
  const request = (async () => {
    const key = await pageKey(identity);
    const hit = await lookupCachedPage<T>(cache, runId, url, onEvent);
    if (hit) return hit;
    const headers = (ttl: number) => ({ 'Cache-Control': `max-age=${ttl / 1000}`, 'x-research-expires-at': String(Date.now() + ttl) });
    try {
      const result = await read();
      if ((result as { status?: string })?.status === 'completed') await cache.put(key, Response.json(result, { headers: headers(PUBLIC_PAGE_TTL_MS) })).catch(() => {});
      return result;
    } catch (error) {
      // Confirmed website failures can be shared briefly, but never admission,
      // rate limits, reader transport or provider infrastructure failures.
      if (error instanceof ResearchProviderError && [404, 410].includes(error.status)) await cache.put(key, Response.json({}, { headers: { ...headers(MISSING_PAGE_TTL_MS), 'x-research-missing-page': String(error.status) } })).catch(() => {});
      if (error instanceof ResearchProviderError && error.category === 'origin_http_error' && [500, 502, 503, 504].includes(error.status)) await cache.put(key, Response.json({}, { headers: { ...headers(ORIGIN_FAILURE_TTL_MS), 'x-research-origin-failure': String(error.status) } })).catch(() => {});
      throw error;
    }
  })();
  pending.set(identity, request);
  try { return await request; } finally { pending.delete(identity); }
}
