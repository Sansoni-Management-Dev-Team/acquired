import { expect, it, vi } from 'vitest';
import { cachedPage } from './page-cache';
it('shares a public page within a run, preserves retrieval time, and isolates different runs', async () => {
  const saved = new Map<string, Response>();
  const cache = { match: vi.fn(async (key: Request) => saved.get(key.url)?.clone()), put: vi.fn(async (key: Request, value: Response) => { saved.set(key.url, value); }) };
  const read = vi.fn(async () => ({ status: 'completed', page: { markdown: 'Company evidence', observedAt: '2026-09-14T00:00:00Z' } }));
  const first = await cachedPage(cache as unknown as Cache, 'run-a', 'https://example.com/', read);
  expect(await cachedPage(cache as unknown as Cache, 'run-a', 'https://example.com/', read)).toEqual(first);
  expect(read).toHaveBeenCalledOnce();
  await cachedPage(cache as unknown as Cache, 'run-b', 'https://example.com/', read);
  expect(read).toHaveBeenCalledTimes(2);
});
it('does not cache failed reads', async () => {
  const cache = { match: vi.fn(async () => undefined), put: vi.fn().mockResolvedValue(undefined) };
  await cachedPage(cache as unknown as Cache, 'run-a', 'https://example.com/', async () => ({ status: 'failed' }));
  expect(cache.put).not.toHaveBeenCalled();
});
it('coalesces simultaneous people and company reads but never shares across runs', async () => {
  const cache = { match: vi.fn(async () => undefined), put: vi.fn().mockResolvedValue(undefined) };
  let release!: (value: { status: string }) => void;
  const read = vi.fn(() => new Promise<{ status: string }>(resolve => { release = resolve; }));
  const a = cachedPage(cache as unknown as Cache, 'run', 'https://example.com/', read);
  const b = cachedPage(cache as unknown as Cache, 'run', 'https://example.com/', read);
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
