import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { assertSameBinding, assertOperationMatches, assertSubmissionReceiptMatches, ContractError } from '../../contracts/src';
import type { DeliveryOutcome, ProviderReference } from '../../contracts/src';
import type { DispatchRecord, DispatchMetadata, ClaimDecision } from '../../core/src/dispatch';
import type { SqlClient, SqlResult } from './webhook-repository';
import type { CanonicalIdentity, ConnectionBinding, OperationSnapshot } from '../../contracts/src';
import type { DispatchJournalPort } from '../../core/src/dispatch';
import type { JournalEnvelope, JournalPurpose } from '../../core/src/journal-codec';
import type { SqlPool } from './webhook-repository';
export interface DispatchJournalCodec {
    readonly keyVersion: string;
    encode(snapshot: OperationSnapshot, purpose: JournalPurpose, value: unknown): JournalEnvelope;
    decode(snapshot: OperationSnapshot, purpose: JournalPurpose, envelope: unknown): unknown;
    digest(snapshot: OperationSnapshot, purpose: JournalPurpose, value: unknown, keyVersion?: string): string;
}
export interface CanonicalRecipientDigest {
    readonly keyVersion: string;
    /** Independent retained keyed canonical identity digest; never snapshot/key/content-bound. */
    digest(recipient: CanonicalIdentity, keyVersion: string): string;
}
export interface PostgresDispatchJournalOptions {
    pool: SqlPool;
    binding: ConnectionBinding;
    integrationId: string;
    providerConfigurationReference: string | null;
    providerApiVersion: 'v1' | 'v2' | null;
    authority: 'service' | 'legacy_port';
    leaseOwnerToken: string;
    codec: DispatchJournalCodec;
    recipientDigest: CanonicalRecipientDigest;
    claimSeconds?: number;
    leaseSeconds?: number;
    transactionTimeoutMs?: number;
    statementTimeoutMs?: number;
    lockTimeoutMs?: number;
}
const bindingFields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'] as const;
const retryCodes = ['incomplete', 'stale', 'busy', 'timeout', 'rate_limited', 'unavailable', 'identity_pending'];
const reviewCodes = ['reconnect', 'account_changed', 'protocol', 'unexpected', 'delivery_disabled', 'unresolved_send', 'unsupported', 'forbidden', 'operation_conflict'];
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function fail(): never { throw Error('Dispatch journal unavailable'); }
function conflict(): never { throw new ContractError('operation_conflict'); }
function observe(v: unknown): unknown { if (types.isPromise(v)) {
    void Promise.prototype.then.call(v, () => undefined, () => undefined);
    fail();
} return v; }
function record(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    observe(v);
    if (!v || typeof v !== 'object' || Array.isArray(v) || types.isProxy(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        fail();
    const d = Object.getOwnPropertyDescriptors(v), out: Record<string, unknown> = {};
    if (required.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k) || !('value' in d[k]) || !d[k].enumerable))
        fail();
    for (const k of Object.keys(d))
        out[k] = d[k].value;
    return out;
}
function binding(v: unknown): ConnectionBinding { const r = record(v, bindingFields); if (bindingFields.some(k => k !== 'generation' && !id(r[k])) || !Number.isSafeInteger(r.generation) || Number(r.generation) < 1 || Number(r.generation) > 2147483647)
    fail(); const b = r as unknown as ConnectionBinding; assertSameBinding(b, b); return b; }
function date(v: unknown): string { if (v instanceof Date) {
    const time = Date.prototype.getTime.call(v);
    if (!Number.isFinite(time))
        fail();
    return new Date(time).toISOString();
} if (typeof v !== 'string' || v.length > 64 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(v))
    fail(); const time = Date.parse(v); if (!Number.isFinite(time))
    fail(); const match = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/)!; const [year, month, day, hour, minute, second] = match.slice(1).map(Number); if (year < 1000 || month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || minute > 59 || second > 59)
    fail(); return new Date(time).toISOString(); }
function sourceDate(v: unknown): string { if (typeof v !== 'string')
    fail(); return date(v); }
function bigint(v: unknown): string { if (typeof v !== 'string' || !(/^[1-9]\d{0,18}$/).test(v) || BigInt(v) > BigInt('9223372036854775807'))
    fail(); return v; }
