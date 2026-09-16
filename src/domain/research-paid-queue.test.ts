import { expect, it } from 'vitest';
import { consumeProvider, coolDownBrowser, releaseProvider, reservationDelay, reserveProvider, type ProviderQueue } from './research-provider-queue';
const reserve = (q: ProviderQueue, job: string, provider: 'page'|'search', now: number, token = job) => reserveProvider(q, job, token, provider, now, undefined, false, true);
it('allows four concurrent pages and reserves a fifth slot for search; starts are spaced one second', () => {
  let queue: ProviderQueue = {};
  for (let i = 0; i < 4; i++) {
    const now = 1000 + i * 1000;
    const r = reserve(queue, `p${i}`, 'page', now);
    expect(r.reservation).toBeDefined();
    queue = consumeProvider(r.queue, `p${i}`, `p${i}`, now, `site${i}.com`)!;
    expect(reserve(queue, 'early', 'search', now + 999).reservation).toBeUndefined();
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
  expect(reserve(q,'new','search',2000).reservation).toBeUndefined();
  expect(reserve(q,'new','search',11000).reservation).toBeDefined();
});
