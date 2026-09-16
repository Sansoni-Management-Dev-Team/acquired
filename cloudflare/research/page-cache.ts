import { ResearchProviderError } from '../../src/domain/research-provider-error';
// Public pages only, isolated by authenticated run. In-flight sharing is a
// best-effort optimisation inside an isolate; persistent cache reuse spans jobs.
const inflight = new WeakMap<object, Map<string, Promise<unknown>>>();
async function pageKey(runId: string, url: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${runId}:${url}`));
  return new Request(`https://research-cache.invalid/${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`);
}
export async function lookupCachedPage<T>(cache: Pick<Cache, 'match'>, runId: string, url: string): Promise<T | null> {
  const hit = await cache.match(await pageKey(runId, url)).catch(() => undefined);
  if (!hit) return null;
  if (hit.headers.get('x-research-missing-page')) throw new ResearchProviderError('provider_error', Number(hit.headers.get('x-research-missing-page')));
  return hit.json() as Promise<T>;
}
export async function cachedPage<T>(cache: Pick<Cache, 'match' | 'put'>, runId: string, url: string, read: () => Promise<T>): Promise<T> {
  const identity = `${runId}:${url}`;
  const pending = inflight.get(cache) || new Map<string, Promise<unknown>>();
  inflight.set(cache, pending);
  const previous = pending.get(identity);
  if (previous) return previous as Promise<T>;
  const request = (async () => {
    const key = await pageKey(runId, url);
    const hit = await lookupCachedPage<T>(cache, runId, url);
    if (hit) return hit;
    try {
      const result = await read();
      if ((result as { status?: string })?.status === 'completed') await cache.put(key, Response.json(result, { headers: { 'Cache-Control': 'max-age=3600' } })).catch(() => {});
      return result;
    } catch (error) {
      // Only confirmed missing URLs are negatively cached. Throttling, credit,
      // authentication, robots, timeout and transport failures remain retryable.
      if (error instanceof ResearchProviderError && [404, 410].includes(error.status)) await cache.put(key, Response.json({}, { headers: { 'Cache-Control': 'max-age=300', 'x-research-missing-page': String(error.status) } })).catch(() => {});
      throw error;
    }
  })();
  pending.set(identity, request);
  try { return await request; } finally { pending.delete(identity); }
}