function sameHex(a: unknown, b: unknown) { observe(a); if (!hex(a) || !hex(b) || !timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')))
    fail(); }
type Context = {
    recipient: CanonicalIdentity;
    message?: ProviderReference;
} & DispatchMetadata;
/** Bounded P2.3 claim/preflight persistence only. Dispatch is ALWAYS disabled; no quota writes,
 * submitted completion, provider I/O, default permission, lease reclaim of existing operations,
 * or reconciliation proof is implemented. Historical reads retain original immutable generation.
 * release(error) must physically terminate the checked-out session, as pg.PoolClient does. */
export function createPostgresDispatchJournal(inputOptions: PostgresDispatchJournalOptions): DispatchJournalPort {
    let options: PostgresDispatchJournalOptions;
    try {
        options = record(inputOptions, ['pool', 'binding', 'integrationId', 'providerConfigurationReference', 'providerApiVersion', 'authority', 'leaseOwnerToken', 'codec', 'recipientDigest'], ['claimSeconds', 'leaseSeconds', 'transactionTimeoutMs', 'statementTimeoutMs', 'lockTimeoutMs']) as unknown as PostgresDispatchJournalOptions;
    }
    catch {
        throw Error('Invalid dispatch journal configuration');
    }
    let fixed: ConnectionBinding;
    let activeCodecVersion: string, activeRecipientVersion: string;
    let connect: SqlPool['connect'], encode: DispatchJournalCodec['encode'], decode: DispatchJournalCodec['decode'], digest: DispatchJournalCodec['digest'], identityDigest: CanonicalRecipientDigest['digest'];
    const claimSeconds = options.claimSeconds ?? 60, leaseSeconds = options.leaseSeconds ?? 60, timeout = options.transactionTimeoutMs ?? 20000, statementTimeout = options.statementTimeoutMs ?? 5000, lockTimeout = options.lockTimeoutMs ?? 1000;
    try {
        observe(options.pool);
        observe(options.codec);
        observe(options.recipientDigest);
        if (types.isProxy(options.pool) || types.isProxy(options.codec) || types.isProxy(options.recipientDigest))
            fail();
        fixed = binding(options.binding);
        activeCodecVersion = observe(options.codec?.keyVersion) as string;
        activeRecipientVersion = observe(options.recipientDigest?.keyVersion) as string;
        if (!id(options.integrationId) || !id(options.leaseOwnerToken) || !['service', 'legacy_port'].includes(options.authority) || !id(activeCodecVersion, 64) || !id(activeRecipientVersion) ||
            (fixed.backend === 'unipile' ? !['v1', 'v2'].includes(options.providerApiVersion as string) || !id(options.providerConfigurationReference, 2000) : options.providerApiVersion !== null || options.providerConfigurationReference !== null) ||
            !Number.isSafeInteger(claimSeconds) || claimSeconds < 1 || claimSeconds > 3600 || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 3600 ||
            !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 25000 || !Number.isSafeInteger(statementTimeout) || statementTimeout < 1 || statementTimeout > timeout || !Number.isSafeInteger(lockTimeout) || lockTimeout < 1 || lockTimeout > statementTimeout)
            fail();
        // Capture each callable once while configuration exceptions remain sanitized.
        // An accessor must not change the method between validation and binding.
        const connectPort = options.pool?.connect, encodePort = options.codec?.encode, decodePort = options.codec?.decode, digestPort = options.codec?.digest, identityPort = options.recipientDigest?.digest;
        if (typeof connectPort !== 'function' || typeof encodePort !== 'function' || typeof decodePort !== 'function' || typeof digestPort !== 'function' || typeof identityPort !== 'function')
            fail();
        connect = Function.prototype.bind.call(connectPort, options.pool);
        encode = Function.prototype.bind.call(encodePort, options.codec);
        decode = Function.prototype.bind.call(decodePort, options.codec);
        digest = Function.prototype.bind.call(digestPort, options.codec);
        identityDigest = Function.prototype.bind.call(identityPort, options.recipientDigest);
    }
    catch {
        throw Error('Invalid dispatch journal configuration');
    }
    Object.freeze(fixed);
    const integrationId = options.integrationId, configuration = options.providerConfigurationReference, apiVersion = options.providerApiVersion, authority = options.authority, worker = options.leaseOwnerToken;
    const scopes = [fixed.applicationId, fixed.tenantId, fixed.ownerId];
    function snap(v: unknown): OperationSnapshot { const r = record(v, ['key', 'binding', 'operation', 'payloadDigest']), b = binding(r.binding); assertSameBinding(fixed, b); if (!id(r.key) || !hex(r.payloadDigest) || !['message', 'invitation'].includes(r.operation as string) || r.operation === 'invitation' && b.channel !== 'linkedin')
        fail(); return { key: r.key, binding: b, operation: r.operation as OperationSnapshot['operation'], payloadDigest: r.payloadDigest }; }
    function recipient(v: unknown): CanonicalIdentity { const r = record(v, ['kind', 'value']); if (!id(r.value, 2048))
        fail(); if (fixed.channel === 'email') {
        if (r.kind !== 'email' || r.value !== r.value.toLowerCase() || !(/^[^\s<>@]+@[^\s<>@]+$/).test(r.value))
            fail();
    }
    else if (fixed.channel === 'whatsapp') {
        if (r.kind !== 'phone' || !(/^\+[1-9]\d{6,14}$/).test(r.value))
            fail();
    }
    else {
        if (r.kind !== 'linkedin_profile')
            fail();
        const u = new URL(r.value);
        if (u.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(u.hostname) || !(/^\/in\/[^/]+\/?$/).test(u.pathname) || u.username || u.password || u.port || u.search || u.hash)
            fail();
    } return r as unknown as CanonicalIdentity; }
    function reference(v: unknown): ProviderReference { const r = record(v, ['binding', 'id']); if (!id(r.id, 2048))
        fail(); const b = binding(r.binding); assertSameBinding(fixed, b); return { binding: b, id: r.id }; }
    function context(v: unknown, allowMessage = false): Context { const r = record(v, ['recipient'], ['conversation', 'rfcMessageId', ...(allowMessage ? ['message'] : [])]); if (r.rfcMessageId !== undefined && !id(r.rfcMessageId, 2048))
        fail(); return { recipient: recipient(r.recipient), ...(r.conversation === undefined ? {} : { conversation: reference(r.conversation) }), ...(r.rfcMessageId === undefined ? {} : { rfcMessageId: r.rfcMessageId as string }), ...(r.message === undefined ? {} : { message: reference(r.message) }) }; }
    function outcome(v: unknown, snapshot: OperationSnapshot, ctx: Context): DeliveryOutcome {
        const raw = record(v, ['status'], ['code', 'retryAt', 'operation', 'reason', 'receipt']);
        if (typeof raw.status !== 'string')
            fail();
        if (raw.status === 'unknown') {
            record(v, ['status']);
            return { status: 'unknown' };
        }
        if (raw.status === 'waiting' || raw.status === 'review') {
            const r = record(v, ['status', 'code'], raw.status === 'waiting' ? ['retryAt'] : []);
            if (typeof r.code !== 'string' || !(raw.status === 'waiting' ? retryCodes : reviewCodes).includes(r.code))
                fail();
            if (r.retryAt !== undefined)
                sourceDate(r.retryAt);
            return structuredClone(r) as unknown as DeliveryOutcome;
        }
        if (raw.status === 'rejected') {
            const r = record(v, ['status', 'code']);
            if (typeof r.code !== 'string' || !(/^[a-zA-Z0-9_:/.-]{1,100}$/).test(r.code))
                fail();
            return r as unknown as DeliveryOutcome;
        }
        if (raw.status === 'skipped') {
            const r = record(v, ['status', 'operation', 'reason']);
            if (!id(r.reason, 512))
                fail();
            return { status: 'skipped', operation: reference(r.operation), reason: r.reason };
        }
        if (raw.status !== 'submitted')
            fail();
        record(v, ['status', 'receipt']);
        const r = record(raw.receipt, ['recipient'], ['message', 'operation', 'conversation', 'submittedAt', 'deliveredAt', 'readAt']);
        const target = recipient(r.recipient);
        if (!isDeepStrictEqual(target, ctx.recipient) || (r.message === undefined) === (r.operation === undefined))
            fail();
        if (snapshot.operation === 'invitation' && r.message !== undefined || snapshot.operation === 'message' && r.message === undefined && !(fixed.backend === 'browser' && fixed.channel === 'linkedin'))
            fail();
        const accepted = { ...r, recipient: target, ...(r.message === undefined ? {} : { message: reference(r.message) }), ...(r.operation === undefined ? {} : { operation: reference(r.operation) }), ...(r.conversation === undefined ? {} : { conversation: reference(r.conversation) }) };
        for (const k of ['submittedAt', 'deliveredAt', 'readAt'])
            if (r[k] !== undefined)
                sourceDate(r[k]);
        if (ctx.message && (r.message === undefined || reference(r.message).id !== ctx.message.id) || ctx.conversation && (r.conversation === undefined || reference(r.conversation).id !== ctx.conversation.id))
            fail();
        assertSubmissionReceiptMatches(snapshot, ctx.recipient, accepted as unknown as Extract<DeliveryOutcome, {
            status: 'submitted';
        }>['receipt']);
        return { status: 'submitted', receipt: accepted as unknown as Extract<DeliveryOutcome, {
                status: 'submitted';
            }>['receipt'] };
    }
    function parsedRecord(v: unknown): DispatchRecord { const r = record(v, ['snapshot', 'recipient', 'state'], ['conversation', 'rfcMessageId', 'message', 'outcome']), s = snap(r.snapshot), c = context(Object.fromEntries(Object.entries(r).filter(([k]) => ['recipient', 'conversation', 'rfcMessageId', 'message'].includes(k))), true); if (r.state === 'claimed' || r.state === 'dispatching') {
        if (r.outcome !== undefined)
            fail();
        return { ...c, snapshot: s, state: r.state };
    } if (r.state === 'unknown') {
        if (outcome(r.outcome, s, c).status !== 'unknown')
            fail();
        return { ...c, snapshot: s, state: 'unknown', outcome: { status: 'unknown' } };
    } if (r.state !== 'completed')
        fail(); const o = outcome(r.outcome, s, c); if (o.status === 'unknown')
        fail(); return { ...c, snapshot: s, state: 'completed', outcome: o }; }
    function base(r: DispatchRecord): Context { return context({ recipient: r.recipient, ...(r.conversation ? { conversation: r.conversation } : {}), ...(r.rfcMessageId ? { rfcMessageId: r.rfcMessageId } : {}), ...(r.message ? { message: r.message } : {}) }, true); }
    function envelope(v: unknown, version?: unknown): JournalEnvelope { const r = record(v, ['format', 'keyVersion', 'nonce', 'ciphertext', 'tag']); if (r.format !== 'communications-journal-v1' || !id(r.keyVersion, 64) || version !== undefined && r.keyVersion !== version || !id(r.nonce, 200) || !id(r.tag, 200) || typeof r.ciphertext !== 'string' || r.ciphertext.length < 1 || r.ciphertext.length > 2200000)
        fail(); return r as unknown as JournalEnvelope; }
    function seal(s: OperationSnapshot, purpose: JournalPurpose, value: unknown) { const e = envelope(encode(structuredClone(s), purpose, structuredClone(value)), activeCodecVersion); const json = JSON.stringify(e); if (json.length > 2200000)
        fail(); return { json, version: e.keyVersion }; }
    function open(s: OperationSnapshot, purpose: JournalPurpose, json: unknown, version: unknown): unknown { if (typeof json !== 'string' || json.length < 1 || json.length > 2200000 || !id(version, 64))
        fail(); return observe(decode(structuredClone(s), purpose, envelope(JSON.parse(json), version))); }
    const columns = `id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,state,claim_token,claim_until,fencing_token::text AS fencing_token,lease_owner_token,quota_reserved,encrypted_receipt,receipt_key_version,outcome_status,encrypted_outcome,outcome_key_version,submitted_at,delivered_at,read_at,(claim_until>clock_timestamp()) AS claim_alive`;
    async function grant(c: SqlClient): Promise<boolean> { const result = await c.query(`SELECT application_id,tenant_id,owner_id FROM communications.access_grants WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE`, [...scopes]); return result.rows.length === 1 && result.rows[0].application_id === fixed.applicationId && result.rows[0].tenant_id === fixed.tenantId && result.rows[0].owner_id === fixed.ownerId; }
    async function generation(c: SqlClient, current = false): Promise<boolean> { const result = await c.query(`SELECT c.id AS connection_id,c.application_id,c.tenant_id,c.owner_id,c.channel,c.platform,c.backend,c.current_generation,c.account_id AS current_account_id,c.active,c.status,g.generation,g.account_id,g.integration_id,g.provider_api_version,g.provider_configuration_reference,g.authority FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=$5 WHERE c.application_id=$1 AND c.tenant_id=$2 AND c.owner_id=$3 AND c.id=$4 ${current ? 'FOR UPDATE OF c' : ''}`, [...scopes, fixed.connectionId, fixed.generation]); if (result.rows.length !== 1)
        return false; const r = result.rows[0]; return r.connection_id === fixed.connectionId && r.application_id === fixed.applicationId && r.tenant_id === fixed.tenantId && r.owner_id === fixed.ownerId && r.channel === fixed.channel && r.platform === fixed.platform && r.backend === fixed.backend && r.generation === fixed.generation && r.account_id === fixed.accountId && r.integration_id === integrationId && r.provider_api_version === apiVersion && r.provider_configuration_reference === configuration && r.authority === authority && (!current || r.current_generation === fixed.generation && r.current_account_id === fixed.accountId && r.active === true && r.status === 'connected'); }
    async function account(c: SqlClient) { const result = await c.query('SELECT id,channel,verified_at FROM communications.physical_accounts WHERE id=$1 FOR UPDATE', [fixed.accountId]); if (result.rows.length !== 1 || result.rows[0].id !== fixed.accountId || result.rows[0].channel !== fixed.channel || result.rows[0].verified_at === null)
        fail(); date(result.rows[0].verified_at); }
    async function row(c: SqlClient, key: string, lock = false) { const r = await c.query(`SELECT ${columns} FROM communications.operation_journal WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND operation_key=$4 ${lock ? 'FOR UPDATE' : ''}`, [...scopes, key]); if (r.rows.length > 1)
        fail(); return r.rows[0]; }
    function read(r: Record<string, unknown>, requested: OperationSnapshot): DispatchRecord {
        const original = snap({ key: r.operation_key, binding: { applicationId: r.application_id, tenantId: r.tenant_id, ownerId: r.owner_id, connectionId: r.connection_id, accountId: r.account_id, generation: r.generation, channel: fixed.channel, platform: fixed.platform, backend: fixed.backend }, operation: r.operation, payloadDigest: r.payload_digest });
        assertOperationMatches(requested, original);
        if (!id(r.id) || !id(r.claim_token) || !id(r.lease_owner_token) || !id(r.recipient_key_version) || r.digest_version !== 'message-v1' || typeof r.quota_reserved !== 'boolean')
            fail();
        bigint(r.fencing_token);
        date(r.claim_until);
        const raw = open(original, 'context', r.encrypted_operation_context, r.operation_context_key_version), ctx = context(raw, true);
        sameHex(digest(structuredClone(original), 'context', structuredClone(raw), r.operation_context_key_version as string), r.operation_context_digest);
        sameHex(identityDigest(structuredClone(ctx.recipient), r.recipient_key_version), r.recipient_digest);
        const initial = { snapshot: original, ...ctx };
        if (r.state === 'claimed' || r.state === 'dispatching' || r.state === 'unknown') {
            if (r.encrypted_receipt !== null || r.receipt_key_version !== null || r.outcome_status !== null || r.encrypted_outcome !== null || r.outcome_key_version !== null || r.submitted_at !== null || r.delivered_at !== null || r.read_at !== null || r.state === 'claimed' && r.quota_reserved !== false || r.state === 'dispatching' && r.quota_reserved !== true)
                fail();
            return r.state === 'unknown' ? { ...initial, state: 'unknown', outcome: { status: 'unknown' } } : { ...initial, state: r.state };
        }
        if (r.state === 'submitted') {
            if (r.quota_reserved !== true || r.outcome_status !== null || r.encrypted_outcome !== null || r.outcome_key_version !== null)
                fail();
            const stored = open(original, 'receipt', r.encrypted_receipt, r.receipt_key_version);
            const accepted = outcome({ status: 'submitted', receipt: stored }, original, ctx);
            if (accepted.status !== 'submitted')
                fail();
            const facts = accepted.receipt as unknown as Record<string, unknown>;
            if ('operation' in accepted.receipt && (r.delivered_at !== null || r.read_at !== null))
                fail();
            for (const [column, field] of [['submitted_at', 'submittedAt'], ['delivered_at', 'deliveredAt'], ['read_at', 'readAt']] as const) {
                const known = facts[field];
                if (known !== undefined && (r[column] === null || date(known) !== date(r[column])))
                    fail();
                if (r[column] !== null) {
                    if (column === 'submitted_at' && known === undefined)
                        fail();
                    if (known === undefined)
                        facts[field] = date(r[column]);
                }
            }
            return { ...initial, ...('message' in accepted.receipt ? { message: accepted.receipt.message } : {}), state: 'completed', outcome: accepted };
        }
        if (!['blocked', 'rejected', 'skipped'].includes(r.state as string) || r.encrypted_receipt !== null || r.receipt_key_version !== null || r.submitted_at !== null || r.delivered_at !== null || r.read_at !== null)
            fail();
        const completed = outcome(open(original, 'outcome', r.encrypted_outcome, r.outcome_key_version), original, ctx);
        if (completed.status !== r.outcome_status || !(r.state === 'blocked' && ['waiting', 'review'].includes(completed.status) || r.state === completed.status && ['rejected', 'skipped'].includes(completed.status)))
            fail();
        return { ...initial, state: 'completed', outcome: completed as Exclude<DeliveryOutcome, {
                status: 'unknown';
            }> };
    }
    async function transaction<T>(work: (c: SqlClient) => Promise<T>): Promise<T> {
        let client: SqlClient | undefined, released = false, expired = false, commitAttempted = false, inFlight = 0, discard: Error | undefined;
        const deadline = performance.now() + timeout;
        const dispose = () => { if (!client || released)
            return; released = true; try {
            client.release(discard);
        }
        catch { /* Driver errors remain private. */ } };
        const expire = () => { expired = true; discard = Error('Dispatch journal session retired'); dispose(); };
        const live = () => { if (expired || performance.now() >= deadline) {
            expire();
            fail();
        } if (released)
            fail(); };
        const run = async () => {
            try {
                live();
                client = await connect();
                live();
                const query = client.query.bind(client);
                const tx: SqlClient = { query<Row>(sql: string, values?: unknown[]) { let request: Promise<SqlResult<Row>>; try {
                        live();
                        if (inFlight !== 0)
                            fail();
                        if (sql === 'COMMIT')
                            commitAttempted = true;
                        inFlight++;
                        request = Promise.resolve().then(() => { live(); return query<Row>(sql, values); }).then(result => { live(); return result; }).finally(() => { inFlight--; });
                    }
                    catch {
                        request = Promise.reject(Error('Dispatch journal unavailable'));
                    } void request.catch(() => undefined); return request; }, release() { fail(); } };
                await tx.query('BEGIN');
                await tx.query('SET LOCAL ROLE communications_control');
                const roles = await tx.query('SELECT current_user AS role_name,rolsuper,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user');
                if (roles.rows.length !== 1 || roles.rows[0].role_name !== 'communications_control' || roles.rows[0].rolsuper !== false || roles.rows[0].rolbypassrls !== false || roles.rows[0].rolcanlogin !== false)
                    fail();
                await tx.query("SELECT set_config('lock_timeout',$1,true),set_config('statement_timeout',$2,true)", [`${lockTimeout}ms`, `${statementTimeout}ms`]);
                const result = await work(tx);
                live();
                return result;
            }
            catch (error) {
                if (performance.now() >= deadline)
                    expire();
                const code = error && typeof error === 'object' && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, 'code')?.value : undefined;
                const connectionFailed = typeof code === 'string' && /^(?:08[A-Z0-9]{3}|57P0[123]|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EHOSTUNREACH|ENETUNREACH)$/.test(code);
                if (commitAttempted || inFlight !== 0 || connectionFailed) {
                    discard = Error('Dispatch journal session retired');
                    dispose();
                }
                if (client && !released && !expired) {
                    try {
                        await client.query('ROLLBACK');
                    }
                    catch {
                        discard = Error('Dispatch journal session retired');
                    }
                }
                if (error instanceof ContractError && error.code === 'operation_conflict')
                    throw error;
                return fail();
            }
            finally {
                dispose();
            }
        };
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const stopped = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expire(); reject(Error('Dispatch journal unavailable')); }, timeout); });
            return await Promise.race([Promise.resolve().then(run), stopped]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    async function tenant(c: SqlClient) { const r = await c.query('SELECT communications.lock_reply_barrier($1,$2)::text AS revision', [fixed.applicationId, fixed.tenantId]); if (r.rows.length !== 1 || typeof r.rows[0].revision !== 'string' || !(/^(0|[1-9]\d{0,18})$/).test(r.rows[0].revision) || BigInt(r.rows[0].revision) > BigInt('9223372036854775807'))
        fail(); }
    async function lease(c: SqlClient): Promise<{
        fence: string;
    } | null> {
        const selected = await c.query('SELECT account_id,owner_token,fencing_token::text AS fencing_token,(expires_at>clock_timestamp()) AS alive FROM communications.account_leases WHERE account_id=$1 FOR UPDATE', [fixed.accountId]);
        if (selected.rows.length > 1)
            fail();
        if (selected.rows.length === 1) {
            const r = selected.rows[0];
            if (r.account_id !== fixed.accountId || !id(r.owner_token) || typeof r.alive !== 'boolean')
                fail();
            const fence = bigint(r.fencing_token);
            if (r.alive)
                return r.owner_token === worker ? { fence } : null;
            if (fence === '9223372036854775807')
                fail();
        }
        const query = selected.rows.length === 0 ? 'INSERT INTO communications.account_leases(account_id,owner_token,fencing_token,expires_at) VALUES($1,$2,1,clock_timestamp()+($3::double precision*interval \'1 second\')) RETURNING account_id,owner_token,fencing_token::text AS fencing_token' : `UPDATE communications.account_leases SET owner_token=$2,fencing_token=fencing_token+1,expires_at=clock_timestamp()+($3::double precision*interval '1 second') WHERE account_id=$1 AND expires_at<=clock_timestamp() RETURNING account_id,owner_token,fencing_token::text AS fencing_token`;
        const changed = await c.query(query, [fixed.accountId, worker, leaseSeconds]);
        if (changed.rows.length !== 1 || changed.rows[0].account_id !== fixed.accountId || changed.rows[0].owner_token !== worker)
            fail();
        return { fence: bigint(changed.rows[0].fencing_token) };
    }
    async function owned(c: SqlClient, r: Record<string, unknown>, token: string) { if (r.state !== 'claimed' || r.quota_reserved !== false || r.claim_token !== token || r.lease_owner_token !== worker || r.claim_alive !== true)
        fail(); const l = await c.query('SELECT account_id,owner_token,fencing_token::text AS fencing_token,(expires_at>clock_timestamp()) AS alive FROM communications.account_leases WHERE account_id=$1 FOR UPDATE', [fixed.accountId]); if (l.rows.length !== 1 || l.rows[0].account_id !== fixed.accountId || l.rows[0].owner_token !== worker || l.rows[0].alive !== true || bigint(l.rows[0].fencing_token) !== bigint(r.fencing_token))
        fail(); }
    function mutation(input: unknown, withOutcome: boolean) { const raw = record(input, ['token', 'record', ...(withOutcome ? ['outcome'] : [])]); if (!id(raw.token))
        fail(); const provided = parsedRecord(raw.record); return { token: raw.token, provided, ...(withOutcome ? { outcome: outcome(raw.outcome, provided.snapshot, base(provided)) } : {}) }; }
    return {
        async claim(input) {
            let snapshot: OperationSnapshot, ctx: Context;
            try {
                const r = record(input, ['snapshot', 'recipient'], ['conversation', 'rfcMessageId']);
                snapshot = snap(r.snapshot);
                ctx = context(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'snapshot')));
            }
            catch {
                conflict();
            }
            return transaction(async (c) => {
                await tenant(c);
                const existing = await row(c, snapshot.key);
                if (existing) {
                    if (!await grant(c)) {
                        await c.query('ROLLBACK');
                        return { kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } };
                    }
                    if (!await generation(c))
                        fail();
                    const original = read(existing, snapshot);
                    const immutable = context(open(snapshot, 'context', existing.encrypted_operation_context, existing.operation_context_key_version), true);
                    const comparable = context({ recipient: immutable.recipient, ...(immutable.conversation ? { conversation: immutable.conversation } : {}), ...(immutable.rfcMessageId ? { rfcMessageId: immutable.rfcMessageId } : {}) });
                    if (!isDeepStrictEqual(comparable, ctx))
                        conflict();
                    if (!await grant(c))
                        fail();
                    await c.query('COMMIT');
                    return { kind: 'existing', record: original };
                }
                if (!await generation(c, true)) {
                    await c.query('ROLLBACK');
                    return { kind: 'blocked', outcome: { status: 'review', code: 'reconnect' } };
                }
                await account(c);
                if (!await grant(c)) {
                    await c.query('ROLLBACK');
                    return { kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } };
                }
                if (authority !== 'service') {
                    await c.query('ROLLBACK');
                    return { kind: 'blocked', outcome: { status: 'review', code: 'delivery_disabled' } };
                }
                const acquired = await lease(c);
                if (!acquired) {
                    await c.query('ROLLBACK');
                    return { kind: 'blocked', outcome: { status: 'waiting', code: 'busy' } };
                }
                const encrypted = seal(snapshot, 'context', ctx), contextDigest = observe(digest(structuredClone(snapshot), 'context', structuredClone(ctx), encrypted.version)), recipientHash = observe(identityDigest(structuredClone(ctx.recipient), activeRecipientVersion));
                if (!hex(contextDigest) || !hex(recipientHash))
                    fail();
                const token = randomBytes(32).toString('base64url');
                const inserted = await c.query(`INSERT INTO communications.operation_journal(id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,claim_token,claim_until,fencing_token,lease_owner_token)
 SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'message-v1',$12,$13,$14,$15,$16,LEAST(clock_timestamp()+($17::double precision*interval '1 second'),l.expires_at),$18::bigint,$19 FROM communications.account_leases l WHERE l.account_id=$8 AND l.owner_token=$19 AND l.fencing_token=$18::bigint AND l.expires_at>clock_timestamp() RETURNING ${columns}`, [randomUUID(), ...scopes, snapshot.key, fixed.connectionId, fixed.generation, fixed.accountId, snapshot.operation, snapshot.payloadDigest, recipientHash, activeRecipientVersion, encrypted.json, encrypted.version, contextDigest, token, claimSeconds, acquired.fence, worker]);
                if (inserted.rows.length !== 1 || !await grant(c))
                    fail();
                const captured = read(inserted.rows[0], snapshot);
                await c.query('COMMIT');
                return { kind: 'claimed', token, record: captured };
            }) as Promise<ClaimDecision>;
        },
        async get(input) { let snapshot: OperationSnapshot; try {
            snapshot = snap(input);
        }
        catch {
            conflict();
        } return transaction(async (c) => { if (!await grant(c) || !await generation(c))
            fail(); const found = await row(c, snapshot.key); const result = found ? read(found, snapshot) : null; if (!await grant(c))
            fail(); await c.query('COMMIT'); return result; }); },
        async beginDispatch(input) { let m: ReturnType<typeof mutation>; try {
            m = mutation(input, false);
        }
        catch {
            return fail();
        } return transaction(async (c) => { await tenant(c); if (!await generation(c, true))
            fail(); await account(c); if (!await grant(c))
            fail(); const found = await row(c, m.provided.snapshot.key, true); if (!found)
            fail(); const current = read(found, m.provided.snapshot); if (m.provided.state !== 'claimed' || !isDeepStrictEqual(base(current), base(m.provided)))
            fail(); await owned(c, found, m.token); if (!await grant(c))
            fail(); await c.query('COMMIT'); return { kind: 'blocked', outcome: { status: 'review', code: 'delivery_disabled' } }; }); },
        async complete(input) {
            let m: ReturnType<typeof mutation>;
            try {
                m = mutation(input, true);
                if (m.outcome?.status === 'submitted')
                    fail();
            }
            catch {
                return fail();
            }
            return transaction(async (c) => {
                await tenant(c);
                if (!await generation(c))
                    fail();
                await account(c);
                if (!await grant(c))
                    fail();
                const found = await row(c, m.provided.snapshot.key, true);
                if (!found)
                    fail();
                const current = read(found, m.provided.snapshot);
                if (found.claim_token !== m.token || !isDeepStrictEqual(base(current), base(m.provided)))
                    fail();
                const wanted = m.outcome!;
                if (current.state === 'completed' || current.state === 'unknown') {
                    if (!isDeepStrictEqual(current.outcome, wanted))
                        fail();
                    if (!await grant(c))
                        fail();
                    await c.query('COMMIT');
                    return current;
                }
                if (m.provided.state !== 'claimed')
                    fail();
                await owned(c, found, m.token);
                const target = wanted.status === 'unknown' ? 'unknown' : wanted.status === 'waiting' || wanted.status === 'review' ? 'blocked' : wanted.status;
                if (!['unknown', 'blocked', 'rejected', 'skipped'].includes(target))
                    fail();
                const encrypted = wanted.status === 'unknown' ? null : seal(current.snapshot, 'outcome', wanted);
                const changed = await c.query(`UPDATE communications.operation_journal SET state=$5,outcome_status=$6,encrypted_outcome=$7,outcome_key_version=$8,updated_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND operation_key=$4 AND state='claimed' AND claim_token=$9 AND claim_until>clock_timestamp() AND quota_reserved=false AND EXISTS(SELECT 1 FROM communications.account_leases l WHERE l.account_id=communications.operation_journal.account_id AND l.owner_token=communications.operation_journal.lease_owner_token AND l.fencing_token=communications.operation_journal.fencing_token AND l.expires_at>clock_timestamp()) RETURNING ${columns}`, [...scopes, current.snapshot.key, target, wanted.status === 'unknown' ? null : wanted.status, encrypted?.json ?? null, encrypted?.version ?? null, m.token]);
                if (changed.rows.length !== 1 || !await grant(c))
                    fail();
                const completed = read(changed.rows[0], current.snapshot);
                if (!('outcome' in completed) || !isDeepStrictEqual(completed.outcome, wanted))
                    fail();
                await c.query('COMMIT');
                return completed;
            });
        },
        async reconcile(input) { try {
            const r = record(input, ['record', 'outcome']), stored = parsedRecord(r.record);
            outcome(r.outcome, stored.snapshot, base(stored));
        }
        catch {
            return fail();
        } return fail(); },
    };
}
