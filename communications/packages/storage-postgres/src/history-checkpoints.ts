import {isDeepStrictEqual} from 'node:util';
import {businessSql,type BusinessClock} from '../../core/src/business-clock';
import{assertHistoryRepliesProcessed}from'./history-pending';
import { createHash, randomBytes } from 'node:crypto';
import { types } from 'node:util';
import { assertSameBinding, type ConnectionBinding, type EventQuery, type EventPage, type Coverage, type CanonicalIdentity } from '../../contracts/src';
import type { HistoryCheckpointPort, HistoryInitialSyncEvidence, HistoryOutboundObservation } from '../../core/src/history-backfill';
import { parseEventPayload, type EventPayload } from '../../core/src/event-codec';
import type { SqlPool, SqlClient } from './webhook-repository';
import type { HistoryCheckpointCodec } from './history-checkpoint-codec';
import type { ClaimedWebhook } from '../../core/src/reply-ingress';
import type { WebhookEventRepositoryCodec, WebhookRepositoryCodec } from './webhook-repository';
import { parseHistoryOutbound } from '../../core/src/history-backfill';
import { historyTransaction } from './history-transaction';
import { parseLifecycleRecord, type RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
export interface HistoryCheckpointOptions {
    businessClock?:BusinessClock;
    pool: SqlPool;
    binding: ConnectionBinding;
    record: RecordedLifecycleConnection;
    integrationId: string;
    providerConfigurationReference: string;
    subscriberId: string;
    codec: HistoryCheckpointCodec;
    eventCodec: WebhookEventRepositoryCodec;
    transactionTimeoutMs?: number;
    scopeKeyVersion?: string;
    captureCodec?: WebhookRepositoryCodec;
    expectedSyncProduct?: string;
    isRecordedOutbound?(client: SqlClient, observation: HistoryOutboundObservation): Promise<boolean>;
}
function fail(): never { throw Error('History storage unavailable'); }
const id = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v);
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !types.isProxy(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v)) && Reflect.ownKeys(Object.getOwnPropertyDescriptors(v)).every(k => typeof k === 'string' && 'value' in Object.getOwnPropertyDescriptor(v, k)!);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const dbDate = (v: unknown) => {
    if (v instanceof Date)
        return v.toISOString();
    if (date(v))
        return v;
    return fail();
};
const fields = ['applicationId', 'tenantId', 'ownerId', 'connectionId', 'accountId', 'generation', 'channel', 'platform', 'backend'] as const;
/** Trusted history-worker storage, no remote calls, no app IDs. Unknown commits never authorize
 * readiness. Driver release(error) terminates the physical session. SQL007 remains a prerequisite. */
