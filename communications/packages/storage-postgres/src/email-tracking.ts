import { randomUUID, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { assertSameBinding, type ConnectionBinding, type MessageReceipt, type OperationSnapshot } from '../../contracts/src';
import type { DispatchRecord } from '../../core/src/dispatch';
import type { DeliveryOutcome } from '../../contracts/src';
import type { SqlClient, SqlPool, SqlResult } from './webhook-repository';
import type { CanonicalRecipientDigest, DispatchJournalCodec } from './dispatch-journal';
import type { MessagingAdapter, ActionReceipt } from '../../contracts/src';
export interface EmailTrackingDigest {
    readonly keyVersion: string;
    /** Complete retained identity-key inventory. Rotation cannot omit live historical keys. */
    readonly versions: readonly string[];
    digest(input: {
        integrationId: string;
        providerConfigurationReference: string;
        providerAccountId: string;
        trackingId: string;
    }, version: string): string;
}
export interface EmailSentEvidence {
    trackingId: string;
    providerAccountId: string;
    emailId: string;
    rfcMessageId: string;
    recipient: string;
    occurredAt: string;
}
export interface VerifiedEmailSentAssociation {
    receipt: MessageReceipt;
    rfcMessageId: string;
    evidenceDigest: string;
}
export interface EmailTrackingOptions {
    pool: SqlPool;
    binding: ConnectionBinding;
    integrationId: string;
    providerConfigurationReference: string;
    providerAccountId: string;
    codec: DispatchJournalCodec;
    recipientDigest: CanonicalRecipientDigest;
    trackingDigest: EmailTrackingDigest;
    /** Required retained original-generation provider-account decrypt/verification port. */
    decodeProviderAccount(input: {
        binding: ConnectionBinding;
        encryptedProviderAccountId: string;
        keyVersion: string;
        digest: string;
    }): string;
    authenticateNotification(input: {
        binding: ConnectionBinding;
        integrationId: string;
        providerConfigurationReference: string;
        rawHeaders: readonly string[];
    }, signal: AbortSignal): Promise<boolean>;
    /** Required read-only original provider/owner/header/thread verification. A caller proposal
     * or the webhook alone is insufficient. No default implementation exists. */
    verifySentMessage(input: {
        snapshot: OperationSnapshot;
        evidence: EmailSentEvidence;
        recipient: string;
        conversationId?: string;
    }, signal: AbortSignal): Promise<VerifiedEmailSentAssociation | null>;
    timeoutMs?: number;
    statementTimeoutMs?: number;
    lockTimeoutMs?: number;
}
export type EmailAssociationDecision = {
    kind: 'associated' | 'duplicate';
    association: VerifiedEmailSentAssociation;
} | {
    kind: 'missing' | 'review';
};
export interface EmailTrackingRepository {
    recordAcknowledgement(input: {
        snapshot: OperationSnapshot;
        trackingId: string;
    }): Promise<{
        kind: 'recorded' | 'duplicate';
    }>;
    get(snapshot: OperationSnapshot): Promise<{
        trackingId: string;
        association: VerifiedEmailSentAssociation | null;
    } | null>;
    associate(input: {
        snapshot: OperationSnapshot;
        trackingId: string;
        notification: {
            rawBody: Uint8Array;
            rawHeaders: readonly string[];
        };
    }): Promise<EmailAssociationDecision>;
    /** Composition callback for DispatchJournal.verifyReconciliation. Does not mutate the journal. */
    verifyReconciliation(record: DispatchRecord, proposed: DeliveryOutcome): Promise<DeliveryOutcome | null>;
}
export interface EmailAcknowledgementProducer extends Pick<MessagingAdapter, 'ready' | 'lookup'> {
    submitAcknowledged(input: Parameters<MessagingAdapter['submit']>[0]): Promise<Exclude<DeliveryOutcome, {
        status: 'submitted';
    }> | {
        status: 'acknowledged';
        receipt: ActionReceipt;
    }>;
}
/** Choose this wrapper as the coordinator's provider. Its acknowledgement callback is
 * awaited through durable COMMIT; returned outcome stays unknown until verified association. */
export function createTrackedEmailSubmission(options: {
    producer: EmailAcknowledgementProducer;
    tracking: Pick<EmailTrackingRepository, 'recordAcknowledgement'>;
}): MessagingAdapter {
    let ready: MessagingAdapter['ready'], lookup: MessagingAdapter['lookup'], submit: EmailAcknowledgementProducer['submitAcknowledged'], record: EmailTrackingRepository['recordAcknowledgement'];
    try {
        const config = object(options, ['producer', 'tracking']);
        observe(config.producer);
        observe(config.tracking);
        if (!config.producer || !config.tracking || types.isProxy(config.producer) || types.isProxy(config.tracking))
            fail();
        const producer = config.producer as EmailAcknowledgementProducer, tracking = config.tracking as Pick<EmailTrackingRepository, 'recordAcknowledgement'>;
        const methods = [producer.ready, producer.lookup, producer.submitAcknowledged, tracking.recordAcknowledgement];
        for (const fn of methods) {
            observe(fn);
            if (typeof fn !== 'function')
                fail();
        }
        ready = Function.prototype.bind.call(methods[0], producer);
        lookup = Function.prototype.bind.call(methods[1], producer);
        submit = Function.prototype.bind.call(methods[2], producer);
        record = Function.prototype.bind.call(methods[3], tracking);
    }
    catch {
        throw Error('Invalid email acknowledgement configuration');
    }
    return { ready, lookup, async submit(request) {
            // Copy inert data before yielding. This prevents caller edits while the provider is sending
            // from moving the acknowledgement to another original journal operation.
            function inert(value: unknown, depth = 0): void {
                observe(value);
                if (depth > 32)
                    fail();
                if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value))
                    return;
                if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null, Array.prototype].includes(Object.getPrototypeOf(value)))
                    fail();
                const d = Object.getOwnPropertyDescriptors(value);
                for (const key of Reflect.ownKeys(d)) {
                    if (typeof key !== 'string' || !('value' in d[key]))
                        fail();
                    inert(d[key].value, depth + 1);
                }
            }
            let input: typeof request;
            try {
                inert(request);
                input = structuredClone(request);
            }
            catch {
                fail();
            }
            try {
                const result = await submit(structuredClone(input));
                if (!result || !['acknowledged', 'unknown', 'waiting', 'review', 'rejected', 'skipped'].includes(result.status))
                    return { status: 'unknown' };
                if (result.status !== 'acknowledged')
                    return result;
                const receipt = object(result.receipt, ['operation', 'recipient']), operation = object(receipt.operation, ['binding', 'id']);
                assertSameBinding(input.snapshot.binding, bind(operation.binding));
                if (!id(operation.id, 2048) || !isDeepStrictEqual(receipt.recipient, input.message.recipient))
                    return { status: 'unknown' };
                const committed = await record({ snapshot: structuredClone(input.snapshot), trackingId: operation.id });
                if (!['recorded', 'duplicate'].includes(committed.kind))
                    return { status: 'unknown' };
                return { status: 'unknown' };
            }
            catch {
                return { status: 'unknown' };
            }
        } };
}
const fields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'];
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const mail = (v: unknown): v is string => typeof v === 'string' && v.length <= 320 && v === v.toLowerCase() && /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(v);
const rfc = (v: unknown): v is string => typeof v === 'string' && v.length <= 998 && /^<[^<>@\s]+@[^<>@\s]+>$/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
function fail(): never { throw Error('Email tracking unavailable'); }
function observe(v: unknown): unknown {
    if (types.isPromise(v)) {
        void Promise.prototype.then.call(v, undefined, () => { });
        fail();
    }
    return v;
}
function object(v: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
    observe(v);
    if (!v || typeof v !== 'object' || Array.isArray(v) || types.isProxy(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        fail();
    const d = Object.getOwnPropertyDescriptors(v);
    if (required.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k) || !('value' in d[k]) || !d[k].enumerable))
        fail();
    return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, observe(v.value)]));
}
function bind(v: unknown): ConnectionBinding {
    const b = object(v, fields);
    if (fields.some(k => k !== 'generation' && !id(b[k])) || !Number.isInteger(b.generation) || Number(b.generation) < 1 || Number(b.generation) > 2147483647)
        fail();
    assertSameBinding(b as unknown as ConnectionBinding, b as unknown as ConnectionBinding);
    return b as unknown as ConnectionBinding;
}
function same(a: unknown, b: unknown) {
    if (!hex(observe(a)) || !hex(b) || !timingSafeEqual(Buffer.from(a as string, 'hex'), Buffer.from(b, 'hex')))
        fail();
}
type Original = {
    row: Record<string, unknown>;
    message?: {
        binding: ConnectionBinding;
        id: string;
    };
    recipient: {
        kind: 'email';
        value: string;
    };
    conversation?: {
        binding: ConnectionBinding;
        id: string;
    };
    rfcMessageId?: string;
};
/** Storage-only composition. No provider writes, journal transition, lease renewal, quota
 * charge, receipt inference, SQL startup or authorization defaults are supplied. */
