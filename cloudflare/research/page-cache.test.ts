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
  const cache = { match: vi.fn(async () => undefined), put: vi.fn() };
  await cachedPage(cache as unknown as Cache, 'run-a', 'https://example.com/', async () => ({ status: 'failed' }));
  expect(cache.put).not.toHaveBeenCalled();
});