export function createPostgresHistoryCheckpoints(options: HistoryCheckpointOptions): HistoryCheckpointPort & {
    withCoverage<T>(query: EventQuery, work: (snapshot: {
        coverage: Coverage;
        scopeDigest: string;
        serviceRevision: string;
        signal: AbortSignal;
        revalidate(): Promise<void>;
    }) => Promise<T>, options?: {
        signal?: AbortSignal;
    }): Promise<T>;
    scopeDigest(scope: string): string;
    assertCoverage(client: SqlClient, input: {
        binding: ConnectionBinding;
        scopeDigest: string;
        requiredSince: string;
        maxAgeSeconds: number;
        serviceRevision: string;
        recipient?: CanonicalIdentity;
    }): Promise<void>;
    initialSync(signal?: AbortSignal): Promise<HistoryInitialSyncEvidence | null>;
    recordInitialSync(claim: ClaimedWebhook, signal?: AbortSignal): Promise<{
        status: "recorded" | "duplicate";
    }>;
} {
    if (!plain(options) || !plain(options.binding) || !id(options.integrationId) || !id(options.providerConfigurationReference, 2000) || !id(options.subscriberId))
        fail();
    const b = Object.fromEntries(fields.map(k => [k, options.binding[k]])) as unknown as ConnectionBinding;
    assertSameBinding(b, b);
    if (b.backend !== 'unipile')
        fail();
    const record = parseLifecycleRecord(options.record);
    assertSameBinding(b, record.binding);
    const integration = options.integrationId, configuration = options.providerConfigurationReference, subscriber = options.subscriberId, codec = options.codec, eventCodec = options.eventCodec;
    if (!codec || types.isProxy(codec) || !eventCodec || types.isProxy(eventCodec))
        fail();
    const digest = Function.prototype.bind.call(codec.digest, codec), seal = Function.prototype.bind.call(codec.seal, codec), open = Function.prototype.bind.call(codec.open, codec), encode = Function.prototype.bind.call(eventCodec.encode, eventCodec), decode = Function.prototype.bind.call(eventCodec.decode, eventCodec), keyVersion = options.scopeKeyVersion ?? codec.keyVersion;
    if (!codec.versions().includes(keyVersion))
        fail();
    const recorded = options.isRecordedOutbound ? Function.prototype.bind.call(options.isRecordedOutbound, options) : null;
    const capture = options.captureCodec;
    if (capture && types.isProxy(capture))
        fail();
    const decodeCapture = capture ? Function.prototype.bind.call(capture.decode, capture) : null, digestCapture = capture ? Function.prototype.bind.call(capture.digest, capture) : null, expectedProduct = options.expectedSyncProduct;
    if (expectedProduct !== undefined && !id(expectedProduct, 100))
        fail();
    const initialScope = digest(structuredClone(b), 'history-initial-sync', keyVersion);
    const tx = historyTransaction(options.pool, options.transactionTimeoutMs), scopeDigest = (s: string) => {
        if (!id(s))
            fail();
        const value = digest(structuredClone(b), s, keyVersion);
        if (!/^[a-f0-9]{64}$/.test(value))
            fail();
        return value;
    };
    const validate = (q: EventQuery) => {
        if (!plain(q))
            fail();
        assertSameBinding(b, q.binding);
        if (!id(q.scope) || !date(q.since) || q.cursor !== null || q.refresh !== true)
            fail();
    };
    const bind = [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend, integration, configuration];
    const authority = async (c: Parameters<Parameters<typeof tx>[1]>[0]) => {
        const physical = await c.query(`SELECT true AS physical_valid FROM communications.physical_accounts WHERE id=$1 AND verified_at<=clock_timestamp() FOR UPDATE`, [b.accountId]);
        if (physical.rows.length !== 1 || physical.rows[0].physical_valid !== true)
            fail();
        const result = await c.query(`SELECT true AS valid FROM communications.connections c JOIN communications.connection_generations g ON g.connection_id=c.id AND g.generation=c.current_generation JOIN communications.access_grants ag ON ag.application_id=c.application_id AND ag.tenant_id=c.tenant_id AND ag.owner_id=c.owner_id WHERE c.application_id=$1 AND c.tenant_id=$2 AND c.owner_id=$3 AND c.id=$4 AND c.account_id=$5 AND c.current_generation=$6 AND c.channel=$7 AND c.platform=$8 AND c.backend=$9 AND c.active AND g.integration_id=$10 AND g.provider_configuration_reference=$11 AND g.provider_api_version='v1' AND g.authority='service' AND ag.revoked_at IS NULL AND ag.expires_at>clock_timestamp() FOR SHARE OF c,g,ag`, bind);
        if (result.rows.length !== 1 || result.rows[0].valid !== true)
            fail();
    };
    const grant = async (c: Parameters<Parameters<typeof tx>[1]>[0]) => {
        const row = await c.query(`SELECT (revoked_at IS NULL AND expires_at>clock_timestamp()) AS grant_valid FROM communications.access_grants WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3`, bind.slice(0, 3));
        if (row.rows.length !== 1 || row.rows[0].grant_valid !== true)
            fail();
    };
    const fence = async (c: Parameters<Parameters<typeof tx>[1]>[0]) => {
        const row = await c.query(`SELECT communications.lock_reply_barrier($1,$2)::text AS revision`, bind.slice(0, 2));
        if (row.rows.length !== 1 || typeof row.rows[0].revision !== 'string' || !/^\d+$/.test(row.rows[0].revision))
            fail();
        return row.rows[0].revision;
    };
    const cursorValues = (scope: string) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.generation, b.accountId, scopeDigest(scope)];
    const repository: ReturnType<typeof createPostgresHistoryCheckpoints> = { scopeDigest,
        async withCoverage<T>(input: EventQuery, work: (snapshot: {
            coverage: Coverage;
            scopeDigest: string;
            serviceRevision: string;
            signal: AbortSignal;
            revalidate(): Promise<void>;
        }) => Promise<T>, request?: {
            signal?: AbortSignal;
        }): Promise<T> {
            validate(input);
            const q = structuredClone(input);
            if (typeof work !== 'function')
                fail();
            return tx(request?.signal, async (c, check, signal) => {
                const revision = await fence(c);
                await authority(c);
                const assertion = { binding: structuredClone(b), scopeDigest: scopeDigest(q.scope), requiredSince: q.since, maxAgeSeconds: 300, serviceRevision: revision };
                const verify = async () => { check(); await repository.assertCoverage(c, structuredClone(assertion)); await assertHistoryRepliesProcessed(c,b.applicationId,b.tenantId); const gate = await c.query(`SELECT communications.assert_dispatch_reply_barrier($1,$2)::text AS revision`, bind.slice(0, 2)); check(); if (gate.rows.length !== 1 || gate.rows[0].revision !== revision)
                    fail(); };
                await verify();
                const row = await c.query(`SELECT coverage_from,coverage_through,observed_at FROM communications.event_cursors WHERE connection_id=$1 AND generation=$2 AND scope_digest=$3 FOR SHARE`, [b.connectionId, b.generation, assertion.scopeDigest]);
                if (row.rows.length !== 1)
                    fail();
                const coverage: Coverage = { binding: structuredClone(b), scope: q.scope, from: dbDate(row.rows[0].coverage_from), through: dbDate(row.rows[0].coverage_through), observedAt: dbDate(row.rows[0].observed_at), complete: true, initialSyncComplete: true, invalidated: false };
                let openCapability = true, revalidated = false;
                const pending = new Set<Promise<void>>();
                const revalidate = (): Promise<void> => { const promise = (async () => { if (!openCapability)
                    fail(); await verify(); if (!openCapability)
                    fail(); revalidated = true; })(); pending.add(promise); void promise.then(() => pending.delete(promise), () => pending.delete(promise)); return promise; };
                try {
                    const result = await work({ coverage: structuredClone(coverage), scopeDigest: assertion.scopeDigest, serviceRevision: revision, signal, revalidate });
                    check();
                    if (!revalidated || pending.size !== 0)
                        fail();
                    await verify();
                    return result;
                }
                finally {
                    openCapability = false;
                }
            });
        },
        async recordInitialSync(input, signal) {
            if (!decodeCapture || !digestCapture || b.channel === 'email' || b.channel === 'linkedin' && !expectedProduct)
                fail();
            const claim = structuredClone(input);
            assertSameBinding(b, claim.binding);
            if (!/^[a-f0-9]{64}$/.test(claim.key) || !date(claim.receivedAt) || !types.isUint8Array(claim.rawBody) || typeof claim.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(claim.token))
                fail();
            return tx(signal, async (c) => {
                await fence(c);
                await authority(c);
                const selected = await c.query(`SELECT w.encrypted_payload,w.key_version,w.payload_digest,w.received_at${options.businessClock?', '+businessSql(options.businessClock)+' AS business_completed_at':''},(w.state='processing' AND w.lease_token=$4 AND w.lease_until>clock_timestamp()) AS claim_valid,(w.expires_at>clock_timestamp()) AS alive
    FROM communications.webhook_inbox w JOIN communications.webhook_receipt_routes r ON r.webhook_inbox_id=w.id
    WHERE w.id=$1 AND w.dedupe_key=$1 AND w.backend='unipile' AND w.integration_id=$2 AND r.connection_id=$3
     AND r.generation=$5 AND r.application_id=$6 AND r.tenant_id=$7 AND r.owner_id=$8 AND r.account_id=$9 FOR UPDATE OF w`, [claim.key, integration, b.connectionId, claim.token, b.generation, b.applicationId, b.tenantId, b.ownerId, b.accountId]);
                if (selected.rows.length !== 1)
                    fail();
                const row = selected.rows[0];
                if (row.claim_valid !== true || row.alive !== true)
                    fail();
                const envelope = JSON.parse(String(row.encrypted_payload));
                if (envelope.keyVersion !== row.key_version)
                    fail();
                const original = decodeCapture({ binding: structuredClone(b), key: claim.key }, envelope);
                assertSameBinding(b, original.binding);
                if (!isDeepStrictEqual(original.localSync,claim.localSync)||original.key !== claim.key || original.receivedAt !== claim.receivedAt || !Buffer.from(original.rawBody).equals(Buffer.from(claim.rawBody)) || digestCapture({ binding: structuredClone(b), key: claim.key }, Uint8Array.from(original.rawBody), row.key_version) !== row.payload_digest)
                    fail();
                const raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original.rawBody));
                if (!plain(raw) || !plain(raw.AccountStatus))
                    fail();
                const status = raw.AccountStatus;
                if (status.account_id !== record.providerAccountId || status.account_type !== b.channel.toUpperCase() || status.message !== 'SYNC_SUCCESS' || b.channel === 'linkedin' && status.product !== expectedProduct || status.product !== undefined && (expectedProduct === undefined || status.product !== expectedProduct))
                    fail();
                // The retained capture authenticates ingress time; SQL owns receipt observation time.
                // Copy its full-precision value in SQL to satisfy the immutable receipt fence.
                const evidence: HistoryInitialSyncEvidence = { kind: 'provider_sync_success', record: structuredClone(record), completedAt: dbDate(row.received_at), evidenceId: claim.key }, sealed = seal(structuredClone(b), initialScope, evidence);
                const inserted = await c.query(`INSERT INTO communications.history_initial_sync(application_id,tenant_id,owner_id,connection_id,generation,account_id,webhook_inbox_id,completed_at,encrypted_evidence,key_version,digest_key_version${options.businessClock?',business_completed_at':''}) SELECT $1,$2,$3,$4,$5,$6,$7,w.received_at,$8,$9,$10${options.businessClock?','+businessSql(options.businessClock):''} FROM communications.webhook_inbox w WHERE w.id=$7 ON CONFLICT(connection_id,generation) DO NOTHING RETURNING webhook_inbox_id`, [...cursorValues('history-initial-sync').slice(0, 6), claim.key, JSON.stringify(sealed), sealed.keyVersion, keyVersion]);
                if (inserted.rows.length === 0) {
                    const old = await c.query(`SELECT encrypted_evidence,key_version,digest_key_version,webhook_inbox_id,completed_at FROM communications.history_initial_sync WHERE connection_id=$1 AND generation=$2`, [b.connectionId, b.generation]);
                    if (old.rows.length !== 1)
                        fail();
                    const v = old.rows[0], e = JSON.parse(String(v.encrypted_evidence));
                    if (e.keyVersion !== v.key_version)
                        fail();
                    const proof = open(structuredClone(b), digest(structuredClone(b), 'history-initial-sync', v.digest_key_version), e);
                    if (!plain(proof) || proof.kind !== 'provider_sync_success' || proof.evidenceId !== v.webhook_inbox_id || proof.completedAt !== dbDate(v.completed_at))
                        fail();
                    const previous = parseLifecycleRecord(proof.record);
                    assertSameBinding(b, previous.binding);
                    if (previous.providerAccountId !== record.providerAccountId || previous.sourceId !== record.sourceId || previous.ownerIdentity.namespace !== record.ownerIdentity.namespace || previous.ownerIdentity.value !== record.ownerIdentity.value)
                        fail();
                }
                else if (inserted.rows.length !== 1)
                    fail();
                const finished = await c.query(`UPDATE communications.webhook_inbox SET state='processed',lease_token=NULL,lease_until=NULL,retry_at=NULL,failure_code=NULL WHERE id=$1 AND state='processing' AND lease_token=$2 AND lease_until>clock_timestamp() AND expires_at>clock_timestamp() RETURNING id`, [claim.key, claim.token]);
                if (finished.rows.length !== 1)
                    fail();
                await c.query(`SELECT communications.advance_reply_barrier($1,$2)`, bind.slice(0, 2));
                await grant(c);
                return { status: inserted.rows.length === 1 ? 'recorded' as const : 'duplicate' as const };
            });
        },
        // Initial-sync evidence is append-only; row locks would require an unnecessary UPDATE grant.
        async initialSync(signal) {
            if (b.channel === 'email')
                return null;
            return tx(signal, async (c) => {
                await fence(c);
                await authority(c);
                const rows = await c.query(`SELECT encrypted_evidence,key_version,digest_key_version,webhook_inbox_id,completed_at${options.businessClock?',business_completed_at':''},(completed_at<=clock_timestamp()${options.businessClock?' AND business_completed_at<='+businessSql(options.businessClock):''}) AS time_valid FROM communications.history_initial_sync WHERE connection_id=$1 AND generation=$2`, [b.connectionId, b.generation]);
                if (rows.rows.length === 0)
                    return null;
                if (rows.rows.length !== 1)
                    fail();
                const r = rows.rows[0];
                if (r.time_valid !== true)
                    fail();
                const envelope = JSON.parse(String(r.encrypted_evidence));
                if (envelope.keyVersion !== r.key_version)
                    fail();
                const proof = open(structuredClone(b), digest(structuredClone(b), 'history-initial-sync', r.digest_key_version), envelope);
                if (!plain(proof) || proof.kind !== 'provider_sync_success' || proof.evidenceId !== r.webhook_inbox_id || proof.completedAt !== dbDate(r.completed_at))
                    fail();
                const current = parseLifecycleRecord(proof.record);
                assertSameBinding(b, current.binding);
                if (current.providerAccountId !== record.providerAccountId || current.sourceId !== record.sourceId || current.ownerIdentity.namespace !== record.ownerIdentity.namespace || current.ownerIdentity.value !== record.ownerIdentity.value)
                    fail();
                await grant(c);
                return { kind: 'provider_sync_success', record: current, completedAt: options.businessClock?dbDate(r.business_completed_at):proof.completedAt as string, evidenceId: proof.evidenceId as string };
            });
        },
        async assertCoverage(c, input) {
            try {
                if (!plain(input))
                    fail();
                assertSameBinding(b, input.binding);
                if (!/^[a-f0-9]{64}$/.test(input.scopeDigest) || !date(input.requiredSince) || !Number.isInteger(input.maxAgeSeconds) || input.maxAgeSeconds < 1 || input.maxAgeSeconds > 300 || !/^\d+$/.test(input.serviceRevision))
                    fail();
                const wanted = structuredClone(input);
                if (wanted.recipient)
                    wanted.recipient = parseHistoryOutbound({ binding: b, reference: { binding: b, id: 'admission-recipient' }, recipient: wanted.recipient, occurredAt: wanted.requiredSince }, b).recipient;
                if (await fence(c) !== wanted.serviceRevision)
                    fail();
                await authority(c);
                const rows = await c.query(`SELECT ec.encrypted_cursor,ec.cursor_key_version,ec.coverage_from,ec.coverage_through,ec.observed_at,ec.complete,ec.initial_sync_complete,ec.invalidated,h.digest_key_version,h.required_since,${options.businessClock?'h.business_started_at AS started_at,h.business_finished_at AS finished_at':'h.started_at,h.finished_at'},h.capture_revision::text,h.finished_revision::text,
    (ec.coverage_from<=$4::timestamptz AND ec.coverage_through>=$4::timestamptz AND ec.coverage_through<=${businessSql(options.businessClock)} AND ec.observed_at<=${businessSql(options.businessClock)} AND ec.coverage_through>=${businessSql(options.businessClock)}-make_interval(secs=>$5) AND ec.observed_at>=${businessSql(options.businessClock)}-make_interval(secs=>$5)) AS fresh
    FROM communications.event_cursors ec JOIN communications.history_refreshes h ON h.connection_id=ec.connection_id AND h.generation=ec.generation AND h.scope_digest=ec.scope_digest
    WHERE ec.connection_id=$1 AND ec.generation=$2 AND ec.scope_digest=$3 AND ec.application_id=$6 AND ec.tenant_id=$7 AND ec.owner_id=$8 AND ec.account_id=$9 FOR SHARE OF ec,h`, [b.connectionId, b.generation, wanted.scopeDigest, wanted.requiredSince, wanted.maxAgeSeconds, b.applicationId, b.tenantId, b.ownerId, b.accountId]);
                if (rows.rows.length !== 1)
                    fail();
                const r = rows.rows[0];
                if (r.complete !== true || r.initial_sync_complete !== true || r.invalidated !== false || r.fresh !== true || r.finished_at === null || typeof r.digest_key_version !== 'string' || typeof r.finished_revision !== 'string' || typeof r.capture_revision !== 'string' || !/^\d+$/.test(r.capture_revision) || !/^\d+$/.test(r.finished_revision) || BigInt(r.capture_revision) > BigInt(r.finished_revision) || BigInt(r.finished_revision) > BigInt(wanted.serviceRevision))
                    fail();
                const envelope = JSON.parse(String(r.encrypted_cursor));
                if (envelope.keyVersion !== r.cursor_key_version)
                    fail();
                const payload = open(structuredClone(b), wanted.scopeDigest, envelope);
                if (!plain(payload) || !plain(payload.coverage) || !plain(payload.provenance))
                    fail();
                const cv = payload.coverage, pv = payload.provenance;
                assertSameBinding(b, cv.binding as ConnectionBinding);
                if (typeof cv.scope !== 'string' || digest(structuredClone(b), cv.scope, r.digest_key_version) !== wanted.scopeDigest || payload.scopeKeyVersion !== r.digest_key_version || payload.captureRevision !== r.capture_revision || payload.finishedRevision !== r.finished_revision || cv.complete !== true || cv.initialSyncComplete !== true || cv.invalidated !== false || cv.from !== dbDate(r.coverage_from) || cv.through !== dbDate(r.coverage_through) || cv.observedAt !== dbDate(r.observed_at) || dbDate(r.required_since) !== cv.from || dbDate(r.started_at) !== cv.through || Date.parse(dbDate(r.finished_at)) < Date.parse(cv.observedAt as string) || pv.providerAccountId !== record.providerAccountId || pv.sourceId !== record.sourceId || pv.exhausted !== true || pv.refresh !== true || !plain(pv.initialSyncEvidence))
                    fail();
                const evidence = pv.initialSyncEvidence;
                if (!date(evidence.completedAt) || Date.parse(evidence.completedAt) > Date.parse((evidence.kind === 'query_baseline' ? cv.observedAt : cv.through) as string) || !id(evidence.evidenceId, 2048))
                    fail();
                if (evidence.kind === 'provider_sync_success' && b.channel === 'email' || !['provider_sync_success', 'query_baseline'].includes(evidence.kind as string) || evidence.kind === 'query_baseline' && (b.channel !== 'email' || !plain(evidence.query) || evidence.query.scope !== cv.scope || evidence.query.from !== cv.from || evidence.query.through !== cv.through))
                    fail();
                const original = parseLifecycleRecord(evidence.record);
                assertSameBinding(b, original.binding);
                if (original.providerAccountId !== record.providerAccountId || original.sourceId !== record.sourceId || original.ownerIdentity.namespace !== record.ownerIdentity.namespace || original.ownerIdentity.value !== record.ownerIdentity.value)
                    fail();
                if (!Array.isArray(pv.outbound) || pv.outbound.length > 10000)
                    fail();
                for (const raw of pv.outbound) {
                    const observation = parseHistoryOutbound(plain(raw) && typeof raw.referenceId === 'string' ? { binding: b, reference: { binding: b, id: raw.referenceId }, ...(typeof raw.conversationId === 'string' ? { conversation: { binding: b, id: raw.conversationId } } : {}), recipient: raw.recipient as CanonicalIdentity, occurredAt: raw.occurredAt as string } : raw, b);
                    if (Date.parse(observation.occurredAt) < Date.parse(cv.from as string) || Date.parse(observation.occurredAt) > Date.parse(cv.through as string))
                        fail();
                    if (wanted.recipient && observation.recipient.kind === wanted.recipient.kind && observation.recipient.value === wanted.recipient.value && Date.parse(observation.occurredAt) >= Date.parse(wanted.requiredSince)) {
                        if (!recorded || await recorded(c, structuredClone(observation)) !== true)
                            fail();
                    }
                }
                await grant(c);
            }
            catch {
                fail();
            }
        },
        async begin(input, signal) {
            validate(input);
            const q = structuredClone(input), token = randomBytes(32).toString('base64url'), tokenHash = hash(token);
            return tx(signal, async (c) => {
                const revision = await fence(c);
                await authority(c);
                const result = await c.query(`INSERT INTO communications.history_refreshes(application_id,tenant_id,owner_id,connection_id,generation,account_id,scope_digest,digest_key_version,token_hash,required_since,capture_revision,started_at,lease_until${options.businessClock?',business_started_at':''}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp(),clock_timestamp()+interval '60 seconds'${options.businessClock?','+businessSql(options.businessClock):''}) ON CONFLICT(connection_id,generation,scope_digest) DO UPDATE SET token_hash=EXCLUDED.token_hash,required_since=EXCLUDED.required_since,capture_revision=EXCLUDED.capture_revision,started_at=EXCLUDED.started_at,lease_until=EXCLUDED.lease_until,finished_at=NULL,finished_revision=NULL${options.businessClock?',business_started_at=EXCLUDED.business_started_at,business_finished_at=NULL':''} WHERE communications.history_refreshes.lease_until<=clock_timestamp() RETURNING ${options.businessClock?'business_started_at AS started_at':'started_at'}`, [...cursorValues(q.scope), keyVersion, tokenHash, q.since, revision]);
                if (result.rows.length === 0)
                    return null;
                if (result.rows.length !== 1)
                    fail();
                await c.query(`INSERT INTO communications.event_cursors(application_id,tenant_id,owner_id,connection_id,generation,account_id,scope_digest,invalidated,complete) VALUES($1,$2,$3,$4,$5,$6,$7,true,false) ON CONFLICT(connection_id,generation,scope_digest) DO UPDATE SET invalidated=true,complete=false`, cursorValues(q.scope));
                await grant(c);
                return { binding: structuredClone(b), scope: q.scope, since: q.since, token, startedAt: dbDate(result.rows[0].started_at), revision };
            });
        },
        async commit(input, pageInput, signal) {
            const ticket = structuredClone(input), page = structuredClone(pageInput);
            assertSameBinding(b, ticket.binding);
            if (!id(ticket.scope) || !date(ticket.since) || !date(ticket.startedAt) || !/^\d+$/.test(ticket.revision) || typeof ticket.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket.token) || !plain(page) || !Array.isArray(page.events) || page.events.length > 10000 || page.nextCursor !== null)
                fail();
            const rawProvenance = (page as EventPage & {
                provenance?: unknown;
            }).provenance;
            if (!plain(rawProvenance) || !Array.isArray(rawProvenance.outbound) || rawProvenance.outbound.length > 10000 || rawProvenance.providerAccountId !== record.providerAccountId || rawProvenance.sourceId !== record.sourceId || rawProvenance.exhausted !== true || rawProvenance.refresh !== true)
                fail();
            rawProvenance.outbound = rawProvenance.outbound.map(v => { const observation = parseHistoryOutbound(v, b); if (Date.parse(observation.occurredAt) < Date.parse(ticket.since) || Date.parse(observation.occurredAt) > Date.parse(ticket.startedAt))
                fail(); return observation; });
            const initial = rawProvenance.initialSyncEvidence;
            if (initial !== null) {
                if (!plain(initial) || !['provider_sync_success', 'query_baseline'].includes(initial.kind as string) || !id(initial.evidenceId, 2048) || !date(initial.completedAt) || Date.parse(initial.completedAt) > Date.parse(initial.kind === 'query_baseline' ? page.coverage.observedAt : ticket.startedAt))
                    fail();
                const original = parseLifecycleRecord(initial.record);
                assertSameBinding(b, original.binding);
                if (original.providerAccountId !== record.providerAccountId || original.sourceId !== record.sourceId || original.ownerIdentity.namespace !== record.ownerIdentity.namespace || original.ownerIdentity.value !== record.ownerIdentity.value)
                    fail();
            }
            const coverage = page.coverage;
            if (coverage.initialSyncComplete !== (initial !== null) || initial !== null && initial.kind === 'provider_sync_success' && b.channel === 'email')
                fail();
            if (initial !== null && initial.kind === 'query_baseline' && (b.channel !== 'email' || !plain(initial.query) || initial.query.scope !== ticket.scope || initial.query.from !== ticket.since || initial.query.through !== ticket.startedAt))
                fail();
            assertSameBinding(b, coverage.binding);
            if (coverage.scope !== ticket.scope || coverage.from !== ticket.since || coverage.through !== ticket.startedAt || !date(coverage.observedAt) || Date.parse(coverage.observedAt) < Date.parse(ticket.startedAt) || [coverage.complete, coverage.initialSyncComplete, coverage.invalidated].some(v => typeof v !== 'boolean'))
                fail();
            return tx(signal, async (c) => {
                const revision = await fence(c);
                await authority(c);
                const refresh = await c.query(`SELECT token_hash,required_since,capture_revision::text,${options.businessClock?'business_started_at AS started_at':'started_at'},(lease_until>clock_timestamp()) AS alive,(${businessSql(options.businessClock)}>=$4::timestamptz) AS observed_valid FROM communications.history_refreshes WHERE connection_id=$1 AND generation=$2 AND scope_digest=$3 FOR UPDATE`, [b.connectionId, b.generation, scopeDigest(ticket.scope), coverage.observedAt]);
                const r = refresh.rows[0];
                if (refresh.rows.length !== 1 || r.token_hash !== hash(ticket.token) || dbDate(r.required_since) !== ticket.since || dbDate(r.started_at) !== ticket.startedAt || r.capture_revision !== ticket.revision || r.alive !== true || r.observed_valid !== true)
                    fail();
                let conflict = false;
                for (const candidate of page.events) {
                    if (candidate.type !== 'message' || !date(candidate.occurredAt) || Date.parse(candidate.occurredAt) < Date.parse(ticket.since) || Date.parse(candidate.occurredAt) > Date.parse(ticket.startedAt))
                        fail();
                    const key = hash(['communications.reply.event.v1', fields.map(k => b[k]), candidate.conversation?.id ?? null, candidate.reference.id]), fingerprint = hash(['communications.reply.content.v1', fields.map(k => b[k]), candidate.reference.id, candidate.conversation?.id ?? null, candidate.direction, candidate.sender.kind, candidate.sender.value, new Date(candidate.occurredAt).toISOString()]);
                    const payload = parseEventPayload({ binding: b, key }, { outcome: { kind: 'event', event: candidate, eventKey: key, fingerprint }, fingerprint, receivedAt: coverage.observedAt });
                    const envelope = encode({ binding: structuredClone(b), key }, structuredClone(payload));
                    const verified = parseEventPayload({ binding: b, key }, decode({ binding: b, key }, structuredClone(envelope)));
                    if (verified.fingerprint !== fingerprint)
                        fail();
                    const inserted = await c.query(`INSERT INTO communications.events(application_id,tenant_id,owner_id,connection_id,generation,account_id,source_namespace,source_event_key,event_type,direction,occurred_at,encrypted_event,key_version) VALUES($1,$2,$3,$4,$5,$6,'reply_message/v1',$7,'message',$8,$9,$10,$11) ON CONFLICT(connection_id,generation,source_namespace,source_event_key) DO NOTHING RETURNING id::text`, [...cursorValues(ticket.scope).slice(0, 6), key, candidate.direction, candidate.occurredAt, JSON.stringify(envelope), envelope.keyVersion]);
                    let eventId: string;
                    if (inserted.rows.length === 1)
                        eventId = String(inserted.rows[0].id);
                    else {
                        const old = await c.query(`SELECT id::text,encrypted_event,key_version FROM communications.events WHERE connection_id=$1 AND generation=$2 AND source_namespace='reply_message/v1' AND source_event_key=$3 FOR SHARE`, [b.connectionId, b.generation, key]);
                        if (old.rows.length !== 1)
                            fail();
                        eventId = String(old.rows[0].id);
                        const storedEnvelope = JSON.parse(String(old.rows[0].encrypted_event));
                        if (storedEnvelope.keyVersion !== old.rows[0].key_version)
                            fail();
                        const original = parseEventPayload({ binding: b, key }, decode({ binding: b, key }, storedEnvelope));
                        if (original.fingerprint !== fingerprint) {
                            conflict = true;
                            const reviewKey = hash(['communications.history.conflict.v1', fields.map(k => b[k]), key, original.fingerprint, fingerprint]), reviewFingerprint = hash(['communications.reply.review.v1', fields.map(k => b[k]), reviewKey, 'protocol']), reviewPayload: EventPayload = { outcome: { kind: 'review', code: 'protocol' }, fingerprint: reviewFingerprint, receivedAt: coverage.observedAt }, reviewEnvelope = encode({ binding: structuredClone(b), key: reviewKey }, reviewPayload);
                            parseEventPayload({ binding: b, key: reviewKey }, decode({ binding: b, key: reviewKey }, structuredClone(reviewEnvelope)));
                            const reviewInsert = await c.query(`INSERT INTO communications.events(application_id,tenant_id,owner_id,connection_id,generation,account_id,source_namespace,source_event_key,event_type,direction,occurred_at,encrypted_event,key_version) VALUES($1,$2,$3,$4,$5,$6,'reply_review/v1',$7,'account',NULL,$8,$9,$10) ON CONFLICT(connection_id,generation,source_namespace,source_event_key) DO NOTHING RETURNING id::text`, [...cursorValues(ticket.scope).slice(0, 6), reviewKey, coverage.observedAt, JSON.stringify(reviewEnvelope), reviewEnvelope.keyVersion]);
                            let reviewId: string;
                            if (reviewInsert.rows.length === 1)
                                reviewId = String(reviewInsert.rows[0].id);
                            else {
                                const previous = await c.query(`SELECT id::text,encrypted_event,key_version FROM communications.events WHERE connection_id=$1 AND generation=$2 AND source_namespace='reply_review/v1' AND source_event_key=$3 FOR SHARE`, [b.connectionId, b.generation, reviewKey]);
                                if (previous.rows.length !== 1)
                                    fail();
                                reviewId = String(previous.rows[0].id);
                                const previousEnvelope = JSON.parse(String(previous.rows[0].encrypted_event));
                                if (previousEnvelope.keyVersion !== previous.rows[0].key_version || parseEventPayload({ binding: b, key: reviewKey }, decode({ binding: b, key: reviewKey }, previousEnvelope)).fingerprint !== reviewFingerprint)
                                    fail();
                            }
                            if (!/^[1-9]\d*$/.test(reviewId))
                                fail();
                            await c.query(`INSERT INTO communications.reply_review_latches(event_id,application_id,tenant_id,owner_id,code) VALUES($1,$2,$3,$4,'semantic_conflict') ON CONFLICT(event_id) DO NOTHING`, [reviewId, ...bind.slice(0, 3)]);
                            await c.query(`INSERT INTO communications.event_outbox(event_id,subscriber_id,application_id,tenant_id,owner_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,subscriber_id) DO NOTHING`, [reviewId, subscriber, ...bind.slice(0, 3)]);
                        }
                    }
                    if (!/^[1-9]\d*$/.test(eventId))
                        fail();
                    await c.query(`INSERT INTO communications.event_outbox(event_id,subscriber_id,application_id,tenant_id,owner_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT(event_id,subscriber_id) DO NOTHING`, [eventId, subscriber, ...bind.slice(0, 3)]);
                }
                const valid = coverage.complete && coverage.initialSyncComplete && !coverage.invalidated && !conflict && revision === ticket.revision;
                const finalCoverage = { ...coverage, binding: structuredClone(b), complete: valid, invalidated: coverage.invalidated || conflict || revision !== ticket.revision };
                const advanced = await c.query(`SELECT communications.advance_reply_barrier($1,$2)::text AS revision`, bind.slice(0, 2));
                if (advanced.rows.length !== 1 || typeof advanced.rows[0].revision !== 'string' || !/^\d+$/.test(advanced.rows[0].revision))
                    fail();
                const committedRevision = advanced.rows[0].revision;
                const sealed = seal(structuredClone(b), scopeDigest(ticket.scope), { coverage: finalCoverage, provenance: { ...rawProvenance, outbound: (rawProvenance.outbound as HistoryOutboundObservation[]).map(o => ({ referenceId: o.reference.id, conversationId: o.conversation?.id ?? null, recipient: o.recipient, occurredAt: o.occurredAt })) }, scopeKeyVersion: keyVersion, captureRevision: ticket.revision, finishedRevision: committedRevision });
                await c.query(`UPDATE communications.event_cursors SET encrypted_cursor=$4,cursor_key_version=$5,coverage_from=$6,coverage_through=$7,observed_at=$8,complete=$9,initial_sync_complete=$10,invalidated=$11 WHERE connection_id=$1 AND generation=$2 AND scope_digest=$3`, [b.connectionId, b.generation, scopeDigest(ticket.scope), JSON.stringify(sealed), sealed.keyVersion, coverage.from, coverage.through, coverage.observedAt, valid, coverage.initialSyncComplete, finalCoverage.invalidated]);
                await c.query(`UPDATE communications.history_refreshes SET finished_at=clock_timestamp(),lease_until=clock_timestamp(),finished_revision=$4${options.businessClock?',business_finished_at='+businessSql(options.businessClock):''} WHERE connection_id=$1 AND generation=$2 AND scope_digest=$3`, [b.connectionId, b.generation, scopeDigest(ticket.scope), committedRevision]);
                await grant(c);
                return { committed: true, coverage: finalCoverage };
            });
        },
        async abandon(input) {
            const ticket = structuredClone(input);
            assertSameBinding(b, ticket.binding);
            if (!id(ticket.scope) || !date(ticket.since) || !date(ticket.startedAt) || !/^\d+$/.test(ticket.revision) || typeof ticket.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket.token)) fail();
            await tx(undefined, async c => {
                await fence(c); await authority(c);
                // A late failure cannot expire a replacement lease or invalidate
                // coverage that already committed (including uncertain COMMIT).
                const owned = await c.query(`UPDATE communications.history_refreshes SET lease_until=clock_timestamp() WHERE connection_id=$1 AND generation=$2 AND scope_digest=$3 AND token_hash=$4 AND capture_revision=$5 AND required_since=$6 AND finished_at IS NULL RETURNING connection_id`, [b.connectionId,b.generation,scopeDigest(ticket.scope),hash(ticket.token),ticket.revision,ticket.since]);
                if (!owned.rows.length) return;
                if (owned.rows.length !== 1) fail();
                await c.query(`UPDATE communications.event_cursors SET invalidated=true,complete=false WHERE connection_id=$1 AND generation=$2 AND scope_digest=$3`, [b.connectionId,b.generation,scopeDigest(ticket.scope)]);
                await c.query(`SELECT communications.advance_reply_barrier($1,$2)`, bind.slice(0,2));
                await grant(c);
            });
        },
        async invalidate(input, signal) { validate(input); const q = structuredClone(input); await tx(signal, async (c) => { await fence(c); await authority(c); await c.query(`UPDATE communications.event_cursors SET invalidated=true,complete=false WHERE connection_id=$1 AND generation=$2 AND scope_digest=$3`, [b.connectionId, b.generation, scopeDigest(q.scope)]); await c.query(`SELECT communications.advance_reply_barrier($1,$2)`, bind.slice(0, 2)); await grant(c); }); },
        async coverage(input, signal) {
            validate(input);
            const q = structuredClone(input);
            return tx(signal, async (c) => {
                await fence(c);
                await authority(c);
                const result = await c.query(`SELECT coverage_from,coverage_through,observed_at,complete,initial_sync_complete,invalidated,encrypted_cursor,cursor_key_version,(coverage_through<=${businessSql(options.businessClock)} AND observed_at<=${businessSql(options.businessClock)} AND coverage_through>=${businessSql(options.businessClock)}-interval '5 minutes' AND observed_at>=${businessSql(options.businessClock)}-interval '5 minutes') AS fresh FROM communications.event_cursors WHERE connection_id=$1 AND generation=$2 AND scope_digest=$3 FOR SHARE`, [b.connectionId, b.generation, scopeDigest(q.scope)]);
                if (result.rows.length === 0)
                    return null;
                if (result.rows.length !== 1)
                    fail();
                const r = result.rows[0];
                if (r.encrypted_cursor === null)
                    return null;
                const envelope = JSON.parse(String(r.encrypted_cursor));
                if (envelope.keyVersion !== r.cursor_key_version)
                    fail();
                const payload = open(structuredClone(b), scopeDigest(q.scope), envelope);
                if (!plain(payload) || !plain(payload.coverage))
                    fail();
                const coverage: Coverage = { binding: structuredClone(b), scope: q.scope, from: dbDate(r.coverage_from), through: dbDate(r.coverage_through), observedAt: dbDate(r.observed_at), complete: r.complete === true && r.fresh === true, initialSyncComplete: r.initial_sync_complete === true, invalidated: r.invalidated !== false };
                const stored = payload.coverage;
                assertSameBinding(b, stored.binding as ConnectionBinding);
                if (stored.scope !== q.scope || stored.from !== coverage.from || stored.through !== coverage.through || stored.observedAt !== coverage.observedAt || stored.initialSyncComplete !== coverage.initialSyncComplete || typeof stored.complete !== 'boolean' || typeof stored.invalidated !== 'boolean')
                    fail();
                coverage.complete = coverage.complete && stored.complete && !stored.invalidated;
                await grant(c);
                return coverage;
            });
        }
    };
    return Object.freeze(repository);
}
