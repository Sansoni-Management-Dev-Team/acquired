// Production shares browser spacing across search and page reads. Local reads
// use three completion-released slots; local search and AI have separate limits.
export type ResearchProvider = 'page' | 'search' | 'ai';
export type ProviderReservation = { token: string; jobId: string; provider: ResearchProvider; after: number; until: number; consumed?: boolean; local?: boolean; released?: boolean };
export type ProviderQueue = { localSearchAfter?: number; localSearchConsumedAfter?: number; browserAfter?: number; browserConsumedAfter?: number; aiAfter?: number[]; reservations?: ProviderReservation[] };
export const BROWSER_SPACING_MS = 12000;
export const AI_CONCURRENCY = 4;
export const LOCAL_PAGE_CONCURRENCY = 3;
// Longer than a local read's 45-second deadline; abandoned slots recover automatically.
export const LOCAL_PAGE_LEASE_MS = 60000;
export function localProviderPolicy(env: { NODE_ENV?: string; LOCAL_DEVELOPMENT?: string; LOCAL_RESEARCH_POLICY?: string }) {
  return env.NODE_ENV === 'development' && env.LOCAL_DEVELOPMENT === 'true' && env.LOCAL_RESEARCH_POLICY === 'development';
}
export function reserveProvider(queue: ProviderQueue, jobId: string, token: string, provider: ResearchProvider, now: number, maxWaitMs = 480000, local = false) {
  const reservations = (queue.reservations || []).filter(r => r.until >= now);
  const existing = reservations.find(r => r.token === token && r.jobId === jobId && r.provider === provider && !r.consumed);
  if (existing) return { queue, reservation: existing, retryAfterMs: Math.max(0, existing.after - now) };
  if (local && provider === 'page') {
    if (reservations.some(r => r.token === token && r.jobId === jobId && r.consumed)) return { queue, retryAfterMs: 1000 };
    const active = reservations.filter(r => r.local && r.provider === 'page' && !r.released);
    if (active.length >= LOCAL_PAGE_CONCURRENCY) return { queue, retryAfterMs: 1000, queued: true };
    const reservation: ProviderReservation = { token, jobId, provider, local: true, after: now, until: now + LOCAL_PAGE_LEASE_MS };
    return { queue: { ...queue, reservations: [...reservations, reservation] }, reservation, retryAfterMs: 0 };
  }
  const lanes = Array.from({ length: AI_CONCURRENCY }, (_, i) => queue.aiAfter?.[i] || 0);
  const lane = lanes.indexOf(Math.min(...lanes));
  const after = Math.max(now, provider === 'ai' ? lanes[lane] : (local ? queue.localSearchAfter : queue.browserAfter) || 0);
  if (after - now > maxWaitMs) return { queue, retryAfterMs: Math.min(30000, after - now) };
  const reservation: ProviderReservation = { token, jobId, provider, ...(local ? { local: true } : {}), after, until: after + 10000 };
  // An AI operation, including fallback, has a 45-second wall-clock deadline.
  if (provider === 'ai') lanes[lane] = after + 47000;
  return { queue: { ...queue, ...(provider === 'ai' ? { aiAfter: lanes } : { [local ? 'localSearchAfter' : 'browserAfter']: after + BROWSER_SPACING_MS }), reservations: [...reservations.filter(r => r.token !== token), reservation] }, reservation, retryAfterMs: after - now };
}
export function consumeProvider(queue: ProviderQueue, token: string, jobId: string, now: number) {
  const reservation = queue.reservations?.find(r => r.token === token && r.jobId === jobId && !r.consumed && r.after <= now && r.until >= now);
  if (!reservation || providerConsumedAfter(queue, reservation) > now) return null;
  return { ...queue, ...(reservation.provider !== 'ai' && !(reservation.local && reservation.provider === 'page') ? { [reservation.local ? 'localSearchConsumedAfter' : 'browserConsumedAfter']: now + 10000 } : {}), reservations: queue.reservations!.map(r => r === reservation ? { ...r, consumed: true, ...(r.local && r.provider === 'page' ? { until: now + LOCAL_PAGE_LEASE_MS } : {}) } : r) };
}

// A slightly early wake-up retains its place instead of joining the queue again.
export function reservationDelay(queue: ProviderQueue, token: string, jobId: string, now: number) {
  const r = queue.reservations?.find(r => r.token === token && r.jobId === jobId && !r.consumed && r.until >= now);
  if (!r) return null;
  return Math.max(0, r.after - now, providerConsumedAfter(queue, r) - now);
}

function providerConsumedAfter(queue: ProviderQueue, r: ProviderReservation) {
  if (r.provider === 'ai' || (r.local && r.provider === 'page')) return 0;
  return (r.local ? queue.localSearchConsumedAfter : queue.browserConsumedAfter) || 0;
}
export function releaseProvider(queue: ProviderQueue, token: string, jobId: string): ProviderQueue {
  return { ...queue, reservations: queue.reservations?.map(r => r.token === token && r.jobId === jobId && r.local && r.provider === 'page' ? { ...r, consumed: true, released: true } : r) };
}
