import { expect, it, vi } from 'vitest';
import { companyPage } from './company-page';
const request = (url: string) => new Request('https://worker.example/company-page', { method: 'POST', body: JSON.stringify({ url }) });
const env = { CRAWL4AI_URL: 'https://crawler.example', CRAWL4AI_SECRET: 'synthetic-service-secret' };
it('returns bounded full-page company evidence through the existing authenticated crawler', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ url: 'https://instruments.example.com/contact', html: 'x'.repeat(250001), markdown: 'm'.repeat(100001), only_main_content: false }));
  const response = await companyPage(request('https://instruments.example.com'), env, fetcher);
  expect(response.status).toBe(200);
  expect(fetcher.mock.calls[0][0]).toBe('https://crawler.example/crawl');
  const init = fetcher.mock.calls[0][1] as RequestInit;
  expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${env.CRAWL4AI_SECRET}`);
  expect(JSON.parse(String(init.body))).toMatchObject({ only_main_content: false });
  expect(await response.json()).toMatchObject({ html: 'x'.repeat(250000), markdown: 'm'.repeat(100000), truncated: true, only_main_content: false });
});
it.each(['http://127.0.0.1/private', 'http://10.0.0.1', 'file:///etc/passwd', 'https://user:password@instruments.example.com'])('rejects unsupported public input %s without upstream access', async url => {
  const fetcher = vi.fn(); expect((await companyPage(request(url), env, fetcher)).status).toBe(400); expect(fetcher).not.toHaveBeenCalled();
});
it('rejects a private final URL and a main-content-only response', async () => {
  for (const data of [{ url: 'http://127.0.0.1', html: '<html>Legal</html>', only_main_content: false }, { url: 'https://instruments.example.com', html: '<html>Legal</html>', only_main_content: true }]) {
    expect((await companyPage(request('https://instruments.example.com'), env, vi.fn<typeof fetch>(async () => Response.json(data)))).status).toBe(502);
  }
});
it('reports unavailable crawler without returning service credentials', async () => {
  const response = await companyPage(request('https://instruments.example.com'), env, vi.fn<typeof fetch>(async () => new Response(env.CRAWL4AI_SECRET, { status: 503 })));
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body).toMatchObject({ upstreamStatus: 503 });
  expect(JSON.stringify(body)).not.toContain(env.CRAWL4AI_SECRET);
});
it('uses the bounded local reader endpoint with no crawler authorization', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ url: 'https://instruments.example.com', html: '<html>Legal</html>', only_main_content: false }));
  expect((await companyPage(request('https://instruments.example.com'), { LOCAL_DEVELOPMENT: 'true', APP_ORIGIN: 'http://127.0.0.1:3010' }, fetcher)).status).toBe(200);
  expect(fetcher.mock.calls[0][0]).toBe('http://127.0.0.1:18083/crawl');
  expect(new Headers((fetcher.mock.calls[0][1] as RequestInit).headers).has('authorization')).toBe(false);
});
it.each(['domain_backoff','reader_busy'])('preserves reader429 %s and its retry delay for deferred app reads',async category=>{
 const response=await companyPage(request('https://instruments.example.com'),env,vi.fn<typeof fetch>(async()=>Response.json({category},{status:429,headers:{'retry-after':'2'}})));
 expect(response.status).toBe(429);expect(response.headers.get('retry-after')).toBe('2');expect(await response.json()).toMatchObject({category});
});
