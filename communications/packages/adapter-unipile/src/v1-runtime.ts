import type { ConnectionManagementPort } from '../../contracts/src/management';
import type { AccessScope, ConnectionBinding, MessagingAdapter, ReceiptLookup, SubmissionReceipt, DeliveryOutcome, Readiness } from '../../contracts/src';
import type { RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
import type { CompleteSetupResult } from '../../core/src/connection-setup';
import type { SqlPool } from '../../storage-postgres/src/webhook-repository';
import type { AccountVaultOptions } from '../../storage-postgres/src/account-vault';
import type { AccountRuntimeRepository } from '../../storage-postgres/src/account-runtime';
import type { UnipileV1TransportConfig } from './v1-http';
import type { WebhookCodec } from '../../core/src/webhook-codec';
import type { ConfiguredV1WebhookRuntime, ConfiguredV1WebhookRuntimeOptions } from './v1-webhook-runtime';
import { createConfiguredUnipileV1WebhookRuntime } from './v1-webhook-runtime';
import { createPostgresProviderWebhookSpool } from '../../storage-postgres/src/provider-webhook-spool';
import type { PostgresDispatchJournalOptions } from '../../storage-postgres/src/dispatch-journal';
import type { UncertainDispatchRecord } from '../../core/src/dispatch';
export interface ConfiguredUnipileV1RuntimeOptions {
    pool: SqlPool;
    provider: UnipileV1TransportConfig;
    applicationId: string;
    integrationId: string;
    providerConfigurationReference: string;
    vault: AccountVaultOptions;
    callbackKey: Uint8Array;
    webhookSecret: string;
    redirectOrigin: string;
    successPath: string;
    failurePath: string;
    notifyUrl: string;
    readiness?(binding: ConnectionBinding): Promise<Readiness>;
    sourceIds?: Partial<Record<'gmail' | 'outlook' | 'whatsapp' | 'linkedin', string>>;
}
export interface ConfiguredUnipileV1Runtime extends ConnectionManagementPort {
    store: AccountRuntimeRepository;
    authorizeSignedScope(scope: AccessScope, metadata: {
        expiresAt: string;
    }): Promise<boolean>;
    completeSetupNotification(input: {
        rawBody: Uint8Array;
        capability: string;
    }): Promise<{
        status: 'queued';
    } | CompleteSetupResult>;
    processEmailSentNotification(input: {
        rawBody: Uint8Array;
        rawHeaders: readonly string[];
    }): Promise<{
        kind: 'associated' | 'duplicate' | 'missing' | 'review';
    }>;
    createWebhookRuntime(options: Pick<ConfiguredV1WebhookRuntimeOptions, 'journal' | 'history'> & {
        captureCodec: Pick<WebhookCodec, 'decode' | 'digest'>;
    }): ConfiguredV1WebhookRuntime;
    providerAccountDigests(binding: ConnectionBinding): Promise<string[]>;
    dispatchOptions(binding: ConnectionBinding, options?: {
        historical?: boolean;
    }): Promise<Pick<PostgresDispatchJournalOptions, 'integrationId' | 'providerConfigurationReference' | 'providerApiVersion' | 'authority' | 'codec' | 'recipientDigest' | 'verifyReconciliation'>>;
    providerFactory(binding: ConnectionBinding, options?: {
        lookupOnly?: boolean;
    }): Promise<MessagingAdapter>;
    receiptDetails(binding: ConnectionBinding, lookup: ReceiptLookup, acceptedReceipt: SubmissionReceipt): Promise<DeliveryOutcome | null>;
    resolveCurrent(binding: ConnectionBinding): Promise<RecordedLifecycleConnection | null>;
    recoverUnknownEmail(record: UncertainDispatchRecord, signal: AbortSignal): Promise<DeliveryOutcome | null>;
}
import { createHmac, timingSafeEqual } from 'node:crypto';
import { types, isDeepStrictEqual } from 'node:util';
import { assertManagedConnection } from '../../contracts/src/management';
import { assertSameBinding } from '../../contracts/src';
import { createConnectionSetupCoordinator } from '../../core/src/connection-setup';
import { createConnectionLifecycleCoordinator } from '../../core/src/connection-lifecycle';
import { createPostgresAuthStateRepository } from '../../storage-postgres/src/auth-state-repository';
import { createPostgresAccountRuntime, type SetupNotification, type SetupStateRoute, type RuntimeConnection } from '../../storage-postgres/src/account-runtime';
import { AccountRuntimeVault } from '../../storage-postgres/src/account-vault';
import { ConnectionRetirementCodec, createPostgresConnectionRetirement } from '../../storage-postgres/src/connection-retirement';
import { UnipileV1HostedAuth } from './v1-hosted-auth';
import { UnipileV1AccountLifecycle } from './v1-account-lifecycle';
import { UnipileV1OwnerReader } from './v1-owner';
import { UnipileV1Transport } from './v1-http';
import { createRuntimeEmail, recoverTrackedEmailOutcome } from './v1-runtime-email';
import { portMethod } from './v1-read-guard';
import { createV1SocialRuntime } from './v1-social-runtime';
function failure(): never { throw Error('Configured communications runtime unavailable'); }
function data(value: unknown, depth = 0): void {
    if (types.isPromise(value)) {
        void Promise.prototype.then.call(value, undefined, () => { });
        failure();
    }
    if (depth > 32)
        failure();
    if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value))
        return;
    if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value)))
        failure();
    for (const key of Reflect.ownKeys(Object.getOwnPropertyDescriptors(value))) {
        const d = Object.getOwnPropertyDescriptor(value, key)!;
        if (typeof key !== 'string' || !('value' in d))
            failure();
        data(d.value, depth + 1);
    }
}
const inert = <T>(value: T): T => { data(value); return structuredClone(value); };
export function createConfiguredUnipileV1Runtime(options: ConfiguredUnipileV1RuntimeOptions): ConfiguredUnipileV1Runtime {
    let fixed: ConfiguredUnipileV1RuntimeOptions, key: Buffer;
    try {
        if (!options || types.isProxy(options) || Object.getPrototypeOf(options) !== Object.prototype)
            failure();
        const d = Object.getOwnPropertyDescriptors(options);
        for (const descriptor of Object.values(d)) {
            if ('value' in descriptor && types.isPromise(descriptor.value)) {
                void Promise.prototype.then.call(descriptor.value, undefined, () => { });
                failure();
            }
        }
        if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !('value' in d[k])))
            failure();
        if (Object.keys(d).some(k => !['pool', 'provider', 'applicationId', 'integrationId', 'providerConfigurationReference', 'vault', 'callbackKey', 'webhookSecret', 'redirectOrigin', 'successPath', 'failurePath', 'notifyUrl', 'sourceIds', 'readiness'].includes(k)))
            failure();
        if (!options.provider || types.isProxy(options.provider) || Object.getPrototypeOf(options.provider) !== Object.prototype)
            failure();
        const pd = Object.getOwnPropertyDescriptors(options.provider);
        if (Reflect.ownKeys(pd).some(k => typeof k !== 'string' || !('value' in pd[k])))
            failure();
        for (const [name, value] of Object.entries(pd)) {
            if (name === 'fetch') {
                if (types.isPromise(value.value)) {
                    void Promise.prototype.then.call(value.value, undefined, () => { });
                    failure();
                }
                if (value.value !== undefined && (typeof value.value !== 'function' || types.isProxy(value.value)))
                    failure();
            }
            else
                data(value.value);
        }
        fixed = { ...options, pool: Object.freeze({ connect: portMethod<SqlPool['connect']>(options.pool, 'connect') }), provider: { ...options.provider }, sourceIds: options.sourceIds ? inert(options.sourceIds) : {} };
        if (!types.isUint8Array(options.callbackKey) || types.isProxy(options.callbackKey) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(options.callbackKey)))
            failure();
        key = Buffer.from(options.callbackKey);
        if (key.length !== 32 || typeof options.webhookSecret !== 'string' || options.webhookSecret.length < 16 || options.webhookSecret.length > 4096 || options.readiness !== undefined && (typeof options.readiness !== 'function' || types.isProxy(options.readiness)))
            failure();
        for (const k of ['applicationId', 'integrationId', 'providerConfigurationReference'] as const)
            if (typeof options[k] !== 'string' || !options[k].length || options[k].length > 2000)
                failure();
        const notify = new URL(fixed.notifyUrl), redirect = new URL(fixed.redirectOrigin);
        if (notify.protocol !== 'https:' || notify.username || notify.password || notify.hash || notify.search || redirect.protocol !== 'https:' || redirect.origin !== fixed.redirectOrigin)
            failure();
    }
    catch {
        throw Error('Invalid configured communications runtime');
    }
    const vault = new AccountRuntimeVault(fixed.vault), store = createPostgresAccountRuntime({ pool: fixed.pool, vault, applicationId: fixed.applicationId, integrationId: fixed.integrationId, providerConfigurationReference: fixed.providerConfigurationReference, timeoutMs: 5000 });
    const reader = new UnipileV1OwnerReader(fixed.provider), transport = new UnipileV1Transport(fixed.provider), hosted = new UnipileV1HostedAuth({ ...fixed.provider, redirectOrigins: [fixed.redirectOrigin], notifyOrigins: [new URL(fixed.notifyUrl).origin] }), lifecycleProvider = new UnipileV1AccountLifecycle(fixed.provider), retirementCodec = new ConnectionRetirementCodec({ activeVersion: fixed.vault.activeVersion, keys: fixed.vault.keys });
    const scope = (input: AccessScope) => {
        const s = inert(input);
        if (Object.keys(s).length !== 3 || s.applicationId !== fixed.applicationId || ['tenantId', 'ownerId'].some(k => typeof s[k as keyof AccessScope] !== 'string' || !s[k as keyof AccessScope].length || s[k as keyof AccessScope].length > 200))
            failure();
        return s;
    };
    const binding = (s: AccessScope, input: ConnectionBinding) => {
        const b = inert(input);
        assertSameBinding(b, b);
        if (b.applicationId !== s.applicationId || b.tenantId !== s.tenantId || b.ownerId !== s.ownerId || b.backend !== 'unipile')
            failure();
        return b;
    };
    const cap = (nonce: string, expires: string) => `${Date.parse(expires)}.${createHmac('sha256', key).update(JSON.stringify(['communications.setup.callback.v1', fixed.integrationId, fixed.providerConfigurationReference, nonce, expires])).digest('hex')}`;
    function capability(nonce: string, value: string, expires?: string) {
        if (typeof value !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(value))
            return false;
        const ms = Number(value.split('.')[0]);
        if (!Number.isSafeInteger(ms) || ms <= Date.now() || ms > Date.now() + 3600000)
            return false;
        const e = new Date(ms).toISOString();
        if (expires && expires !== e)
            return false;
        return timingSafeEqual(Buffer.from(value), Buffer.from(cap(nonce, e)));
    }
    function authenticated(headers: readonly string[]) {
        try {
            const values = inert(headers);
            if (values.length > 100 || values.length % 2)
                return false;
            const found: string[] = [];
            for (let i = 0; i < values.length; i += 2) {
                if (typeof values[i] !== 'string' || typeof values[i + 1] !== 'string' || /[\r\n\0]/.test(values[i] + values[i + 1]))
                    return false;
                if (values[i].toLowerCase() === 'unipile-auth')
                    found.push(values[i + 1]);
            }
            const actual = Buffer.from(found[0] ?? ''), expected = Buffer.from(fixed.webhookSecret);
            return found.length === 1 && actual.length === expected.length && timingSafeEqual(actual, expected);
        }
        catch {
            return false;
        }
    }
    function json(raw: Uint8Array) {
        if (!types.isUint8Array(raw) || types.isProxy(raw) || raw.byteLength < 1 || raw.byteLength > 1048576)
            failure();
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(raw)));
    }
    const record = (value: RuntimeConnection): RecordedLifecycleConnection => ({ binding: inert(value.binding), providerAccountId: value.owner.providerAccountId, sourceId: value.owner.sourceId, ownerIdentity: inert(value.owner.providerOwner) });
    const configuredReadiness = options.readiness ? Function.prototype.bind.call(options.readiness, options) : undefined;
    async function managed(value: RuntimeConnection) {
        const result = { binding: inert(value.binding), label: value.owner.canonicalIdentity.value.slice(0, 200), status: value.status, capabilities: inert(value.owner.capabilities), isDefault: value.isDefault, readiness: value.active && value.status === 'connected' ? { status: 'waiting' as const, code: 'incomplete' as const } : { status: 'review' as const, code: 'reconnect' as const } };
        if (value.active && value.status === 'connected' && configuredReadiness)
            result.readiness = inert(await configuredReadiness(inert(value.binding))) as typeof result.readiness;
        assertManagedConnection(result, value.binding);
        return result;
    }
    async function complete(notification: SetupNotification, route: SetupStateRoute): Promise<CompleteSetupResult> {
        if (!capability(notification.nonce, notification.capability, route.expiresAt))
            return { status: 'rejected', code: 'unauthenticated' };
        try {
            await store.requireGrant(route.scope);
        }
        catch {
            return { status: 'unknown' };
        }
        const result = await reader.verify({ platform: route.platform, providerAccountId: notification.payload.account_id, ...(fixed.sourceIds?.[route.platform as keyof typeof fixed.sourceIds] ? { sourceId: fixed.sourceIds[route.platform as keyof typeof fixed.sourceIds] } : {}) });
        if (result.kind !== 'verified')
            return { status: 'unknown' };
        const states = createPostgresAuthStateRepository({ pool: fixed.pool, scope: route.scope, channel: route.channel, platform: route.platform, backend: 'unipile', redirectOrigin: fixed.redirectOrigin, lockTenant: true, authenticateNotification: async (input) => { const n = inert(input.notification) as SetupNotification; return input.nonce === notification.nonce && n.nonce === input.nonce && n.payload.name === input.nonce && n.payload.account_id === result.owner.providerAccountId && capability(n.nonce, n.capability, route.expiresAt) && isDeepStrictEqual(n, notification); }, bindNotification: (client, state) => store.bindVerified(client, state, result.owner) });
        const r = await states.complete({ nonce: notification.nonce, notification: inert(notification) });
        if (r.status === 'completed' || r.status === 'consumed' && r.binding) {
            await store.finishSetup(notification.nonce);
            return { status: r.status === 'completed' ? 'recorded' : 'duplicate', binding: r.binding! };
        }
        if (r.status === 'consumed')
            return { status: 'review', code: 'reconciliation_required' };
        return r;
    }
    async function drain(s: AccessScope) {
        for (const n of await store.pendingSetup(s)) {
            const route = await store.lookupSetup(n.nonce);
            if (route)
                await complete(n, route);
        }
    }
    async function email(b: ConnectionBinding, authenticate = authenticated) {
        const value = await store.resolve(b, false);
        if (!value || b.channel !== 'email')
            failure();
        return createRuntimeEmail({ pool: fixed.pool, connection: value, store, vault, integrationId: fixed.integrationId, providerConfigurationReference: fixed.providerConfigurationReference, transport, ownerReader: reader, authenticate });
    }
    const runtime: ConfiguredUnipileV1Runtime = { store,
        async recoverUnknownEmail(input, signal) {
            if (signal.aborted)
                return null;
            const original = inert(input), b = binding(scope({ applicationId: original.snapshot.binding.applicationId, tenantId: original.snapshot.binding.tenantId, ownerId: original.snapshot.binding.ownerId }), original.snapshot.binding);
            if (!['unknown', 'dispatching'].includes(original.state) || b.channel !== 'email' || original.snapshot.operation !== 'message' || original.message)
                return null;
            const configured = await email(b);
            if (signal.aborted)
                return null;
            return recoverTrackedEmailOutcome({ record: original, tracking: configured.tracking, provider: configured.provider, signal });
        },
        async authorizeSignedScope(input, metadata) { const s = scope(input); return await store.preflight() && await store.authorizeSignedScope(s, inert(metadata)); },
        async list(input) {
            const s = scope(input), checkedAt = new Date().toISOString();
            if (!await store.preflight())
                return { available: false, connections: [], checkedAt };
            await store.requireGrant(s);
            await drain(s);
            return { available: true, connections: await Promise.all((await store.list(s)).map(managed)), checkedAt: new Date().toISOString() };
        },
        async setup(input, requested) {
            const s = scope(input), r = inert(requested);
            if (!await store.preflight())
                return { status: 'unavailable' };
            await store.requireGrant(s);
            if (!['email:gmail', 'email:outlook', 'whatsapp:whatsapp', 'linkedin:linkedin'].includes(`${r.channel}:${r.platform}`))
                return { status: 'rejected', code: 'invalid' };
            const reconnect = r.reconnectBinding ? binding(s, r.reconnectBinding) : undefined;
            const states = createPostgresAuthStateRepository({ pool: fixed.pool, scope: s, channel: r.channel, platform: r.platform, backend: 'unipile', redirectOrigin: fixed.redirectOrigin, lockTenant: true, authenticateNotification: async () => false, bindNotification: async () => failure() });
            const coordinator = createConnectionSetupCoordinator({ scope: s, channel: r.channel, platform: r.platform, backend: 'unipile', redirectOrigin: fixed.redirectOrigin, successPath: fixed.successPath, failurePath: fixed.failurePath, notifyUrl: fixed.notifyUrl, states, hostedAuth: { createLink(input, options) { const url = new URL(input.notifyUrl); url.searchParams.set('capability', cap(input.state, input.expiresAt)); return hosted.createLink({ ...input, notifyUrl: url.href }, options); } }, async resolveReconnect(b, signal) {
                    const stored = await store.resolve(b);
                    if (!stored)
                        failure();
                    const proof = await reader.verify({ platform: b.platform, providerAccountId: stored.owner.providerAccountId, sourceId: stored.owner.sourceId }, signal);
                    if (proof.kind !== 'verified' || !isDeepStrictEqual(proof.owner.physicalOwner, stored.owner.physicalOwner) || !isDeepStrictEqual(proof.owner.providerOwner, stored.owner.providerOwner))
                        failure();
                    return { binding: b, providerAccountId: stored.owner.providerAccountId };
                } });
            return coordinator.begin(reconnect ? { reconnectBinding: reconnect } : {});
        },
        async completeSetupNotification(input) {
            let n: SetupNotification;
            try {
                const raw = json(input.rawBody);
                if (!raw || typeof raw.name !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw.name) || typeof raw.account_id !== 'string' || !raw.account_id.length || raw.account_id.length > 2048 || !['CREATION_SUCCESS', 'RECONNECTED'].includes(raw.status) || !capability(raw.name, input.capability))
                    return { status: 'rejected', code: 'unauthenticated' };
                n = { nonce: raw.name, capability: input.capability, payload: { name: raw.name, account_id: raw.account_id, status: raw.status } };
            }
            catch {
                return { status: 'rejected', code: 'invalid' };
            }
            const route = await store.lookupSetup(n.nonce);
            if (!route || !capability(n.nonce, n.capability, route.expiresAt))
                return { status: 'rejected', code: 'unauthenticated' };
            await store.captureSetup(n);
            return { status: 'queued' };
        },
        async status(input, requested) {
            const s = scope(input), b = binding(s, requested);
            await store.requireGrant(s);
            const stored = await store.resolve(b);
            if (!stored)
                failure();
            const proof = await reader.verify({ platform: b.platform, providerAccountId: stored.owner.providerAccountId, sourceId: stored.owner.sourceId });
            if (proof.kind !== 'verified')
                return managed(stored);
            return managed(await store.observe(b, proof.owner));
        },
        async setDefault(input, requested) { const s = scope(input), b = binding(s, requested); return managed(await store.setDefault(s, b)); },
        async resolveCurrent(requested) {
            const b = binding(scope({ applicationId: requested.applicationId, tenantId: requested.tenantId, ownerId: requested.ownerId }), requested);
            try {
                const value = await store.resolve(b);
                return value ? record(value) : null;
            }
            catch {
                return null;
            }
        },
        async disconnect(input, requested) {
            const s = scope(input), b = binding(s, requested.binding), stored = await store.resolve(b);
            if (!stored)
                return { status: 'review', code: 'reconnect' };
            const original = record(stored), retirement = createPostgresConnectionRetirement({ pool: fixed.pool, record: original, integrationId: fixed.integrationId, providerConfigurationReference: fixed.providerConfigurationReference, codec: retirementCodec, async verifyRecordedIdentity(proof) {
                    const decrypted = vault.open(proof.record.binding, 'provider', { encrypted: proof.generation.encryptedProviderAccountId, keyVersion: proof.generation.providerAccountKeyVersion, digest: '' }) as {
                        providerAccountId: string;
                    };
                    return decrypted.providerAccountId === original.providerAccountId && isDeepStrictEqual(proof.record, original) ? { record: original, physicalIdentity: stored.owner.physicalOwner } : null;
                }, providerAccountDigest: (value, version) => vault.providerAccountDigest(value, version), physicalIdentityDigest: (identity, version) => vault.physicalIdentityDigest(identity, version) });
            const coordinator = createConnectionLifecycleCoordinator({ binding: b, resolveCurrent: async () => original, provider: lifecycleProvider, ...retirement });
            const result = await coordinator.disconnect({ binding: b, operationKey: requested.key });
            if (result.status === 'disconnected' || result.status === 'rejected' || result.status === 'unknown')
                return { status: result.status };
            return result.status === 'duplicate' ? { status: 'disconnected' } : { status: 'review', code: result.status === 'review' ? 'unresolved_send' : 'forbidden' };
        },
        async processEmailSentNotification(input) {
            if (!authenticated(input.rawHeaders))
                return { kind: 'review' };
            let raw: Record<string, unknown>;
            try {
                raw = json(input.rawBody);
                if (raw.event !== 'mail_sent' || typeof raw.account_id !== 'string' || typeof raw.tracking_id !== 'string')
                    return { kind: 'review' };
            }
            catch {
                return { kind: 'review' };
            }
            const snapshot = await store.trackingSnapshot(raw.account_id as string, raw.tracking_id as string);
            if (!snapshot)
                return { kind: 'missing' };
            return (await email(snapshot.binding)).tracking.associate({ snapshot, trackingId: raw.tracking_id as string, notification: { rawBody: Buffer.from(input.rawBody), rawHeaders: [...input.rawHeaders] } });
        },
        createWebhookRuntime(options) {
            const spool = createPostgresProviderWebhookSpool({ pool: fixed.pool, vault, captureCodec: options.captureCodec, applicationId: fixed.applicationId, integrationId: fixed.integrationId, providerConfigurationReference: fixed.providerConfigurationReference, authenticate: authenticated });
            return createConfiguredUnipileV1WebhookRuntime({ spool, authenticate: authenticated, journal: options.journal, history: options.history, async associateSent(record) {
                    if (!await spool.proveRouted(record))
                        return { kind: 'review' };
                    let raw: Record<string, unknown>;
                    try {
                        raw = json(record.rawBody);
                        if (raw.event !== 'mail_sent' || typeof raw.account_id !== 'string' || typeof raw.tracking_id !== 'string')
                            return { kind: 'review' };
                    }
                    catch {
                        return { kind: 'review' };
                    }
                    const snapshot = await store.trackingSnapshot(raw.account_id as string, raw.tracking_id as string);
                    if (!snapshot)
                        return { kind: 'missing' };
                    assertSameBinding(record.binding, snapshot.binding);
                    // Authentication here is the retained encrypted ORIGINAL routed provider receipt, not a
                    // fabricated notification header or boolean supplied by an HTTP body/caller.
                    const sender = await email(snapshot.binding, () => true);
                    return sender.tracking.associate({ snapshot, trackingId: raw.tracking_id as string, notification: { rawBody: Buffer.from(record.rawBody), rawHeaders: [] } });
                } });
        },
        async providerAccountDigests(requested) {
            const b = binding(scope({ applicationId: requested.applicationId, tenantId: requested.tenantId, ownerId: requested.ownerId }), requested), connection = await store.resolve(b, false);
            if (!connection)
                failure();
            return vault.versions().map(version => vault.providerAccountDigest(connection.owner.providerAccountId, version));
        },
        async dispatchOptions(requested, options = {}) {
            const b = binding(scope({ applicationId: requested.applicationId, tenantId: requested.tenantId, ownerId: requested.ownerId }), requested);
            if (!await store.resolve(b, options.historical !== true))
                failure();
            return { integrationId: fixed.integrationId, providerConfigurationReference: fixed.providerConfigurationReference, providerApiVersion: 'v1', authority: 'service', codec: vault.journal, recipientDigest: { keyVersion: vault.identityKeyVersion, digest: (recipient, version) => vault.physicalIdentityDigest({ namespace: recipient.kind, value: recipient.value }, version) }, verifyReconciliation: async (input, signal) => {
                    if (signal.aborted)
                        return null;
                    if (b.channel === 'email')
                        return (await email(b)).tracking.verifyReconciliation(input.record, input.outcome);
                    return null;
                } };
        },
        async providerFactory(requested, options = {}) {
            const b = binding(scope({ applicationId: requested.applicationId, tenantId: requested.tenantId, ownerId: requested.ownerId }), requested), connection = await store.resolve(b, options.lookupOnly !== true);
            if (!connection)
                failure();
            let provider: MessagingAdapter;
            if (b.channel === 'email')
                provider = (await email(b)).provider;
            else
                provider = createV1SocialRuntime({ connection: options.lookupOnly ? { ...connection, active: true } : connection, store, provider: fixed.provider, ownerReader: reader });
            if (options.lookupOnly)
                return { ready: async (requested) => { assertSameBinding(b, requested); return { status: 'review', code: 'reconnect' }; }, submit: async (requested) => { assertSameBinding(b, requested.snapshot.binding); return { status: 'review', code: 'reconnect' }; }, lookup: provider.lookup };
            return provider;
        },
        async receiptDetails(requested, lookup, accepted) {
            const b = binding(scope({ applicationId: requested.applicationId, tenantId: requested.tenantId, ownerId: requested.ownerId }), requested);
            assertSameBinding(b, lookup.snapshot.binding);
            if (b.channel === 'email' && 'message' in accepted && lookup.message && isDeepStrictEqual(lookup.message, accepted.message) && lookup.expectedRecipient && isDeepStrictEqual(lookup.expectedRecipient, accepted.recipient))
                return (await email(b)).provider.lookup(inert(lookup));
            if (b.channel !== 'email') {
                const connection = await store.resolve(b, false);
                if (!connection)
                    return null;
                return createV1SocialRuntime({ connection: { ...connection, active: true }, store, provider: fixed.provider, ownerReader: reader }).receiptDetails(inert(lookup), inert(accepted));
            }
            return null;
        }
    };
    return runtime;
}
