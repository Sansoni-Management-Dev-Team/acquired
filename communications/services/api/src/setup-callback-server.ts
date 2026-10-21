import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import type { ConfiguredUnipileV1Runtime } from '../../../packages/adapter-unipile/src/v1-runtime';
export interface SetupCallbackServerOptions {
    runtime: Pick<ConfiguredUnipileV1Runtime, 'completeSetupNotification'>;
    maxRequestBytes?: number;
    bodyTimeoutMs?: number;
    captureTimeoutMs?: number;
}
class CallbackFailure extends Error {
    constructor(readonly status: number, readonly code: string) { super(code); }
}
function respond(res: ServerResponse, status: number, code: string) {
    if (res.destroyed || res.writableEnded)
        return;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Connection': 'close' });
    res.end(JSON.stringify(status === 200 ? { status: code } : { error: { code } }));
}
function body(req: IncomingMessage, max: number, timeout: number): Promise<Uint8Array> {
    const ct = req.rawHeaders.filter((_, i) => i % 2 === 0 && req.rawHeaders[i].toLowerCase() === 'content-type');
    if (ct.length !== 1 || typeof req.headers['content-type'] !== 'string' || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(req.headers['content-type']))
        throw new CallbackFailure(400, 'invalid_request');
    const rawLength = req.headers['content-length'];
    let length: number | undefined;
    if (rawLength !== undefined) {
        if (typeof rawLength !== 'string' || !/^(0|[1-9]\d*)$/.test(rawLength))
            throw new CallbackFailure(400, 'invalid_request');
        length = Number(rawLength);
        if (!Number.isSafeInteger(length) || length > max)
            throw new CallbackFailure(413, 'too_large');
    }
    if (req.aborted || req.destroyed)
        throw new CallbackFailure(400, 'invalid_request');
    return new Promise((resolve, reject) => {
        let bytes = 0, ended = false;
        const chunks: Buffer[] = [];
        const clean = () => { clearTimeout(timer); req.off('data', chunk); req.off('end', end); req.off('aborted', aborted); req.off('error', aborted); };
        const fail = (status: number, code: string) => {
            if (ended)
                return;
            ended = true;
            clean();
            chunks.length = 0;
            req.resume();
            reject(new CallbackFailure(status, code));
        };
        const chunk = (value: Buffer) => {
            bytes += value.length;
            if (bytes > max) {
                fail(413, 'too_large');
                return;
            }
            chunks.push(Buffer.from(value));
        };
        const end = () => {
            if (ended)
                return;
            if (length !== undefined && length !== bytes) {
                fail(400, 'invalid_request');
                return;
            }
            ended = true;
            clean();
            resolve(Buffer.concat(chunks, bytes));
        };
        const aborted = () => fail(400, 'invalid_request');
        const timer = setTimeout(() => fail(408, 'request_timeout'), timeout);
        req.on('data', chunk);
        req.on('end', end);
        req.on('aborted', aborted);
        req.on('error', aborted);
    });
}
/** Dedicated provider notify listener. Capability is private routing authority bound by the concrete
 * runtime to stored nonce/expiry, never logged/echoed or accepted as an application owner ID.
 * Queued ACK means durable encrypted inbox commit only. Binding happens on authenticated owner polling. */
export function createSetupCallbackServer(options: SetupCallbackServerOptions): Server {
    let capture: ConfiguredUnipileV1Runtime['completeSetupNotification'], max: number, bodyTimeout: number, captureTimeout: number;
    try {
        if (!options || types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype)
            throw Error();
        const d = Object.getOwnPropertyDescriptors(options);
        if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !['runtime', 'maxRequestBytes', 'bodyTimeoutMs', 'captureTimeoutMs'].includes(k) || !('value' in d[k])))
            throw Error();
        const runtime = options.runtime;
        if (!runtime || types.isProxy(runtime))
            throw Error();
        const fn = runtime.completeSetupNotification;
        if (typeof fn !== 'function')
            throw Error();
        capture = Function.prototype.bind.call(fn, runtime);
        max = options.maxRequestBytes ?? 262144;
        bodyTimeout = options.bodyTimeoutMs ?? 5000;
        captureTimeout = options.captureTimeoutMs ?? 20000;
        if (!Number.isSafeInteger(max) || max < 1 || max > 1048576 || !Number.isSafeInteger(bodyTimeout) || bodyTimeout < 1 || !Number.isSafeInteger(captureTimeout) || captureTimeout < 1 || bodyTimeout + captureTimeout >= 30000)
            throw Error();
    }
    catch {
        throw Error('Invalid setup callback server configuration');
    }
    const server = createServer((req, res) => {
        let pending:Promise<unknown>|undefined;
        return (async () => {
            let url: URL;
            try {
                url = new URL(req.url ?? '', 'https://callback.invalid');
            }
            catch {
                throw new CallbackFailure(400, 'invalid_request');
            }
            if (req.method !== 'POST' || url.origin !== 'https://callback.invalid' || url.pathname !== '/v1/setup/notify')
                throw new CallbackFailure(404, 'not_found');
            const caps = url.searchParams.getAll('capability');
            if (caps.length !== 1 || caps[0].length < 1 || caps[0].length > 128 || /[^A-Za-z0-9._-]/.test(caps[0]) || [...url.searchParams.keys()].some(k => k !== 'capability'))
                throw new CallbackFailure(400, 'invalid_request');
            const rawBody = await body(req, max, bodyTimeout), end = performance.now() + captureTimeout;
            let timer: ReturnType<typeof setTimeout> | undefined;
            const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new CallbackFailure(503, 'retry')), captureTimeout); });
            try {
                pending = Promise.resolve().then(() => {
                    if (performance.now() >= end)
                        throw new CallbackFailure(503, 'retry');
                    return capture({ rawBody, capability: caps[0] });
                });
                const result = await Promise.race([pending, deadline]);
                if (performance.now() >= end)
                    throw new CallbackFailure(503, 'retry');
                if (!result || typeof result !== 'object' || types.isProxy(result))
                    throw new CallbackFailure(503, 'retry');
                const d = Object.getOwnPropertyDescriptors(result);
                let malformed = false;
                for (const descriptor of Object.values(d)) {
                    if ('value' in descriptor && types.isPromise(descriptor.value)) {
                        void Promise.prototype.then.call(descriptor.value, undefined, () => { });
                        malformed = true;
                    }
                }
                if (malformed)
                    throw new CallbackFailure(503, 'retry');
                if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !('value' in d[k])))
                    throw new CallbackFailure(503, 'retry');
                if (Object.keys(d).length === 1 && d.status?.value === 'queued') {
                    respond(res, 200, 'queued');
                    return;
                }
                if (Object.keys(d).sort().join(',') === 'code,status' && d.status?.value === 'rejected') {
                    const code = d.code.value;
                    if (code === 'unauthenticated')
                        throw new CallbackFailure(401, 'unauthorized');
                    if (['invalid', 'expired', 'forbidden', 'reconnect_changed'].includes(code))
                        throw new CallbackFailure(code === 'invalid' ? 400 : 403, 'invalid_request');
                }
                throw new CallbackFailure(503, 'retry');
            }
            finally {
                clearTimeout(timer);
            }
        })().catch(error => {
            req.resume();
            if (error instanceof CallbackFailure)
                respond(res, error.status, error.code);
            else
                respond(res, 503, 'retry');
        }).finally(async()=>{await pending?.then(()=>undefined,()=>undefined);});
    });
    server.requestTimeout = 0;
    server.headersTimeout = 10000;
    return server;
}
