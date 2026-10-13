import { types } from 'node:util';
import { parseLifecycleRecord, type AccountDisconnect, type AccountInspection, type RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
import type { ConnectionStatus } from '../../contracts/src';
import type { UnipileV1TransportConfig } from './v1-http';
import { BoundedUnipileHttp } from './http-core';
function object(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value) && !types.isProxy(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).every(k => typeof k === 'string' && 'value' in Object.getOwnPropertyDescriptor(value, k)!);
}
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 2048 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
/** Authenticated single-account projection only. Display names/login usernames are never ownership
 * proof, opaque IDs never become email/person aliases, source OK establishes no initial sync/coverage.
 * The expected identity MUST originate from service-owned verified binding, not this same response. */
export function projectV1Account(raw: unknown, expected: RecordedLifecycleConnection): AccountInspection {
    const record = parseLifecycleRecord(expected), review = (code: 'account_changed' | 'protocol' | 'identity_pending' = 'protocol'): AccountInspection => ({ status: 'review', code });
    if (!object(raw) || raw.object !== 'Account')
        return review();
    const platform = record.binding.platform, type = { gmail: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', imap: 'MAIL', whatsapp: 'WHATSAPP', linkedin: 'LINKEDIN' }[platform];
    if (raw.id !== record.providerAccountId || raw.type !== type)
        return review('account_changed');
    if (!object(raw.connection_params))
        return review();
    if (platform === 'imap')
        return review('identity_pending');
    const product = raw.connection_params[record.binding.channel === 'email' ? 'mail' : 'im'];
    if (!object(product))
        return review();
    let namespace: string, value: string;
    if (platform === 'whatsapp') {
        if (typeof product.phone_number !== 'string' || !/^\+[1-9]\d{6,14}$/.test(product.phone_number))
            return review('identity_pending');
        namespace = 'unipile.v1.whatsapp.im.phone_number';
        value = product.phone_number;
    }
    else {
        if (!id(product.id))
            return review('identity_pending');
        namespace = platform === 'gmail' ? 'unipile.v1.google.mail.id' : platform === 'outlook' ? 'unipile.v1.outlook.mail.id' : 'unipile.v1.linkedin.im.id';
        if (platform === 'outlook' && product.mailbox_id !== undefined && !id(product.mailbox_id))
            return review();
        value = platform === 'outlook' ? JSON.stringify([product.id, product.mailbox_id ?? null]) : product.id;
    }
    if (record.ownerIdentity.namespace !== namespace || record.ownerIdentity.value !== value)
        return review('account_changed');
    if (!Array.isArray(raw.sources) || types.isProxy(raw.sources) || raw.sources.length > 100 || !raw.sources.every(s => object(s) && id(s.id) && typeof s.status === 'string'))
        return review();
    const source = raw.sources.filter(s => s.id === record.sourceId);
    if (source.length !== 1)
        return review();
    const status: Record<string, ConnectionStatus> = { OK: 'connected', CONNECTING: 'connecting', CREDENTIALS: 'verification_required', PERMISSIONS: 'verification_required', ERROR: 'failed', STOPPED: 'disconnected' };
    if (!Object.hasOwn(status, source[0].status))
        return review();
    return { status: 'observed', observation: { ...record, status: status[source[0].status] } };
}
export class UnipileV1AccountLifecycle {
    #http: BoundedUnipileHttp;
    constructor(config: UnipileV1TransportConfig) {
        try {
            if (types.isPromise(config)) {
                void config.catch(() => undefined);
                throw Error();
            }
            if (!object(config))
                throw Error();
            let promised = false;
            for (const value of Object.values(config))
                if (types.isPromise(value)) {
                    void value.catch(() => undefined);
                    promised = true;
                }
            if (promised)
                throw Error();
            const allowed = ['apiVersion', 'baseUrl', 'apiKey', 'fetch', 'timeoutMs', 'maxResponseBytes', 'allowLoopbackHttp'];
            if (Object.keys(config).some(k => !allowed.includes(k)) || config.apiVersion !== 'v1' || typeof config.baseUrl !== 'string' || typeof config.apiKey !== 'string' || config.fetch !== undefined && typeof config.fetch !== 'function')
                throw Error();
            this.#http = new BoundedUnipileHttp({ ...config, basePath: '/api/v1', strictWriteRejections: true });
        }
        catch {
            throw Error('Invalid Unipile configuration');
        }
    }
    async get(input: RecordedLifecycleConnection, signal: AbortSignal): Promise<AccountInspection> {
        const record = parseLifecycleRecord(input), result = await this.#http.request('GET', this.#http.url(`accounts/${encodeURIComponent(record.providerAccountId)}`), undefined, { signal });
        if (result.kind !== 'success' || result.status !== 200)
            return { status: 'unavailable' };
        return projectV1Account(result.data, record);
    }
    /** Only compose with a trusted durable exclusive retirement boundary. This low-level method owns
     * HTTP scope/owner corroboration, not authorization, unresolved-send fencing or durable intent. */
    async disconnect(input: RecordedLifecycleConnection, signal: AbortSignal): Promise<AccountDisconnect> {
        const record = parseLifecycleRecord(input);
        if (signal.aborted)
            return { status: 'rejected' };
        const proof = await this.get(record, signal);
        if (signal.aborted || proof.status !== 'observed')
            return { status: 'rejected' };
        const result = await this.#http.request('DELETE', this.#http.url(`accounts/${encodeURIComponent(record.providerAccountId)}`), undefined, { signal });
        if (result.kind === 'not_submitted' || result.kind === 'rejected')
            return { status: 'rejected' };
        if (result.kind !== 'success' || result.status !== 200 || !object(result.data) || result.data.object !== 'AccountDeleted' || Object.keys(result.data).length !== 1)
            return { status: 'unknown' };
        return { status: 'disconnected' };
    }
}
