import { describe, expect, it, vi } from 'vitest';
import { FirmableAccount } from './account';
import { unseal } from './credentials';
import { retryDelay } from './transport';
const env = { FIRMABLE_CLIENT_COOKIE: 'initial-cookie-value-long-enough', FIRMABLE_SESSION_ID: 'sess_test', FIRMABLE_ORGANIZATION_ID: 'org_test', FIRMABLE_CREDENTIAL_KEY: 'a'.repeat(32) };
function setup(responses: Response[]) {
  const state = new Map<string, unknown>();
  const storage = { get: vi.fn(async (key: string) => state.get(key)), put: vi.fn(async (key: string, value: unknown) => { state.set(key, structuredClone(value)); }) };
  const fetcher = vi.fn(async () => responses.shift()!);
  const account = new FirmableAccount(storage as never, env, fetcher as typeof fetch);
  return { account, fetcher, storage, state };
}
function token(headers = {}) {
  const claims = { sid: env.FIRMABLE_SESSION_ID, o: { id: env.FIRMABLE_ORGANIZATION_ID }, exp: Math.floor(Date.now() / 1000) + 60 };
  return Response.json({ jwt: `e30.${btoa(JSON.stringify(claims))}.signature` }, { headers });
}
const company = { path: '/company', method: 'GET', query: { id: 'f123' } };
describe('Firmable account coordination', () => {
  it('shares one renewal across concurrent requests and persists encrypted rotation', async () => {
    const { account, fetcher, state } = setup([token({ 'Set-Cookie': '__client=rotated-cookie-value-long-enough; HttpOnly; Secure' }), Response.json({ id: 'f123', revenue: { 2: '$1M - $5M' } }), Response.json({ id: 'f123' })]);
    const results = await Promise.all([account.handle(company), account.handle(company)]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(results[0].body.revenue).toBe('$1M - $5M');
    const saved = state.get('firmable:state') as { credentials: Parameters<typeof unseal>[0] };
    expect(JSON.stringify(saved)).not.toContain('rotated-cookie');
    expect((await unseal(saved.credentials, env.FIRMABLE_CREDENTIAL_KEY)).cookie).toBe('rotated-cookie-value-long-enough');
  });
  it('keeps rate-limit cooldown across account recreation without more upstream calls', async () => {
    const { account, fetcher, storage } = setup([token(), Response.json({}, { status: 429, headers: { 'Retry-After': '60' } })]);
    expect((await account.handle(company)).status).toBe(429);
    const recreated = new FirmableAccount(storage as never, env, fetcher as typeof fetch);
    expect((await recreated.handle(company)).status).toBe(429);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('marks rejected authentication as requiring reconnect and stops repeated renewal', async () => {
    const { account, fetcher } = setup([Response.json({}, { status: 401 }), Response.json({}, { status: 401 })]);
    expect((await account.handle(company)).body.category).toBe('reconnect_required');
    expect((await account.handle(company)).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not guess company identity from a similar name', async () => {
    const { account } = setup([token(), Response.json({ records: [{ id: 'f123', website: 'different.example' }] })]);
    expect((await account.handle({ ...company, query: { fqdn: 'raymax.com.au' } })).status).toBe(404);
  });
  it('handles date and missing retry headers', () => {
    expect(retryDelay(null)).toBe(30_000);
    expect(retryDelay(new Date(100_000).toUTCString(), 50_000)).toBe(50_000);
  });
});
it('renews the cached token after expiry', async () => {
  vi.useFakeTimers();
  try {
    const { account, fetcher } = setup([]);
    fetcher.mockImplementation(async () => fetcher.mock.calls.length % 2 === 1 ? token() : Response.json({ id: 'f123' }));
    expect((await account.handle(company)).status).toBe(200);
    vi.setSystemTime(Date.now() + 61_000);
    expect((await account.handle(company)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(4);
  } finally { vi.useRealTimers(); }
});
