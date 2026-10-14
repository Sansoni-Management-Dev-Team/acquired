import { expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { UnipileV1AccountLifecycle, projectV1Account } from './v1-account-lifecycle';
import type { RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
function record(platform: 'gmail' | 'outlook' | 'whatsapp' | 'linkedin' | 'imap' = 'linkedin'): RecordedLifecycleConnection {
    return { binding: { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 2, channel: ['gmail', 'outlook', 'imap'].includes(platform) ? 'email' : platform as 'whatsapp' | 'linkedin', platform, backend: 'unipile' }, providerAccountId: 'account/opaque', sourceId: 'opaque-source', ownerIdentity: { namespace: `unipile.v1.${platform === 'gmail' ? 'google.mail.id' : platform === 'outlook' ? 'outlook.mail.id' : platform === 'whatsapp' ? 'whatsapp.im.phone_number' : 'linkedin.im.id'}`, value: platform === 'whatsapp' ? '+15551234567' : platform === 'outlook' ? JSON.stringify(['owner-id', null]) : 'owner-id' } };
}
function account(platform: ReturnType<typeof record>['binding']['platform'] = 'linkedin', status = 'OK'): {
    object: string;
    id: string;
    type: string;
    name: string;
    sources: {
        id: string;
        status: string;
    }[];
    connection_params: Record<string, Record<string, unknown>>;
} {
    return { object: 'Account', id: 'account/opaque', type: { gmail: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', whatsapp: 'WHATSAPP', linkedin: 'LINKEDIN', imap: 'MAIL' }[platform], name: 'Misleading display name', sources: [{ id: 'other-product', status: 'ERROR' }, { id: 'opaque-source', status }], connection_params: platform === 'gmail' || platform === 'outlook' ? { mail: { id: 'owner-id', username: 'not-proof@example.test' } } : platform === 'whatsapp' ? { im: { phone_number: '+15551234567' } } : platform === 'imap' ? { mail: { imap_user: 'not-proof@example.test' } } : { im: { id: 'owner-id', publicIdentifier: 'not-owner', username: 'private', proxy: { password: 'private-secret' } } } };
}
it.each(['gmail', 'outlook', 'whatsapp', 'linkedin'] as const)('projects only scoped owner and source status for %s', platform => {
    const expected = record(platform), raw = account(platform);
    expect(projectV1Account(raw, expected)).toEqual({ status: 'observed', observation: { ...expected, status: 'connected' } });
    expect(JSON.stringify(projectV1Account(raw, expected))).not.toMatch(/private-secret|not-proof|Misleading/);
});
it.each([['CONNECTING', 'connecting'], ['CREDENTIALS', 'verification_required'], ['PERMISSIONS', 'verification_required'], ['ERROR', 'failed'], ['STOPPED', 'disconnected']] as const)('maps relevant source %s without granting coverage', (source, status) => {
    const expected = record();
    expect(projectV1Account(account('linkedin', source), expected)).toEqual({ status: 'observed', observation: { ...expected, status } });
});
it.each(['wrong-account', 'wrong-type', 'missing-owner', 'changed-owner', 'duplicated-source', 'missing-source', 'unknown-status', 'display-only'])('rejects %s independently of HTTP/list success', fault => {
    const raw = account() as Record<string, unknown>;
    if (fault === 'wrong-account')
        raw.id = 'another';
    if (fault === 'wrong-type')
        raw.type = 'WHATSAPP';
    if (fault === 'missing-owner')
        raw.connection_params = { im: {} };
    if (fault === 'changed-owner')
        raw.connection_params = { im: { id: 'other' } };
    if (fault === 'display-only')
        raw.connection_params = { im: { publicIdentifier: 'owner-id', username: 'owner-id' } };
    if (fault === 'duplicated-source')
        raw.sources = [{ id: 'opaque-source', status: 'OK' }, { id: 'opaque-source', status: 'OK' }];
    if (fault === 'missing-source')
        raw.sources = [{ id: 'other', status: 'OK' }];
    if (fault === 'unknown-status')
        raw.sources = [{ id: 'opaque-source', status: 'SYNC_SUCCESS' }];
    expect(projectV1Account(raw, record())).toMatchObject({ status: 'review' });
});
it('does not infer IMAP owner identity from login/display name', () => expect(projectV1Account(account('imap'), record('imap'))).toEqual({ status: 'review', code: 'identity_pending' }));
it('keeps Outlook shared mailbox identity distinct', () => {
    const raw = account('outlook');
    raw.connection_params = { mail: { id: 'owner-id', username: 'name', mailbox_id: 'shared' } };
    expect(projectV1Account(raw, record('outlook'))).toEqual({ status: 'review', code: 'account_changed' });
    const r = record('outlook');
    r.ownerIdentity.value = JSON.stringify(['owner-id', 'shared']);
    expect(projectV1Account(raw, r)).toMatchObject({ status: 'observed' });
});
it('never guesses WhatsApp number aliases or LinkedIn URNs', () => {
    const raw = account('whatsapp');
    raw.connection_params = { im: { phone_number: '15551234567' } };
    expect(projectV1Account(raw, record('whatsapp'))).toMatchObject({ status: 'review' });
    const r = record();
    r.ownerIdentity = { namespace: 'linkedin_fsd_profile_urn', value: 'urn:li:fsd_profile:owner-id' };
    expect(projectV1Account(account(), r)).toEqual({ status: 'review', code: 'account_changed' });
});
function client(fetcher: typeof fetch, timeoutMs = 100) { return new UnipileV1AccountLifecycle({ apiVersion: 'v1', baseUrl: 'https://fixture.unipile.com/api/v1', apiKey: 'synthetic-only-key', fetch: fetcher, timeoutMs }); }
it('uses exact account GET with no-store and sanitized output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(account()));
    const api = client(fetcher);
    expect(await api.get(record(), new AbortController().signal)).toMatchObject({ status: 'observed' });
    const [url, options] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://fixture.unipile.com/api/v1/accounts/account%2Fopaque');
    expect(options?.method).toBe('GET');
    expect(options?.headers).toMatchObject({ 'Cache-Control': 'no-store' });
    expect(JSON.stringify(api)).not.toContain('synthetic-only-key');
});
it('deletes exact recorded account with documented AccountDeleted200 only', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(account())).mockResolvedValueOnce(Response.json({ object: 'AccountDeleted' }));
    expect(await client(fetcher).disconnect(record(), new AbortController().signal)).toEqual({ status: 'disconnected' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, options] = fetcher.mock.calls[1];
    expect(String(url)).toBe('https://fixture.unipile.com/api/v1/accounts/account%2Fopaque');
    expect(options?.method).toBe('DELETE');
    expect(options?.body).toBeUndefined();
    expect(options?.redirect).toBe('error');
});
it.each([['lost', 0], ['server', 503], ['untyped-conflict', 409], ['untyped-unprocessable', 422], ['empty-success', 204], ['wrong-object', 200]])('keeps %s deletion unknown without retry', async (fault, status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(account())).mockImplementation(async () => {
        if (fault === 'lost')
            throw Error('private-secret');
        return status === 204 ? new Response(null, { status }) : Response.json({ object: 'SomethingElse' }, { status });
    });
    expect(await client(fetcher).disconnect(record(), new AbortController().signal)).toEqual({ status: 'unknown' });
    expect(fetcher).toHaveBeenCalledTimes(2);
});
it('bounded DELETE timeout remains unknown and aborts transport', async () => {
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(account())).mockImplementation((_url, options) => { signal = options?.signal || undefined; return new Promise(() => { }); });
    expect(await client(fetcher, 10).disconnect(record(), new AbortController().signal)).toEqual({ status: 'unknown' });
    expect(signal?.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
});
it('pre-aborted delete and forged recorded binding perform no I/O', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const api = client(fetcher), controller = new AbortController();
    controller.abort();
    expect(await api.disconnect(record(), controller.signal)).toEqual({ status: 'rejected' });
    const bad = record();
    bad.binding.backend = 'browser';
    await expect(api.get(bad, new AbortController().signal)).rejects.toThrow('Invalid account lifecycle record');
    expect(fetcher).not.toHaveBeenCalled();
});
it('does not DELETE when authenticated account owner changed', async () => { const raw = account(); raw.connection_params = { im: { id: 'different' } }; const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw)); expect(await client(fetcher).disconnect(record(), new AbortController().signal)).toEqual({ status: 'rejected' }); expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][1]?.method).toBe('GET'); });
it('rejects a proxied source collection before invoking traps', () => {
    const raw = account(), trap = vi.fn((target: object, key: PropertyKey) => Reflect.get(target, key));
    raw.sources = new Proxy(raw.sources, { get: (target, key) => trap(target, key) });
    expect(projectV1Account(raw, record())).toEqual({ status: 'review', code: 'protocol' });
    expect(trap).not.toHaveBeenCalled();
});
it('rejects accessor HTTP configuration before reading its private value', () => {
    const getter = vi.fn(() => { throw Error('private configuration'); });
    const config = { apiVersion: 'v1', baseUrl: 'https://fixture.unipile.com/api/v1', apiKey: 'synthetic' };
    Object.defineProperty(config, 'apiVersion', { enumerable: true, get: getter });
    expect(() => new UnipileV1AccountLifecycle(config as never)).toThrow('Invalid Unipile configuration');
    expect(getter).not.toHaveBeenCalled();
});
it('observes a rejected promised fetch configuration under strict native Node', () => {
    const script = `const fs=require('node:fs'),ts=require('typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);const {UnipileV1AccountLifecycle}=require(process.argv[1]);try{new UnipileV1AccountLifecycle({apiVersion:'v1',baseUrl:'https://fixture.unipile.com/api/v1',apiKey:'synthetic',fetch:Promise.reject(Error('synthetic rejected fetch'))});throw Error('Expected rejection');}catch(error){if(error.message!=='Invalid Unipile configuration')throw error;}setTimeout(()=>console.log('strict native account configuration guard passed'),10);`;
    const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script, fileURLToPath(new URL('./v1-account-lifecycle.ts', import.meta.url))], { cwd: process.cwd(), encoding: 'utf8', timeout: 3000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('strict native account configuration guard passed');
});
it.each([false, true])('native loopback DELETE preserves exact scope and no-retry lost response: %s', async (lost) => {
    const requests: {
        method: string | undefined;
        url: string | undefined;
    }[] = [];
    const server = createServer((req, res) => {
        requests.push({ method: req.method, url: req.url });
        expect(req.headers['x-api-key']).toBe('synthetic-loopback-only');
        if (req.method === 'GET') {
            expect(req.headers['cache-control']).toBe('no-store');
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(account()));
            return;
        }
        req.resume();
        if (lost) {
            req.socket.destroy();
            return;
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ object: 'AccountDeleted' }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const address = server.address();
        if (!address || typeof address === 'string')
            throw Error('Synthetic fixture unavailable');
        const api = new UnipileV1AccountLifecycle({ apiVersion: 'v1', baseUrl: `http://127.0.0.1:${address.port}/api/v1`, apiKey: 'synthetic-loopback-only', allowLoopbackHttp: true, timeoutMs: 1000 });
        expect(await api.disconnect(record(), new AbortController().signal)).toEqual({ status: lost ? 'unknown' : 'disconnected' });
        expect(requests).toEqual([{ method: 'GET', url: '/api/v1/accounts/account%2Fopaque' }, { method: 'DELETE', url: '/api/v1/accounts/account%2Fopaque' }]);
    }
    finally {
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
    }
});
