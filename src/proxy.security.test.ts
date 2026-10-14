import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
vi.mock('better-auth/cookies', () => ({ getSessionCookie: () => 'synthetic-session' }));
import { proxy, config } from './proxy';
import nextConfig from '../next.config';
const origin = 'https://acquire.example';
beforeEach(() => vi.stubEnv('APP_URL', origin));
afterEach(() => vi.unstubAllEnvs());
const browserPaths = ['/api/mandates', '/api/mandates/m1', '/api/mandates/generate', '/api/outreach/drafts', '/api/outreach/messages/m1/approval', '/api/channels/connections', '/api/targets/search', '/api/campaigns/c1'];
it.each(browserPaths)('blocks a cookie-bearing sibling-origin mutation of %s before the handler', path => {
 expect(unstable_doesMiddlewareMatch({ config, url: origin + path })).toBe(true);
 const response = proxy(new NextRequest(origin + path, { method: 'POST', headers: { cookie: 'synthetic-session', origin: 'https://evil.acquire.example', 'content-type': 'text/plain' }, body: '{}' }));
 expect(response.status).toBe(403);
 expect(response.headers.get('x-middleware-next')).toBeNull();
});
it.each(['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', ''])('rejects simple/non-JSON writes with %s', contentType => {
 const response = proxy(new NextRequest(origin + '/api/mandates', { method: 'POST', headers: { origin, 'content-type': contentType }, body: '{}' }));
 expect(response.status).toBe(415);
});
it.each(['', 'null', 'https://evil.example'])('rejects missing/opaque/foreign Origin %s', supplied => {
 const response = proxy(new NextRequest(origin + '/api/mandates', { method: 'POST', headers: { origin: supplied, 'content-type': 'application/json' }, body: '{}' }));
 expect(response.status).toBe(403);
});
it('allows trusted JSON requests behind a proxy without trusting forwarded hosts', () => {
 const response = proxy(new NextRequest('http://0.0.0.0:3000/api/mandates', { method: 'POST', headers: { origin, 'content-type': 'application/json; charset=utf-8', 'x-forwarded-host': 'evil.example' }, body: '{}' }));
 expect(response.headers.get('x-middleware-next')).toBe('1');
});
it.each(['/api/internal/campaigns/tick', '/api/research/internal/job1', '/api/firmable/internal/run1', '/api/inbound/reply', '/api/auth/sign-in/email', '/api/auth/form-unavailable'])('leaves separately authenticated worker/webhook/Better Auth route %s to its own boundary', path => {
 expect(proxy(new NextRequest(origin + path, { method: 'POST', body: '{}' })).headers.get('x-middleware-next')).toBe('1');
});
it('does not block reads', () => expect(proxy(new NextRequest(origin + '/api/mandates')).headers.get('x-middleware-next')).toBe('1'));
it('ships framing, content-type and compatible CSP defenses on all response paths', async () => {
 const rules = await nextConfig.headers?.();
 const headers = new Map(rules?.find(rule => rule.source === '/:path*')?.headers.map(h => [h.key.toLowerCase(), h.value]));
 expect(headers.get('x-frame-options')).toBe('DENY');
 expect(headers.get('x-content-type-options')).toBe('nosniff');
 const csp = headers.get('content-security-policy') || '';
 expect(csp).toContain("frame-ancestors 'none'");
 expect(csp).toContain("object-src 'none'");
 expect(csp).toContain("base-uri 'self'");
 expect(csp).toContain("form-action 'self'");
});
it('permits existing trusted bodyless POST and DELETE actions but still rejects their foreign Origin', () => {
 for(const method of ['POST','DELETE']) {
  expect(proxy(new NextRequest(origin+'/api/outreach/messages/m1/send',{method,headers:{origin}})).headers.get('x-middleware-next')).toBe('1');
  expect(proxy(new NextRequest(origin+'/api/outreach/messages/m1/send',{method,headers:{origin:'https://evil.example'}})).status).toBe(403);
 }
});
