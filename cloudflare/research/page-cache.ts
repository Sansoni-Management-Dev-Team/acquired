// Public pages only, keyed by the authenticated run so evidence is never shared
// between organisations. Cache API storage is best-effort and expires after 1h.
export async function cachedPage<T>(cache: Pick<Cache, 'match' | 'put'>, runId: string, url: string, read: () => Promise<T>): Promise<T> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${runId}:${url}`));
  const key = new Request(`https://research-cache.invalid/${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`);
  const previous = await cache.match(key).catch(() => undefined);
  if (previous) return previous.json() as Promise<T>;
  const result = await read();
  // Exceptions and failed reads are never cached.
  if ((result as { status?: string })?.status === 'completed') await cache.put(key, Response.json(result, { headers: { 'Cache-Control': 'max-age=3600' } })).catch(() => {});
  return result;
}
