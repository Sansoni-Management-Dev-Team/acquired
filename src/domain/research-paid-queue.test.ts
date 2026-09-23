import { expect, it } from 'vitest';
import { consumeProvider, coolDownBrowser, releaseProvider, reservationDelay, reserveProvider, AI_CONCURRENCY, PAID_PAGE_SLOTS, PAID_SEARCH_SLOTS, PAID_START_SPACING_MS, PAID_SEARCH_HOST_SPACING_MS, type ProviderQueue } from './research-provider-queue';
const reserve = (q: ProviderQueue, job: string, provider: 'page'|'search'|'ai', now: number, token = job) => reserveProvider(q, job, token, provider, now, undefined, false, true);
it('fills the page slots, keeps search slots separate, and staggers starts', () => {
  let queue: ProviderQueue = {};
  for (let i = 0; i < PAID_PAGE_SLOTS; i++) {
    const now = 1000 + i * 1000;
    const r = reserve(queue, `p${i}`, 'page', now);
    expect(r.reservation).toBeDefined();
    queue = consumeProvider(r.queue, `p${i}`, `p${i}`, r.reservation!.after, `site${i}.com`)!;
    // A start inside the spacing window is scheduled, never refused.
    expect(reserve(queue, 'early', 'search', now + 100).reservation?.after).toBeGreaterThanOrEqual(now + PAID_START_SPACING_MS);
  }
  const later = 1000 + PAID_PAGE_SLOTS * 1000;
  expect(reserve(queue, 'extra', 'page', later)).toMatchObject({ queued: true });
  // Searches share one host, so consecutive starts stay one second apart.
  for (let i = 0; i < PAID_SEARCH_SLOTS; i++) {
    const search = reserve(queue, `s${i}`, 'search', later + i * 4000);
    expect(search.reservation).toBeDefined();
    queue = consumeProvider(search.queue, `s${i}`, `s${i}`, search.reservation!.after, 'duckduckgo.com')!;
  }
  expect(reserve(queue, 'extra-search', 'search', later + 20000).reservation).toBeUndefined();
  queue = releaseProvider(queue, 'p0', 'p0');
  expect(reserve(queue, 'next', 'page', later + 20000).reservation).toBeDefined();
});
it('keeps a paid reservation live while a coordinated callback reaches the browser', () => {
  const result=reserve({},'job','search',1000);
  expect(result.reservation?.until).toBe(91000);
  expect(consumeProvider(result.queue,'job','job',70000,'duckduckgo.com')).not.toBeNull();
});
it('releases managed AI capacity immediately and preserves FIFO waits', () => {
  let queue: ProviderQueue={};
  for(let i=0;i<AI_CONCURRENCY;i++){
    const result=reserve(queue,`ai-${i}`,'ai',1000);
    queue=result.queue;
    expect(result.reservation).toBeDefined();
  }
  const waiting=reserveProvider(queue,'waiting','waiting','ai',1000,undefined,false,true);
  queue=waiting.queue;
  expect(waiting).toMatchObject({queued:true,retryAfterMs:1000});
  queue=releaseProvider(queue,'ai-0','ai-0');
  expect(reserveProvider(queue,'later','later','ai',1001,undefined,false,true).reservation).toBeUndefined();
  expect(reserveProvider(queue,'waiting','waiting','ai',1001,undefined,false,true).reservation).toBeDefined();
});
it('preserves FIFO page waits and prevents wrong-job releases', () => {
  let queue: ProviderQueue = {};
  for (let i=0;i<PAID_PAGE_SLOTS;i++) { const r=reserve(queue, `p${i}`, 'page', 1000+i*1000); queue=consumeProvider(r.queue,`p${i}`,`p${i}`,r.reservation!.after)!; }
  const t = 1000 + PAID_PAGE_SLOTS * 1000;
  queue=reserve(queue,'first','page',t).queue;
  queue=reserve(queue,'second','page',t).queue;
  queue=releaseProvider(queue,'p0','wrong');
  expect(reserve(queue,'first','page',t+1000).reservation).toBeUndefined();
  queue=releaseProvider(queue,'p0','p0');
  expect(reserve(queue,'second','page',t+1000).reservation).toBeUndefined();
  expect(reserve(queue,'first','page',t+1000).reservation).toBeDefined();
});
it('paces each domain and prevents overlapping reads until release', () => {
  const a=reserve({},'a','page',1000);
  let queue: ProviderQueue=consumeProvider(a.queue,'a','a',1000,'example.com')!;
  const b=reserve(queue,'b','page',2000);queue=b.queue;
  expect(consumeProvider(queue,'b','b',2000,'example.com')).toBeNull();
  queue=releaseProvider(queue,'a','a');
  expect(reservationDelay(queue,'b','b',2000,'example.com')).toBe(2000);
  expect(consumeProvider(queue,'b','b',4000,'example.com')).not.toBeNull();
});
it('recovers abandoned leases, rejects token reuse and honours rate-limit cooldowns', () => {
  const r=reserve({},'a','page',1000);const queue=consumeProvider(r.queue,'a','a',1000)!;
  expect(reserve(queue,'a','page',3000).reservation).toBeUndefined();
  let full=queue;
  for(let i=1;i<4;i++){const r=reserve(full,`p${i}`,'page',1000+i*1000);full=consumeProvider(r.queue,`p${i}`,`p${i}`,1000+i*1000)!;}
  expect(reserve(full,'next','page',70000).reservation).toBeDefined();
  const cooldown=coolDownBrowser({},1000,30000);
  expect(reserve(cooldown,'next','search',2000)).toMatchObject({queued:true,retryAfterMs:29000});
  expect(reserve(cooldown,'next','search',31000).reservation).toBeDefined();
});
it('respects legacy in-flight browser pacing during rolling deployment', () => {
  const old=reserveProvider({},'old','old','page',1000);
  const q=consumeProvider(old.queue,'old','old',1000)!;
  expect(reserve(q,'new','search',2000).reservation?.after).toBe(11000);
  expect(reserve(q,'new','search',11000).reservation?.after).toBe(11000);
});
it('admits every waiter that fits free capacity in the same tick and keeps FIFO for the last slot', () => {
  let queue: ProviderQueue = {};
  // Fill all but one page slot; every poller is admitted while capacity remains.
  for (let i = 0; i < PAID_PAGE_SLOTS - 1; i++) { const r = reserve(queue, `p${i}`, 'page', 1000 + i * 1000); queue = r.queue; expect(r.reservation, `p${i}`).toBeDefined(); }
  const t = 1000 + PAID_PAGE_SLOTS * 1000;
  // Two more wait for the single remaining slot; the earlier waiter wins it.
  queue = reserve(queue, 'd', 'page', t).queue;
  queue = reserve(queue, 'e', 'page', t + 100).queue;
  expect(reserve(queue, 'e', 'page', t + 200).reservation).toBeUndefined();
  const d = reserve(queue, 'd', 'page', t + 200); queue = d.queue;
  expect(d.reservation).toBeDefined();
  expect(reserve(queue, 'e', 'page', t + 300)).toMatchObject({ queued: true });
  // Search capacity is independent of page waiters.
  expect(reserve(queue, 's', 'search', t + 300).reservation).toBeDefined();
});
it('lets any poller take a released slot instead of idling until the head waiter returns', () => {
  let queue: ProviderQueue = {};
  for (let i = 0; i < PAID_PAGE_SLOTS; i++) { const r = reserve(queue, `p${i}`, 'page', 1000 + i * 1000); queue = consumeProvider(r.queue, `p${i}`, `p${i}`, r.reservation!.after)!; }
  const t = 1000 + PAID_PAGE_SLOTS * 1000;
  queue = reserve(queue, 'head', 'page', t).queue;
  queue = reserve(queue, 'second', 'page', t + 100).queue;
  queue = releaseProvider(queue, 'p0', 'p0');
  queue = releaseProvider(queue, 'p1', 'p1');
  // Two slots free: the second waiter is admitted even though it polls first.
  const second = reserve(queue, 'second', 'page', t + 1000); queue = second.queue;
  expect(second.reservation).toBeDefined();
  const head = reserve(queue, 'head', 'page', t + 1100); queue = head.queue;
  expect(head.reservation).toBeDefined();
  expect(reserve(queue, 'third', 'page', t + 1200)).toMatchObject({ queued: true });
});
it('sustains near slot capacity under polling contention', () => {
  // Discrete-event model: each job reserves, reads for 3.2 s, releases, then re-polls; refused jobs poll again after 3.6 s.
  const simulate = (jobs: number) => {
    let queue: ProviderQueue = {}; let reads = 0; let now = 0;
    const next = Array.from({ length: jobs }, (_, i) => ({ id: `job-${i}`, at: i * 50, token: 0 }));
    while (now < 600000) {
      next.sort((a, b) => a.at - b.at); const j = next[0]; now = j.at; if (now >= 600000) break;
      const token = `${j.id}:${j.token++}`;
      const r = reserve(queue, j.id, 'page', now, token); queue = r.queue;
      // A granted start in the near future is a short Workflow sleep before the claim.
      const startAt = r.reservation ? Math.max(now, r.reservation.after) : now;
      const consumed = r.reservation ? consumeProvider(queue, token, j.id, startAt, `${j.id}.example.com`) : null;
      if (consumed) { queue = releaseProvider(consumed, token, j.id); reads++; j.at = startAt + 3800; continue; }
      j.at = now + 3600;
    }
    return reads;
  };
  // Start spacing of 350 ms allows about 1,700 reads in ten minutes; the old head-of-line gate managed about 165.
  expect(simulate(4)).toBeGreaterThan(500);
  expect(simulate(23)).toBeGreaterThan(1500);
});

it('starts four overlapping searches one second apart while page reads on one website still cannot overlap', () => {
  const a = reserve({}, 'a', 'search', 1000);
  let queue: ProviderQueue = consumeProvider(a.queue, 'a', 'a', 1000, 'duckduckgo.com')!;
  for (let i = 1; i < PAID_SEARCH_SLOTS; i++) {
    const at = 1000 + i * PAID_SEARCH_HOST_SPACING_MS;
    const job = `search-${i}`;
    const result = reserve(queue, job, 'search', at - 1);
    queue = result.queue;
    expect(result.reservation).toBeDefined();
    expect(consumeProvider(queue, job, job, at - 1, 'duckduckgo.com')).toBeNull();
    queue = consumeProvider(queue, job, job, at, 'duckduckgo.com')!;
    expect(queue).not.toBeNull();
  }
  const p1 = reserve({}, 'p1', 'page', 1000);
  let pages: ProviderQueue = consumeProvider(p1.queue, 'p1', 'p1', 1000, 'example.com')!;
  pages = reserve(pages, 'p2', 'page', 5000).queue;
  expect(consumeProvider(pages, 'p2', 'p2', 5000, 'example.com')).toBeNull();
});
