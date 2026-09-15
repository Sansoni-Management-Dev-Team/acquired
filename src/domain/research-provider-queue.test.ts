import { expect, it } from 'vitest';
import { reserveProvider, consumeProvider, type ProviderQueue } from './research-provider-queue';
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
it('admits four independent AI operations while browsers wait', () => {
  let queue: ProviderQueue = { browserAfter: 400000 };
  const starts = [];
  for (let i = 0; i < 5; i++) {
    const r = reserveProvider(queue, 'job', `ai-${i}`, 'ai', 1000);
    queue = r.queue; starts.push(r.reservation!.after);
  }
  expect(starts).toEqual([1000, 1000, 1000, 1000, 48000]);
  expect(queue.browserAfter).toBe(400000);
});
it('reuses reservations on callback retries and consumes once for the correct job', () => {
  const first = reserveProvider({}, 'job', 'token', 'page', 1000);
  const again = reserveProvider(first.queue, 'job', 'token', 'page', 1500);
  expect(again.reservation).toEqual(first.reservation);
  expect(again.queue.browserAfter).toBe(first.queue.browserAfter);
  expect(consumeProvider(first.queue, 'token', 'other-job', 1500)).toBeNull();
  expect(consumeProvider(first.queue, 'token', 'job', 999)).toBeNull();
  expect(consumeProvider(first.queue, 'token', 'job', 3001)).toBeNull();
  const consumed = consumeProvider(first.queue, 'token', 'job', 1500)!;
  expect(consumeProvider(consumed, 'token', 'job', 1501)).toBeNull();
});
