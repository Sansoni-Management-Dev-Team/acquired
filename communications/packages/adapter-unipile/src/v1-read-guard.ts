import { types } from 'node:util';
export function unavailable(): never { throw Error('History unavailable'); }
export function plain(v: unknown): v is Record<string, unknown> {
    if (types.isPromise(v)) {
        void v.catch(() => undefined);
        return false;
    }
    return !!v && typeof v === 'object' && !Array.isArray(v) && !types.isProxy(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(Object.getOwnPropertyDescriptors(v)).every(k => typeof k === 'string' && 'value' in Object.getOwnPropertyDescriptor(v, k)!);
}
export const opaque = (v: unknown, max = 2048): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
export const utc = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function pinned<T extends (...args: never[]) => unknown>(fn: T, owner: unknown): T {
    if (typeof fn !== 'function' || types.isProxy(fn))
        unavailable();
    return Function.prototype.bind.call(fn, owner) as T;
}
/** One monotonic deadline covers callbacks and native I/O. Rejected/late promises remain observed. */
export async function boundedRead<T>(milliseconds: number, external: AbortSignal | undefined, work: (signal: AbortSignal, check: () => void) => Promise<T>): Promise<T> {
    const controller = new AbortController(), end = performance.now() + milliseconds;
    const check = () => {
        if (controller.signal.aborted || performance.now() >= end) {
            controller.abort();
            unavailable();
        }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectDeadline: (error: Error) => void = () => { };
    const deadline = new Promise<never>((_, reject) => { rejectDeadline = reject; timer = setTimeout(() => { controller.abort(); reject(Error('History unavailable')); }, milliseconds); });
    const abort = () => { controller.abort(); rejectDeadline(Error('History unavailable')); };
    external?.addEventListener('abort', abort, { once: true });
    try {
        if (external?.aborted)
            abort();
        check();
        return await Promise.race([Promise.resolve().then(() => work(controller.signal, check)), deadline]);
    }
    catch {
        return unavailable();
    }
    finally {
        clearTimeout(timer);
        external?.removeEventListener('abort', abort);
        controller.abort();
    }
}
/** Vendor ISO timestamps may omit fractions or include offsets; reject calendar rollover. */
export function vendorDate(v: unknown): v is string {
    if (typeof v !== 'string')
        return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(v);
    if (!m)
        return false;
    const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number), zone = m[7];
    return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate() && hour <= 23 && minute <= 59 && second <= 59 && (zone === 'Z' || Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59) && Number.isFinite(Date.parse(v));
}
/** Accept concrete class instances while rejecting proxy/accessor substitution before method reads. */
export function portMethod<T extends (...args: never[]) => unknown>(port: unknown, name: string): T {
    if (types.isPromise(port)) {
        void port.catch(() => undefined);
        unavailable();
    }
    if (!port || typeof port !== 'object' || types.isProxy(port))
        unavailable();
    let owner: object | null = port;
    for (let depth = 0; owner && depth < 8; depth++, owner = Object.getPrototypeOf(owner)) {
        if (types.isProxy(owner))
            unavailable();
        const d = Object.getOwnPropertyDescriptor(owner, name);
        if (d) {
            if (!('value' in d))
                unavailable();
            return pinned(d.value, port);
        }
    }
    return unavailable();
}
export function validateV1ReadConfig(config: unknown): void {
    if (!plain(config) || Object.keys(config).some(k => !['apiVersion', 'baseUrl', 'apiKey', 'fetch', 'timeoutMs', 'maxResponseBytes', 'allowLoopbackHttp'].includes(k)))
        unavailable();
    for (const value of Object.values(config))
        if (types.isPromise(value)) {
            void value.catch(() => undefined);
            unavailable();
        }
    if (config.apiVersion !== 'v1' || typeof config.baseUrl !== 'string' || typeof config.apiKey !== 'string' || config.fetch !== undefined && (typeof config.fetch !== 'function' || types.isProxy(config.fetch)))
        unavailable();
}
