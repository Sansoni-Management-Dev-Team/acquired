import { expect, it, vi } from 'vitest';
vi.mock('@cloudflare/containers', () => ({ Container: class {} }));
import worker from './index';
const secret = 'synthetic-crawler-service-secret';
const request = (body: object) => new Request('https://crawler.example/crawl', { method: 'POST', headers: { authorization: `Bearer ${secret}` }, body: JSON.stringify(body) });
it.each([false, true, undefined])('forwards the requested content mode %s to the container', async only_main_content => {
  const fetcher = vi.fn(async (upstream: Request) => Response.json(await upstream.json()));
  const reader = vi.fn(() => ({ fetch: fetcher }));
  const response = await worker.fetch(request({ url: 'https://instruments.example.com/', ...(only_main_content !== undefined ? { only_main_content } : {}) }), { SERVICE_SECRET: secret, READER: { getByName: reader } } as never);
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ url: 'https://instruments.example.com/', ...(only_main_content !== undefined ? { only_main_content } : {}) });
  expect(reader).toHaveBeenCalledWith('public-reader');
});
it('rejects invalid modes without starting the container', async () => {
  const reader = vi.fn();
  const response = await worker.fetch(request({ url: 'https://instruments.example.com/', only_main_content: 'false' }), { SERVICE_SECRET: secret, READER: { getByName: reader } } as never);
  expect(response.status).toBe(400); expect(reader).not.toHaveBeenCalled();
});
