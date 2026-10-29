import { test as base, expect } from '@playwright/test';
type Reply = { body: unknown; status: number };
type Call = { path: string; method: string; body: unknown };
export type MockApi = { calls: Call[]; reply: (path: string, body: unknown, status?: number) => void };
// Browser/API contract fixtures only: never claim these are real authenticated sessions.
export const test = base.extend<{ api: MockApi }>({
  api: [async ({ context, page }, use) => {
    const replies = new Map<string, Reply>(), calls: Call[] = [], failures: string[] = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      const path = new URL(message.location().url || 'http://127.0.0.1:3217').pathname;
      if (message.text().startsWith('Failed to load resource:') && (replies.get(path)?.status ?? 0) >= 400) return;
      failures.push(message.text());
    });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== 'http://127.0.0.1:3217') { failures.push(`External request: ${url.origin}${url.pathname}`); await route.abort(); return; }
      if (url.pathname.startsWith('/api/')) {
        calls.push({ path: url.pathname, method: request.method(), body: request.postDataJSON() });
        const reply = replies.get(url.pathname);
        if (!reply) { failures.push(`Unconfigured API: ${request.method()} ${url.pathname}`); await route.fulfill({ status: 501, json: { error: 'Missing test fixture' } }); return; }
        await route.fulfill({ status: reply.status, json: reply.body }); return;
      }
      if (!['GET', 'HEAD'].includes(request.method())) { failures.push(`Unexpected mutation: ${request.method()} ${url.pathname}`); await route.abort(); return; }
      await route.continue();
    });
    await use({ calls, reply: (path, body, status = 200) => { replies.set(path, { body, status }); } });
    expect(failures, 'Fixture isolation and browser runtime').toEqual([]);
  }, { auto: true }],
});
export { expect };
