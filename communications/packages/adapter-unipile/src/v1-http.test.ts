import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UnipileV1Transport } from './v1-http';
const secret = 'synthetic-v1-key';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(fn => fn())); });
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    const server = createServer(handler);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanup.push(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Fixture unavailable');
    return `http://127.0.0.1:${address.port}/api/v1`;
}
function client(baseUrl: string, overrides = {}) { return new UnipileV1Transport({ apiVersion: 'v1', baseUrl, apiKey: secret, allowLoopbackHttp: true, timeoutMs: 200, ...overrides }); }
async function parsedRequest(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req)
        chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    const response = new Response(body, { headers: { 'content-type': String(req.headers['content-type']) } });
    if (String(req.headers['content-type']).startsWith('multipart/form-data'))
        return Object.fromEntries(await response.formData());
    return JSON.parse(body.toString());
}
describe('explicit Unipile v1 transport', () => {
    it('uses cursor pagination and opaque account IDs with guarded chat/email GETs', async () => {
        const paths: string[] = [];
        const base = await fixture((req, res) => { paths.push(req.url!); expect(req.headers['x-api-key']).toBe(secret); expect(req.headers['cache-control']).toBe('no-store'); res.end('{}'); });
        const api = client(base);
        expect((await api.listAccounts({ cursor: 'opaque/+cursor', limit: 250 })).kind).toBe('success');
        await api.getAccount('opaque-account');
        await api.getChat('opaque-account', 'peer@lid');
        await api.getMessage('opaque-message');
        await api.getEmail('opaque-account', 'provider/id');
        expect(paths).toEqual(['/api/v1/accounts?cursor=opaque%2F%2Bcursor&limit=250', '/api/v1/accounts/opaque-account', '/api/v1/chats/peer%40lid?account_id=opaque-account', '/api/v1/messages/opaque-message', '/api/v1/emails/provider%2Fid?account_id=opaque-account&include_headers=true']);
    });
    it('sends multipart text/quote with exact account guard and no presumed idempotency', async () => {
        let observed: unknown;
        let calls = 0;
        const base = await fixture((req, res) => { calls++; void parsedRequest(req).then(body => { observed = { path: req.url, body, idempotency: req.headers['idempotency-key'] }; res.statusCode = 201; res.end('{"object":"MessageSent","message_id":"m1"}'); }); });
        expect(await client(base).sendMessage('account1', 'chat/id', { text: 'message', quote_id: 'quoted' })).toMatchObject({ kind: 'success', status: 201 });
        expect(observed).toEqual({ path: '/api/v1/chats/chat%2Fid/messages', body: { account_id: 'account1', text: 'message', quote_id: 'quoted' }, idempotency: undefined });
        expect(calls).toBe(1);
    });
    it('separates email idempotency, draft creation and invitation action routes', async () => {
        const seen: unknown[] = [];
        const base = await fixture((req, res) => { void parsedRequest(req).then(body => { seen.push({ path: req.url, body, key: req.headers['idempotency-key'] }); res.end('{}'); }); });
        const api = client(base);
        const payload = { to: [{ identifier: 'fixture@example.test' }], body: '<p>text</p>', subject: 's', reply_to: 'parent-email', custom_headers: [{ name: 'Reply-To', value: 'reply@example.test' }] };
        await api.sendEmail('a', payload, 'bound-key');
        await api.createDraft('a', payload);
        await api.invite('a', 'ACo_fixture', 'hello');
        const form = { account_id: 'a', to: JSON.stringify(payload.to), body: payload.body, subject: 's', reply_to: 'parent-email', custom_headers: JSON.stringify(payload.custom_headers) };
        expect(seen).toEqual([{ path: '/api/v1/emails', body: form, key: 'bound-key' }, { path: '/api/v1/drafts', body: form, key: undefined }, { path: '/api/v1/users/invite', body: { account_id: 'a', provider_id: 'ACo_fixture', message: 'hello' }, key: undefined }]);
    });
    it.each(['https://api.unipile.com/v2', 'https://a.unipile.com/api/v1?key=x', 'https://user:password@a.unipile.com/api/v1', 'http://a.unipile.com/api/v1'])('rejects wrong-version/unsafe URL %s', base => { expect(() => client(base)).toThrow('Invalid Unipile configuration'); });
    it('requires the explicit v1 version and loopback opt-in', () => {
        expect(() => client('https://a.unipile.com/api/v1', { apiVersion: 'v2' })).toThrow();
        expect(() => client('http://127.0.0.1/api/v1', { allowLoopbackHttp: false })).toThrow();
        expect(JSON.stringify(client('https://a.unipile.com/api/v1'))).not.toContain(secret);
    });
    it('rejects unsafe paths, unsupported fields/headers and invalid keys before I/O', async () => {
        const fetcher = vi.fn();
        const api = client('https://a.unipile.com/api/v1', { fetch: fetcher });
        await expect(api.getAccount('..')).rejects.toThrow();
        await expect(api.getMessage('x\n')).rejects.toThrow();
        await expect(api.listAccounts({ limit: 251 })).rejects.toThrow();
        await expect(api.sendEmail('a', { to: [{ identifier: 'fixture@example.test' }], body: 'text', custom_headers: [{ name: 'Message-ID', value: 'x' }] }, 'key')).rejects.toThrow();
        await expect(api.sendEmail('a', { to: [{ identifier: 'fixture@example.test' }], body: 'text' }, 'x\r\ny')).rejects.toThrow();
        await expect(api.sendMessage('a', 'c', { text: 'x', attachments: [] } as never)).rejects.toThrow();
        await expect(api.sendEmail('a', { to: [{ identifier: 'fixture@example.test' }], body: 'text', html: 'ignored' } as never, 'key')).rejects.toThrow();
        await expect(api.invite('a', 'ACo_fixture', 'x'.repeat(301))).rejects.toThrow();
        expect(fetcher).not.toHaveBeenCalled();
    });
    it('keeps lost-response and 5xx writes unknown without retries', async () => {
        let writes = 0;
        const base = await fixture(req => { writes++; req.resume(); req.on('end', () => req.socket.destroy()); });
        expect(await client(base).sendMessage('a', 'c', { text: 'x' })).toEqual({ kind: 'unknown', reason: 'transport' });
        expect(writes).toBe(1);
        const failing = await fixture((_req, res) => { res.statusCode = 503; res.end(secret); });
        expect(await client(failing).createDraft('a', { to: [{ identifier: 'fixture@example.test' }], body: 'x' })).toEqual({ kind: 'unknown', reason: 'provider_failure', status: 503 });
    });
    it('refuses redirects and bounds response/cancellation without leaking secrets', async () => {
        let targetCalls = 0;
        const target = await fixture((_req, res) => { targetCalls++; res.end('{}'); });
        const redirect = await fixture((_req, res) => { res.statusCode = 302; res.setHeader('Location', target); res.end(); });
        expect((await client(redirect).getAccount('a')).kind).toBe('unavailable');
        expect(targetCalls).toBe(0);
        const oversized = await fixture((_req, res) => res.end('x'.repeat(100)));
        expect(await client(oversized, { maxResponseBytes: 10 }).getAccount('a')).toEqual({ kind: 'unavailable', reason: 'invalid_response' });
        const fetcher = vi.fn(() => new Promise<Response>(() => { }));
        const api = client('https://a.unipile.com/api/v1', { fetch: fetcher, timeoutMs: 10 });
        expect(await api.listAccounts({}, { signal: AbortSignal.abort() })).toEqual({ kind: 'not_submitted', reason: 'canceled' });
        expect(fetcher).not.toHaveBeenCalled();
        expect(await api.listAccounts()).toEqual({ kind: 'unavailable', reason: 'timeout' });
    });
});
