import { lockAcquireSendGate } from './campaign-send-gate';
import 'server-only';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import type { PoolClient } from 'pg';
import type { CampaignActor } from '@/db/campaign-client';
import { replyIdentity } from '@/domain/campaign-replies';
import { communicationReplyIdentity } from '../domain/communication-reply-identity';
import { applyCampaignReply, replyMonitorMode } from './campaign-reply-store';
import { assertSameBinding, type ConnectionBinding, type CanonicalIdentity, type CommunicationEvent } from '../../communications/packages/contracts/src';
import type { EventPayload } from '../../communications/packages/core/src/event-codec';
import type { SqlClient, SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
export interface CommunicationReplyDelivery {
    binding: ConnectionBinding;
    bindingId: string;
    subscriberId: string;
    serviceEventId: string;
    sourceKey: string;
    payload: EventPayload;
}
export interface VerifiedCampaignReplyIdentity {
    actor: CampaignActor;
    binding: ConnectionBinding;
    sender: CanonicalIdentity;
    identity: string;
    identityAuthority?: 'canonical_service';
}
export interface VerifiedUnrelatedCampaignReply {
    kind: 'unrelated';
    proofVersion: 'acquire.reply.unrelated.v1';
    actor: CampaignActor;
    binding: ConnectionBinding;
    sender: CanonicalIdentity;
}
export interface RoleBoundUnrelatedReplyClients {
    owner: SqlClient;
    registry: SqlClient;
}
export interface CommunicationReplyConsumerOptions {
    /** release(error) must physically terminate/retire the checked-out session, as pg does. */
    pool: SqlPool;
    actor: CampaignActor;
    binding: ConnectionBinding;
    bindingId: string;
    subscriberId: string;
    authenticationTimeoutMs?: number;
    transactionTimeoutMs?: number;
    /** REQUIRED authenticated service delivery/subject/subscriber verification. No boolean field in
     * a webhook body constitutes authority. Actor/binding options come from trusted server routing. */
    authenticateDelivery(input: CommunicationReplyDelivery, signal?: AbortSignal): Promise<boolean>;
    /** REQUIRED current verified identity mapping inside the same owner transaction. LinkedIn URL
     * to legacy URN needs recorded evidence; phone/email mappings must match the canonical sender.
     * Await SQL sequentially. The callback client closes when resolution settles and rejects direct
     * transaction/role commands. SELECT/WITH can have side effects; this trusted port is not an SQL
     * sandbox. Its session is retired after invocation, including a successful commit. */
    /** Optional concrete exhaustive classifier, never a caller field or boolean. The engine
     * controls owner/worker roles on these same-TX clients and restores owner before writes. */
    resolveUnrelated?(clients: RoleBoundUnrelatedReplyClients, input: {
        actor: CampaignActor;
        binding: ConnectionBinding;
        sender: CanonicalIdentity;
    }, signal?: AbortSignal): Promise<VerifiedUnrelatedCampaignReply | null>;
    resolveIdentity(client: SqlClient, input: {
        actor: CampaignActor;
        binding: ConnectionBinding;
        sender: CanonicalIdentity;
    }, signal?: AbortSignal): Promise<VerifiedCampaignReplyIdentity | null>;
}
export type CommunicationReplyConsumption = {
    status: 'applied' | 'duplicate' | 'review';
    decision: 'stop' | 'ignore' | 'review';
};
const VERSION = 'acquire.reply.delivery.v1';
const bindingFields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'];
function fail(): never { throw new Error('Communication reply consumption unavailable'); }
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const hex = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const exact = (v: unknown, required: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> => object(v) && required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => required.includes(k) || optional.includes(k));
const same = (a: ConnectionBinding, b: unknown) => {
    try {
        if (!exact(b, bindingFields))
            return false;
        assertSameBinding(a, b as unknown as ConnectionBinding);
        return true;
    }
    catch {
        return false;
    }
};
const vector = (b: ConnectionBinding) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function snapshot(v: unknown, depth = 0): unknown {
    if (depth > 12)
        fail();
    if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v))
        return v;
    if (typeof v === 'string') {
        if (v.length > 4096)
            fail();
        return v;
    }
    if (!object(v) || types.isProxy(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
        fail();
    const result: Record<string, unknown> = {};
    const descriptors = Object.getOwnPropertyDescriptors(v);
    if (Reflect.ownKeys(descriptors).length > 32)
        fail();
    for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string' || key === '__proto__' || !('value' in descriptors[key]) || !descriptors[key].enumerable)
            fail();
        result[key] = snapshot(descriptors[key].value, depth + 1);
    }
    return result;
}
function date(v: unknown): v is string {
    if (typeof v !== 'string')
        return false;
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(v);
    if (!m)
        return false;
    const [y, month, d, h, min, s] = m.slice(1, 7).map(Number), zone = m[7];
    return y >= 1000 && month >= 1 && month <= 12 && d >= 1 && d <= new Date(Date.UTC(y, month, 0)).getUTCDate() && h <= 23 && min <= 59 && s <= 59 &&
        (zone === 'Z' || Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(4, 6)) <= 59) && Number.isFinite(Date.parse(v));
}
function canonicalSender(binding: ConnectionBinding, v: unknown): v is CanonicalIdentity {
    if (!exact(v, ['kind', 'value']) || !id(v.value, 2048))
        return false;
    if (binding.channel === 'email')
        return v.kind === 'email' && replyIdentity('email', v.value) === v.value;
    if (binding.channel === 'whatsapp')
        return v.kind === 'phone' && /^\+[1-9]\d{6,14}$/.test(v.value);
    if (v.kind !== 'linkedin_profile')
        return false;
    try {
        const u = new URL(v.value);
        return u.protocol === 'https:' && ['linkedin.com', 'www.linkedin.com'].includes(u.hostname) && /^\/in\/[^/]+\/?$/.test(u.pathname) && !u.username && !u.password && !u.port && !u.search && !u.hash;
    }
    catch {
        return false;
    }
}
function validateDelivery(b: ConnectionBinding, bindingId: string, subscriberId: string, v: unknown): CommunicationReplyDelivery {
    if (!exact(v, ['binding', 'bindingId', 'subscriberId', 'serviceEventId', 'sourceKey', 'payload']) || !same(b, v.binding) || v.bindingId !== bindingId || v.subscriberId !== subscriberId || !id(v.serviceEventId) || !hex(v.sourceKey))
        fail();
    const payload = v.payload;
    if (!exact(payload, ['outcome', 'fingerprint', 'receivedAt']) || !hex(payload.fingerprint) || !date(payload.receivedAt))
        fail();
    const outcome = payload.outcome;
    if (!object(outcome))
        fail();
    if (outcome.kind === 'review') {
        if (!exact(outcome, ['kind', 'code']) || typeof outcome.code !== 'string' || !['protocol', 'account_changed', 'identity_pending'].includes(outcome.code) ||
            payload.fingerprint !== hash(['communications.reply.review.v1', vector(b), v.sourceKey, outcome.code]))
            fail();
    }
    else {
        if (!exact(outcome, ['kind', 'event', 'eventKey', 'fingerprint']) || outcome.kind !== 'event' || outcome.eventKey !== v.sourceKey || outcome.fingerprint !== payload.fingerprint)
            fail();
        const e = outcome.event;
        if (!exact(e, ['type', 'reference', 'direction', 'sender', 'occurredAt'], ['conversation']) || e.type !== 'message' || !exact(e.reference, ['binding', 'id']) || !same(b, e.reference.binding) || !id(e.reference.id, 2048) ||
            typeof e.direction !== 'string' || !['inbound', 'outbound', 'self', 'group'].includes(e.direction) || !canonicalSender(b, e.sender) || !date(e.occurredAt) || Date.parse(e.occurredAt) > Date.parse(payload.receivedAt))
            fail();
        if (e.conversation !== undefined && (!exact(e.conversation, ['binding', 'id']) || !same(b, e.conversation.binding) || !id(e.conversation.id, 2048)))
            fail();
        const conversation = object(e.conversation) ? e.conversation.id : null;
        if (v.sourceKey !== hash(['communications.reply.event.v1', vector(b), conversation, e.reference.id]) ||
            payload.fingerprint !== hash(['communications.reply.content.v1', vector(b), e.reference.id, conversation, e.direction, e.sender.kind, e.sender.value, new Date(e.occurredAt).toISOString()]))
            fail();
    }
    return v as unknown as CommunicationReplyDelivery;
}
/** Prepared consumer, not wired to application routes. Requires approved 003. The returned result
 * acknowledges only this Acquire transaction; caller ACKs the service afterward with its lease.
 * Service normalization and Acquire holds are separate durable transactions. No readiness advance,
 * backend/default selection, provider action or database provisioning happens here. */
