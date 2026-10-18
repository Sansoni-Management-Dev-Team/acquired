import {parseEventPayload} from '../../core/src/event-codec';
import {emailBounceSemantics} from '../../core/src/email-bounce';
import { createHash, randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding, type CommunicationEvent } from '../../contracts/src';
import type { EventPayload, EventScope } from '../../core/src/event-codec';
import type { SqlClient, SqlPool } from './webhook-repository';
import type { OutboxDelivery,ApplicationReplyReceipt } from '../../core/src/outbox-delivery';
export type { OutboxDelivery,ApplicationReplyReceipt } from '../../core/src/outbox-delivery';
export interface OutboxRepositoryOptions {
    pool: SqlPool;
    binding: ConnectionBinding;
    subscriberId: string;
    codec: {
        decode(scope: EventScope, envelope: unknown): EventPayload;
    };
    leaseSeconds?: number;
    replyBarrier?: {
        lock(client: SqlClient, applicationId: string, tenantId: string): Promise<void>;
    };
}
const bindingFields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'] as const;
function fail(): never {
    throw Error('Outbox repository unavailable');
}
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function object(input: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
    if (input === null || typeof input !== 'object' || Array.isArray(input) || types.isProxy(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input)))
        fail();
    const descriptors = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(descriptors), out: Record<string, unknown> = Object.create(null);
    if (required.some(k => !Object.hasOwn(descriptors, k)) || keys.some(k => typeof k !== 'string' || ![...required, ...optional].includes(k)))
        fail();
    for (const k of keys as string[]) {
        const d = descriptors[k];
        if (!('value' in d) || !d.enumerable)
            fail();
        out[k] = d.value;
    }
    return out;
}
function binding(input: unknown): ConnectionBinding {
    const raw = object(input, bindingFields);
    for (const k of bindingFields)
        if (k !== 'generation' && !id(raw[k]))
            fail();
    if (!Number.isInteger(raw.generation) || Number(raw.generation) < 1 || Number(raw.generation) > 2147483647)
        fail();
    const out = { applicationId:raw.applicationId,tenantId:raw.tenantId,ownerId:raw.ownerId,connectionId:raw.connectionId,accountId:raw.accountId,generation:raw.generation,channel:raw.channel,platform:raw.platform,backend:raw.backend } as ConnectionBinding;
    assertSameBinding(out, out);
    return out;
}
function same(expected: ConnectionBinding, input: unknown) {
    assertSameBinding(expected, binding(input));
}
function eventId(input: unknown): string {
    if (typeof input !== 'string' || !/^[1-9][0-9]{0,18}$/.test(input) || BigInt(input) > BigInt('9223372036854775807'))
        fail();
    return input;
}
function date(v: unknown): v is string {
    if (typeof v !== 'string')
        return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(v);
    if (!m)
        return false;
    const [y, month, d, h, min, s] = m.slice(1, 7).map(Number), z = m[7];
    return y >= 1000 && month >= 1 && month <= 12 && d >= 1 && d <= new Date(Date.UTC(y, month, 0)).getUTCDate() && h <= 23 && min <= 59 && s <= 59 && (z === 'Z' || Number(z.slice(1, 3)) <= 23 && Number(z.slice(4, 6)) <= 59) && Number.isFinite(Date.parse(v));
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const vector = (b: ConnectionBinding) => bindingFields.map(k => b[k]);
function canonicalPayload(input: unknown, b: ConnectionBinding, key: string, namespace: string): EventPayload {
    const raw = object(input, ['outcome', 'fingerprint', 'receivedAt']);
    if (!hex(raw.fingerprint) || !date(raw.receivedAt))
        fail();
    const discriminator = object(raw.outcome, ['kind'], ['event', 'eventKey', 'fingerprint', 'code']);
    if (namespace === 'reply_review/v1') {
        const outcome = object(raw.outcome, ['kind', 'code']);
        if (outcome.kind !== 'review' || typeof outcome.code !== 'string' || !['protocol', 'account_changed', 'identity_pending'].includes(outcome.code) || raw.fingerprint !== hash(['communications.reply.review.v1', vector(b), key, outcome.code]))
            fail();
        return {
            outcome: {
                kind: 'review', code: outcome.code as 'protocol' | 'account_changed' | 'identity_pending'
            }, fingerprint: raw.fingerprint, receivedAt: raw.receivedAt
        };
    }
    if(namespace==='email_bounce/v1'){const payload=parseEventPayload({binding:b,key},input);if(payload.outcome.kind!=='event'||payload.outcome.event.type!=='email_change'||payload.outcome.event.change!=='bounce')fail();const semantic=emailBounceSemantics(b,payload.outcome.event);if(semantic.eventKey!==key||semantic.fingerprint!==payload.fingerprint)fail();return payload;}
    if (namespace !== 'reply_message/v1' || discriminator.kind !== 'event')
        fail();
    const outcome = object(raw.outcome, ['kind', 'event', 'eventKey', 'fingerprint']);
    if (outcome.eventKey !== key || outcome.fingerprint !== raw.fingerprint)
        fail();
    const event = object(outcome.event, ['type', 'reference', 'direction', 'sender', 'occurredAt'], ['conversation']);
    if (event.type !== 'message' || typeof event.direction !== 'string' || !['inbound', 'outbound', 'self', 'group'].includes(event.direction) || !date(event.occurredAt) || Date.parse(event.occurredAt) > Date.parse(raw.receivedAt))
        fail();
    const ref = (v: unknown) => {
        const r = object(v, ['binding', 'id']);
        same(b, r.binding);
        if (!id(r.id, 2048) || r.id === '.' || r.id === '..')
            fail();
        return {
            binding: binding(r.binding), id: r.id
        };
    };
    const reference = ref(event.reference), conversation = Object.hasOwn(event, 'conversation') ? ref(event.conversation) : undefined, sender = object(event.sender, ['kind', 'value']);
    if (!id(sender.value, 2048))
        fail();
    if (b.channel === 'whatsapp') {
        if (sender.kind !== 'phone' || !/^\+[1-9]\d{6,14}$/.test(sender.value))
            fail();
    }
    else if (b.channel === 'email') {
        if (sender.kind !== 'email' || sender.value !== sender.value.toLowerCase() || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(sender.value))
            fail();
    }
    else {
        if (sender.kind !== 'linkedin_profile')
            fail();
        const u = new URL(sender.value);
        if (u.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(u.hostname) || !/^\/in\/[^/]+\/?$/.test(u.pathname) || u.username || u.password || u.port || u.search || u.hash)
            fail();
    }
    const message = {
        type: 'message', reference, ...(conversation ? {
            conversation
        } : {}), direction: event.direction, sender: {
            kind: sender.kind, value: sender.value
        }, occurredAt: event.occurredAt
    } as Extract<CommunicationEvent, {
        type: 'message';
    }>;
    if (key !== hash(['communications.reply.event.v1', vector(b), conversation?.id ?? null, reference.id]) || raw.fingerprint !== hash(['communications.reply.content.v1', vector(b), reference.id, conversation?.id ?? null, message.direction, sender.kind, sender.value, new Date(message.occurredAt).toISOString()]))
        fail();
    return {
        outcome: {
            kind: 'event', event: message, eventKey: key, fingerprint: raw.fingerprint
        }, fingerprint: raw.fingerprint, receivedAt: raw.receivedAt
    };
}
const SCOPE_SQL = `SELECT c.id AS connection_id,g.application_id,g.tenant_id,g.owner_id,g.account_id,g.generation,g.channel,g.platform,g.backend,
 (ag.revoked_at IS NULL AND ag.expires_at>clock_timestamp()) AS grant_valid
 FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id
 JOIN communications.access_grants ag ON ag.application_id=g.application_id AND ag.tenant_id=g.tenant_id AND ag.owner_id=g.owner_id
 WHERE g.application_id=$1 AND g.tenant_id=$2 AND g.owner_id=$3 AND g.connection_id=$4 AND g.account_id=$5
 AND g.generation=$6 AND g.channel=$7 AND g.platform=$8 AND g.backend=$9
 AND ag.revoked_at IS NULL AND ag.expires_at>clock_timestamp() FOR SHARE OF c,g,ag`;
const COLUMNS = `o.event_id::text AS event_id,o.subscriber_id,o.application_id AS outbox_application_id,o.tenant_id AS outbox_tenant_id,o.owner_id AS outbox_owner_id,
 o.state,o.lease_token,(o.lease_until>clock_timestamp()) AS lease_valid,
 e.application_id,e.tenant_id,e.owner_id,e.connection_id,e.generation,e.account_id,e.source_namespace,e.source_event_key,e.event_type,e.direction,e.occurred_at,e.encrypted_event,e.key_version`;
/** Durable service subscriber leases/ACK only. An application receipt is a trusted authenticated
 * boundary attestation: this repository cannot prove a separate database commit. It embeds no app
 * hold/person policy or provider callback. Historical accepted generations are delivered unchanged.
 * 001/002-only execution is a fixture prerequisite, not activation; installed003 requires an explicit
 * tenant-first DB fence port before any connection/grant/work-row lock. No migrations run here. */
export function createPostgresOutboxRepository(options: OutboxRepositoryOptions): {
    claim(): Promise<{
        kind: 'claimed';
        delivery: OutboxDelivery;
    } | {
        kind: 'busy' | 'forbidden';
    }>;
    acknowledge(input: {
        delivery: OutboxDelivery;
        receipt: ApplicationReplyReceipt;
    }): Promise<{
        status: 'acknowledged' | 'duplicate' | 'rejected';
    }>;
} {
    let fixed: ConnectionBinding;
    let subscriberId: string;
    let leaseSeconds: number;
    try {
        const config = object(options, ['pool', 'binding', 'subscriberId', 'codec'], ['leaseSeconds', 'replyBarrier']);
        fixed = binding(config.binding);
        if (fixed.backend !== 'unipile' || !id(config.subscriberId) || !Number.isInteger(config.leaseSeconds ?? 60) || Number(config.leaseSeconds ?? 60) < 1 || Number(config.leaseSeconds ?? 60) > 3600)
            fail();
        subscriberId = config.subscriberId;
        leaseSeconds = Number(config.leaseSeconds ?? 60);
        if (typeof options.pool?.connect !== 'function' || typeof options.codec?.decode !== 'function' || options.replyBarrier !== undefined && typeof options.replyBarrier?.lock !== 'function')
            fail();
    }
    catch {
        throw Error('Invalid outbox repository configuration');
    }
    const connect = options.pool.connect.bind(options.pool), decode = options.codec.decode.bind(options.codec), fence = options.replyBarrier?.lock.bind(options.replyBarrier), scopeValues = vector(fixed);
    async function originalScope(client: SqlClient): Promise<boolean> {
        const result = await client.query(SCOPE_SQL, [...scopeValues]);
        if (result.rows.length !== 1)
            return false;
        const r = result.rows[0];
        return r.connection_id === fixed.connectionId && r.application_id === fixed.applicationId && r.tenant_id === fixed.tenantId && r.owner_id === fixed.ownerId && r.account_id === fixed.accountId && r.generation === fixed.generation && r.channel === fixed.channel && r.platform === fixed.platform && r.backend === fixed.backend && r.grant_valid === true;
    }
    async function transaction<T>(operation: (client: SqlClient) => Promise<T>): Promise<T> {
        let client: SqlClient | undefined, discard: Error | undefined, attempted = false;
        try {
            client = await connect();
            const query = client.query.bind(client), wrapped: SqlClient = {
                async query<Row>(sql: string, values?: unknown[]) {
                    if (sql === 'COMMIT')
                        attempted = true;
                    return query<Row>(sql, values);
                }, release() {
                }
            };
            await wrapped.query('BEGIN');
            await wrapped.query('SET LOCAL ROLE communications_control');
            await wrapped.query("SET LOCAL lock_timeout='5s'");
            await wrapped.query("SET LOCAL statement_timeout='15s'");
            const role = await wrapped.query('SELECT current_user AS role_name,r.rolsuper,r.rolbypassrls,r.rolcanlogin FROM pg_roles r WHERE r.rolname=current_user');
            if (role.rows.length !== 1 || role.rows[0].role_name !== 'communications_control' || role.rows[0].rolsuper !== false || role.rows[0].rolbypassrls !== false || role.rows[0].rolcanlogin !== false)
                fail();
            const installed = await wrapped.query("SELECT to_regclass('communications.tenant_reply_barriers') IS NOT NULL AS barrier");
            if (installed.rows.length !== 1 || typeof installed.rows[0].barrier !== 'boolean')
                fail();
            if (installed.rows[0].barrier === true && !fence)
                fail();
            if (fence)
                await fence(wrapped, fixed.applicationId, fixed.tenantId);
            return await operation(wrapped);
        }
        catch (error) {
            if (attempted || error && typeof error === 'object' && 'code' in error && ['08000', '08003', '08006', '08001', '08004', '08007', '08P01', '57P01', '57P02', '57P03', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(String(error.code)))
                discard = Error('Outbox database session unavailable');
            if (client)
                try {
                    await client.query('ROLLBACK');
                }
                catch {
                    discard = Error('Outbox database session unavailable');
                }
            return fail();
        }
        finally {
            if (client)
                try {
                    client.release(discard);
                }
                catch { /* Sanitized outcome owns session lifecycle. */
                }
        }
    }
    function open(row: Record<string, unknown>): OutboxDelivery {
        const eid = eventId(row.event_id);
        if (row.subscriber_id !== subscriberId || row.outbox_application_id !== fixed.applicationId || row.outbox_tenant_id !== fixed.tenantId || row.outbox_owner_id !== fixed.ownerId || row.application_id !== fixed.applicationId || row.tenant_id !== fixed.tenantId || row.owner_id !== fixed.ownerId || row.connection_id !== fixed.connectionId || row.generation !== fixed.generation || row.account_id !== fixed.accountId || !hex(row.source_event_key) || typeof row.source_namespace !== 'string' || !['reply_message/v1', 'reply_review/v1','email_bounce/v1'].includes(row.source_namespace) || !id(row.key_version, 64) || typeof row.encrypted_event !== 'string' || row.encrypted_event.length > 2200000)
            fail();
        const envelope = object(JSON.parse(row.encrypted_event), ['format', 'keyVersion', 'nonce', 'ciphertext', 'tag']);
        if (envelope.format !== 'communications-event-v1' || envelope.keyVersion !== row.key_version)
            fail();
        const payload = canonicalPayload(decode({
            binding: structuredClone(fixed), key: row.source_event_key
        }, envelope), fixed, row.source_event_key, String(row.source_namespace));
        const occurredAt = row.occurred_at instanceof Date ? row.occurred_at.toISOString() : row.occurred_at;
        if (!date(occurredAt))
            fail();
        if (payload.outcome.kind === 'event') {
            if(payload.outcome.event.type==='email_change'&&payload.outcome.event.change==='bounce'){if(row.event_type!=='email_change'||row.direction!==null||Date.parse(occurredAt)!==Date.parse(payload.outcome.event.occurredAt))fail();}
            else if (payload.outcome.event.type !== 'message' || row.event_type !== 'message' || row.direction !== payload.outcome.event.direction || Date.parse(occurredAt) !== Date.parse(payload.outcome.event.occurredAt))
                fail();
        }
        else if (row.event_type !== 'account' || row.direction !== null || Date.parse(occurredAt) !== Date.parse(payload.receivedAt))
            fail();
        return {
            binding: structuredClone(fixed), subscriberId, eventId: eid, sourceNamespace: String(row.source_namespace), sourceEventKey: row.source_event_key, payload, token: ''
        };
    }
    function delivery(input: unknown): OutboxDelivery {
        const raw = object(input, ['binding', 'subscriberId', 'eventId', 'sourceNamespace', 'sourceEventKey', 'payload', 'token']);
        same(fixed, raw.binding);
        if (raw.subscriberId !== subscriberId || !hex(raw.sourceEventKey) || typeof raw.sourceNamespace !== 'string' || !id(raw.token))
            fail();
        return {
            binding: structuredClone(fixed), subscriberId, eventId: eventId(raw.eventId), sourceNamespace: String(raw.sourceNamespace), sourceEventKey: raw.sourceEventKey, payload: canonicalPayload(raw.payload, fixed, raw.sourceEventKey, String(raw.sourceNamespace)), token: raw.token
        };
    }
    return {
        async claim() {
            return transaction(async (client) => {
                if (!await originalScope(client)) {
                    await client.query('ROLLBACK');
                    return {
                        kind: 'forbidden'
                    };
                }
                const selected = await client.query(`SELECT ${COLUMNS} FROM communications.event_outbox o JOIN communications.events e ON e.id=o.event_id
 WHERE e.application_id=$1 AND e.tenant_id=$2 AND e.owner_id=$3 AND e.connection_id=$4 AND e.account_id=$5 AND e.generation=$6
 AND o.subscriber_id=$7 AND (o.retry_at IS NULL OR o.retry_at<=clock_timestamp())
 AND (o.state='pending' OR (o.state='delivering' AND (o.lease_until IS NULL OR o.lease_until<=clock_timestamp()))) ORDER BY o.event_id LIMIT 1 FOR UPDATE OF o SKIP LOCKED`, [...scopeValues.slice(0, 6), subscriberId]);
                if (selected.rows.length === 0) {
                    await client.query('COMMIT');
                    return {
                        kind: 'busy'
                    };
                }
                if (selected.rows.length !== 1)
                    fail();
                const result = open(selected.rows[0]), token = randomBytes(32).toString('base64url');
                const updated = await client.query(`UPDATE communications.event_outbox SET state='delivering',attempts=attempts+1,lease_token=$6,lease_until=clock_timestamp()+($7::double precision*interval '1 second'),failure_code=NULL
 WHERE event_id=$1 AND subscriber_id=$2 AND application_id=$3 AND tenant_id=$4 AND owner_id=$5
 AND (retry_at IS NULL OR retry_at<=clock_timestamp()) AND (state='pending' OR (state='delivering' AND (lease_until IS NULL OR lease_until<=clock_timestamp()))) RETURNING event_id::text`, [result.eventId, subscriberId, fixed.applicationId, fixed.tenantId, fixed.ownerId, token, leaseSeconds]);
                if (updated.rows.length !== 1 || updated.rows[0].event_id !== result.eventId || !await originalScope(client))
                    fail();
                await client.query('COMMIT');
                return {
                    kind: 'claimed', delivery: {
                        ...result, token
                    }
                };
            });
        },
        async acknowledge(input) {
            let supplied: OutboxDelivery;
            try {
                const raw = object(input, ['delivery', 'receipt']);
                supplied = delivery(raw.delivery);
                const receipt = object(raw.receipt, ['binding', 'subscriberId', 'eventId', 'fingerprint', 'status']);
                same(fixed, receipt.binding);
                if (receipt.subscriberId !== subscriberId || receipt.eventId !== supplied.eventId || receipt.fingerprint !== supplied.payload.fingerprint || typeof receipt.status !== 'string' || !['committed', 'duplicate'].includes(receipt.status))
                    fail();
            }
            catch {
                return {
                    status: 'rejected'
                };
            }
            return transaction(async (client) => {
                if (!await originalScope(client)) {
                    await client.query('ROLLBACK');
                    return {
                        status: 'rejected'
                    };
                }
                const selected = await client.query(`SELECT ${COLUMNS} FROM communications.event_outbox o JOIN communications.events e ON e.id=o.event_id WHERE o.event_id=$1 AND o.subscriber_id=$2 FOR UPDATE OF o`, [supplied.eventId, subscriberId]);
                if (selected.rows.length !== 1) {
                    await client.query('ROLLBACK');
                    return {
                        status: 'rejected'
                    };
                }
                const row = selected.rows[0], original = open(row);
                if (original.sourceNamespace !== supplied.sourceNamespace || original.sourceEventKey !== supplied.sourceEventKey || JSON.stringify(original.payload) !== JSON.stringify(supplied.payload) || row.lease_token !== supplied.token) {
                    await client.query('ROLLBACK');
                    return {
                        status: 'rejected'
                    };
                }
                if (row.state === 'acknowledged') {
                    if (!await originalScope(client))
                        fail();
                    await client.query('COMMIT');
                    return {
                        status: 'duplicate'
                    };
                }
                if (row.state !== 'delivering' || row.lease_valid !== true) {
                    await client.query('ROLLBACK');
                    return {
                        status: 'rejected'
                    };
                }
                // Retain original claim token/expiry as immutable terminal provenance. A duplicate ACK neither
                // renews that expired lease nor changes the acknowledged row.
                const updated = await client.query(`UPDATE communications.event_outbox SET state='acknowledged',acknowledged_at=clock_timestamp(),retry_at=NULL,failure_code=NULL
 WHERE event_id=$1 AND subscriber_id=$2 AND application_id=$3 AND tenant_id=$4 AND owner_id=$5 AND state='delivering'
 AND lease_token=$6 AND lease_until>clock_timestamp() RETURNING event_id::text`, [supplied.eventId, subscriberId, fixed.applicationId, fixed.tenantId, fixed.ownerId, supplied.token]);
                if (updated.rows.length === 0 || !await originalScope(client)) {
                    await client.query('ROLLBACK');
                    return {
                        status: 'rejected'
                    };
                }
                if (updated.rows.length !== 1 || updated.rows[0].event_id !== supplied.eventId)
                    fail();
                await client.query('COMMIT');
                return {
                    status: 'acknowledged'
                };
            });
        },
    };
}
