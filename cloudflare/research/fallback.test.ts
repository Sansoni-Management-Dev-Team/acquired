import { expect, it, vi } from 'vitest';
import { readFallback } from './fallback';
const url = 'https://example.com/';
it('defers capacity failures without treating the page as exhausted', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '30' } }));
  expect(await readFallback(url, 'https://reader.example.com', 'secret', fetcher)).toMatchObject({ deferred: true, retryAfterMs: 30000 });
});
it('authenticates the reader and refuses redirects or challenge content', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ url, markdown: 'Please verify you are human before accessing our company website.' }));
  expect(await readFallback(url, 'https://reader.example.com', 'secret', fetcher)).toMatchObject({ status: 'failed' });
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', headers: { authorization: 'Bearer secret' } });
});
it('accepts useful public content and rejects unconfigured readers', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ url, markdown: 'Example manufactures industrial sensors and calibration instruments.' }));
  expect(await readFallback(url, 'https://reader.example.com', 'secret', fetcher)).toMatchObject({ status: 'completed', page: { url } });
  fetcher.mockClear();
  expect(await readFallback(url, 'https://reader.example.com', '', fetcher)).toMatchObject({ status: 'failed' });
  expect(fetcher).not.toHaveBeenCalled();
});
