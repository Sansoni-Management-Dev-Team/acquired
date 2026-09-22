// Production shares browser spacing across search and page reads. Local reads
// use three completion-released slots; local search and AI have separate limits.
export type ResearchProvider = 'page' | 'search' | 'ai';
export type ProviderReservation = { token: string; jobId: string; provider: ResearchProvider; after: number; until: number; consumed?: boolean; local?: boolean; released?: boolean; paid?: boolean; domain?: string };
export type ProviderQueue = { localSearchAfter?: number; localSearchConsumedAfter?: number; browserAfter?: number; browserConsumedAfter?: number; aiAfter?: number[]; reservations?: ProviderReservation[]; browserCooldownUntil?: number; browserStartAfter?: number; domainAfter?: Record<string, number>; browserWaiters?: { jobId: string; provider: ResearchProvider; since: number }[]; aiWaiters?: { jobId: string; since: number }[] };
export const BROWSER_SPACING_MS = 12000;
// Local OpenSERP tolerates closer spacing than the rendered DuckDuckGo page.
export const LOCAL_SEARCH_SPACING_MS = 6000;
const LOCAL_SEARCH_CONSUMED_MS = 5000;
export const AI_CONCURRENCY = 8;
export const LOCAL_PAGE_CONCURRENCY = 3;
// Longer than a local read's 45-second deadline; abandoned slots recover automatically.
export const LOCAL_PAGE_LEASE_MS = 60000;
export function localProviderPolicy(env: { NODE_ENV?: string; LOCAL_DEVELOPMENT?: string; LOCAL_RESEARCH_POLICY?: string }) {
  return env.NODE_ENV === 'development' && env.LOCAL_DEVELOPMENT === 'true' && env.LOCAL_RESEARCH_POLICY === 'development';
}
export function reserveProvider(queue: ProviderQueue, jobId: string, token: string, provider: ResearchProvider, now: number, maxWaitMs = 480000, local = false, paid = false) {
  const reservations = (queue.reservations || []).filter(r => r.until >= now);
  const existing = reservations.find(r => r.token === token && r.jobId === jobId && r.provider === provider && !r.consumed);
  if (existing) return { queue, reservation: existing, retryAfterMs: Math.max(0, existing.after - now) };
  if (paid && provider === 'ai') return reserveManagedAi(queue, jobId, token, now);
  if (local && provider === 'page') {
    if (reservations.some(r => r.token === token && r.jobId === jobId && r.consumed)) return { queue, retryAfterMs: 1000 };
    const active = reservations.filter(r => r.local && r.provider === 'page' && !r.released);
    if (active.length >= LOCAL_PAGE_CONCURRENCY) return { queue, retryAfterMs: 1000, queued: true };
    const reservation: ProviderReservation = { token, jobId, provider, local: true, after: now, until: now + LOCAL_PAGE_LEASE_MS };
    return { queue: { ...queue, reservations: [...reservations, reservation] }, reservation, retryAfterMs: 0 };
  }
  if (paid && !local && provider !== 'ai') return reservePaidBrowser(queue, jobId, token, provider, now);
  const lanes = Array.from({ length: AI_CONCURRENCY }, (_, i) => queue.aiAfter?.[i] || 0);
  const lane = lanes.indexOf(Math.min(...lanes));
  const after = Math.max(now, provider === 'ai' ? lanes[lane] : (local ? queue.localSearchAfter : queue.browserAfter) || 0);
  if (after - now > maxWaitMs) return { queue, retryAfterMs: Math.min(30000, after - now) };
  // AI work can be delayed after its durable Workflow sleep when many instances
  // wake together. Keep the scheduled lane claim valid through that dispatch lag.
  const reservation: ProviderReservation = { token, jobId, provider, ...(local ? { local: true } : {}), after, until: after + (provider === 'ai' ? 90000 : 10000) };
  // An AI operation, including fallback, has a 45-second wall-clock deadline.
  if (provider === 'ai') lanes[lane] = after + 47000;
  return { queue: { ...queue, ...(provider === 'ai' ? { aiAfter: lanes } : { [local ? 'localSearchAfter' : 'browserAfter']: after + (local ? LOCAL_SEARCH_SPACING_MS : BROWSER_SPACING_MS) }), reservations: [...reservations.filter(r => r.token !== token), reservation] }, reservation, retryAfterMs: after - now };
}
export function consumeProvider(queue: ProviderQueue, token: string, jobId: string, now: number, domain?: string) {
  const reservation = queue.reservations?.find(r => r.token === token && r.jobId === jobId && !r.consumed && r.after <= now && r.until >= now);
  if (!reservation || providerConsumedAfter(queue, reservation, domain) > now) return null;
  return { ...queue, ...(reservation.provider !== 'ai' && !(reservation.local && reservation.provider === 'page') ? { [reservation.local ? 'localSearchConsumedAfter' : 'browserConsumedAfter']: now + (reservation.paid ? PAID_START_SPACING_MS : reservation.local ? LOCAL_SEARCH_CONSUMED_MS : 10000) } : {}), ...(reservation.paid && domain ? { domainAfter: { ...queue.domainAfter, [domain]: now + 3000 } } : {}), reservations: queue.reservations!.map(r => r === reservation ? { ...r, consumed: true, ...((r.local && r.provider === 'page') || r.paid ? { until: now + LOCAL_PAGE_LEASE_MS, ...(domain ? { domain } : {}) } : {}) } : r) };
}

