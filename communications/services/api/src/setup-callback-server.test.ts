import { describe, it, expect, vi } from 'vitest';
import { request } from 'node:http';
import { once } from 'node:events';
import { createSetupCallbackServer } from './setup-callback-server';
async function fixture(complete: (input: {
    rawBody: Uint8Array;
    capability: string;
}) => Promise<unknown>, captureTimeoutMs = 1000) { const capture = vi.fn(complete), server = createSetupCallbackServer({ runtime: { completeSetupNotification: capture as never }, bodyTimeoutMs: 50, captureTimeoutMs, maxRequestBytes: 64 }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); const port = (server.address() as {
    port: number;
}).port; function send(body = '{"name":"opaque"}', path = '/v1/setup/notify?capability=private-capability', contentType = 'application/json') { return new Promise<{
    status: number;
    body: string;
}>((resolve, reject) => { const req = request({ hostname: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': contentType } }, res => { let output = ''; res.on('data', x => output += x); res.on('end', () => resolve({ status: res.statusCode!, body: output })); }); req.on('error', reject); req.end(body); }); } return { capture, send, close: () => new Promise<void>(resolve => server.close(() => resolve())) }; }
describe('dedicated setup callback HTTP listener', () => {
    it('preserves raw bytes/private capability and only acknowledges after durable queued result', async () => { let commit!: () => void; const f = await fixture(() => new Promise(resolve => { commit = () => resolve({ status: 'queued' }); })); try {
        let done = false;
        const response = f.send().then(x => { done = true; return x; });
        while (!f.capture.mock.calls.length)
            await new Promise(r => setTimeout(r, 1));
        expect(done).toBe(false);
        commit();
        const result = await response;
        expect(result).toEqual({ status: 200, body: '{"status":"queued"}' });
        expect(f.capture.mock.calls[0][0]).toEqual({ rawBody: Buffer.from('{"name":"opaque"}'), capability: 'private-capability' });
    }
    finally {
        await f.close();
    } });
    it('sanitizes rejected callback and never returns private payload errors', async () => { const f = await fixture(async () => { throw Error('synthetic private detail'); }); try {
        expect(await f.send()).toEqual({ status: 503, body: '{"error":{"code":"retry"}}' });
    }
    finally {
        await f.close();
    } });
    it.each(['oversize', 'content type', 'repeated capability', 'wrong path'])('rejects %s before callback capture', async (kind) => { const f = await fixture(async () => ({ status: 'queued' })); try {
        const result = await f.send(kind === 'oversize' ? 'x'.repeat(65) : '{}', kind === 'wrong path' ? '/wrong' : kind === 'repeated capability' ? '/v1/setup/notify?capability=first&capability=second' : undefined, kind === 'content type' ? 'text/plain' : undefined);
        expect(result.status).toBe(kind === 'oversize' ? 413 : kind === 'wrong path' ? 404 : 400);
        expect(f.capture).not.toHaveBeenCalled();
    }
    finally {
        await f.close();
    } });
    it('never claims commit when capture stalls or commits after response timeout', async () => { let commit!: () => void; const f = await fixture(() => new Promise(resolve => { commit = () => resolve({ status: 'queued' }); }), 10); try {
        expect((await f.send()).status).toBe(503);
        commit();
        await new Promise(r => setTimeout(r, 5));
        expect(f.capture).toHaveBeenCalledTimes(1);
    }
    finally {
        await f.close();
    } });
    it('malformed completed result cannot produce ACK200', async () => { const f = await fixture(async () => ({ status: 'recorded', binding: { private: 'unverified' } })); try {
        expect((await f.send()).status).toBe(503);
    }
    finally {
        await f.close();
    } });
});
