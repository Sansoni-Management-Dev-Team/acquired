import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding, type ConnectionStatus } from '../../contracts/src';
/** Namespace is explicit: an opaque provider account ID is never a person/channel alias. */
export interface LifecycleOwnerIdentity {
    namespace: string;
    value: string;
}
export interface RecordedLifecycleConnection {
    binding: ConnectionBinding;
    providerAccountId: string;
    sourceId: string;
    ownerIdentity: LifecycleOwnerIdentity;
}
export interface LifecycleObservation extends RecordedLifecycleConnection {
    status: ConnectionStatus;
}
export type AccountInspection = {
    status: 'observed';
    observation: LifecycleObservation;
} | {
    status: 'review';
    code: 'account_changed' | 'protocol' | 'identity_pending';
} | {
    status: 'unavailable';
};
export type AccountDisconnect = {
    status: 'disconnected';
} | {
    status: 'rejected';
} | {
    status: 'unknown';
};
export interface LifecycleProviderPort {
    get(record: RecordedLifecycleConnection, signal: AbortSignal): Promise<AccountInspection>;
    disconnect(record: RecordedLifecycleConnection, signal: AbortSignal): Promise<AccountDisconnect>;
}
export interface DisconnectTicket {
    record: RecordedLifecycleConnection;
    operationKey: string;
    token: string;
}
export interface ConnectionLifecycleOptions {
    binding: ConnectionBinding;
    timeoutMs?: number;
    /** Current authorized exact generation and physical owner proof from trusted service storage.
     * Retired current records remain readable for exact terminal replay; inactivity never authorizes
     * a new operation. Missing/revoked/stale returns null. No defaults or caller account IDs. */
    resolveCurrent(binding: ConnectionBinding, signal: AbortSignal): Promise<RecordedLifecycleConnection | null>;
    provider: LifecycleProviderPort;
    /** Required durable boundary, not a default callback permission. A prepared ticket resolves ONLY
     * after retirement/coverage invalidation/exclusive physical-account intent commits definitely.
     * Recheck current grant/generation/owner while committing, reject inactive new operations,
     * unresolved sends and shared accounts. Fence reconnects and ALL dispatch until completion
     * or explicit reconciliation. Unknown/lost commits never return prepared or trigger deletion.
     * Same-key replay after an uncertain provider attempt MUST return review, never another ticket.
     * No concrete storage implementation is supplied by this module. */
    prepareDisconnect(record: RecordedLifecycleConnection, operationKey: string, signal: AbortSignal): Promise<{
        status: 'prepared';
        ticket: DisconnectTicket;
    } | {
        status: 'duplicate';
    } | {
        status: 'review';
    }>;
    /** Resolve recorded only after terminal result commit. Preserve original binding and history;
     * unknown/rejected results remain retired and require reconciliation, never clear person holds. */
    finishDisconnect(ticket: DisconnectTicket, result: AccountDisconnect, signal: AbortSignal): Promise<{
        status: 'recorded';
    } | {
        status: 'unknown';
    }>;
}
export type LifecycleStatusResult = AccountInspection | {
    status: 'forbidden';
};
export type LifecycleDisconnectResult = AccountDisconnect | {
    status: 'forbidden' | 'review' | 'duplicate' | 'unavailable';
};
function fail(): never { throw Error('Connection lifecycle unavailable'); }
function exact(value: unknown, fields: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    if (types.isPromise(value)) {
        void value.catch(() => undefined);
        fail();
    }
    if (!value || typeof value !== 'object' || Array.isArray(value) || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
        fail();
    const d = Object.getOwnPropertyDescriptors(value), result: Record<string, unknown> = {};
    if (fields.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== 'string' || ![...fields, ...optional].includes(k) || !('value' in d[k]) || !d[k].enumerable))
        fail();
    let promised = false;
    for (const k of Object.keys(d)) {
        const v = d[k].value;
        if (types.isPromise(v)) {
            void v.catch(() => undefined);
            promised = true;
        }
        result[k] = v;
    }
    if (promised)
        fail();
    return result;
}
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const bindingFields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'];
function parsedBinding(value: unknown): ConnectionBinding {
    const raw = exact(value, bindingFields);
    if (bindingFields.some(k => k !== 'generation' && !id(raw[k])) || !Number.isSafeInteger(raw.generation) || Number(raw.generation) > 2147483647)
        fail();
    const binding = raw as unknown as ConnectionBinding;
    assertSameBinding(binding, binding);
    return binding;
}
/** Validate service-owned metadata without evaluating caller getters or retaining extra fields. */
export function parseLifecycleRecord(value: unknown): RecordedLifecycleConnection {
    try {
        const raw = exact(value, ['binding', 'providerAccountId', 'sourceId', 'ownerIdentity']), binding = parsedBinding(raw.binding), owner = exact(raw.ownerIdentity, ['namespace', 'value']);
        if (binding.backend !== 'unipile' || !id(raw.providerAccountId, 2048) || ['.', '..'].includes(raw.providerAccountId) || !id(raw.sourceId, 2048) || !id(owner.namespace) || !id(owner.value, 4096))
            fail();
        return { binding, providerAccountId: raw.providerAccountId, sourceId: raw.sourceId, ownerIdentity: { namespace: owner.namespace, value: owner.value } };
    }
    catch {
        throw Error('Invalid account lifecycle record');
    }
}
function same(a: RecordedLifecycleConnection, b: RecordedLifecycleConnection): boolean {
    try {
        assertSameBinding(a.binding, b.binding);
        return a.providerAccountId === b.providerAccountId && a.sourceId === b.sourceId && a.ownerIdentity.namespace === b.ownerIdentity.namespace && a.ownerIdentity.value === b.ownerIdentity.value;
    }
    catch {
        return false;
    }
}
function inspection(value: unknown, record: RecordedLifecycleConnection): AccountInspection {
    const raw = exact(value, ['status'], ['observation', 'code']);
    if (raw.status === 'unavailable' && raw.observation === undefined && raw.code === undefined)
        return { status: 'unavailable' };
    if (raw.status === 'review' && raw.observation === undefined && ['account_changed', 'protocol', 'identity_pending'].includes(raw.code as string))
        return { status: 'review', code: raw.code as 'account_changed' | 'protocol' | 'identity_pending' };
    if (raw.status !== 'observed' || raw.code !== undefined)
        fail();
    const observation = exact(raw.observation, ['binding', 'providerAccountId', 'sourceId', 'ownerIdentity', 'status']);
    const parsed = parseLifecycleRecord({ binding: observation.binding, providerAccountId: observation.providerAccountId, sourceId: observation.sourceId, ownerIdentity: observation.ownerIdentity });
    if (!same(record, parsed) || !['connecting', 'connected', 'syncing', 'verification_required', 'disconnected', 'failed'].includes(observation.status as string))
        fail();
    return { status: 'observed', observation: { ...parsed, status: observation.status as ConnectionStatus } };
}
function disconnected(value: unknown): AccountDisconnect {
    const raw = exact(value, ['status']);
    if (!['disconnected', 'rejected', 'unknown'].includes(raw.status as string))
        fail();
    return { status: raw.status as AccountDisconnect['status'] };
}
/** No storage implementation or activated disconnect route is implied. All provider work follows
 * an exact current read and owner comparison; deletion requires definite durable retirement first. */
