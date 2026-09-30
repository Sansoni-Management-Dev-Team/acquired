import { expect, it, vi } from 'vitest';
import { cachedPage } from './page-cache';
it('shares a public page within a run, preserves retrieval time, and shares different runs', async () => {
  const saved = new Map<string, Response>();
  const cache = { match: vi.fn(async (key: Request) => saved.get(key.url)?.clone()), put: vi.fn(async (key: Request, value: Response) => { saved.set(key.url, value); }) };
  const read = vi.fn(async () => ({ status: 'completed', page: { markdown: 'Company evidence', observedAt: '2026-09-14T00:00:00Z' } }));
  const first = await cachedPage(cache as unknown as Cache, 'run-a', 'https://example.com/', read);
  expect(await cachedPage(cache as unknown as Cache, 'run-a', 'https://example.com/', read)).toEqual(first);
  expect(read).toHaveBeenCalledOnce();
  await cachedPage(cache as unknown as Cache, 'run-b', 'https://example.com/', read);
  expect(read).toHaveBeenCalledOnce();
});
it('does not cache failed reads', async () => {
  const cache = { match: vi.fn(async () => undefined), put: vi.fn().mockResolvedValue(undefined) };
  await cachedPage(cache as unknown as Cache, 'run-a', 'https://example.com/', async () => ({ status: 'failed' }));
  expect(cache.put).not.toHaveBeenCalled();
});
it('coalesces simultaneous people and company reads across runs', async () => {
  const cache = { match: vi.fn(async () => undefined), put: vi.fn().mockResolvedValue(undefined) };
  let release!: (value: { status: string }) => void;
  const read = vi.fn(() => new Promise<{ status: string }>(resolve => { release = resolve; }));
  const a = cachedPage(cache as unknown as Cache, 'run', 'https://example.com/', read);
  const b = cachedPage(cache as unknown as Cache, 'different-run', 'https://example.com/', read);
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  release({ status: 'completed' });
  expect(await a).toEqual(await b);
});
it('caches confirmed missing URLs briefly without caching rate limits', async () => {
  const { ResearchProviderError } = await import('../../src/domain/research-provider-error');
  const saved = new Map<string, Response>();
  const cache = { match: vi.fn(async (key: Request) => saved.get(key.url)?.clone()), put: vi.fn(async (key: Request, value: Response) => { saved.set(key.url, value); }) };
  const missing = vi.fn(async () => { throw new ResearchProviderError('provider_error', 404); });
  await expect(cachedPage(cache as unknown as Cache, 'run', 'https://example.com/gone', missing)).rejects.toMatchObject({ status: 404 });
  await expect(cachedPage(cache as unknown as Cache, 'run', 'https://example.com/gone', missing)).rejects.toMatchObject({ status: 404 });
  expect(missing).toHaveBeenCalledOnce();
  const rate = vi.fn(async () => { throw new ResearchProviderError('request_rate', 429); });
  for (let i = 0; i < 2; i++) await expect(cachedPage(cache as unknown as Cache, 'run', 'https://example.com/busy', rate)).rejects.toMatchObject({ status: 429 });
  expect(rate).toHaveBeenCalledTimes(2);
});

it('expires stale content without changing original observation dates on fresh hits', async () => {
  vi.useFakeTimers();
  try {
    const saved = new Map<string, Response>();
    const cache = { match: async (key: Request) => saved.get(key.url)?.clone(), put: async (key: Request, value: Response) => { saved.set(key.url, value); } };
    const read = vi.fn(async () => ({ status: 'completed', page: { observedAt: new Date().toISOString() } }));
    const first = await cachedPage(cache as unknown as Cache, 'a', 'https://example.com/?utm_source=a#about', read);
    expect(await cachedPage(cache as unknown as Cache, 'b', 'https://example.com/', read)).toEqual(first);
    vi.advanceTimersByTime(3600001);
    expect(await cachedPage(cache as unknown as Cache, 'b', 'https://example.com/', read)).not.toEqual(first);
    expect(read).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
it('does not share credentialed or nonpublic URLs', async () => {
  const cache = { match: vi.fn(), put: vi.fn() };
  await cachedPage(cache as unknown as Cache, 'run', 'https://user:password@example.com/', async () => ({ status: 'completed' }));
  expect(cache.match).not.toHaveBeenCalled();
  expect(cache.put).not.toHaveBeenCalled();
});
it('reports cache hits, expiry and misses without refreshing observation times', async () => {
  vi.useFakeTimers();
  try {
    const saved = new Map<string, Response>();
    const cache = { match: async (key: Request) => saved.get(key.url)?.clone(), put: async (key: Request, value: Response) => { saved.set(key.url, value); } };
    const onEvent = vi.fn();
    const read = vi.fn(async () => ({ status: 'completed', page: { observedAt: new Date().toISOString() } }));
    const first = await cachedPage(cache as unknown as Cache, 'a', 'https://example.com/', read, onEvent);
    expect(onEvent).toHaveBeenLastCalledWith('miss');
    vi.advanceTimersByTime(1000);
    expect(await cachedPage(cache as unknown as Cache, 'b', 'https://example.com/', read, onEvent)).toEqual(first);
    expect(onEvent).toHaveBeenLastCalledWith('hit');
    vi.advanceTimersByTime(3600000);
    await cachedPage(cache as unknown as Cache, 'b', 'https://example.com/', read, onEvent);
    expect(onEvent).toHaveBeenLastCalledWith('expired');
  } finally { vi.useRealTimers(); }
});

it('briefly reuses confirmed origin failures, preserves their category and retries after expiry', async () => {
  vi.useFakeTimers();
  try {
    const { ResearchProviderError } = await import('../../src/domain/research-provider-error');
    const saved = new Map<string, Response>();
    const cache = { match: async (key: Request) => saved.get(key.url)?.clone(), put: async (key: Request, value: Response) => { saved.set(key.url, value); } };
    const read = vi.fn(async () => { throw new ResearchProviderError('origin_http_error', 502); });
    const event = vi.fn();
    for (let i = 0; i < 2; i++) await expect(cachedPage(cache as unknown as Cache, 'a', 'https://example.com/down', read, event)).rejects.toMatchObject({ category: 'origin_http_error', status: 502 });
    expect(read).toHaveBeenCalledOnce();
    expect(event).toHaveBeenLastCalledWith('origin_failure');
    vi.advanceTimersByTime(15001);
    await expect(cachedPage(cache as unknown as Cache, 'b', 'https://example.com/down', read)).rejects.toMatchObject({ status: 502 });
    expect(read).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});
it('does not cache reader infrastructure failures as website evidence', async () => {
  const { ResearchProviderError } = await import('../../src/domain/research-provider-error');
  const cache = { match: vi.fn(async () => undefined), put: vi.fn().mockResolvedValue(undefined) };
  for (const category of ['reader_failure', 'reader_timeout', 'reader_busy', 'provider_error']) {
    await expect(cachedPage(cache as unknown as Cache, 'run', 'https://example.com/', async () => { throw new ResearchProviderError(category, 502); })).rejects.toMatchObject({ category });
  }
  expect(cache.put).not.toHaveBeenCalled();
});
