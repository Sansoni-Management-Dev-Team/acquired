import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { types, isDeepStrictEqual } from 'node:util';
import { performance } from 'node:perf_hooks';
import { assertSameBinding, type ConnectionBinding } from '../../contracts/src';
import { parseLifecycleRecord, type AccountDisconnect, type DisconnectTicket, type RecordedLifecycleConnection, type ConnectionLifecycleOptions } from '../../core/src/connection-lifecycle';
import type { SqlPool, SqlClient, SqlResult } from './webhook-repository';
export interface RetirementScope {
    binding: ConnectionBinding;
    key: string;
}
export type RetirementPurpose = 'record' | 'outcome';
export interface RetirementEnvelope {
    format: 'communications-retirement-v1';
    keyVersion: string;
    nonce: string;
    ciphertext: string;
    tag: string;
}
export interface RetirementCodecOptions {
    activeVersion: string;
    keys: readonly {
        version: string;
        encryptionKey: Uint8Array;
        digestKey: Uint8Array;
    }[];
}
function fail(): never { throw Error('Connection retirement unavailable'); }
function observe(v: unknown): unknown {
    if (types.isPromise(v)) {
        void Promise.prototype.then.call(v, () => undefined, () => undefined);
        fail();
    }
    return v;
}
function exact(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    observe(v);
    if (!v || typeof v !== 'object' || Array.isArray(v) || types.isProxy(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        fail();
    const d = Object.getOwnPropertyDescriptors(v), out: Record<string, unknown> = {};
    if (required.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k) || !('value' in d[k]) || !d[k].enumerable))
        fail();
    for (const k of Object.keys(d))
        out[k] = observe(d[k].value);
    return out;
}
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const version = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const vector = (b: ConnectionBinding) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
function parsedScope(v: unknown): RetirementScope {
    const r = exact(v, ['binding', 'key']);
    if (!id(r.key))
        fail();
    const b = parseLifecycleRecord({ binding: r.binding, providerAccountId: 'scope', sourceId: 'scope', ownerIdentity: { namespace: 'scope', value: 'scope' } }).binding;
    return { binding: b, key: r.key };
}
function result(v: unknown): AccountDisconnect {
    const r = exact(v, ['status']);
    if (!['unknown', 'rejected', 'disconnected'].includes(r.status as string))
        fail();
    return { status: r.status as AccountDisconnect['status'] };
}
function equalHex(a: unknown, b: unknown): boolean { observe(a); observe(b); return hex(a) && hex(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
function keyBytes(v: unknown): Buffer {
    observe(v);
    if (!types.isUint8Array(v) || types.isProxy(v) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(v)))
        fail();
    const n = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(v);
    if (n !== 32 || Reflect.ownKeys(v).some(k => typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k)))
        fail();
    return Buffer.from(v);
}
function b64(v: unknown, min: number, max: number): Buffer {
    if (typeof v !== 'string' || v.length > Math.ceil(max / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(v))
        fail();
    const bytes = Buffer.from(v, 'base64');
    if (bytes.length < min || bytes.length > max || bytes.toString('base64') !== v)
        fail();
    return bytes;
}
/** Dedicated AEAD domain/purposes; plaintext never includes credentials and never enters SQL.
 * Retained versions authenticate both exact original scope and keyed replay fingerprint. */
export class ConnectionRetirementCodec {
    #active: string;
    #keys = new Map<string, {
        encryptionKey: Buffer;
        digestKey: Buffer;
    }>();
    constructor(options: RetirementCodecOptions) {
        try {
            const r = exact(options, ['activeVersion', 'keys']);
            if (!version(r.activeVersion) || !Array.isArray(r.keys) || types.isProxy(r.keys) || Object.getPrototypeOf(r.keys) !== Array.prototype || r.keys.length < 1 || r.keys.length > 32 || Reflect.ownKeys(r.keys).length !== r.keys.length + 1)
                fail();
            this.#active = r.activeVersion;
            const retained = new Set<string>();
            for (let i = 0; i < r.keys.length; i++) {
                const descriptor = Object.getOwnPropertyDescriptor(r.keys, String(i));
                if (!descriptor || !('value' in descriptor))
                    fail();
                const k = exact(descriptor.value, ['version', 'encryptionKey', 'digestKey']);
                if (!version(k.version) || this.#keys.has(k.version))
                    fail();
                const encryptionKey = keyBytes(k.encryptionKey), digestKey = keyBytes(k.digestKey);
                for (const bytes of [encryptionKey, digestKey]) {
                    const h = bytes.toString('hex');
                    if (retained.has(h))
                        fail();
                    retained.add(h);
                }
                this.#keys.set(k.version, { encryptionKey, digestKey });
            }
            if (!this.#keys.has(this.#active))
                fail();
        }
        catch {
            throw Error('Invalid retirement codec configuration');
        }
    }
    get keyVersion() { return this.#active; }
    #aad(scope: RetirementScope, purpose: RetirementPurpose, v: string) {
        if (!['record', 'outcome'].includes(purpose) || !this.#keys.has(v))
            fail();
        return Buffer.from(JSON.stringify(['communications.connection-retirement.v1', purpose, v, ...vector(scope.binding), scope.key]));
    }
    #payload(scope: RetirementScope, purpose: RetirementPurpose, v: unknown) {
        if (purpose === 'outcome')
            return result(v);
        if (purpose !== 'record')
            fail();
        const record = parseLifecycleRecord(v);
        assertSameBinding(scope.binding, record.binding);
        return record;
    }
    encode(input: RetirementScope, purpose: RetirementPurpose, value: RecordedLifecycleConnection | AccountDisconnect): RetirementEnvelope {
        const scope = parsedScope(input), plaintext = Buffer.from(JSON.stringify(this.#payload(scope, purpose, value)));
        if (plaintext.length > 16384)
            fail();
        const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.#keys.get(this.#active)!.encryptionKey, nonce);
        cipher.setAAD(this.#aad(scope, purpose, this.#active));
        const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
        return { format: 'communications-retirement-v1', keyVersion: this.#active, nonce: nonce.toString('base64'), ciphertext: ciphertext.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    }
    decode(input: RetirementScope, purpose: RetirementPurpose, value: unknown): RecordedLifecycleConnection | AccountDisconnect {
        try {
            const scope = parsedScope(input), e = exact(value, ['format', 'keyVersion', 'nonce', 'ciphertext', 'tag']);
            if (e.format !== 'communications-retirement-v1' || !version(e.keyVersion))
                fail();
            const aad = this.#aad(scope, purpose, e.keyVersion), nonce = b64(e.nonce, 12, 12), tag = b64(e.tag, 16, 16), ciphertext = b64(e.ciphertext, 1, 16384), cipher = createDecipheriv('aes-256-gcm', this.#keys.get(e.keyVersion)!.encryptionKey, nonce);
            cipher.setAAD(aad);
            cipher.setAuthTag(tag);
            const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat([cipher.update(ciphertext), cipher.final()]));
            const parsed = this.#payload(scope, purpose, JSON.parse(text));
            if (JSON.stringify(parsed) !== text)
                fail();
            return parsed;
        }
        catch {
            return fail();
        }
    }
    digest(input: RetirementScope, value: RecordedLifecycleConnection, v = this.#active): string { const scope = parsedScope(input), payload = this.#payload(scope, 'record', value); return createHmac('sha256', this.#keys.get(v)?.digestKey ?? (fail())).update(this.#aad(scope, 'record', v)).update(JSON.stringify(payload)).digest('hex'); }
}
export interface RetirementIdentityProof {
    record: RecordedLifecycleConnection;
    physicalIdentity: {
        namespace: string;
        value: string;
    };
}
export interface ConnectionRetirementOptions {
    pool: SqlPool;
    record: RecordedLifecycleConnection;
    integrationId: string;
    providerConfigurationReference: string;
    codec: Pick<ConnectionRetirementCodec, 'keyVersion' | 'encode' | 'decode' | 'digest'>;
    /** Trusted generation-vault/canonical-owner verification. Independently decrypt/verify the exact
     * stored generation provider ID, source and provider-owner key. Return canonical physical identity
     * from a verified bridge, never infer it from names/usernames or the caller's owner key. */
    verifyRecordedIdentity(input: {
        record: RecordedLifecycleConnection;
        generation: {
            encryptedProviderAccountId: string;
            providerAccountKeyVersion: string;
            credentialReference: string | null;
        };
    }, signal: AbortSignal): Promise<RetirementIdentityProof | null>;
    providerAccountDigest(value: string, keyVersion: string): string;
    physicalIdentityDigest(identity: {
        namespace: string;
        value: string;
    }, keyVersion: string): string;
    transactionTimeoutMs?: number;
    statementTimeoutMs?: number;
    lockTimeoutMs?: number;
}
/** Durable retirement only; never provider I/O or a migration. Driver release(error) MUST
 * physically terminate/discard the checked-out session (pg.PoolClient semantics). */
export function createPostgresConnectionRetirement(inputOptions: ConnectionRetirementOptions): Pick<ConnectionLifecycleOptions, 'prepareDisconnect' | 'finishDisconnect'> {
    let fixed: RecordedLifecycleConnection, connect: SqlPool['connect'], encode: ConnectionRetirementCodec['encode'], decode: ConnectionRetirementCodec['decode'], digest: ConnectionRetirementCodec['digest'], verify: ConnectionRetirementOptions['verifyRecordedIdentity'], providerDigest: ConnectionRetirementOptions['providerAccountDigest'], physicalDigest: ConnectionRetirementOptions['physicalIdentityDigest'], activeVersion: string, integration: string, configuration: string, timeout: number, statement: number, lock: number;
    try {
        const o = exact(inputOptions, ['pool', 'record', 'integrationId', 'providerConfigurationReference', 'codec', 'verifyRecordedIdentity', 'providerAccountDigest', 'physicalIdentityDigest'], ['transactionTimeoutMs', 'statementTimeoutMs', 'lockTimeoutMs']);
        fixed = parseLifecycleRecord(o.record);
        integration = o.integrationId as string;
        configuration = o.providerConfigurationReference as string;
        timeout = (o.transactionTimeoutMs ?? 20000) as number;
        statement = (o.statementTimeoutMs ?? 5000) as number;
        lock = (o.lockTimeoutMs ?? 1000) as number;
        observe(o.pool);
        observe(o.codec);
        if (types.isProxy(o.pool) || types.isProxy(o.codec))
            fail();
        const pool = o.pool as SqlPool, codec = o.codec as ConnectionRetirementOptions['codec'];
        activeVersion = observe(codec?.keyVersion) as string;
        const c = pool?.connect, e = codec?.encode, d = codec?.decode, h = codec?.digest;
        if (!id(integration) || !id(configuration, 2000) || !version(activeVersion) || !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 25000 || !Number.isSafeInteger(statement) || statement < 1 || statement > timeout || !Number.isSafeInteger(lock) || lock < 1 || lock > statement || [c, e, d, h, o.verifyRecordedIdentity, o.providerAccountDigest, o.physicalIdentityDigest].some(fn => typeof fn !== 'function'))
            fail();
        connect = Function.prototype.bind.call(c, pool);
        encode = Function.prototype.bind.call(e, codec);
        decode = Function.prototype.bind.call(d, codec);
        digest = Function.prototype.bind.call(h, codec);
        verify = Function.prototype.bind.call(o.verifyRecordedIdentity as ConnectionRetirementOptions['verifyRecordedIdentity'], inputOptions);
        providerDigest = Function.prototype.bind.call(o.providerAccountDigest as ConnectionRetirementOptions['providerAccountDigest'], inputOptions);
        physicalDigest = Function.prototype.bind.call(o.physicalIdentityDigest as ConnectionRetirementOptions['physicalIdentityDigest'], inputOptions);
    }
    catch {
        throw Error('Invalid connection retirement configuration');
    }
    const b = fixed.binding, scopes = [b.applicationId, b.tenantId, b.ownerId], bindingValues = [...scopes, b.connectionId, b.generation, b.accountId, b.channel, b.platform, b.backend];
    function captured(value: unknown): RecordedLifecycleConnection {
        const r = parseLifecycleRecord(value);
        if (!isDeepStrictEqual(r, fixed))
            fail();
        return r;
    }
    function scope(key: unknown): RetirementScope {
        if (!id(key))
            fail();
        return { binding: structuredClone(b), key };
    }
    function operationId(s: RetirementScope) { return createHash('sha256').update(JSON.stringify(['communications.retirement.operation.v1', ...scopes, s.key])).digest('hex'); }
    function seal(s: RetirementScope, p: RetirementPurpose, value: RecordedLifecycleConnection | AccountDisconnect) {
        const encrypted = observe(encode(structuredClone(s), p, structuredClone(value)));
        const r = exact(encrypted, ['format', 'keyVersion', 'nonce', 'ciphertext', 'tag']);
        if (r.keyVersion !== activeVersion || r.format !== 'communications-retirement-v1')
            fail();
        const json = JSON.stringify(r);
        if (json.length > 65536)
            fail();
        const opened = observe(decode(structuredClone(s), p, JSON.parse(json)));
        if (!isDeepStrictEqual(p === 'record' ? captured(opened) : result(opened), value))
            fail();
        return json;
    }
    async function transaction<T>(signal: AbortSignal, work: (c: SqlClient, signal: AbortSignal) => Promise<T>): Promise<T> {
        observe(signal);
        if (types.isProxy(signal) || !(signal instanceof AbortSignal))
            fail();
        const isAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(signal) as boolean;
        let client: SqlClient | undefined, released = false, expired = false, committing = false, inFlight = 0, discard: Error | undefined;
        const controller = new AbortController(), deadline = performance.now() + timeout;
        const dispose = () => {
            if (!client || released)
                return;
            released = true;
            try {
                client.release(discard);
            }
            catch { }
        };
        const expire = () => { expired = true; controller.abort(); discard = Error('Connection retirement session retired'); dispose(); };
        const live = () => {
            if (expired || controller.signal.aborted || performance.now() >= deadline) {
                expire();
                fail();
            }
            if (released)
                fail();
        };
        let rejectStop: (e: Error) => void = () => { };
        const cancel = () => { expire(); rejectStop(Error('Connection retirement unavailable')); };
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stopped = new Promise<never>((_r, reject) => { rejectStop = reject; timer = setTimeout(cancel, timeout); });
        if (isAborted)
            cancel();
        else
            EventTarget.prototype.addEventListener.call(signal, 'abort', cancel, { once: true });
        const run = async () => {
            try {
                live();
                client = await connect();
                live();
                const query = Function.prototype.bind.call(client.query, client) as SqlClient['query'];
                const tx: SqlClient = { query<Row>(text: string, values?: unknown[]) {
                        let request: Promise<SqlResult<Row>>;
                        try {
                            live();
                            if (inFlight !== 0)
                                fail();
                            if (text === 'COMMIT')
                                committing = true;
                            inFlight++;
                            request = Promise.resolve().then(() => { live(); return query<Row>(text, values); }).then(r => { live(); return r; }).finally(() => { inFlight--; });
                        }
                        catch {
                            request = Promise.reject(Error('Connection retirement unavailable'));
                        }
                        void request.catch(() => undefined);
                        return request;
                    }, release() { fail(); } };
                await tx.query('BEGIN');
                await tx.query('SET LOCAL ROLE communications_control');
                const roles = await tx.query('SELECT current_user AS role_name,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user');
                if (roles.rows.length !== 1 || roles.rows[0].role_name !== 'communications_control' || roles.rows[0].rolsuper !== false || roles.rows[0].rolbypassrls !== false || roles.rows[0].rolcanlogin !== false)
                    fail();
                await tx.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [`${lock}ms`, `${statement}ms`]);
                const schema = await tx.query("SELECT to_regclass('communications.connection_retirements') IS NOT NULL AS present");
                if (schema.rows.length !== 1 || schema.rows[0].present !== true)
                    fail();
                const value = await work(tx, controller.signal);
                live();
                await tx.query('COMMIT');
                return value;
            }
            catch (error) {
                const code = error && typeof error === 'object' && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
                if (committing || inFlight !== 0 || typeof code === 'string' && /^(08|57P0|ECONN|ETIMEDOUT|EPIPE)/.test(code)) {
                    discard = Error('Connection retirement session retired');
                    dispose();
                }
                if (performance.now() >= deadline)
                    expire();
                if (client && !released && !expired) {
                    try {
                        await client.query('ROLLBACK');
                    }
                    catch {
                        discard = Error('Connection retirement session retired');
                    }
                }
                return fail();
            }
            finally {
                dispose();
            }
        };
        const pending = Promise.resolve().then(run);
        try {
            return await Promise.race([pending, stopped]);
        }
        finally {
            clearTimeout(timer);
            EventTarget.prototype.removeEventListener.call(signal, 'abort', cancel);
            controller.abort();
        }
    }
    async function tenant(c: SqlClient) {
        const r = await c.query('SELECT communications.lock_reply_barrier($1,$2)::text AS revision', [...scopes.slice(0, 2)]);
        if (r.rows.length !== 1 || typeof r.rows[0].revision !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(r.rows[0].revision))
            fail();
    }
    async function authority(c: SqlClient) {
        await tenant(c);
        const physical = await c.query("SELECT id,channel,identity_namespace,identity_digest,identity_key_version,(verified_at IS NOT NULL AND verified_at<=clock_timestamp()) AS verified FROM communications.physical_accounts WHERE id=$1 FOR UPDATE", [b.accountId]);
        if (physical.rows.length !== 1 || physical.rows[0].id !== b.accountId || physical.rows[0].channel !== b.channel || physical.rows[0].verified !== true)
            return null;
        const connection = await c.query(`SELECT c.id AS connection_id,c.application_id,c.tenant_id,c.owner_id,c.account_id AS current_account_id,c.current_generation,c.active,(c.status_observed_at>clock_timestamp()) IS TRUE AS status_observed_future,g.* FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=$5 WHERE c.application_id=$1 AND c.tenant_id=$2 AND c.owner_id=$3 AND c.id=$4 FOR UPDATE OF c,g`, [...scopes, b.connectionId, b.generation]);
        if (connection.rows.length !== 1)
            return null;
        const g = connection.rows[0];
        if (g.connection_id !== b.connectionId || g.application_id !== b.applicationId || g.tenant_id !== b.tenantId || g.owner_id !== b.ownerId || g.account_id !== b.accountId || g.generation !== b.generation || g.channel !== b.channel || g.platform !== b.platform || g.backend !== b.backend || g.integration_id !== integration || g.provider_api_version !== 'v1' || g.provider_configuration_reference !== configuration || g.authority !== 'service')
            return null;
        if (!await grant(c))
            return null;
        return { physical: physical.rows[0], generation: g };
    }
    async function grant(c: SqlClient) { const r = await c.query('SELECT application_id,tenant_id,owner_id,(revoked_at IS NULL AND expires_at>clock_timestamp()) AS valid FROM communications.access_grants WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 FOR SHARE', [...scopes]); return r.rows.length === 1 && r.rows[0].application_id === b.applicationId && r.rows[0].tenant_id === b.tenantId && r.rows[0].owner_id === b.ownerId && r.rows[0].valid === true; }
    async function existing(c: SqlClient, s: RetirementScope) {
        const r = await c.query('SELECT * FROM communications.connection_retirements WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND operation_key=$4 FOR UPDATE', [...scopes, s.key]);
        if (r.rows.length > 1)
            fail();
        return r.rows[0];
    }
    function opened(s: RetirementScope, row: Record<string, unknown>) {
        if (row.id !== operationId(s) || row.application_id !== b.applicationId || row.tenant_id !== b.tenantId || row.owner_id !== b.ownerId || row.connection_id !== b.connectionId || row.generation !== b.generation || row.account_id !== b.accountId || row.channel !== b.channel || row.platform !== b.platform || row.backend !== b.backend || row.operation_key !== s.key || !hex(row.record_fingerprint) || !version(row.fingerprint_key_version) || !version(row.record_key_version) || !hex(row.token_hash) || typeof row.encrypted_record !== 'string' || row.encrypted_record.length > 65536 || !['pending', 'unknown', 'rejected', 'disconnected'].includes(row.state as string))
            fail();
        const envelope = JSON.parse(row.encrypted_record);
        if (!envelope || envelope.keyVersion !== row.record_key_version)
            fail();
        const r = captured(observe(decode(structuredClone(s), 'record', envelope)));
        if (!equalHex(digest(structuredClone(s), structuredClone(r), row.fingerprint_key_version), row.record_fingerprint))
            fail();
        if (row.state === 'pending') {
            if (row.encrypted_outcome !== null || row.outcome_key_version !== null)
                fail();
        }
        else {
            if (typeof row.encrypted_outcome !== 'string' || row.encrypted_outcome.length > 4096 || !version(row.outcome_key_version))
                fail();
            const outcome = JSON.parse(row.encrypted_outcome);
            if (outcome?.keyVersion !== row.outcome_key_version || result(observe(decode(structuredClone(s), 'outcome', outcome))).status !== row.state)
                fail();
        }
        return r;
    }
    return {
        async prepareDisconnect(input, key, signal) {
            const r = captured(input), s = scope(key);
            return transaction(signal, async (c, signal) => {
                const state = await authority(c);
                if (!state)
                    return { status: 'review' };
                const old = await existing(c, s);
                if (old) {
                    opened(s, old);
                    if (!await grant(c))
                        fail();
                    return { status: old.state === 'disconnected' ? 'duplicate' : 'review' };
                }
                const g = state.generation, p = state.physical;
                if (g.current_generation !== b.generation || g.current_account_id !== b.accountId || g.active !== true || g.status_observed_future !== false || !hex(g.provider_account_digest) || !id(g.encrypted_provider_account_id, 65536) || !version(g.provider_account_key_version) || g.credential_reference !== null && !id(g.credential_reference, 2000) || !id(p.identity_namespace) || !hex(p.identity_digest) || !version(p.identity_key_version))
                    return { status: 'review' };
                const blockers = await c.query(`SELECT EXISTS(SELECT 1 FROM communications.connections WHERE account_id=$1 AND id<>$2 AND active) AS shared,EXISTS(SELECT 1 FROM communications.operation_journal WHERE account_id=$1 AND state IN ('claimed','dispatching','unknown')) AS journal,EXISTS(SELECT 1 FROM communications.account_leases WHERE account_id=$1 AND expires_at>clock_timestamp()) AS lease,EXISTS(SELECT 1 FROM communications.auth_states a LEFT JOIN communications.connection_generations g ON g.connection_id=a.reconnect_connection_id AND g.generation=a.reconnect_generation WHERE a.consumed_at IS NULL AND a.expires_at>clock_timestamp() AND ((a.application_id=$3 AND a.tenant_id=$4 AND a.owner_id=$5 AND a.channel=$6) OR g.account_id=$1)) AS setup`, [b.accountId, b.connectionId, ...scopes, b.channel]);
                if (blockers.rows.length !== 1 || ['shared', 'journal', 'lease', 'setup'].some(k => blockers.rows[0][k] !== false))
                    return { status: 'review' };
                const proofRaw = observe(await verify({ record: structuredClone(r), generation: { encryptedProviderAccountId: g.encrypted_provider_account_id, providerAccountKeyVersion: g.provider_account_key_version, credentialReference: g.credential_reference as string | null } }, signal));
                if (proofRaw === null)
                    return { status: 'review' };
                const proof = exact(proofRaw, ['record', 'physicalIdentity']), identity = exact(proof.physicalIdentity, ['namespace', 'value']);
                captured(proof.record);
                if (!id(identity.namespace) || !id(identity.value, 4096) || identity.namespace !== p.identity_namespace || !equalHex(providerDigest(r.providerAccountId, g.provider_account_key_version), g.provider_account_digest) || !equalHex(physicalDigest({ namespace: identity.namespace, value: identity.value }, p.identity_key_version), p.identity_digest) || !await grant(c))
                    return { status: 'review' };
                const token = randomBytes(32).toString('base64url'), fingerprint = observe(digest(structuredClone(s), structuredClone(r), activeVersion));
                if (!hex(fingerprint))
                    fail();
                const encrypted = seal(s, 'record', r), tokenHash = createHash('sha256').update(token).digest('hex');
                const inserted = await c.query(`INSERT INTO communications.connection_retirements(id,application_id,tenant_id,owner_id,connection_id,generation,account_id,channel,platform,backend,operation_key,record_fingerprint,fingerprint_key_version,encrypted_record,record_key_version,token_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [operationId(s), ...bindingValues, s.key, fingerprint, activeVersion, encrypted, activeVersion, tokenHash]);
                if (inserted.rows.length !== 1)
                    fail();
                opened(s, inserted.rows[0]);
                if (inserted.rows[0].state !== 'pending')
                    fail();
                if (!await grant(c))
                    fail();
                return { status: 'prepared', ticket: { record: structuredClone(r), operationKey: s.key, token } };
            });
        },
        async finishDisconnect(input, wanted, signal) {
            let ticket: DisconnectTicket, s: RetirementScope, outcome: AccountDisconnect;
            try {
                const raw = exact(input, ['record', 'operationKey', 'token']);
                ticket = { record: captured(raw.record), operationKey: raw.operationKey as string, token: raw.token as string };
                s = scope(ticket.operationKey);
                if (typeof ticket.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket.token))
                    fail();
                outcome = result(wanted);
            }
            catch {
                return { status: 'unknown' };
            }
            try {
                return await transaction(signal, async (c) => {
                    if (!await authority(c))
                        return { status: 'unknown' };
                    const row = await existing(c, s);
                    if (!row)
                        return { status: 'unknown' };
                    opened(s, row);
                    if (!equalHex(createHash('sha256').update(ticket.token).digest('hex'), row.token_hash))
                        return { status: 'unknown' };
                    if (row.state !== 'pending') {
                        if (!await grant(c))
                            fail();
                        return { status: row.state === outcome.status ? 'recorded' : 'unknown' };
                    }
                    const json = seal(s, 'outcome', outcome);
                    const changed = await c.query(`UPDATE communications.connection_retirements SET state=$2,encrypted_outcome=$3,outcome_key_version=$4,finished_at=clock_timestamp() WHERE id=$1 AND state='pending' AND token_hash=$5 RETURNING *`, [row.id, outcome.status, json, activeVersion, row.token_hash]);
                    if (changed.rows.length !== 1)
                        fail();
                    opened(s, changed.rows[0]);
                    if (!await grant(c))
                        fail();
                    return { status: 'recorded' };
                });
            }
            catch {
                return { status: 'unknown' };
            }
        }
    };
}
