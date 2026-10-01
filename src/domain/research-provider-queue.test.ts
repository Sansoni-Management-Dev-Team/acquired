import { expect, it } from 'vitest';
import { reserveProvider, consumeProvider, releaseProvider, reservationDelay, AI_CONCURRENCY, type ProviderQueue } from './research-provider-queue';
it('queues 40 page/search operations across mandates at safe account-wide intervals', () => {
  let queue: ProviderQueue = {};
  const starts: number[] = [];
  for (let i = 0; i < 40; i++) {
    const r = reserveProvider(queue, `mandate-${i % 2}`, `token-${i}`, i % 2 ? 'page' : 'search', 1000);
    expect(r.reservation).toBeDefined();
    queue = r.queue; starts.push(r.reservation!.after);
  }
  expect(new Set(starts).size).toBe(40);
  expect(starts.every((start, i) => i === 0 || start - starts[i - 1] >= 12000)).toBe(true);
  expect(reserveProvider(queue, 'third', 'overflow', 'page', 1000, 22000).reservation).toBeUndefined();
});
it('keeps legacy AI lane scheduling separate from browser admission', () => {
  let queue: ProviderQueue = { browserAfter: 400000 };
  const starts = [];
  for (let i = 0; i < AI_CONCURRENCY + 1; i++) {
    const r = reserveProvider(queue, 'job', `ai-${i}`, 'ai', 1000);
    queue = r.queue; starts.push(r.reservation!.after);
  }
  expect(starts).toEqual([...Array(AI_CONCURRENCY).fill(1000), 48000]);
  expect(queue.reservations?.every(reservation => reservation.until - reservation.after === 90000)).toBe(true);
  expect(queue.browserAfter).toBe(400000);
});
it('reuses reservations on callback retries and consumes once for the correct job', () => {
  const first = reserveProvider({}, 'job', 'token', 'page', 1000);
  const again = reserveProvider(first.queue, 'job', 'token', 'page', 1500);
  expect(again.reservation).toEqual(first.reservation);
  expect(again.queue.browserAfter).toBe(first.queue.browserAfter);
  expect(consumeProvider(first.queue, 'token', 'other-job', 1500)).toBeNull();
  expect(consumeProvider(first.queue, 'token', 'job', 999)).toBeNull();
  expect(consumeProvider(first.queue, 'token', 'job', 11001)).toBeNull();
  const consumed = consumeProvider(first.queue, 'token', 'job', 1500)!;
  expect(consumeProvider(consumed, 'token', 'job', 1501)).toBeNull();
});

it('tolerates callback latency while preserving actual browser spacing', () => {
 const a = reserveProvider({}, 'a', 'a', 'page', 1000);
 const b = reserveProvider(a.queue, 'b', 'b', 'page', 1000);
 expect(reservationDelay(b.queue, 'b', 'b', 12999)).toBe(1);
 const claimed = consumeProvider(b.queue, 'a', 'a', 8000)!;
 expect(claimed).not.toBeNull();
 expect(consumeProvider(claimed, 'b', 'b', 13000)).toBeNull();
 expect(reservationDelay(claimed, 'b', 'b', 13000)).toBe(5000);
 expect(consumeProvider(claimed, 'b', 'b', 18000)).not.toBeNull();
 expect(reservationDelay(claimed, 'a', 'a', 8001)).toBeNull();
});

it('fills five local page slots immediately and refills a released slot while search stays throttled', async () => {
  const { releaseProvider } = await import('./research-provider-queue');
  let queue: ProviderQueue = { browserAfter: 999999, browserConsumedAfter: 999999 };
  for (let i = 0; i < 5; i++) {
    const r = reserveProvider(queue, `job-${i}`, `page-${i}`, 'page', 1000, 480000, true);
    expect(r.reservation?.after).toBe(1000);
    queue = consumeProvider(r.queue, `page-${i}`, `job-${i}`, 1000)!;
    expect(queue).not.toBeNull();
  }
  expect(reserveProvider(queue, 'sixth', 'sixth', 'page', 1001, 480000, true)).toMatchObject({ queued: true, retryAfterMs: 1000 });
  const search = reserveProvider(queue, 'search', 'search', 'search', 1001, 480000, true);
  expect(search.reservation?.after).toBe(1001);
  queue = consumeProvider(search.queue, 'search', 'search', 1001)!;
  expect(reserveProvider(queue, 'search2', 'search2', 'search', 1001, 480000, true).reservation?.after).toBe(7001);
  queue = releaseProvider(queue, 'page-0', 'wrong-job');
  expect(reserveProvider(queue, 'sixth', 'sixth', 'page', 1002, 480000, true).reservation).toBeUndefined();
  queue = releaseProvider(queue, 'page-0', 'job-0');
  expect(reserveProvider(queue, 'sixth', 'sixth', 'page', 1002, 480000, true).reservation?.after).toBe(1002);
  expect(consumeProvider(queue, 'page-0', 'job-0', 1002)).toBeNull();
});

