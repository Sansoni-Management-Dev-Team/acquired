import { assertSameBinding, type ConnectionBinding } from '../../contracts/src';
import type { AccountRuntimeVault, ProviderReceiptPayload } from './account-vault';
import type { SqlPool } from './webhook-repository';
import type { WebhookCodec } from '../../core/src/webhook-codec';
export interface ProviderSpoolClaim extends ProviderReceiptPayload {
    id: string;
    token: string;
    binding?: ConnectionBinding;
}
export interface ProviderWebhookSpoolOptions {
    pool: SqlPool;
    vault: AccountRuntimeVault;
    captureCodec: Pick<WebhookCodec, 'decode' | 'digest'>;
    applicationId: string;
    integrationId: string;
    providerConfigurationReference: string;
    authenticate(headers: readonly string[]): boolean;
    ttlSeconds?: number;
    maxPending?: number;
}
export interface ProviderWebhookSpool {
    capture(input: {
        rawHeaders: readonly string[];
        rawBody: Uint8Array;
    }): Promise<{
        status: 'accepted' | 'duplicate' | 'retry';
    } | {
        status: 'rejected';
        code: 'unauthorized' | 'invalid_request' | 'too_large';
    }>;
    claim(): Promise<ProviderSpoolClaim | null>;
    pendingScoped(): Promise<{
        binding: ConnectionBinding;
        key: string;
    }[]>;
    proveRouted(record: import("../../core/src/reply-ingress").ClaimedWebhook): Promise<boolean>;
    blocked(binding: ConnectionBinding): Promise<boolean>;
    complete(record: ProviderSpoolClaim, receiptKey: string): Promise<void>;
    defer(record: ProviderSpoolClaim): Promise<void>;
}
import { randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { runtimeTransaction } from './runtime-sql';
import type { SqlClient } from './webhook-repository';
function fail(): never { throw Error('Provider webhook spool unavailable'); }
function observe(v: unknown) { if (types.isPromise(v)) {
    void Promise.prototype.then.call(v, undefined, () => { });
    fail();
} return v; }
function object(v: unknown, keys?: string[]): Record<string, unknown> { observe(v); if (!v || typeof v !== 'object' || types.isProxy(v) || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    fail(); const d = Object.getOwnPropertyDescriptors(v); if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !('value' in d[k]) || keys && !keys.includes(k)))
    fail(); return Object.fromEntries(Object.entries(d).map(([k, p]) => [k, observe(p.value)])); }
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const date = (v: unknown) => { if (v instanceof Date) {
    const t = Date.prototype.getTime.call(v);
    if (!Number.isFinite(t))
        fail();
    return new Date(t).toISOString();
} if (typeof v !== 'string' || !Number.isFinite(Date.parse(v)))
    fail(); return new Date(v).toISOString(); };
const fields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'];
function binding(v: unknown) { const b = object(v, fields) as unknown as ConnectionBinding; if (Object.keys(b).length !== fields.length)
    fail(); assertSameBinding(b, b); if (b.backend !== 'unipile')
    fail(); return structuredClone(b); }
