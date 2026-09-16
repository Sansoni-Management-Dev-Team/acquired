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

it('identifies admission expiry without an upstream request or leaking secrets', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const fetcher = vi.fn<typeof fetch>();
    await expect(browserMarkdown(env, 'https://example.com/?private=value', {
      jobId: 'job', requestId: 'correlation', operation: 'markdown',
      permit: async () => ({ granted: false, expired: true, retryAfterMs: 0 }),
    }, fetcher)).rejects.toMatchObject({ category: 'browser_admission' });
    expect(fetcher).not.toHaveBeenCalled();
    const events = log.mock.calls.map(call => JSON.parse(String(call[1])));
    expect(events).toContainEqual(expect.objectContaining({ event: 'admission_deferred', failureOrigin: 'application_admission', requestId: 'correlation', upstreamRequestSent: false, reason: 'reservation_expired' }));
    expect(JSON.stringify(events)).not.toContain('private');
  } finally { log.mockRestore(); }
});

it('correlates an actual upstream 429 with the granted browser permit', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errors: [{ code: 1015, message: 'requests per second exceeded' }], success: false }, { status: 429, headers: { 'retry-after': '12', 'cf-ray': '0123456789abcdef-MEL' } }));
    await expect(browserMarkdown(env, 'https://example.com/', {
      jobId: 'job', operation: 'markdown', permit: async () => ({ granted: true, retryAfterMs: 0 }),
    }, fetcher)).rejects.toMatchObject({ category: 'request_rate' });
    const events = log.mock.calls.map(call => JSON.parse(String(call[1])));
    const permit = events.find(event => event.event === 'permit_result');
    expect(events).toContainEqual(expect.objectContaining({ event: 'request_failed', failureOrigin: 'upstream_response', requestId: permit.requestId, provider: 'cloudflare-browser', httpStatus: 429, category: 'request_rate', limits: { 'retry-after': 12 }, providerRequestIds: { 'cf-ray': '0123456789abcdef-MEL' } }));
  } finally { log.mockRestore(); }
});

it('shares Retry-After cooldown and releases the lease on an upstream rate limit', async () => {
  const cooldown=vi.fn(async()=>{}), release=vi.fn(async()=>{});
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({success:false,errors:[{message:'requests per second exceeded'}]},{status:429,headers:{'retry-after':'12'}}));
  await expect(browserMarkdown(env,'https://example.com/',{operation:'markdown',permit:async()=>({granted:true,retryAfterMs:0}),cooldown,release},fetcher)).rejects.toMatchObject({category:'browser_admission'});
  expect(cooldown).toHaveBeenCalledWith(12000);expect(release).toHaveBeenCalledOnce();expect(fetcher).toHaveBeenCalledOnce();
});
it('releases capacity after a successful page read', async () => {
  const release=vi.fn(async()=>{});
  await browserMarkdown(env,'https://example.com/',{operation:'markdown',permit:async()=>({granted:true,retryAfterMs:0}),release},async()=>Response.json({success:true,result:'evidence'}));
  expect(release).toHaveBeenCalledOnce();
});
