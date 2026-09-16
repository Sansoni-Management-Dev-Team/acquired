import { afterEach, expect, it, vi } from 'vitest';
import { browserMarkdown } from './browser-reader';
afterEach(() => vi.useRealTimers());
const env = { CF_ACCOUNT_ID: 'test', CF_BROWSER_TOKEN: 'test' };
it('does not call the browser until a global permit is granted', async () => {
  vi.useFakeTimers();
  const permit = vi.fn().mockResolvedValueOnce({ granted: false, retryAfterMs: 11000 }).mockResolvedValue({ granted: true, retryAfterMs: 0 });
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, result: 'Company evidence' }));
  const pending = browserMarkdown(env, 'https://example.com/', { operation: 'markdown', permit }, fetcher);
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toBe('Company evidence');
  expect(fetcher).toHaveBeenCalledOnce();
});
it('preserves daily quota classification without repeatedly calling the browser', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: false, errors: [{ code: 429, message: 'Browser time limit exceeded for today' }] }, { status: 429 }));
  await expect(browserMarkdown(env, 'https://example.com/', { operation: 'markdown', permit: async () => ({ granted: true, retryAfterMs: 0 }) }, fetcher)).rejects.toMatchObject({ category: 'daily_quota', status: 429 });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('waits for a reserved permit before sending the browser request', async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true, result: 'Company evidence' }));
  const pending = browserMarkdown(env, 'https://example.com/', {
    operation: 'markdown', permit: async () => ({ granted: true, retryAfterMs: 11000 }),
  }, fetcher);
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  await expect(pending).resolves.toBe('Company evidence');
});
