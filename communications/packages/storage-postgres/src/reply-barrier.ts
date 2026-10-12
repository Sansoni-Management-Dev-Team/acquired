import { createHash, timingSafeEqual } from 'node:crypto';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding } from '../../contracts/src';
import { parseEventPayload } from '../../core/src/event-codec';
import type { WebhookCapture } from '../../core/src/reply-ingress';
import type { SqlClient, WebhookRepositoryCodec, WebhookEventRepositoryCodec } from './webhook-repository';
export type ServiceReplyReviewCode = 'protocol' | 'account_changed' | 'identity_pending';
export interface ReplyBarrierOptions {
    binding: ConnectionBinding;
    integrationId: string;
    codec: WebhookRepositoryCodec;
    eventCodec?: WebhookEventRepositoryCodec;
}
export interface PostgresReplyBarrier {
    lock(client: SqlClient, applicationId: string, tenantId: string): Promise<void>;
    route(client: SqlClient, capture: WebhookCapture): Promise<{
        revision: string;
    }>;
    review(client: SqlClient, input: {
        eventId: string;
        code: ServiceReplyReviewCode;
    }): Promise<void>;
}
const fields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'] as const;
function fail(): never {
    throw Error('Reply barrier unavailable');
}
function record(v: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    if (!v || typeof v !== 'object' || Array.isArray(v) || types.isProxy(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        fail();
    const d = Object.getOwnPropertyDescriptors(v), out: Record<string, unknown> = {};
    if (required.some(k => !Object.hasOwn(d, k)) || Reflect.ownKeys(d).some(k => typeof k !== 'string' || ![...required, ...optional].includes(k) || !('value' in d[k]) || !d[k].enumerable))
        fail();
    for (const k of Object.keys(d))
        out[k] = d[k].value;
    return out;
}
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function boundBinding(v: unknown): ConnectionBinding {
    const raw = record(v, fields);
    for (const k of fields)
        if (k !== 'generation' && !id(raw[k]))
            fail();
    if (!Number.isInteger(raw.generation) || Number(raw.generation) < 1 || Number(raw.generation) > 2147483647)
        fail();
    const out = Object.fromEntries(fields.map(k => [k, raw[k]])) as unknown as ConnectionBinding;
    assertSameBinding(out, out);
    return out;
}
function integer(v: unknown, positive = false): string {
    if (typeof v !== 'string' || !(/^(0|[1-9][0-9]*)$/.test(v)) || v.length > 19 || BigInt(v) > BigInt('9223372036854775807') || positive && v === '0')
        fail();
    return v;
}
function transactionId(v: unknown): string {
    if (typeof v !== 'string' || !(/^[1-9][0-9]{0,19}$/.test(v)) || BigInt(v) > BigInt('18446744073709551615'))
        fail();
    return v;
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function timestamp(v: unknown): v is string {
    return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
}
/** Database-only helpers inside a caller-owned transaction. Authentication, current grants,
 * generation admission and the surrounding atomic capture/event/outbox commit remain mandatory.
 * Lock is tenant-first, and transaction identity is checked before work-row mutations. No schema,
 * transaction ownership, send readiness, coverage, app hold, provider I/O or fallback is provided.
 * Lock-cache checks cover ordinary transaction/client reuse; callers must not roll back the lock
 * to a savepoint or expose arbitrary SQL between these helpers. */
export function createPostgresReplyBarrier(options: ReplyBarrierOptions): PostgresReplyBarrier {
    let binding: ConnectionBinding;
    let integrationId: string;
    try {
        const raw = record(options, ['binding', 'integrationId', 'codec'], ['eventCodec']);
        binding = boundBinding(raw.binding);
        if (!id(raw.integrationId) || typeof options.codec?.decode !== 'function' || typeof options.codec?.digest !== 'function' || options.eventCodec !== undefined && typeof options.eventCodec?.decode !== 'function')
            fail();
        integrationId = raw.integrationId;
    }
    catch {
        throw Error('Invalid reply barrier configuration');
    }
    const decode = options.codec.decode.bind(options.codec), digest = options.codec.digest.bind(options.codec), decodeEvent = options.eventCodec?.decode.bind(options.eventCodec), scope = fields.map(k => binding[k]);
    const held = new WeakMap<SqlClient, {
        transaction: string;
        revision: string;
    }>();
    async function authority(client: SqlClient): Promise<string> {
        const result = await client.query(`SELECT current_user AS role_name,r.rolsuper,r.rolbypassrls,r.rolcanlogin,pg_current_xact_id()::text AS transaction_id FROM pg_roles r WHERE r.rolname=current_user`);
        if (result.rows.length !== 1 || result.rows[0].role_name !== 'communications_control' || result.rows[0].rolsuper !== false || result.rows[0].rolbypassrls !== false || result.rows[0].rolcanlogin !== false)
            fail();
        return transactionId(result.rows[0].transaction_id);
    }
    async function locked(client: SqlClient) {
        const previous = held.get(client);
        if (!previous)
            fail();
        if (await authority(client) !== previous.transaction)
            fail();
        return previous;
    }
    function capture(input: unknown): WebhookCapture {
        const raw = record(input, ['binding', 'key', 'rawBody', 'receivedAt']), b = boundBinding(raw.binding);
        assertSameBinding(binding, b);
        if (!hex(raw.key) || !timestamp(raw.receivedAt) || !types.isUint8Array(raw.rawBody) || types.isProxy(raw.rawBody) || ![Uint8Array.prototype, Buffer.prototype].includes(Object.getPrototypeOf(raw.rawBody)))
            fail();
        const byteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength')!.get!.call(raw.rawBody) as number;
        if (byteLength < 1 || byteLength > 1048576 || Reflect.ownKeys(raw.rawBody).some(k => typeof k !== 'string' || !/^(0|[1-9]\d*)$/.test(k)))
            fail();
        const body = new Uint8Array(Buffer.from(raw.rawBody));
        if (raw.key !== hash(['communications.webhook.receipt.v1', scope, createHash('sha256').update(body).digest('hex')]))
            fail();
        return {
            binding: b, key: raw.key, rawBody: body, receivedAt: raw.receivedAt
        };
    }
    function scopeRow(row: Record<string, unknown>) {
        if (row.connection_id !== binding.connectionId || row.application_id !== binding.applicationId || row.tenant_id !== binding.tenantId || row.owner_id !== binding.ownerId || row.account_id !== binding.accountId || row.generation !== binding.generation)
            fail();
    }
    return {
        async lock(client, applicationId, tenantId) {
            try {
                if (applicationId !== binding.applicationId || tenantId !== binding.tenantId)
                    fail();
                const tx = await authority(client), result = await client.query(`SELECT communications.lock_reply_barrier($1,$2)::text AS revision,pg_current_xact_id()::text AS transaction_id`, [binding.applicationId, binding.tenantId]);
                if (result.rows.length !== 1 || transactionId(result.rows[0].transaction_id) !== tx)
                    fail();
                held.set(client, {
                    transaction: tx, revision: integer(result.rows[0].revision)
                });
            }
            catch {
                held.delete(client);
                return fail();
            }
        },
        async route(client, input) {
            try {
                const original = capture(input), lock = await locked(client);
                const selected = await client.query(`SELECT w.id,w.backend,w.integration_id,w.dedupe_key,w.payload_digest,w.encrypted_payload,w.key_version,
 g.connection_id,g.generation,g.application_id,g.tenant_id,g.owner_id,g.account_id,g.channel,g.platform,g.backend AS generation_backend,g.integration_id AS generation_integration_id
 FROM communications.webhook_inbox w JOIN communications.connection_generations g ON g.connection_id=$2 AND g.generation=$3
 WHERE w.id=$1 AND g.application_id=$4 AND g.tenant_id=$5 AND g.owner_id=$6 AND g.account_id=$7 FOR SHARE OF w,g`, [original.key, binding.connectionId, binding.generation, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId]);
                if (selected.rows.length !== 1)
                    fail();
                const row = selected.rows[0];
                scopeRow(row);
                if (row.id !== original.key || row.dedupe_key !== original.key || row.backend !== binding.backend || row.integration_id !== integrationId || row.generation_backend !== binding.backend || row.generation_integration_id !== integrationId || row.channel !== binding.channel || row.platform !== binding.platform || !hex(row.payload_digest) || !id(row.key_version, 64) || typeof row.encrypted_payload !== 'string' || row.encrypted_payload.length > 2200000)
                    fail();
                const envelope = record(JSON.parse(row.encrypted_payload), ['format', 'keyVersion', 'nonce', 'ciphertext', 'tag']);
                if (envelope.format !== 'communications-webhook-v1' || envelope.keyVersion !== row.key_version)
                    fail();
                const decoded = capture(decode({
                    binding: structuredClone(binding), key: original.key
                }, envelope));
                if (decoded.key !== original.key || decoded.receivedAt !== original.receivedAt || !Buffer.from(decoded.rawBody).equals(Buffer.from(original.rawBody)))
                    fail();
                const proof = digest({
                    binding: structuredClone(binding), key: original.key
                }, new Uint8Array(decoded.rawBody), row.key_version);
                if (!hex(proof) || !timingSafeEqual(Buffer.from(proof, 'hex'), Buffer.from(row.payload_digest, 'hex')))
                    fail();
                await client.query(`INSERT INTO communications.webhook_receipt_routes(webhook_inbox_id,application_id,tenant_id,owner_id,connection_id,generation,account_id,capture_revision)
 VALUES($1,$2,$3,$4,$5,$6,$7,1) ON CONFLICT(webhook_inbox_id) DO NOTHING`, [original.key, binding.applicationId, binding.tenantId, binding.ownerId, binding.connectionId, binding.generation, binding.accountId]);
                const result = await client.query(`SELECT r.webhook_inbox_id,r.application_id,r.tenant_id,r.owner_id,r.connection_id,r.generation,r.account_id,r.capture_revision::text AS capture_revision,b.revision::text AS tenant_revision
 FROM communications.webhook_receipt_routes r JOIN communications.tenant_reply_barriers b ON b.application_id=r.application_id AND b.tenant_id=r.tenant_id WHERE r.webhook_inbox_id=$1`, [original.key]);
                if (result.rows.length !== 1)
                    fail();
                const routed = result.rows[0];
                scopeRow(routed);
                if (routed.webhook_inbox_id !== original.key)
                    fail();
                const revision = integer(routed.capture_revision, true), tenantRevision = integer(routed.tenant_revision);
                if (BigInt(revision) > BigInt(tenantRevision) || BigInt(tenantRevision) < BigInt(lock.revision))
                    fail();
                held.set(client, {
                    ...lock, revision: tenantRevision
                });
                return {
                    revision
                };
            }
            catch {
                held.delete(client);
                return fail();
            }
        },
        async review(client, input) {
            try {
                const raw = record(input, ['eventId', 'code']), eid = integer(raw.eventId, true);
                if (typeof raw.code !== 'string' || !['protocol', 'account_changed', 'identity_pending'].includes(raw.code) || !decodeEvent)
                    fail();
                await locked(client);
                const selected = await client.query(`SELECT e.id::text AS id,e.application_id,e.tenant_id,e.owner_id,e.connection_id,e.generation,e.account_id,e.source_namespace,e.source_event_key,e.event_type,e.direction,e.occurred_at,e.encrypted_event,e.key_version
 FROM communications.events e WHERE e.id=$1 AND e.application_id=$2 AND e.tenant_id=$3 AND e.owner_id=$4 AND e.connection_id=$5 AND e.generation=$6 AND e.account_id=$7`, [eid, binding.applicationId, binding.tenantId, binding.ownerId, binding.connectionId, binding.generation, binding.accountId]);
                if (selected.rows.length !== 1)
                    fail();
                const row = selected.rows[0];
                scopeRow(row);
                if (row.id !== eid || row.source_namespace !== 'reply_review/v1' || !hex(row.source_event_key) || row.event_type !== 'account' || row.direction !== null || !id(row.key_version, 64) || typeof row.encrypted_event !== 'string' || row.encrypted_event.length > 2200000)
                    fail();
                const envelope = record(JSON.parse(row.encrypted_event), ['format', 'keyVersion', 'nonce', 'ciphertext', 'tag']);
                if (envelope.format !== 'communications-event-v1' || envelope.keyVersion !== row.key_version)
                    fail();
                const payload = parseEventPayload({
                    binding: structuredClone(binding), key: row.source_event_key
                }, decodeEvent({
                    binding: structuredClone(binding), key: row.source_event_key
                }, envelope));
                const occurredAt = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at;
                if (payload.outcome.kind !== 'review' || payload.outcome.code !== raw.code || payload.fingerprint !== hash(['communications.reply.review.v1', scope, row.source_event_key, raw.code]) || !timestamp(payload.receivedAt) || !timestamp(occurredAt) || payload.receivedAt !== occurredAt)
                    fail();
                await client.query(`INSERT INTO communications.reply_review_latches(event_id,application_id,tenant_id,owner_id,code) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id) DO NOTHING`, [eid, binding.applicationId, binding.tenantId, binding.ownerId, raw.code]);
                const result = await client.query(`SELECT event_id::text AS event_id,application_id,tenant_id,owner_id,code,resolved_at,resolution_reference FROM communications.reply_review_latches WHERE event_id=$1`, [eid]);
                if (result.rows.length !== 1)
                    fail();
                const latch = result.rows[0];
                if (latch.event_id !== eid || latch.application_id !== binding.applicationId || latch.tenant_id !== binding.tenantId || latch.owner_id !== binding.ownerId || latch.code !== raw.code || (latch.resolved_at === null) !== (latch.resolution_reference === null))
                    fail();
                if (latch.resolved_at !== null) {
                    const resolvedAt = latch.resolved_at instanceof Date ? latch.resolved_at.toISOString() : latch.resolved_at;
                    if (!timestamp(resolvedAt) || !id(latch.resolution_reference, 2000))
                        fail();
                }
            }
            catch {
                held.delete(client);
                return fail();
            }
        },
    };
}