function method<T>(port: object, name: string): T { observe(port); if (types.isProxy(port))
    fail(); let cursor: object | null = port; for (let n = 0; cursor && n < 8; n++, cursor = Object.getPrototypeOf(cursor)) {
    if (types.isProxy(cursor))
        fail();
    const d = Object.getOwnPropertyDescriptor(cursor, name);
    if (d) {
        observe(d.value);
        if (!('value' in d) || typeof d.value !== 'function' || types.isProxy(d.value))
            fail();
        return Function.prototype.bind.call(d.value, port) as T;
    }
} return fail(); }
export function createPostgresProviderWebhookSpool(input: ProviderWebhookSpoolOptions): ProviderWebhookSpool {
    let o: ProviderWebhookSpoolOptions;
    try {
        o = object(input, ['pool', 'vault', 'captureCodec', 'applicationId', 'integrationId', 'providerConfigurationReference', 'authenticate', 'ttlSeconds', 'maxPending']) as unknown as ProviderWebhookSpoolOptions;
        if (!id(o.applicationId) || !id(o.integrationId) || !id(o.providerConfigurationReference, 2000) || typeof o.authenticate !== 'function' || types.isProxy(o.authenticate))
            fail();
    }
    catch {
        throw Error('Invalid provider spool configuration');
    }
    const app = o.applicationId, integration = o.integrationId, config = o.providerConfigurationReference, ttl = o.ttlSeconds ?? 86400, max = o.maxPending ?? 512;
    if (!Number.isSafeInteger(ttl) || ttl < 60 || ttl > 86400 || !Number.isSafeInteger(max) || max < 1 || max > 4096)
        fail();
    const pool = Object.freeze({ connect: method<SqlPool['connect']>(o.pool, 'connect') }), authenticate = Function.prototype.bind.call(o.authenticate, input), seal = method<AccountRuntimeVault['sealProviderReceipt']>(o.vault, 'sealProviderReceipt'), open = method<AccountRuntimeVault['openProviderReceipt']>(o.vault, 'openProviderReceipt'), receiptId = method<AccountRuntimeVault['providerReceiptId']>(o.vault, 'providerReceiptId'), digest = method<AccountRuntimeVault['providerAccountDigest']>(o.vault, 'providerAccountDigest'), versions = method<AccountRuntimeVault['versions']>(o.vault, 'versions')(), decodeCapture = method<WebhookCodec['decode']>(o.captureCodec, 'decode'), digestCapture = method<WebhookCodec['digest']>(o.captureCodec, 'digest');
    const scope = (key: string) => ({ integrationId: integration, providerConfigurationReference: config, id: key });
    const tx = <T>(fn: (client: SqlClient) => Promise<T>) => runtimeTransaction(pool, 5000, fn);
    const columns = 'w.*,g.application_id,g.tenant_id,g.owner_id,g.account_id,g.channel,g.platform,g.backend';
    function read(row: Record<string, unknown>): ProviderReceiptPayload { if (!id(row.id) || row.integration_id !== integration || row.provider_configuration_reference !== config || typeof row.encrypted_receipt !== 'string' || typeof row.key_version !== 'string' || typeof row.payload_digest !== 'string')
        fail(); const payload = open(scope(row.id), { encrypted: row.encrypted_receipt, keyVersion: row.key_version, digest: row.payload_digest }); if (payload.receivedAt !== date(row.received_at) || receiptId({ ...scope(row.id), providerAccountId: payload.providerAccountId, rawBody: payload.rawBody }) !== row.id)
        fail(); return payload; }
    function claimRow(row: Record<string, unknown>): ProviderSpoolClaim { const payload = read(row); if (typeof row.claim_token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(row.claim_token))
        fail(); return { ...payload, id: row.id as string, token: row.claim_token, ...(row.bound_connection_id !== null ? { binding: binding({ applicationId: row.application_id, tenantId: row.tenant_id, ownerId: row.owner_id, connectionId: row.bound_connection_id, accountId: row.account_id, generation: row.bound_generation, channel: row.channel, platform: row.platform, backend: row.backend }) } : {}) }; }
    function claimed(v: ProviderSpoolClaim) { const r = object(v, ['id', 'token', 'providerAccountId', 'rawBody', 'receivedAt', 'binding']); if (!id(r.id) || typeof r.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(r.token) || !types.isUint8Array(r.rawBody) || types.isProxy(r.rawBody))
        fail(); return { ...r, rawBody: Buffer.from(r.rawBody as Uint8Array), ...(r.binding ? { binding: binding(r.binding) } : {}) } as unknown as ProviderSpoolClaim; }
    async function pinAuthority(c: SqlClient, b: ConnectionBinding, provider: string) { if (b.applicationId !== app)
        fail(); await c.query('SELECT communications.lock_reply_barrier($1,$2)', [b.applicationId, b.tenantId]); const rows = await c.query(`SELECT g.provider_account_digest,g.provider_account_key_version FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation JOIN communications.physical_accounts p ON p.id=g.account_id JOIN communications.access_grants a ON a.application_id=c.application_id AND a.tenant_id=c.tenant_id AND a.owner_id=c.owner_id WHERE c.id=$1 AND c.current_generation=$2 AND c.application_id=$3 AND c.tenant_id=$4 AND c.owner_id=$5 AND c.active AND g.account_id=$6 AND g.channel=$7 AND g.platform=$8 AND g.backend='unipile' AND g.integration_id=$9 AND g.provider_configuration_reference=$10 AND g.provider_api_version='v1' AND g.authority='service' AND p.verified_at<=clock_timestamp() AND a.revoked_at IS NULL AND a.expires_at>clock_timestamp() FOR SHARE OF c,g,p,a`, [b.connectionId, b.generation, b.applicationId, b.tenantId, b.ownerId, b.accountId, b.channel, b.platform, integration, config]); if (rows.rows.length !== 1 || rows.rows[0].provider_account_digest !== digest(provider, rows.rows[0].provider_account_key_version as string))
        fail(); }
    async function finalGrant(c: SqlClient, b: ConnectionBinding) { const result = await c.query('SELECT true AS allowed FROM communications.access_grants WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND revoked_at IS NULL AND expires_at>clock_timestamp()', [b.applicationId, b.tenantId, b.ownerId]); if (result.rows.length !== 1 || result.rows[0].allowed !== true)
        fail(); }
    async function locked(c: SqlClient, record: ProviderSpoolClaim) { const row = await c.query("SELECT w.* FROM communications.provider_webhook_spool w WHERE id=$1 AND integration_id=$2 AND provider_configuration_reference=$3 AND state='processing' AND claim_token=$4 AND claim_until>clock_timestamp() AND expires_at>clock_timestamp() FOR UPDATE", [record.id, integration, config, record.token]); if (row.rows.length !== 1)
        fail(); const payload = read(row.rows[0]); if (payload.providerAccountId !== record.providerAccountId || payload.receivedAt !== record.receivedAt || !Buffer.from(payload.rawBody).equals(record.rawBody) || record.binding && (row.rows[0].bound_connection_id !== record.binding.connectionId || row.rows[0].bound_generation !== record.binding.generation))
        fail(); return row.rows[0]; }
    // Routes are immutable and grant no UPDATE privilege required for row locks.
    // Lock the mutable inbox while checking the exact retained route and ciphertext.
    // Scoped ingestion may occur later; both encrypted receipts retain the exact
    // original ingress time, while the inbox row records its own DB ingestion time.
    async function scopedProof(c: SqlClient, record: ProviderReceiptPayload, b: ConnectionBinding, key: string) { const selected = await c.query(`SELECT w.encrypted_payload,w.key_version,w.payload_digest,w.received_at FROM communications.webhook_inbox w JOIN communications.webhook_receipt_routes r ON r.webhook_inbox_id=w.id WHERE w.id=$1 AND w.dedupe_key=$1 AND w.integration_id=$2 AND w.backend='unipile' AND r.connection_id=$3 AND r.generation=$4 AND r.application_id=$5 AND r.tenant_id=$6 AND r.owner_id=$7 AND r.account_id=$8 FOR SHARE OF w`, [key, integration, b.connectionId, b.generation, b.applicationId, b.tenantId, b.ownerId, b.accountId]); if (selected.rows.length !== 1)
        fail(); const row = selected.rows[0], e = JSON.parse(row.encrypted_payload as string), s = { binding: b, key }; if (e.keyVersion !== row.key_version)
        fail(); const payload = decodeCapture(s, e); assertSameBinding(b, payload.binding); if (payload.key !== key || payload.receivedAt !== record.receivedAt || Date.parse(date(row.received_at)) < Date.parse(record.receivedAt) || !Buffer.from(payload.rawBody).equals(record.rawBody) || digestCapture(s, payload.rawBody, row.key_version as string) !== row.payload_digest)
        fail(); }
    return {
        async capture(input) {
            let bytes: Buffer, headers: string[], provider: string;
            try {
                const raw = object(input, ['rawHeaders', 'rawBody']);
                if (!Array.isArray(raw.rawHeaders) || types.isProxy(raw.rawHeaders) || raw.rawHeaders.length > 100)
                    fail();
                const d = Object.getOwnPropertyDescriptors(raw.rawHeaders);
                if (Reflect.ownKeys(d).some(k => typeof k !== 'string' || !('value' in d[k])))
                    fail();
                headers = [...raw.rawHeaders];
                if (headers.some(h => typeof observe(h) !== 'string' || h.length > 8192 || /[\r\n\0]/.test(h)))
                    fail();
                if (authenticate(headers) !== true)
                    return { status: 'rejected', code: 'unauthorized' };
                if (!types.isUint8Array(raw.rawBody) || types.isProxy(raw.rawBody))
                    fail();
                if (raw.rawBody.byteLength > 262144)
                    return { status: 'rejected', code: 'too_large' };
                bytes = Buffer.from(raw.rawBody as Uint8Array);
                const parsed = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(bytes));
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                    fail();
                provider = parsed.AccountStatus?.account_id ?? parsed.account_id;
                if (!id(provider, 2048))
                    fail();
            }
            catch {
                return { status: 'rejected', code: 'invalid_request' };
            }
            try {
                return await tx(async (c) => { const key = receiptId({ ...scope(''), providerAccountId: provider, rawBody: bytes }), candidates = versions.map(v => digest(provider, v)); const owners = await c.query(`SELECT c.application_id,c.tenant_id FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation WHERE c.active AND g.backend='unipile' AND g.integration_id=$1 AND g.provider_configuration_reference=$2 AND g.provider_account_digest=ANY($3::text[]) ORDER BY c.application_id,c.tenant_id`, [integration, config, candidates]); for (const row of owners.rows)
                    await c.query('SELECT communications.lock_reply_barrier($1,$2)', [row.application_id, row.tenant_id]); await c.query("SELECT pg_advisory_xact_lock(hashtextextended(jsonb_build_array('provider-webhook-spool',$1::text,$2::text)::text,0))", [integration, config]); const duplicate = await c.query("SELECT w.*,(expires_at>clock_timestamp()) AS alive FROM communications.provider_webhook_spool w WHERE id=$1 FOR UPDATE", [key]); if (duplicate.rows.length) {
                    if (duplicate.rows.length !== 1)
                        fail();
                    const original = read(duplicate.rows[0]);
                    if (original.providerAccountId !== provider || !Buffer.from(original.rawBody).equals(bytes) || duplicate.rows[0].state === 'review' || duplicate.rows[0].state !== 'routed' && duplicate.rows[0].alive !== true)
                        fail();
                    return { status: 'duplicate' as const };
                } const count = await c.query("SELECT count(*)::integer AS pending FROM communications.provider_webhook_spool WHERE integration_id=$1 AND provider_configuration_reference=$2 AND state IN('pending','processing') AND expires_at>clock_timestamp()", [integration, config]); if (count.rows.length !== 1 || typeof count.rows[0].pending !== 'number' || count.rows[0].pending >= max)
                    fail(); const now = await c.query('SELECT clock_timestamp() AS received_at'), receivedAt = date(now.rows[0]?.received_at); const sealed = seal(scope(key), { providerAccountId: provider, rawBody: bytes, receivedAt }); const inserted = await c.query(`INSERT INTO communications.provider_webhook_spool(id,integration_id,provider_configuration_reference,encrypted_receipt,key_version,payload_digest,received_at,expires_at,provider_account_digests) VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,$7::timestamptz+($8::double precision*interval '1 second'),$9::text[]) RETURNING id`, [key, integration, config, sealed.encrypted, sealed.keyVersion, sealed.digest, receivedAt, ttl, candidates]); if (inserted.rows.length !== 1 || inserted.rows[0].id !== key)
                    fail(); return { status: 'accepted' as const }; });
            }
            catch {
                return { status: 'retry' };
            }
        },
        async claim() { return tx(async (c) => { await c.query("UPDATE communications.provider_webhook_spool SET state='review',claim_token=NULL,claim_until=NULL WHERE integration_id=$1 AND provider_configuration_reference=$2 AND state IN('pending','processing') AND expires_at<=clock_timestamp()", [integration, config]); const token = randomBytes(32).toString('base64url'); const r = await c.query(`WITH picked AS(SELECT id FROM communications.provider_webhook_spool WHERE integration_id=$1 AND provider_configuration_reference=$2 AND expires_at>clock_timestamp() AND (state='pending' AND (retry_at IS NULL OR retry_at<=clock_timestamp()) OR state='processing' AND claim_until<=clock_timestamp()) ORDER BY received_at,id FOR UPDATE SKIP LOCKED LIMIT 1), leased AS(UPDATE communications.provider_webhook_spool w SET state='processing',claim_token=$3,claim_until=LEAST(expires_at,clock_timestamp()+interval '30 seconds'),retry_at=NULL FROM picked WHERE w.id=picked.id RETURNING w.*) SELECT ${columns} FROM leased w LEFT JOIN communications.connection_generations g ON g.connection_id=w.bound_connection_id AND g.generation=w.bound_generation`, [integration, config, token]); if (r.rows.length > 1)
            fail(); return r.rows.length ? claimRow(r.rows[0]) : null; }); },
        async pendingScoped() { return tx(async (c) => { const rows = await c.query(`SELECT w.scoped_receipt_key,g.connection_id,g.generation,g.application_id,g.tenant_id,g.owner_id,g.account_id,g.channel,g.platform,g.backend FROM communications.provider_webhook_spool w JOIN communications.connection_generations g ON g.connection_id=w.bound_connection_id AND g.generation=w.bound_generation JOIN communications.webhook_inbox i ON i.id=w.scoped_receipt_key WHERE w.integration_id=$1 AND w.provider_configuration_reference=$2 AND w.state='routed' AND i.expires_at>clock_timestamp() AND (i.state='pending' OR i.state='processing' AND i.lease_until<=clock_timestamp()) ORDER BY w.received_at LIMIT 20`, [integration, config]); return rows.rows.map(r => ({ binding: binding({ applicationId: r.application_id, tenantId: r.tenant_id, ownerId: r.owner_id, connectionId: r.connection_id, accountId: r.account_id, generation: r.generation, channel: r.channel, platform: r.platform, backend: r.backend }), key: r.scoped_receipt_key as string })); }); },
        async complete(input, key) { const r = claimed(input); if (!r.binding || !/^[a-f0-9]{64}$/.test(key))
            fail(); await tx(async (c) => { await pinAuthority(c, r.binding!, r.providerAccountId); await locked(c, r); await scopedProof(c, r, r.binding!, key); const changed = await c.query("UPDATE communications.provider_webhook_spool SET state='routed',scoped_receipt_key=$3,claim_token=NULL,claim_until=NULL,retry_at=NULL WHERE id=$1 AND claim_token=$2 AND state='processing' AND claim_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id", [r.id, r.token, key]); if (changed.rows.length !== 1)
            fail(); await finalGrant(c, r.binding!); }); },
        async defer(input) { const r = claimed(input); await tx(async (c) => { await locked(c, r); await c.query("UPDATE communications.provider_webhook_spool SET state='pending',claim_token=NULL,claim_until=NULL,retry_at=clock_timestamp()+interval '1 second' WHERE id=$1 AND state='processing' AND claim_token=$2 AND claim_until>clock_timestamp() AND expires_at>clock_timestamp()", [r.id, r.token]); }); },
        async proveRouted(input) { const r = { binding: binding(input.binding), key: input.key, rawBody: Buffer.from(input.rawBody), receivedAt: input.receivedAt }; try {
            return await tx(async (c) => { const rows = await c.query("SELECT w.* FROM communications.provider_webhook_spool w WHERE state='routed' AND scoped_receipt_key=$1 AND bound_connection_id=$2 AND bound_generation=$3 AND integration_id=$4 AND provider_configuration_reference=$5", [r.key, r.binding.connectionId, r.binding.generation, integration, config]); if (rows.rows.length !== 1)
                fail(); const payload = read(rows.rows[0]); if (payload.receivedAt !== r.receivedAt || !Buffer.from(payload.rawBody).equals(r.rawBody))
                fail(); await pinAuthority(c, r.binding, payload.providerAccountId); await scopedProof(c, payload, r.binding, r.key); await finalGrant(c, r.binding); return true; });
        }
        catch {
            return false;
        } },
        async blocked(input) { const b = binding(input); if (b.applicationId !== app)
            fail(); return tx(async (c) => { const rows = await c.query("SELECT EXISTS(SELECT 1 FROM communications.provider_webhook_spool WHERE bound_connection_id=$1 AND bound_generation=$2 AND state<>'routed') AS blocked", [b.connectionId, b.generation]); await finalGrant(c, b); return rows.rows.length !== 1 || rows.rows[0].blocked !== false; }); }
    };
}
