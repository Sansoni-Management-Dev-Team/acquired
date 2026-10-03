import { expect, it, vi } from 'vitest';
import { withLocalProvider } from './local-provider';

it.each([false, true])('releases page capacity after a read (failure=%s)', async failed => {
  const callback = vi.fn().mockResolvedValue({ granted: true, retryAfterMs: 0 });
  const read = vi.fn(async () => { if (failed) throw new Error('reader failed'); return 'evidence'; });
  const result = withLocalProvider('page', 'reserved', callback, read);
  if (failed) await expect(result).rejects.toThrow('reader failed');
  else await expect(result).resolves.toBe('evidence');
  expect(callback.mock.calls.map(c => c[0])).toEqual([
    { action: 'browser-permit', token: 'reserved' },
    { action: 'provider-release', token: 'reserved' },
  ]);
});
it('does not read when its reservation has expired', async () => {
  const callback = vi.fn().mockResolvedValue({ granted: false, retryAfterMs: 0 });
  const read = vi.fn();
  await expect(withLocalProvider('page', 'expired', callback, read)).rejects.toMatchObject({ category: 'browser_admission' });
  expect(read).not.toHaveBeenCalled();
});
it('direct local searches obtain their own reservation and consume it', async () => {
  const callback = vi.fn().mockResolvedValue({ granted: true, retryAfterMs: 0 });
  await expect(withLocalProvider('search', undefined, callback, async () => 'results')).resolves.toBe('results');
  expect(callback.mock.calls[0][0]).toMatchObject({ action: 'provider-reserve', provider: 'search' });
  expect(callback.mock.calls[1][0]).toMatchObject({ action: 'browser-permit', token: callback.mock.calls[0][0].token });
});

it('runs the configured local reader pool and admits the next read after completion', async () => {
  const { reserveProvider, consumeProvider, releaseProvider, LOCAL_PAGE_CONCURRENCY } = await import('../../src/domain/research-provider-queue');
  let queue: import('../../src/domain/research-provider-queue').ProviderQueue = {};
  let active = 0, peak = 0;
  const finish: Array<() => void> = [];
  const start = (id: string) => withLocalProvider('page', undefined, async body => {
    if (body.action === 'provider-reserve') {
      const result = reserveProvider(queue, id, body.token, 'page', Date.now(), 480000, true);
      queue = result.queue;
      return { granted: Boolean(result.reservation), retryAfterMs: result.retryAfterMs };
    }
    if (body.action === 'browser-permit') {
      const consumed = consumeProvider(queue, body.token, id, Date.now());
      if (consumed) queue = consumed;
      return { granted: Boolean(consumed), retryAfterMs: 0 };
    }
    queue = releaseProvider(queue, body.token, id);
    return {};
  }, async () => {
    active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => finish.push(resolve));
    active--;
    return id;
  });
  const reads = Array.from({length:LOCAL_PAGE_CONCURRENCY},(_,i)=>start(`read-${i}`));
  await vi.waitFor(() => expect(active).toBe(LOCAL_PAGE_CONCURRENCY));
  await expect(start('blocked')).rejects.toMatchObject({ category: 'browser_admission' });
  finish[0]();
  await reads[0];
  reads.push(start('d'));
  await vi.waitFor(() => expect(finish).toHaveLength(LOCAL_PAGE_CONCURRENCY+1));
  expect(active).toBe(LOCAL_PAGE_CONCURRENCY);
  finish.slice(1).forEach(resolve => resolve());
  await Promise.all(reads);
  expect(peak).toBe(LOCAL_PAGE_CONCURRENCY);
  expect(queue.reservations?.filter(r => !r.released)).toHaveLength(0);
});