it('recovers abandoned local slots after their lease and keeps local policy explicitly gated', async () => {
  const { localProviderPolicy, LOCAL_PAGE_LEASE_MS } = await import('./research-provider-queue');
  let queue: ProviderQueue = {};
  for (let i = 0; i < 5; i++) queue = reserveProvider(queue, 'job', `p${i}`, 'page', 1000, 480000, true).queue;
  expect(reserveProvider(queue, 'next', 'next', 'page', 1000 + LOCAL_PAGE_LEASE_MS, 480000, true).reservation).toBeUndefined();
  expect(reserveProvider(queue, 'next', 'next', 'page', 1000 + LOCAL_PAGE_LEASE_MS + 1, 480000, true).reservation).toBeDefined();
  expect(localProviderPolicy({ NODE_ENV: 'development', LOCAL_DEVELOPMENT: 'true', LOCAL_RESEARCH_POLICY: 'development' })).toBe(true);
  expect(localProviderPolicy({ NODE_ENV: 'production', LOCAL_DEVELOPMENT: 'true', LOCAL_RESEARCH_POLICY: 'development' })).toBe(false);
  expect(localProviderPolicy({ NODE_ENV: 'development', LOCAL_DEVELOPMENT: 'true', LOCAL_RESEARCH_POLICY: 'production' })).toBe(false);
  expect(localProviderPolicy({})).toBe(false);
});


it.each([false, true])('isolates website cooldowns for local=%s without delaying other websites or AI', async local => {
  const { coolDownBrowser } = await import('./research-provider-queue');
  let queue = coolDownBrowser({}, 1000, 12000, 'blocked.example');
  expect(queue.browserCooldownUntil).toBeUndefined();
  const first = reserveProvider(queue, 'a', 'a', 'page', 1000, 480000, local, true);
  queue = first.queue;
  expect(reservationDelay(queue, 'a', 'a', 1000, 'blocked.example')).toBe(12000);
  expect(reservationDelay(queue, 'a', 'a', 1000, 'other.example')).toBe(0);
  expect(reservationDelay(queue, 'a', 'a', 13001, 'blocked.example')).toBe(0);
  expect(reserveProvider(queue, 'ai', 'ai', 'ai', 1000, 480000, local, true).retryAfterMs).toBe(0);
});
it('keeps true account capacity cooldowns global and never shortens existing website cooldowns', async () => {
  const { coolDownBrowser } = await import('./research-provider-queue');
  let queue = coolDownBrowser({}, 1000, 20000, 'example.com');
  queue = coolDownBrowser(queue, 1001, 1000, 'example.com');
  expect(queue.domainAfter?.['example.com']).toBe(21000);
  queue = coolDownBrowser(queue, 1000, 12000);
  expect(reserveProvider(queue, 'a', 'a', 'page', 1000, 480000, false, true).reservation).toBeUndefined();
});

it('allows four overlapping sitemap page reads per host, preserves start spacing, and refills after release', () => {
  let queue: ProviderQueue = {};
  for (let i = 0; i < 4; i++) {
    const now = 1000 + i * 4000;
    const reserved = reserveProvider(queue, `job-${i}`, `page-${i}`, 'page', now, 480000, false, true);
    queue = reserved.queue;
    expect(reservationDelay(queue, `page-${i}`, `job-${i}`, now, 'example.com')).toBe(0);
    queue = consumeProvider(queue, `page-${i}`, `job-${i}`, now, 'example.com')!;
  }
  queue = reserveProvider(queue, 'fifth', 'fifth', 'page', 17000, 480000, false, true).queue;
  expect(reservationDelay(queue, 'fifth', 'fifth', 17000, 'example.com')).toBeGreaterThan(0);
  expect(reservationDelay(queue, 'fifth', 'fifth', 17000, 'another.example')).toBe(0);
  queue = releaseProvider(queue, 'page-0', 'job-0');
  expect(reservationDelay(queue, 'fifth', 'fifth', 17000, 'example.com')).toBe(0);
  queue = consumeProvider(queue, 'fifth', 'fifth', 17000, 'example.com')!;
  queue = reserveProvider(queue, 'sixth', 'sixth', 'page', 17001, 480000, false, true).queue;
  expect(reservationDelay(queue, 'sixth', 'sixth', 17001, 'example.com')).toBeGreaterThanOrEqual(2999);
});
