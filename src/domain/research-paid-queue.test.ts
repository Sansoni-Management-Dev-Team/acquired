import { expect, it } from 'vitest';
import { consumeProvider, coolDownBrowser, releaseProvider, reservationDelay, reserveProvider, type ProviderQueue } from './research-provider-queue';
const reserve = (q: ProviderQueue, job: string, provider: 'page'|'search'|'ai', now: number, token = job) => reserveProvider(q, job, token, provider, now, undefined, false, true);
it('allows four concurrent pages and reserves a fifth slot for search; starts are spaced one second', () => {
  let queue: ProviderQueue = {};
  for (let i = 0; i < 4; i++) {
    const now = 1000 + i * 1000;
    const r = reserve(queue, `p${i}`, 'page', now);
    expect(r.reservation).toBeDefined();
    queue = consumeProvider(r.queue, `p${i}`, `p${i}`, now, `site${i}.com`)!;
    // A start inside the one-second spacing is scheduled, never refused.
    expect(reserve(queue, 'early', 'search', now + 999).reservation?.after).toBeGreaterThanOrEqual(now + 1000);
  }
  expect(reserve(queue, 'extra', 'page', 5000)).toMatchObject({ queued: true });
  const search = reserve(queue, 'early', 'search', 5000);
  expect(search.reservation).toBeDefined();
  queue = consumeProvider(search.queue, 'early', 'early', 5000, 'duckduckgo.com')!;
  expect(reserve(queue, 'second-search', 'search', 6000).reservation).toBeUndefined();
  queue = releaseProvider(queue, 'p0', 'p0');
  expect(reserve(queue, 'next', 'page', 6000).reservation).toBeDefined();
});
it('keeps a paid reservation live while a coordinated callback reaches the browser', () => {
  const result=reserve({},'job','search',1000);
  expect(result.reservation?.until).toBe(91000);
  expect(consumeProvider(result.queue,'job','job',70000,'duckduckgo.com')).not.toBeNull();
});
it('releases managed AI capacity immediately and preserves FIFO waits', () => {
  let queue: ProviderQueue={};
  for(let i=0;i<8;i++){
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
  for (let i=0;i<4;i++) { const r=reserve(queue, `p${i}`, 'page', 1000+i*1000); queue=consumeProvider(r.queue,`p${i}`,`p${i}`,1000+i*1000)!; }
  queue=reserve(queue,'first','page',5000).queue;
  queue=reserve(queue,'second','page',5000).queue;
  queue=releaseProvider(queue,'p0','wrong');
  expect(reserve(queue,'first','page',6000).reservation).toBeUndefined();
  queue=releaseProvider(queue,'p0','p0');
  expect(reserve(queue,'second','page',6000).reservation).toBeUndefined();
  expect(reserve(queue,'first','page',6000).reservation).toBeDefined();
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
  // Three jobs poll while all four page slots are free: none should be refused.
  for (const job of ['a', 'b', 'c']) { const r = reserve(queue, job, 'page', 1000); queue = r.queue; expect(r.reservation, job).toBeDefined(); }
  // Two more wait for the single remaining slot; the earlier waiter wins it.
  queue = reserve(queue, 'd', 'page', 1100).queue;
  queue = reserve(queue, 'e', 'page', 1200).queue;
  expect(reserve(queue, 'e', 'page', 1300).reservation).toBeUndefined();
  const d = reserve(queue, 'd', 'page', 1300); queue = d.queue;
  expect(d.reservation).toBeDefined();
  expect(reserve(queue, 'e', 'page', 1400)).toMatchObject({ queued: true });
  // Search capacity is independent of page waiters.
  expect(reserve(queue, 's', 'search', 1400).reservation).toBeDefined();
});
it('lets any poller take a released slot instead of idling until the head waiter returns', () => {
  let queue: ProviderQueue = {};
  for (let i = 0; i < 4; i++) { const r = reserve(queue, `p${i}`, 'page', 1000); queue = consumeProvider(r.queue, `p${i}`, `p${i}`, r.reservation!.after)!; }
  queue = reserve(queue, 'head', 'page', 5000).queue;
  queue = reserve(queue, 'second', 'page', 5100).queue;
  queue = releaseProvider(queue, 'p0', 'p0');
  queue = releaseProvider(queue, 'p1', 'p1');
  // Two slots free: the second waiter is admitted even though it polls first.
  const second = reserve(queue, 'second', 'page', 6000); queue = second.queue;
  expect(second.reservation).toBeDefined();
  const head = reserve(queue, 'head', 'page', 6100); queue = head.queue;
  expect(head.reservation).toBeDefined();
  expect(reserve(queue, 'third', 'page', 6200)).toMatchObject({ queued: true });
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
  // Four slots at 3.8 s per read allow about 630 reads in ten minutes; the old head-of-line gate managed about 165.
  expect(simulate(4)).toBeGreaterThan(500);
  expect(simulate(23)).toBeGreaterThan(450);
});