// A slightly early wake-up retains its place instead of joining the queue again.
export function reservationDelay(queue: ProviderQueue, token: string, jobId: string, now: number, domain?: string) {
  const r = queue.reservations?.find(r => r.token === token && r.jobId === jobId && !r.consumed && r.until >= now);
  if (!r) return null;
  return Math.max(0, r.after - now, providerConsumedAfter(queue, r, domain) - now);
}

function providerConsumedAfter(queue: ProviderQueue, r: ProviderReservation, domain?: string) {
  if (r.provider === 'ai' || (r.local && r.provider === 'page')) return 0;
  const shared = (r.local ? queue.localSearchConsumedAfter : queue.browserConsumedAfter) || 0;
  if (!r.paid) return shared;
  // Company websites never receive overlapping reads. Searches all target the
  // one search host, so they may overlap while keeping the start spacing.
  const activeDomain = domain && r.provider !== 'search' ? (queue.reservations || []).filter(x => x.token !== r.token && x.domain === domain && x.consumed && !x.released).reduce((end, x) => Math.max(end, x.until), 0) : 0;
  return Math.max(shared, queue.browserCooldownUntil || 0, domain ? queue.domainAfter?.[domain] || 0 : 0, activeDomain);
}
export function releaseProvider(queue: ProviderQueue, token: string, jobId: string): ProviderQueue {
  return { ...queue, reservations: queue.reservations?.map(r => r.token === token && r.jobId === jobId && ((r.local && r.provider === 'page') || r.paid) ? { ...r, consumed: true, released: true } : r) };
}

// AI capacity is a real concurrent pool. A slot is released as soon as the
// provider call finishes instead of remaining blocked for a fixed interval.
function reserveManagedAi(queue: ProviderQueue, jobId: string, token: string, now: number) {
  const reservations = (queue.reservations || []).filter(r => r.until >= now);
  if (reservations.some(r => r.token === token && r.jobId === jobId)) return { queue, queued: true, retryAfterMs: 1000 };
  const active = reservations.filter(r => r.paid && r.provider === 'ai' && !r.released);
  const waiters = (queue.aiWaiters || []).filter(waiter => waiter.since > now - 120000);
  if (!waiters.some(waiter => waiter.jobId === jobId)) waiters.push({ jobId, since: now });
  const next = { ...queue, reservations, aiWaiters: waiters.map(waiter => waiter.jobId === jobId ? { ...waiter, since: now } : waiter) };
  if (active.length >= AI_CONCURRENCY || waiters[0]?.jobId !== jobId) return { queue: next, queued: true, retryAfterMs: 1000 };
  const reservation: ProviderReservation = { token, jobId, provider: 'ai', paid: true, after: now, until: now + 90000 };
  return { queue: { ...next, reservations: [...reservations, reservation], aiWaiters: waiters.filter(waiter => waiter.jobId !== jobId) }, reservation, retryAfterMs: 0 };
}