export function createPostgresEmailTracking(inputOptions: EmailTrackingOptions): EmailTrackingRepository {
    let b: ConnectionBinding, o: EmailTrackingOptions, connect: SqlPool['connect'], encode: DispatchJournalCodec['encode'], decode: DispatchJournalCodec['decode'], digest: DispatchJournalCodec['digest'], recipientDigest: CanonicalRecipientDigest['digest'], trackingDigest: EmailTrackingDigest['digest'], decodeAccount: EmailTrackingOptions['decodeProviderAccount'], authenticate: EmailTrackingOptions['authenticateNotification'], verify: EmailTrackingOptions['verifySentMessage'];
    let version: string, trackingVersion: string, trackingVersions: string[], timeout: number, statementTimeout: number, lockTimeout: number;
    try {
        o = object(inputOptions, ['pool', 'binding', 'integrationId', 'providerConfigurationReference', 'providerAccountId', 'codec', 'recipientDigest', 'trackingDigest', 'decodeProviderAccount', 'authenticateNotification', 'verifySentMessage'], ['timeoutMs', 'statementTimeoutMs', 'lockTimeoutMs']) as unknown as EmailTrackingOptions;
        b = bind(o.binding);
        if (b.channel !== 'email' || b.backend !== 'unipile' || !id(o.integrationId) || !id(o.providerConfigurationReference, 2000) || !id(o.providerAccountId, 2048))
            fail();
        for (const p of [o.pool, o.codec, o.recipientDigest, o.trackingDigest]) {
            observe(p);
            if (!p || types.isProxy(p))
                fail();
        }
        version = observe(o.codec.keyVersion) as string;
        trackingVersion = observe(o.trackingDigest.keyVersion) as string;
        const inventory = observe(o.trackingDigest.versions);
        if (!Array.isArray(inventory) || types.isProxy(inventory) || Object.getPrototypeOf(inventory) !== Array.prototype)
            fail();
        const descriptors = Object.getOwnPropertyDescriptors(inventory);
        if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || !('value' in descriptors[k])))
            fail();
        trackingVersions = Array.from(inventory);
        if (!id(version, 64) || !id(trackingVersion, 64) || !trackingVersions.length || trackingVersions.length > 32 || trackingVersions.some(v => !id(observe(v), 64)) || new Set(trackingVersions).size !== trackingVersions.length || !trackingVersions.includes(trackingVersion))
            fail();
        timeout = o.timeoutMs ?? 20000;
        statementTimeout = o.statementTimeoutMs ?? 5000;
        lockTimeout = o.lockTimeoutMs ?? 1000;
        if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 25000 || !Number.isSafeInteger(statementTimeout) || statementTimeout < 1 || statementTimeout > timeout || !Number.isSafeInteger(lockTimeout) || lockTimeout < 1 || lockTimeout > statementTimeout)
            fail();
        const ports = [o.pool.connect, o.codec.encode, o.codec.decode, o.codec.digest, o.recipientDigest.digest, o.trackingDigest.digest, o.decodeProviderAccount, o.authenticateNotification, o.verifySentMessage];
        for (const p of ports) {
            observe(p);
            if (typeof p !== 'function')
                fail();
        }
        connect = Function.prototype.bind.call(ports[0], o.pool);
        encode = Function.prototype.bind.call(ports[1], o.codec);
        decode = Function.prototype.bind.call(ports[2], o.codec);
        digest = Function.prototype.bind.call(ports[3], o.codec);
        recipientDigest = Function.prototype.bind.call(ports[4], o.recipientDigest);
        trackingDigest = Function.prototype.bind.call(ports[5], o.trackingDigest);
        decodeAccount = Function.prototype.bind.call(ports[6], o);
        authenticate = Function.prototype.bind.call(ports[7], o);
        verify = Function.prototype.bind.call(ports[8], o);
    }
    catch {
        throw Error('Invalid email tracking configuration');
    }
    const integration = o.integrationId, configuration = o.providerConfigurationReference, provider = o.providerAccountId, scopes = [b.applicationId, b.tenantId, b.ownerId];
    function snapshot(v: unknown): OperationSnapshot {
        const s = object(v, ['key', 'binding', 'operation', 'payloadDigest']);
        const binding = bind(s.binding);
        assertSameBinding(b, binding);
        if (!id(s.key) || s.operation !== 'message' || !hex(s.payloadDigest))
            fail();
        return { key: s.key, binding, operation: 'message', payloadDigest: s.payloadDigest };
    }
    function reference(v: unknown) {
        const r = object(v, ['binding', 'id']);
        const binding = bind(r.binding);
        assertSameBinding(b, binding);
        if (!id(r.id, 2048))
            fail();
        return { binding, id: r.id };
    }
    function recipient(v: unknown) {
        const r = object(v, ['kind', 'value']);
        if (r.kind !== 'email' || !mail(r.value))
            fail();
        return { kind: 'email' as const, value: r.value };
    }
    function trackingKey(trackingId: string, keyVersion: string): string {
        const value = observe(trackingDigest({ integrationId: integration, providerConfigurationReference: configuration, providerAccountId: provider, trackingId }, keyVersion));
        if (!hex(value))
            fail();
        return value;
    }
    function sealed(s: OperationSnapshot, purpose: 'context' | 'receipt', payload: unknown) {
        const envelope = object(encode(structuredClone(s), purpose, structuredClone(payload)), ['format', 'keyVersion', 'nonce', 'ciphertext', 'tag']);
        if (envelope.format !== 'communications-journal-v1' || envelope.keyVersion !== version || typeof envelope.ciphertext !== 'string' || !id(envelope.nonce, 200) || !id(envelope.tag, 200))
            fail();
        const json = JSON.stringify(envelope);
        if (json.length > 2200000)
            fail();
        const proof = observe(digest(structuredClone(s), purpose, structuredClone(payload), version));
        if (!hex(proof))
            fail();
        return { json, version, proof };
    }
    function opened(s: OperationSnapshot, purpose: 'context' | 'receipt', raw: unknown, keyVersion: unknown, proof: unknown): unknown {
        if (typeof raw !== 'string' || raw.length > 2200000 || !id(keyVersion, 64))
            fail();
        const envelope = object(JSON.parse(raw), ['format', 'keyVersion', 'nonce', 'ciphertext', 'tag']);
        if (envelope.keyVersion !== keyVersion)
            fail();
        const payload = observe(decode(structuredClone(s), purpose, envelope));
        same(digest(structuredClone(s), purpose, structuredClone(payload), keyVersion), proof);
        return payload;
    }
    interface Budget {
        deadline: number;
        signal: AbortSignal;
        call<T>(port: () => Promise<T>): Promise<T>;
        live(): void;
    }
    async function bounded<T>(work: (budget: Budget) => Promise<T>): Promise<T> {
        const controller = new AbortController(), deadline = performance.now() + timeout;
        let timer: ReturnType<typeof setTimeout>;
        let expired = false;
        const stopped = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; controller.abort(); reject(Error('Email tracking unavailable')); }, timeout); });
        const budget: Budget = { deadline, signal: controller.signal, live() {
                if (expired || performance.now() >= deadline) {
                    expired = true;
                    controller.abort();
                    fail();
                }
            }, call<TValue>(port: () => Promise<TValue>) {
                this.live();
                let promise: Promise<TValue>;
                try {
                    promise = Promise.resolve(port());
                }
                catch {
                    fail();
                }
                void Promise.prototype.then.call(promise, undefined, () => { });
                this.live();
                return Promise.race([promise, stopped]).then(value => { this.live(); return value; });
            } };
        try {
            return await Promise.race([Promise.resolve().then(() => work(budget)), stopped]);
        }
        catch {
            fail();
        }
        finally {
            clearTimeout(timer!);
            controller.abort();
        }
    }
    async function transaction<T>(budget: Budget, work: (c: SqlClient) => Promise<T>): Promise<T> {
        let client: SqlClient | undefined, released = false, active = 0, commit = false;
        let broken: Error | undefined;
        const release = () => {
            if (client && !released) {
                released = true;
                try {
                    client.release(broken);
                }
                catch { /* private */ }
            }
        };
        const abort = () => { broken = Error('Email tracking session retired'); release(); };
        budget.signal.addEventListener('abort', abort, { once: true });
        try {
            const pending = Promise.resolve().then(() => connect()).then(value => {
                client = value;
                try {
                    budget.live();
                }
                catch {
                    abort();
                    fail();
                }
                return value;
            });
            void pending.catch(() => { });
            client = await budget.call(() => pending);
            if (budget.signal.aborted) {
                abort();
                fail();
            }
            budget.live();
            const query = Function.prototype.bind.call(client.query, client) as SqlClient['query'];
            const tx: SqlClient = { query<Row>(sql: string, values?: unknown[]) {
                    let promise: Promise<SqlResult<Row>>;
                    try {
                        budget.live();
                        if (released || active)
                            fail();
                        if (sql === 'COMMIT')
                            commit = true;
                        active++;
                        promise = Promise.resolve().then(() => { budget.live(); return query<Row>(sql, values); }).then(result => { budget.live(); return result; }).finally(() => { active--; });
                    }
                    catch {
                        promise = Promise.reject(Error('Email tracking unavailable'));
                    }
                    void Promise.prototype.then.call(promise, undefined, () => { });
                    return promise;
                }, release() { fail(); } };
            await tx.query('BEGIN');
            await tx.query('SET LOCAL ROLE communications_control');
            const roles = await tx.query('SELECT current_user AS role_name,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user');
            const role = roles.rows[0];
            if (roles.rows.length !== 1 || role.role_name !== 'communications_control' || role.rolsuper !== false || role.rolbypassrls !== false || role.rolcanlogin !== false)
                fail();
            await tx.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [`${lockTimeout}ms`, `${statementTimeout}ms`]);
            const result = await work(tx);
            budget.live();
            const authority = await tx.query('SELECT application_id,tenant_id,owner_id FROM communications.access_grants WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE', scopes);
            if (authority.rows.length !== 1 || authority.rows[0].application_id !== b.applicationId || authority.rows[0].tenant_id !== b.tenantId || authority.rows[0].owner_id !== b.ownerId)
                fail();
            budget.live();
            await tx.query('COMMIT');
            return result;
        }
        catch (error) {
            const code = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
            if (commit || active || budget.signal.aborted || (typeof code === 'string' && (/^08/.test(code) || ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', '57P01', '57P02', '57P03'].includes(code)))) {
                broken = Error('Email tracking session retired');
                release();
            }
            if (client && !released) {
                try {
                    await client.query('ROLLBACK');
                }
                catch {
                    broken = Error('Email tracking session retired');
                }
            }
            fail();
        }
        finally {
            budget.signal.removeEventListener('abort', abort);
            release();
        }
    }
    async function original(c: SqlClient, s: OperationSnapshot, lock: boolean): Promise<Original> {
        if (lock) {
            const tenant = await c.query('SELECT communications.lock_reply_barrier($1,$2)::text AS revision', [b.applicationId, b.tenantId]);
            if (tenant.rows.length !== 1 || typeof tenant.rows[0].revision !== 'string' || !/^\d+$/.test(tenant.rows[0].revision))
                fail();
        }
        const generation = await c.query(`SELECT c.id AS connection_id,c.application_id,c.tenant_id,c.owner_id,c.channel,c.platform,c.backend,g.generation,g.account_id,g.integration_id,g.provider_api_version,g.provider_configuration_reference,g.authority,g.encrypted_provider_account_id,g.provider_account_key_version,g.provider_account_digest FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=$5 WHERE c.application_id=$1 AND c.tenant_id=$2 AND c.owner_id=$3 AND c.id=$4 ${lock ? 'FOR SHARE OF c,g' : ''}`, [...scopes, b.connectionId, b.generation]);
        const g = generation.rows[0];
        if (generation.rows.length !== 1 || g.connection_id !== b.connectionId || g.application_id !== b.applicationId || g.tenant_id !== b.tenantId || g.owner_id !== b.ownerId || g.channel !== 'email' || g.platform !== b.platform || g.backend !== 'unipile' || g.generation !== b.generation || g.account_id !== b.accountId || g.integration_id !== integration || g.provider_api_version !== 'v1' || g.provider_configuration_reference !== configuration || g.authority !== 'service' || typeof g.encrypted_provider_account_id !== 'string' || !id(g.provider_account_key_version) || !hex(g.provider_account_digest))
            fail();
        const decoded = observe(decodeAccount({ binding: structuredClone(b), encryptedProviderAccountId: g.encrypted_provider_account_id, keyVersion: g.provider_account_key_version, digest: g.provider_account_digest }));
        if (decoded !== provider)
            fail();
        const account = await c.query(`SELECT id,channel,verified_at,(verified_at IS NOT NULL AND verified_at<=clock_timestamp()) AS identity_verified FROM communications.physical_accounts WHERE id=$1 ${lock ? 'FOR UPDATE' : ''}`, [b.accountId]);
        if (account.rows.length !== 1 || account.rows[0].id !== b.accountId || account.rows[0].channel !== 'email' || account.rows[0].identity_verified !== true)
            fail();
        const grant = await c.query('SELECT application_id,tenant_id,owner_id FROM communications.access_grants WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE', scopes);
        if (grant.rows.length !== 1 || grant.rows[0].application_id !== b.applicationId || grant.rows[0].tenant_id !== b.tenantId || grant.rows[0].owner_id !== b.ownerId)
            fail();
        const result = await c.query(`SELECT id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,state,quota_reserved,encrypted_operation_context,operation_context_key_version,operation_context_digest,recipient_digest,recipient_key_version FROM communications.operation_journal WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND operation_key=$4 ${lock ? 'FOR UPDATE' : ''}`, [...scopes, s.key]);
        const j = result.rows[0];
        if (result.rows.length !== 1 || !id(j.id) || j.application_id !== b.applicationId || j.tenant_id !== b.tenantId || j.owner_id !== b.ownerId || j.operation_key !== s.key || j.connection_id !== b.connectionId || j.generation !== b.generation || j.account_id !== b.accountId || j.operation !== 'message' || j.payload_digest !== s.payloadDigest || j.quota_reserved !== true || !['dispatching', 'unknown', 'submitted'].includes(j.state as string))
            fail();
        const context = object(opened(s, 'context', j.encrypted_operation_context, j.operation_context_key_version, j.operation_context_digest), ['recipient'], ['conversation', 'rfcMessageId', 'message']);
        const target = recipient(context.recipient);
        if (!id(j.recipient_key_version))
            fail();
        same(recipientDigest(structuredClone(target), j.recipient_key_version), j.recipient_digest);
        if (context.rfcMessageId !== undefined && !rfc(context.rfcMessageId))
            fail();
        return { row: j, recipient: target, ...(context.message !== undefined ? { message: reference(context.message) } : {}), ...(context.conversation ? { conversation: reference(context.conversation) } : {}), ...(context.rfcMessageId ? { rfcMessageId: context.rfcMessageId as string } : {}) };
    }
    function ackPayload(original: Original, trackingId: string) { return { domain: 'communications.email-ack.v1', integrationId: integration, providerConfigurationReference: configuration, providerAccountId: provider, trackingId, recipient: original.recipient, ...(original.conversation ? { conversation: original.conversation } : {}), ...(original.message ? { message: original.message } : {}) }; }
    async function ack(c: SqlClient, s: OperationSnapshot, original: Original, trackingId?: string) {
        const candidates = trackingId ? trackingVersions.map(v => trackingKey(trackingId, v)) : [];
        const found = await c.query(`SELECT id,journal_id,tracking_digest,tracking_key_version,encrypted_ack,ack_key_version,ack_digest FROM communications.email_tracking_acknowledgements WHERE journal_id=$1 ${trackingId ? 'OR (integration_id=$2 AND provider_configuration_reference=$3 AND tracking_digest=ANY($4::text[]))' : ''} FOR SHARE`, trackingId ? [original.row.id, integration, configuration, candidates] : [original.row.id]);
        if (found.rows.length > 1)
            fail();
        if (!found.rows.length)
            return null;
        const row = found.rows[0];
        if (row.journal_id !== original.row.id || !id(row.id) || typeof row.tracking_key_version !== 'string' || !trackingVersions.includes(row.tracking_key_version))
            fail();
        const payload = object(opened(s, 'context', row.encrypted_ack, row.ack_key_version, row.ack_digest), ['domain', 'integrationId', 'providerConfigurationReference', 'providerAccountId', 'trackingId', 'recipient'], ['conversation', 'message']);
        if (!id(payload.trackingId, 2048) || !isDeepStrictEqual(payload, ackPayload(original, payload.trackingId)))
            fail();
        if (trackingId !== undefined && payload.trackingId !== trackingId)
            fail();
        same(trackingKey(payload.trackingId, row.tracking_key_version), row.tracking_digest);
        return { row, trackingId: payload.trackingId };
    }
    function verified(v: unknown, original: Original, event: EmailSentEvidence): VerifiedEmailSentAssociation {
        const a = object(v, ['receipt', 'rfcMessageId', 'evidenceDigest']);
        const receipt = object(a.receipt, ['message', 'recipient', 'submittedAt'], ['conversation']);
        const message = reference(receipt.message), target = recipient(receipt.recipient), conversation = receipt.conversation ? reference(receipt.conversation) : undefined;
        if (!isDeepStrictEqual(target, original.recipient) || (original.message && !isDeepStrictEqual(message, original.message)) || message.id !== event.emailId || a.rfcMessageId !== event.rfcMessageId || !rfc(a.rfcMessageId) || !hex(a.evidenceDigest) || !date(receipt.submittedAt) || (original.rfcMessageId && original.rfcMessageId !== a.rfcMessageId) || (original.conversation && !isDeepStrictEqual(conversation, original.conversation)))
            fail();
        return { receipt: { message, recipient: target, submittedAt: receipt.submittedAt, ...(conversation ? { conversation } : {}) }, rfcMessageId: a.rfcMessageId, evidenceDigest: a.evidenceDigest };
    }
    function evidence(v: unknown): EmailSentEvidence {
        const e = object(v, ['trackingId', 'providerAccountId', 'emailId', 'rfcMessageId', 'recipient', 'occurredAt']);
        if (!id(e.trackingId, 2048) || e.providerAccountId !== provider || !id(e.emailId, 2048) || !rfc(e.rfcMessageId) || !mail(e.recipient) || !date(e.occurredAt))
            fail();
        return e as unknown as EmailSentEvidence;
    }
    async function associated(c: SqlClient, s: OperationSnapshot, original: Original, acknowledgement: {
        row: Record<string, unknown>;
        trackingId: string;
    }) {
        const selected = await c.query('SELECT acknowledgement_id,encrypted_association,association_key_version,association_digest,evidence_digest FROM communications.email_tracking_associations WHERE acknowledgement_id=$1 FOR SHARE', [acknowledgement.row.id]);
        if (selected.rows.length > 1)
            fail();
        if (!selected.rows.length)
            return null;
        const row = selected.rows[0];
        if (row.acknowledgement_id !== acknowledgement.row.id)
            fail();
        const stored = object(opened(s, 'receipt', row.encrypted_association, row.association_key_version, row.association_digest), ['domain', 'event', 'association']);
        if (stored.domain !== 'communications.email-association.v1')
            fail();
        const event = evidence(stored.event);
        if (event.trackingId !== acknowledgement.trackingId || event.recipient !== original.recipient.value)
            fail();
        const association = verified(stored.association, original, event);
        same(association.evidenceDigest, row.evidence_digest);
        return { association, event };
    }
    async function read(budget: Budget, s: OperationSnapshot) {
        return transaction(budget, async (c) => {
            const originalRecord = await original(c, s, false), acknowledgement = await ack(c, s, originalRecord);
            if (!acknowledgement)
                return null;
            const linked = await associated(c, s, originalRecord, acknowledgement);
            return { trackingId: acknowledgement.trackingId, association: linked?.association ?? null, original: originalRecord };
        });
    }
    return {
        async recordAcknowledgement(input) {
            const v = object(input, ['snapshot', 'trackingId']), s = snapshot(v.snapshot);
            if (!id(v.trackingId, 2048))
                fail();
            const trackingId = v.trackingId;
            return bounded(budget => transaction(budget, async (c) => {
                const orig = await original(c, s, true);
                const inventory = await c.query('SELECT DISTINCT tracking_key_version FROM communications.email_tracking_acknowledgements WHERE integration_id=$1 AND provider_configuration_reference=$2', [integration, configuration]);
                if (inventory.rows.some(row => typeof row.tracking_key_version !== 'string' || !trackingVersions.includes(row.tracking_key_version)))
                    fail();
                const existing = await ack(c, s, orig, trackingId);
                if (existing)
                    return { kind: 'duplicate' as const };
                const value = sealed(s, 'context', ackPayload(orig, trackingId));
                const rows = await c.query('INSERT INTO communications.email_tracking_acknowledgements(id,journal_id,tracking_digest,tracking_key_version,encrypted_ack,ack_key_version,ack_digest,integration_id,provider_configuration_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [randomUUID(), orig.row.id, trackingKey(trackingId, trackingVersion), trackingVersion, value.json, value.version, value.proof, integration, configuration]);
                if (rows.rows.length !== 1)
                    fail();
                return { kind: 'recorded' as const };
            }));
        },
        async get(input) { const s = snapshot(input); return bounded(async (budget) => { const value = await read(budget, s); return value ? { trackingId: value.trackingId, association: value.association } : null; }); },
        async associate(input) {
            const v = object(input, ['snapshot', 'trackingId', 'notification']), s = snapshot(v.snapshot), notification = object(v.notification, ['rawBody', 'rawHeaders']);
            if (!id(v.trackingId, 2048) || !(notification.rawBody instanceof Uint8Array) || types.isProxy(notification.rawBody) || notification.rawBody.byteLength < 1 || notification.rawBody.byteLength > 1048576 || !Array.isArray(notification.rawHeaders) || types.isProxy(notification.rawHeaders) || notification.rawHeaders.length > 100)
                fail();
            const trackingId = v.trackingId, body = Buffer.from(notification.rawBody);
            const descriptors = Object.getOwnPropertyDescriptors(notification.rawHeaders);
            if (Reflect.ownKeys(descriptors).some(k => typeof k !== 'string' || !('value' in descriptors[k])))
                fail();
            const headers = Array.from(notification.rawHeaders);
            if (headers.some(v => typeof observe(v) !== 'string' || v.length > 8192 || /[\r\n\u0000]/.test(v)))
                fail();
            return bounded(async (budget) => {
                if (await budget.call(() => authenticate({ binding: structuredClone(b), integrationId: integration, providerConfigurationReference: configuration, rawHeaders: headers }, budget.signal)) !== true)
                    return { kind: 'review' };
                let event: EmailSentEvidence;
                try {
                    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
                    if (!parsed || typeof parsed !== 'object' || parsed.event !== 'mail_sent' || parsed.role !== 'sent' || parsed.origin !== 'unipile' || !Array.isArray(parsed.to_attendees) || parsed.to_attendees.length !== 1 || !parsed.to_attendees[0] || (parsed.cc_attendees !== undefined && (!Array.isArray(parsed.cc_attendees) || parsed.cc_attendees.length !== 0)) || (parsed.bcc_attendees !== undefined && (!Array.isArray(parsed.bcc_attendees) || parsed.bcc_attendees.length !== 0)))
                        fail();
                    event = evidence({ trackingId: parsed.tracking_id, providerAccountId: parsed.account_id, emailId: parsed.email_id, rfcMessageId: parsed.message_id, recipient: parsed.to_attendees[0].identifier, occurredAt: parsed.date });
                    if (event.trackingId !== trackingId)
                        fail();
                }
                catch {
                    return { kind: 'review' };
                }
                const current = await read(budget, s);
                if (!current)
                    return { kind: 'missing' };
                if (current.trackingId !== trackingId || event.recipient !== current.original.recipient.value)
                    return { kind: 'review' };
                const proof = await budget.call(() => verify({ snapshot: structuredClone(s), evidence: structuredClone(event), recipient: current.original.recipient.value, ...(current.original.conversation ? { conversationId: current.original.conversation.id } : {}) }, budget.signal));
                if (proof === null)
                    return { kind: 'review' };
                let accepted: VerifiedEmailSentAssociation;
                try {
                    accepted = verified(proof, current.original, event);
                }
                catch {
                    return { kind: 'review' };
                }
                return transaction(budget, async (c) => {
                    const orig = await original(c, s, true), acknowledgement = await ack(c, s, orig, trackingId);
                    if (!acknowledgement)
                        return { kind: 'missing' as const };
                    accepted = verified(accepted, orig, event);
                    const existing = await associated(c, s, orig, acknowledgement);
                    if (existing)
                        return isDeepStrictEqual(existing, { association: accepted, event }) ? { kind: 'duplicate' as const, association: existing.association } : { kind: 'review' as const };
                    const sealedValue = sealed(s, 'receipt', { domain: 'communications.email-association.v1', event, association: accepted });
                    const inserted = await c.query('INSERT INTO communications.email_tracking_associations(acknowledgement_id,encrypted_association,association_key_version,association_digest,evidence_digest) VALUES($1,$2,$3,$4,$5) RETURNING acknowledgement_id', [acknowledgement.row.id, sealedValue.json, sealedValue.version, sealedValue.proof, accepted.evidenceDigest]);
                    if (inserted.rows.length !== 1)
                        fail();
                    return { kind: 'associated' as const, association: accepted };
                });
            });
        },
        async verifyReconciliation(record, proposed) {
            const input = object(record, ['snapshot', 'recipient', 'state'], ['outcome', 'message', 'conversation', 'rfcMessageId']), proposal = object(proposed, ['status'], ['receipt', 'code', 'retryAt', 'operation', 'reason']);
            const s = snapshot(input.snapshot);
            if (!['unknown','dispatching'].includes(input.state as string) || proposal.status !== 'submitted')
                return null;
            const originalRecipient = recipient(input.recipient);
            return bounded(async (budget) => {
                const value = await read(budget, s);
                if (!value?.association || !isDeepStrictEqual(originalRecipient, value.original.recipient) || !isDeepStrictEqual(proposed, { status: 'submitted', receipt: value.association.receipt }))
                    return null;
                return { status: 'submitted', receipt: structuredClone(value.association.receipt) };
            });
        }
    };
}