export function createCommunicationReplyConsumer(options: CommunicationReplyConsumerOptions): {
    apply(input: CommunicationReplyDelivery, signal?: AbortSignal): Promise<CommunicationReplyConsumption>;
} {
    let binding: ConnectionBinding, actor: CampaignActor, unrelated: CommunicationReplyConsumerOptions['resolveUnrelated'];
    const authenticationTimeoutMs = options.authenticationTimeoutMs ?? 3000, transactionTimeoutMs = options.transactionTimeoutMs ?? 20000;
    try {
        const classifier = options.resolveUnrelated;
        if (classifier !== undefined && typeof classifier !== 'function')
            fail();
        unrelated = classifier === undefined ? undefined : Function.prototype.bind.call(classifier, options);
        binding = snapshot(options.binding) as ConnectionBinding;
        actor = snapshot(options.actor) as CampaignActor;
        assertSameBinding(binding, binding);
        if (!same(binding, binding) || binding.applicationId !== 'acquire' || !exact(actor, ['organizationId', 'userId']) || !id(actor.organizationId) || !id(actor.userId) || binding.tenantId !== actor.organizationId || binding.ownerId !== actor.userId ||
            !uuid(options.bindingId) || !id(options.subscriberId) || typeof options.pool?.connect !== 'function' || typeof options.authenticateDelivery !== 'function' || typeof options.resolveIdentity !== 'function' ||
            !Number.isSafeInteger(authenticationTimeoutMs) || authenticationTimeoutMs < 1 || authenticationTimeoutMs > 5000 ||
            !Number.isSafeInteger(transactionTimeoutMs) || transactionTimeoutMs < 1 || transactionTimeoutMs > 25000 || authenticationTimeoutMs + transactionTimeoutMs >= 30000)
            fail();
    }
    catch {
        throw new Error('Invalid communication reply consumer configuration');
    }
    const bindingId = options.bindingId, subscriberId = options.subscriberId, connect = options.pool.connect.bind(options.pool), authenticate = options.authenticateDelivery.bind(options), resolve = options.resolveIdentity.bind(options), mode = replyMonitorMode;
    const accountIdentity = hash(['communications.account.binding.v1', vector(binding)]);
    async function authenticated(delivery: CommunicationReplyDelivery, signal?: AbortSignal): Promise<boolean> {
        const controller = new AbortController(), deadline = performance.now() + authenticationTimeoutMs;
        let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
        const live = () => {
            if (signal?.aborted || controller.signal.aborted || performance.now() >= deadline) {
                controller.abort();
                fail();
            }
        };
        try {
            live();
            const stopped = new Promise<never>((_resolve, reject) => {
                abort = () => { controller.abort(); reject(new Error('Communication reply consumption unavailable')); };
                signal?.addEventListener('abort', abort, { once: true });
                timer = setTimeout(abort, authenticationTimeoutMs);
            });
            const checked = Promise.resolve().then(async () => {
                live();
                const result = await authenticate(structuredClone(delivery), controller.signal);
                live();
                return result === true;
            });
            return await Promise.race([checked, stopped]);
        }
        finally {
            clearTimeout(timer);
            if (abort)
                signal?.removeEventListener('abort', abort);
        }
    }
    async function transaction<T>(signal: AbortSignal | undefined, work: (client: SqlClient, retireResolverSession: () => void, callbackSignal: AbortSignal) => Promise<T>): Promise<T> {
        let client: SqlClient | undefined, released = false, timedOut = false, resolverUsed = false, commitAttempted = false, inFlight = 0, discard = false;
        const controller = new AbortController(), deadline = performance.now() + transactionTimeoutMs;
        const dispose = () => {
            if (!client || released)
                return;
            released = true;
            try {
                if (discard || timedOut || resolverUsed)
                    client.release(new Error('Reply consumer session unavailable'));
                else
                    client.release();
            }
            catch { /* The injected driver owns physical retirement; never leak session diagnostics. */ }
        };
        // Retire the locked database session before invoking externally registered abort handlers.
        const expire = () => { timedOut = true; discard = true; dispose(); controller.abort(); };
        const live = () => {
            if (signal?.aborted || timedOut || performance.now() >= deadline) {
                expire();
                fail();
            }
            if (released)
                fail();
        };
        async function run() {
            try {
                live();
                client = await connect();
                live();
                const query = client.query.bind(client);
                const tx: SqlClient = {
                    async query<Row>(text: string, values?: unknown[]) {
                        live();
                        if (inFlight !== 0)
                            fail();
                        if (text === 'COMMIT')
                            commitAttempted = true;
                        inFlight++;
                        try {
                            const result = await query<Row>(text, values);
                            live();
                            return result;
                        }
                        finally {
                            inFlight--;
                        }
                    }, release() { fail(); }
                };
                await tx.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
                await tx.query(`SET LOCAL statement_timeout='${Math.min(10000, transactionTimeoutMs)}ms'`);
                await tx.query(`SET LOCAL lock_timeout='${Math.min(5000, transactionTimeoutMs)}ms'`);
                const result = await work(tx, () => { live(); resolverUsed = true; }, controller.signal);
                live();
                return result;
            }
            catch (error) {
                if (performance.now() >= deadline || signal?.aborted)
                    expire();
                const descriptor = object(error) && !types.isProxy(error) ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
                const code = descriptor && 'value' in descriptor ? descriptor.value : undefined;
                discard = discard || commitAttempted || typeof code === 'string' && (/^(?:08|57P)/.test(code) || ['ECONNRESET', 'EPIPE', 'ETIMEDOUT'].includes(code));
                if (inFlight !== 0) {
                    discard = true;
                    dispose();
                }
                // Termination owns timeout/active-query rollback. Never issue competing SQL.
                if (client && !released && !timedOut) {
                    try {
                        await client.query('ROLLBACK');
                    }
                    catch {
                        discard = true;
                    }
                }
                return fail();
            }
            finally {
                dispose();
            }
        }
        let timer: ReturnType<typeof setTimeout> | undefined, abort: (() => void) | undefined;
        try {
            const stopped = new Promise<never>((_resolve, reject) => {
                abort = () => { expire(); reject(new Error('Communication reply consumption unavailable')); };
                signal?.addEventListener('abort', abort, { once: true });
                timer = setTimeout(abort, transactionTimeoutMs);
            });
            return await Promise.race([Promise.resolve().then(run), stopped]);
        }
        finally {
            clearTimeout(timer);
            if (abort)
                signal?.removeEventListener('abort', abort);
        }
    }
    async function enter(client: SqlClient, role: 'acquire_campaign_user' | 'acquire_campaign_worker') {
        await client.query(`SET LOCAL ROLE ${role}`);
        const result = await client.query('SELECT current_user AS active_role, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname=current_user');
        if (result.rows.length !== 1 || result.rows[0].active_role !== role || result.rows[0].rolsuper !== false || result.rows[0].rolbypassrls !== false || result.rows[0].rolcanlogin !== false)
            fail();
    }
    async function review(client: SqlClient, delivery: CommunicationReplyDelivery, code: string, allowResolved: boolean): Promise<boolean> {
        const inserted = await client.query(`INSERT INTO public.communication_reply_review_latches (binding_id,service_event_id,organization_id,owner_user_id,code)
 VALUES ($1,$2,$3,$4,$5) ON CONFLICT (binding_id,service_event_id) DO NOTHING RETURNING service_event_id`, [bindingId, delivery.serviceEventId, actor.organizationId, actor.userId, code]);
        if (inserted.rows.length === 0) {
            const existing = await client.query(`SELECT binding_id,service_event_id,organization_id,owner_user_id,code,resolved_at FROM public.communication_reply_review_latches
 WHERE binding_id=$1 AND service_event_id=$2 AND organization_id=$3 AND owner_user_id=$4`, [bindingId, delivery.serviceEventId, actor.organizationId, actor.userId]);
            const latch = existing.rows[0];
            if (existing.rows.length !== 1 || latch.binding_id !== bindingId || latch.service_event_id !== delivery.serviceEventId || latch.organization_id !== actor.organizationId || latch.owner_user_id !== actor.userId)
                fail();
            if (latch.resolved_at !== null) {
                if (!allowResolved || latch.code !== code)
                    fail();
                return true;
            }
        }
        else if (inserted.rows.length !== 1 || inserted.rows[0].service_event_id !== delivery.serviceEventId)
            fail();
        await client.query(`UPDATE public.communication_reply_monitors SET invalidated=true,complete=false,initial_sync_complete=false,lease_token=NULL,lease_until=NULL,failure_code=$3
 WHERE organization_id=$1 AND owner_user_id=$2`, [actor.organizationId, actor.userId, code]);
        return false;
    }
    return { async apply(input, signal) {
            let delivery: CommunicationReplyDelivery;
            try {
                if (mode() === 'off')
                    fail();
                delivery = validateDelivery(binding, bindingId, subscriberId, snapshot(input));
                if (!await authenticated(delivery, signal))
                    fail();
            }
            catch {
                return fail();
            }
            return transaction(signal, async (client, retireResolverSession, callbackSignal) => {
                await enter(client, 'acquire_campaign_user');
                await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [actor.organizationId, actor.userId]);
                if (process.env.COMMUNICATIONS_RUNTIME_ENABLED === 'true')
                    await lockAcquireSendGate(client, actor.organizationId, { required: true });
                const member = await client.query('SELECT public.communications_lock_reply_member($1,$2) AS allowed', [actor.organizationId, actor.userId]);
                if (member.rows.length !== 1 || member.rows[0].allowed !== true || mode() === 'off')
                    fail();
                const bindings = await client.query(`SELECT id,application_id,organization_id,owner_user_id,service_connection_id,service_account_id,generation,channel,platform,backend,authority
 FROM public.communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3`, [bindingId, actor.organizationId, actor.userId]);
                const row = bindings.rows[0];
                if (bindings.rows.length !== 1 || row.id !== bindingId || row.application_id !== 'acquire' || row.organization_id !== actor.organizationId || row.owner_user_id !== actor.userId ||
                    row.service_connection_id !== binding.connectionId || row.service_account_id !== binding.accountId || row.generation !== binding.generation || row.channel !== binding.channel || row.platform !== binding.platform || row.backend !== binding.backend || row.authority !== 'service')
                    fail();
                const outcome = delivery.payload.outcome;
                const event = outcome.kind === 'event' ? outcome.event as Extract<CommunicationEvent, {
                    type: 'message';
                }> : null;
                const occurredAt = new Date(event?.occurredAt ?? delivery.payload.receivedAt).toISOString();
                const stableOutcome = event ? [event.reference.id, event.conversation?.id ?? null, event.direction, event.sender.kind, event.sender.value, new Date(event.occurredAt).toISOString()] : ['review', outcome.kind === 'review' ? outcome.code : null];
                const fingerprint = hash([VERSION, vector(binding), bindingId, delivery.serviceEventId, delivery.sourceKey, delivery.payload.fingerprint, new Date(delivery.payload.receivedAt).toISOString(), stableOutcome]);
                const existing = await client.query(`SELECT binding_id,service_event_id,organization_id,owner_user_id,event_type,occurred_at,result,payload_fingerprint,fingerprint_version
 FROM public.communication_event_receipts WHERE binding_id=$1 AND service_event_id=$2 AND organization_id=$3 AND owner_user_id=$4`, [bindingId, delivery.serviceEventId, actor.organizationId, actor.userId]);
                if (existing.rows.length > 1)
                    fail();
                const original = existing.rows[0];
                if (original && (original.binding_id !== bindingId || original.service_event_id !== delivery.serviceEventId || original.organization_id !== actor.organizationId || original.owner_user_id !== actor.userId ||
                    !['processed', 'ignored', 'review'].includes(String(original.result))))
                    fail();
                let decision: 'stop' | 'ignore' | 'review', reviewCode: string | undefined;
                const replayConflict = !!original && (original.payload_fingerprint !== fingerprint || original.fingerprint_version !== VERSION || original.event_type !== (event ? 'message' : 'account') || new Date(original.occurred_at as string | Date).toISOString() !== occurredAt);
                if (replayConflict) {
                    decision = 'review';
                    reviewCode = 'semantic_conflict';
                }
                else if (outcome.kind === 'review') {
                    decision = 'review';
                    reviewCode = outcome.code;
                }
                else if (!event || event.direction !== 'inbound')
                    decision = 'ignore';
                else {
                    let resolutionOpen = true;
                    const requests: Promise<unknown>[] = [];
                    const resolverClient: SqlClient = Object.freeze({
                        query<Row>(text: string, values?: unknown[]) {
                            let request: ReturnType<SqlClient['query']>;
                            try {
                                if (!resolutionOpen || typeof text !== 'string' || text.length > 100000)
                                    fail();
                                const statement = text.trim().replace(/;$/, '').trim();
                                if (statement.includes(';') || !/^(?:SELECT|INSERT|UPDATE|WITH)\b/i.test(statement))
                                    fail();
                                request = client.query(statement, values);
                            }
                            catch {
                                request = Promise.reject(new Error('Communication reply consumption unavailable'));
                            }
                            // Observe exactly the returned promise if a trusted callback forgets to await SQL.
                            void request.catch(() => undefined);
                            if (resolutionOpen)
                                requests.push(request);
                            return request as Promise<{
                                rows: Row[];
                                rowCount?: number | null;
                            }>;
                        }, release() { fail(); }
                    });
                    retireResolverSession();
                    let resolved: unknown;
                    try {
                        resolved = await resolve(resolverClient, { actor: structuredClone(actor), binding: structuredClone(binding), sender: structuredClone(event.sender) }, callbackSignal);
                    }
                    finally {
                        resolutionOpen = false;
                    }
                    await Promise.all(requests);
                    const proof = snapshot(resolved) as VerifiedCampaignReplyIdentity | null;
                    const mapped = proof && typeof proof.identity === 'string' ? communicationReplyIdentity(binding.channel, proof.identity) : null;
                    if (proof === null && unrelated) {
                        let active = true;
                        const probes: Promise<unknown>[] = [];
                        let queue: Promise<unknown> = Promise.resolve();
                        const capability = (role: 'acquire_campaign_user' | 'acquire_campaign_worker'): SqlClient => Object.freeze({ query<Row>(sql: string, values?: unknown[]) { const request = queue.then(async () => { if (!active || typeof sql !== 'string' || sql.length > 100000 || sql.includes(';') || !/^SELECT\s/i.test(sql.trim()))
                                fail(); await enter(client, role); if (!active)
                                fail(); return client.query<Row>(sql, values); }); void request.catch(() => { }); queue = request; probes.push(request); return request; }, release() { fail(); } });
                        let negative: unknown;
                        try {
                            negative = await unrelated({ owner: capability('acquire_campaign_user'), registry: capability('acquire_campaign_worker') }, { actor: structuredClone(actor), binding: structuredClone(binding), sender: structuredClone(event.sender) }, callbackSignal);
                        }
                        finally {
                            active = false;
                        }
                        await Promise.all(probes);
                        await enter(client, 'acquire_campaign_user');
                        const absent = snapshot(negative) as VerifiedUnrelatedCampaignReply | null;
                        if (absent && exact(absent, ['kind', 'proofVersion', 'actor', 'binding', 'sender']) && absent.kind === 'unrelated' && absent.proofVersion === 'acquire.reply.unrelated.v1' && exact(absent.actor, ['organizationId', 'userId']) && absent.actor.organizationId === actor.organizationId && absent.actor.userId === actor.userId && same(binding, absent.binding) && canonicalSender(binding, absent.sender) && absent.sender.kind === event.sender.kind && absent.sender.value === event.sender.value)
                            decision = 'ignore';
                        else {
                            decision = 'review';
                            reviewCode = 'identity_pending';
                        }
                    }
                    else {
                        if (!proof || !exact(proof, ['actor', 'binding', 'sender', 'identity', ...(proof.identityAuthority === undefined ? [] : ['identityAuthority'])]) || !exact(proof.actor, ['organizationId', 'userId']) || proof.actor.organizationId !== actor.organizationId || proof.actor.userId !== actor.userId || !same(binding, proof.binding) ||
                            !canonicalSender(binding, proof.sender) || proof.sender.kind !== event.sender.kind || proof.sender.value !== event.sender.value || !mapped || mapped !== proof.identity ||
                            (binding.channel !== 'linkedin' && mapped !== replyIdentity(binding.channel, event.sender.value)) || (binding.channel === 'linkedin' && mapped?.startsWith('https:') && (proof.identityAuthority !== 'canonical_service' || mapped !== event.sender.value)) || (proof.identityAuthority !== undefined && proof.identityAuthority !== 'canonical_service')) {
                            decision = 'review';
                            reviewCode = 'identity_pending';
                        }
                        else {
                            await enter(client, 'acquire_campaign_worker');
                            // Existing policy uses this client's query protocol; no separate pool/transaction is opened.
                            const applied = await applyCampaignReply(client as unknown as PoolClient, actor, binding.channel, accountIdentity, { id: delivery.sourceKey, fromIdentity: mapped, receivedAt: occurredAt }, 'service');
                            await enter(client, 'acquire_campaign_user');
                            if (!['stop', 'ignore', 'review'].includes(applied))
                                fail();
                            decision = applied;
                            if (decision === 'review')
                                reviewCode = 'identity_pending';
                        }
                    }
                }
                if (!original) {
                    const inserted = await client.query(`INSERT INTO public.communication_event_receipts
 (binding_id,service_event_id,organization_id,owner_user_id,event_type,occurred_at,result,payload_fingerprint,fingerprint_version)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (binding_id,service_event_id) DO NOTHING RETURNING service_event_id`, [bindingId, delivery.serviceEventId, actor.organizationId, actor.userId, event ? 'message' : 'account', occurredAt, decision === 'stop' ? 'processed' : decision === 'ignore' ? 'ignored' : 'review', fingerprint, VERSION]);
                    // A concurrent insert may be invisible in this SERIALIZABLE snapshot. Roll back all policy
                    // effects and retry the complete transaction; never commit effects before checking its receipt.
                    if (inserted.rows.length !== 1 || inserted.rows[0].service_event_id !== delivery.serviceEventId)
                        fail();
                }
                const resolvedReplay = reviewCode ? await review(client, delivery, reviewCode, !!original && !replayConflict && original.result === 'review' && outcome.kind === 'review') : false;
                if (mode() === 'off')
                    fail();
                await client.query('COMMIT');
                return { status: resolvedReplay ? 'duplicate' : decision === 'review' ? 'review' : original ? 'duplicate' : 'applied', decision };
            });
        } };
}