export function createConnectionLifecycleCoordinator(options: ConnectionLifecycleOptions): {
    status(binding: ConnectionBinding): Promise<LifecycleStatusResult>;
    disconnect(input: {
        binding: ConnectionBinding;
        operationKey: string;
    }): Promise<LifecycleDisconnectResult>;
} {
    let binding: ConnectionBinding, timeout: number, resolve: ConnectionLifecycleOptions['resolveCurrent'], get: LifecycleProviderPort['get'], remove: LifecycleProviderPort['disconnect'], prepare: ConnectionLifecycleOptions['prepareDisconnect'], finish: ConnectionLifecycleOptions['finishDisconnect'];
    try {
        const config = exact(options, ['binding', 'resolveCurrent', 'provider', 'prepareDisconnect', 'finishDisconnect'], ['timeoutMs']);
        binding = parsedBinding(config.binding);
        timeout = (config.timeoutMs ?? 15000) as number;
        if (binding.backend !== 'unipile' || !Number.isSafeInteger(timeout) || timeout < 1 || timeout >= 30000 || types.isProxy(config.provider))
            fail();
        const provider = config.provider as LifecycleProviderPort;
        if (typeof config.resolveCurrent !== 'function' || typeof config.prepareDisconnect !== 'function' || typeof config.finishDisconnect !== 'function' || typeof provider?.get !== 'function' || typeof provider?.disconnect !== 'function')
            fail();
        resolve = Function.prototype.bind.call(config.resolveCurrent, options);
        get = Function.prototype.bind.call(provider.get, provider);
        remove = Function.prototype.bind.call(provider.disconnect, provider);
        prepare = Function.prototype.bind.call(config.prepareDisconnect, options);
        finish = Function.prototype.bind.call(config.finishDisconnect, options);
    }
    catch {
        throw Error('Invalid connection lifecycle configuration');
    }
    function scoped(value: unknown): ConnectionBinding { const parsed = parsedBinding(value); assertSameBinding(binding, parsed); return parsed; }
    async function bounded<T>(work: (step: <R>(invoke: (signal: AbortSignal) => Promise<R>) => Promise<R>) => Promise<T>): Promise<T> {
        const controller = new AbortController(), deadline = performance.now() + timeout;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const check = () => {
            if (controller.signal.aborted || performance.now() >= deadline) {
                controller.abort();
                fail();
            }
        };
        const stopped = new Promise<never>((_r, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('Connection lifecycle unavailable')); }, timeout); });
        async function step<R>(invoke: (signal: AbortSignal) => Promise<R>) { check(); const result = await invoke(controller.signal); check(); return result; }
        const pending = Promise.resolve().then(async () => { check(); const result = await work(step); check(); return result; });
        try {
            return await Promise.race([pending, stopped]);
        }
        finally {
            clearTimeout(timer);
            controller.abort();
        }
    }
    async function current(step: <R>(invoke: (signal: AbortSignal) => Promise<R>) => Promise<R>): Promise<RecordedLifecycleConnection | null> {
        const value = await step(signal => resolve(structuredClone(binding), signal));
        if (value === null)
            return null;
        const record = parseLifecycleRecord(value);
        assertSameBinding(binding, record.binding);
        return record;
    }
    return {
        async status(requested) {
            try {
                scoped(requested);
            }
            catch {
                return { status: 'forbidden' };
            }
            try {
                return await bounded(async (step) => {
                    const record = await current(step);
                    if (!record)
                        return { status: 'forbidden' };
                    const result = inspection(await step(signal => get(structuredClone(record), signal)), record);
                    const refreshed = await current(step);
                    if (!refreshed || !same(record, refreshed))
                        return { status: 'forbidden' };
                    return result;
                });
            }
            catch {
                return { status: 'unavailable' };
            }
        },
        async disconnect(input) {
            let operationKey: string;
            try {
                const raw = exact(input, ['binding', 'operationKey']);
                scoped(raw.binding);
                if (!id(raw.operationKey))
                    fail();
                operationKey = raw.operationKey;
            }
            catch {
                return { status: 'forbidden' };
            }
            let providerRequested = false;
            try {
                return await bounded(async (step) => {
                    const record = await current(step);
                    if (!record)
                        return { status: 'forbidden' };
                    const prepared = exact(await step(signal => prepare(structuredClone(record), operationKey, signal)), ['status'], ['ticket']);
                    if (['duplicate', 'review'].includes(prepared.status as string) && prepared.ticket === undefined)
                        return { status: prepared.status as 'duplicate' | 'review' };
                    if (prepared.status !== 'prepared')
                        fail();
                    const raw = exact(prepared.ticket, ['record', 'operationKey', 'token']), ticket: DisconnectTicket = { record: parseLifecycleRecord(raw.record), operationKey: raw.operationKey as string, token: raw.token as string };
                    if (!same(record, ticket.record) || ticket.operationKey !== operationKey || typeof ticket.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket.token))
                        fail();
                    let result: AccountDisconnect;
                    try {
                        // Terminal replay never reaches provider GET. Fresh deletion corroborates
                        // owner only after durable retirement has closed all account operations.
                        const proof = inspection(await step(signal => get(structuredClone(record), signal)), record);
                        result = proof.status !== 'observed' ? { status: 'rejected' } : disconnected(await step(signal => { providerRequested = true; return remove(structuredClone(record), signal); }));
                    }
                    catch {
                        result = { status: providerRequested ? 'unknown' : 'rejected' };
                    }
                    const recorded = exact(await step(signal => finish(structuredClone(ticket), structuredClone(result), signal)), ['status']);
                    if (recorded.status !== 'recorded')
                        return { status: 'unknown' };
                    return result;
                });
            }
            catch {
                return { status: providerRequested ? 'unknown' : 'unavailable' };
            }
        }
    };
}
