// Account-wide browser capacity is shared by search and page reads. AI has
// independent lanes, so extraction can proceed while browsers are queued.
export type ResearchProvider = 'page' | 'search' | 'ai';
export type ProviderReservation = { token: string; jobId: string; provider: ResearchProvider; after: number; until: number; consumed?: boolean };
export type ProviderQueue = { browserAfter?: number; aiAfter?: number[]; reservations?: ProviderReservation[] };
export const BROWSER_SPACING_MS = 12000;
export const AI_CONCURRENCY = 4;
export function reserveProvider(queue: ProviderQueue, jobId: string, token: string, provider: ResearchProvider, now: number, maxWaitMs = 480000) {
  const reservations = (queue.reservations || []).filter(r => r.until >= now);
  const existing = reservations.find(r => r.token === token && r.jobId === jobId && r.provider === provider && !r.consumed);
  if (existing) return { queue, reservation: existing, retryAfterMs: Math.max(0, existing.after - now) };
  const lanes = Array.from({ length: AI_CONCURRENCY }, (_, i) => queue.aiAfter?.[i] || 0);
  const lane = lanes.indexOf(Math.min(...lanes));
  const after = Math.max(now, provider === 'ai' ? lanes[lane] : queue.browserAfter || 0);
  if (after - now > maxWaitMs) return { queue, retryAfterMs: Math.min(30000, after - now) };
  const reservation: ProviderReservation = { token, jobId, provider, after, until: after + 2000 };
  // An AI operation, including fallback, has a 45-second wall-clock deadline.
  if (provider === 'ai') lanes[lane] = after + 47000;
  return { queue: { ...queue, ...(provider === 'ai' ? { aiAfter: lanes } : { browserAfter: after + BROWSER_SPACING_MS }), reservations: [...reservations.filter(r => r.token !== token), reservation] }, reservation, retryAfterMs: after - now };
}
export function consumeProvider(queue: ProviderQueue, token: string, jobId: string, now: number) {
  const reservation = queue.reservations?.find(r => r.token === token && r.jobId === jobId && !r.consumed && r.after <= now && r.until >= now);
  if (!reservation) return null;
  return { ...queue, reservations: queue.reservations!.map(r => r === reservation ? { ...r, consumed: true } : r) };
}
