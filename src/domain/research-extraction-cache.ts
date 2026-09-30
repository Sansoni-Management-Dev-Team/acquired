// Private run-scoped reuse. Full request hashing includes mandate context, page
// content, schema and extraction options; no assessments enter the public cache.
export const EXTRACTION_CACHE_VERSION = 'research-extraction-v1';
const inflight = new WeakMap<object, Map<string, Promise<unknown>>>();
async function extractionKey(runId: string, request: unknown) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([EXTRACTION_CACHE_VERSION, runId, request])));
  return new Request(`https://research-cache.invalid/extraction/${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`);
}
export async function cachedResearchExtraction<T>(cache: Pick<Cache, 'match' | 'put'>, runId: string, request: unknown, read: () => Promise<T>, onEvent?: (event: 'hit' | 'miss' | 'coalesced') => void): Promise<T> {
  if (!runId) return read();
  const key = await extractionKey(runId, request);
  const pending = inflight.get(cache) || new Map<string, Promise<unknown>>();
  inflight.set(cache, pending);
  const previous = pending.get(key.url);
  if (previous) { onEvent?.('coalesced'); return previous as Promise<T>; }
  const operation = (async () => {
    const hit = await cache.match(key).catch(() => undefined);
    if (hit && Number(hit.headers.get('x-research-expires-at')) > Date.now()) {
      onEvent?.('hit');
      return hit.json() as Promise<T>;
    }
    onEvent?.('miss');
    const result = await read(); // The caller validates provider output before caching.
    await cache.put(key, Response.json(result, { headers: { 'Cache-Control': 'max-age=3600', 'x-research-expires-at': String(Date.now() + 3600000) } })).catch(() => {});
    return result;
  })();
  pending.set(key.url, operation);
  try { return await operation; } finally { pending.delete(key.url); }
}