// Separate page and search slot counts prevent either workload monopolising the pool.
// Any waiter is admitted while its workload has free capacity; FIFO order only
// decides who takes the last free slot, so a slot never idles waiting for the
// head of the queue to poll again. No long future bookings.
// Demand tops out near 24 concurrent reads per run (8 candidates plus 8 businesses
// with paired jobs); 32 page slots cover a run plus a second mandate. Browser
// Rendering allows 200 concurrent sessions and 3 new browsers a second, so starts
// are staggered 350 ms apart instead of one second.
export const PAID_PAGE_SLOTS = 32;
export const PAID_SEARCH_SLOTS = 4;
export const PAID_START_SPACING_MS = 350;
export const PAID_BROWSER_SLOTS = PAID_PAGE_SLOTS + PAID_SEARCH_SLOTS;
function reservePaidBrowser(queue: ProviderQueue, jobId: string, token: string, provider: ResearchProvider, now: number) {
  const reservations = (queue.reservations || []).filter(r => r.until >= now);
  if (reservations.some(r => r.token === token && r.jobId === jobId)) return { queue, queued: true, retryAfterMs: 3000 };
  const active = reservations.filter(r => !r.released && !r.local && r.provider !== 'ai');
  const waiters = (queue.browserWaiters || []).filter(w => w.since > now - 60000);
  if (!waiters.some(w => w.jobId === jobId && w.provider === provider)) waiters.push({ jobId, provider, since: now });
  const rank = waiters.filter(w => w.provider === provider).findIndex(w => w.jobId === jobId);
  const free = Math.min(PAID_BROWSER_SLOTS - active.length, (provider === 'search' ? PAID_SEARCH_SLOTS : PAID_PAGE_SLOTS) - active.filter(r => r.provider === provider).length);
  // Browser starts are staggered by scheduling the start time into the grant
  // instead of refusing the poller; the Workflow sleeps briefly.
  const start = Math.max(now, queue.browserConsumedAfter || 0, queue.browserCooldownUntil || 0, queue.browserStartAfter || 0);
  const next = { ...queue, reservations, domainAfter: Object.fromEntries(Object.entries(queue.domainAfter || {}).filter(([, after]) => after > now)), browserWaiters: waiters.map(w => w.jobId === jobId && w.provider === provider ? { ...w, since: now } : w) };
  if (free <= 0 || rank >= free || start - now > 10000) return { queue: next, queued: true, retryAfterMs: Math.max(1000, Math.min(30000, start - now)) };
  // A Vercel discovery callback can perform database coordination before it
  // reaches the nested browser request, especially when many jobs wake at once.
  const reservation: ProviderReservation = { token, jobId, provider, paid: true, after: start, until: start + 90000 };
  return { queue: { ...next, browserStartAfter: start + PAID_START_SPACING_MS, reservations: [...reservations, reservation], browserWaiters: waiters.filter(w => w.jobId !== jobId || w.provider !== provider) }, reservation, retryAfterMs: start - now };
}
export function coolDownBrowser(queue: ProviderQueue, now: number, retryAfterMs: number): ProviderQueue {
  return { ...queue, browserCooldownUntil: Math.max(queue.browserCooldownUntil || 0, now + Math.max(1000, Math.min(300000, retryAfterMs))) };
}
