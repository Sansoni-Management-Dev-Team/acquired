import { afterEach, expect, it, vi } from 'vitest';
import { browserMarkdown } from './browser-reader';
afterEach(() => vi.useRealTimers());
const env = { CF_ACCOUNT_ID: 'test', CF_BROWSER_TOKEN: 'test' };
it('logs the local reader reason, slot snapshot and website retry scope', async () => {
  const log = vi.spyOn(console, 'info').mockImplementation(() => {});
  try {
    const cooldown = vi.fn(async () => {}), release = vi.fn(async () => {});
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ category: 'domain_backoff', error: 'private body', reader: { activeReads: 2, maxReads: 5, availableReads: 3, domainActive: true, domainKey: 'abcdef012345' } }, { status: 429, headers: { 'retry-after': '3' } }));
    await expect(browserMarkdown({ LOCAL_DEVELOPMENT: 'true', LOCAL_CRAWL4AI_URL: 'http://127.0.0.1:18083' }, 'https://example.com/?private=value', {
      jobId: 'job-12345678', requestId: 'request-1234', operation: 'markdown', permit: async () => ({ granted: true, retryAfterMs: 0 }), cooldown, release,
    }, fetcher)).rejects.toMatchObject({ category: 'browser_admission' });
    const events = log.mock.calls.map(call => JSON.parse(String(call[1])));
    expect(events).toContainEqual(expect.objectContaining({ event: 'reader_deferred', requestId: 'request-1234', category: 'domain_backoff', cooldownScope: 'website', retryAfterMs: 3000, reader: expect.objectContaining({ activeReads: 2, availableReads: 3, domainActive: true }) }));
    expect(JSON.stringify(events)).not.toContain('private');
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'x-request-id': 'request-1234', 'x-research-job-id': 'job-12345678' });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(cooldown).toHaveBeenCalledWith(3000, 'example.com');
    expect(release).toHaveBeenCalledOnce();
  } finally { log.mockRestore(); }
});
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

it('keeps a delayed admission callback retryable without sending an upstream request', async () => {
  const fetcher = vi.fn<typeof fetch>();
  await expect(browserMarkdown(env, 'https://example.com/', {
    operation: 'markdown', permit: async () => { throw new Error('callback timed out'); },
  }, fetcher)).rejects.toMatchObject({ category: 'browser_admission' });
  expect(fetcher).not.toHaveBeenCalled();
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

it('keeps claiming a still-valid reservation when concurrent searches push its start back', async () => {
  vi.useFakeTimers();
  const permit = vi.fn().mockResolvedValueOnce({ granted: false, retryAfterMs: 3000 }).mockResolvedValueOnce({ granted: false, retryAfterMs: 2500 }).mockResolvedValueOnce({ granted: false, retryAfterMs: 1000 }).mockResolvedValue({ granted: true, retryAfterMs: 0 });
  const fetcher = vi.fn(async () => Response.json({ success: true, result: '## [Result](https://example.com/)' }));
  const pending = browserMarkdown({ CF_ACCOUNT_ID: 'acc', CF_BROWSER_TOKEN: 'token' }, 'https://html.duckduckgo.com/html/?q=test', { operation: 'web_search', permit }, fetcher as unknown as typeof fetch);
  await vi.advanceTimersByTimeAsync(7000);
  await expect(pending).resolves.toContain('Result');
  expect(permit).toHaveBeenCalledTimes(4);
  expect(fetcher).toHaveBeenCalledOnce();
  vi.useRealTimers();
});

it('defers instead of waiting past the admission window', async () => {
  vi.useFakeTimers();
  const permit = vi.fn().mockResolvedValue({ granted: false, retryAfterMs: 11000 });
  const fetcher = vi.fn();
  const pending = browserMarkdown({ CF_ACCOUNT_ID: 'acc', CF_BROWSER_TOKEN: 'token' }, 'https://example.com/', { operation: 'markdown', permit }, fetcher as unknown as typeof fetch).catch(error => error);
  await vi.advanceTimersByTimeAsync(25000);
  const { BrowserAdmissionDeferred } = await import('../../src/domain/research-provider-error');
  expect(await pending).toBeInstanceOf(BrowserAdmissionDeferred);
  expect(permit.mock.calls.length).toBeLessThanOrEqual(3);
  expect(fetcher).not.toHaveBeenCalled();
  vi.useRealTimers();
});


it.each(['domain_backoff', 'origin_rate_limit', 'reader_busy'])('routes %s cooldown to the appropriate website or shared capacity', async category => {
  const cooldown = vi.fn(async () => {});
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ category }, { status: 429, headers: { 'retry-after': '2' } }));
  await expect(browserMarkdown({ LOCAL_DEVELOPMENT: 'true', LOCAL_CRAWL4AI_URL: 'http://127.0.0.1:18083' }, 'https://www.Example.com/', {
    operation: 'markdown', permit: async () => ({ granted: true, retryAfterMs: 0 }), cooldown,
  }, fetcher)).rejects.toMatchObject({ category: 'browser_admission' });
  if (category === 'reader_busy') expect(cooldown).toHaveBeenCalledWith(2000);
  else expect(cooldown).toHaveBeenCalledWith(2000, 'example.com');
});
