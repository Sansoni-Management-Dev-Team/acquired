import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';
import { assertSameBinding } from '../../communications/packages/contracts/src';
import { lockAcquireSendGate } from './campaign-send-gate';
import type { SqlClient } from '../../communications/packages/storage-postgres/src/webhook-repository';
import type { ConnectionBinding, Coverage, EventQuery } from '../../communications/packages/contracts/src';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import type { JournalCodec } from '../../communications/packages/core/src/journal-codec';
export interface HeldCoverageProjection {
    coverage: Coverage;
    scopeDigest: string;
    serviceRevision: string;
    signal: AbortSignal;
    revalidate(): Promise<void>;
}
export interface AcquireCoverageProjectorOptions {
    pool: SqlPool;
    binding: ConnectionBinding;
    bindingId: string;
    subscriberId: string;
    codec: Pick<JournalCodec, 'keyVersion' | 'encode'>;
    withCoverage<T>(query: EventQuery, work: (proof: HeldCoverageProjection) => Promise<T>, options?: {
        signal?: AbortSignal;
    }): Promise<T>;
    timeoutMs?: number;
}
const fail = (): never => { throw Error('Coverage projection unavailable'); };
function plain(v: unknown): Record<string, unknown> {
    if (types.isPromise(v)) {
        void Promise.prototype.then.call(v, () => undefined, () => undefined);
        fail();
    }
    if (!v || typeof v !== 'object' || types.isProxy(v) || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype || Reflect.ownKeys(Object.getOwnPropertyDescriptors(v)).some(k => typeof k !== 'string' || !('value' in Object.getOwnPropertyDescriptor(v, k)!)))
        fail();
    return v as Record<string, unknown>;
}
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 200 && v === v.trim() && !/[\u0000-\u001f\u007f]/.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
export function createAcquireCoverageProjector(input: AcquireCoverageProjectorOptions): {
    project(query: EventQuery): Promise<void>;
} {
    let binding: ConnectionBinding, bindingId: string, subscriber: string, connect: SqlPool['connect'], withCoverage: AcquireCoverageProjectorOptions['withCoverage'], encode: AcquireCoverageProjectorOptions['codec']['encode'], keyVersion: string, timeout: number;
    try {
        const o = plain(input);
        plain(o.binding);
        binding = structuredClone(o.binding) as ConnectionBinding;
        assertSameBinding(binding, binding);
        bindingId = o.bindingId as string;
        subscriber = o.subscriberId as string;
        const pool = o.pool as SqlPool, codec = o.codec as AcquireCoverageProjectorOptions['codec'];
        if (types.isProxy(pool) || types.isProxy(codec))
            fail();
        const c = pool.connect, w = o.withCoverage, e = codec.encode;
        keyVersion = codec.keyVersion;
        timeout = Number(o.timeoutMs ?? 20000);
        if (binding.applicationId !== 'acquire' || !id(bindingId) || !id(subscriber) || !id(keyVersion) || [c, w, e].some(p => typeof p !== 'function') || !Number.isInteger(timeout) || timeout < 1 || timeout > 25000)
            fail();
        connect = Function.prototype.bind.call(c, pool);
        withCoverage = Function.prototype.bind.call(w as AcquireCoverageProjectorOptions['withCoverage'], input);
        encode = Function.prototype.bind.call(e, codec);
    }
    catch {
        throw Error('Invalid coverage projection configuration');
    }
    return { async project(inputQuery) {
            let client: SqlClient | undefined, closed = false;
            const controller = new AbortController(), deadline = performance.now() + timeout;
            let rejectStopped!: (e: Error) => void;
            const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
            void stopped.catch(() => { });
            const dispose = () => {
                if (closed)
                    return;
                closed = true;
                try {
                    client?.release(Error('Coverage projection session retired'));
                }
                catch { /*private*/ }
                controller.abort();
            };
            const cancel = () => { dispose(); rejectStopped(Error('Coverage projection unavailable')); };
            const timer = setTimeout(cancel, timeout);
            let peerSignal: AbortSignal | undefined;
            const live = () => {
                if (closed || controller.signal.aborted || performance.now() >= deadline || peerSignal && Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(peerSignal))
                    fail();
            };
            const call = async <T>(work: () => Promise<T>) => { live(); const p = Promise.resolve().then(work).then(value => { live(); return value; }); void p.catch(() => { }); return Promise.race([p, stopped]); };
            const run = async () => {
                plain(inputQuery);
                plain(inputQuery.binding);
                const query = structuredClone(inputQuery);
                assertSameBinding(binding, query.binding);
                if (!id(query.scope) || !date(query.since) || query.cursor !== null || query.refresh !== true)
                    fail();
                await withCoverage(query, async (raw) => {
                    live();
                    const proof = plain(raw) as unknown as HeldCoverageProjection, coverage = structuredClone(plain(proof.coverage)) as unknown as Coverage;
                    assertSameBinding(binding, coverage.binding);
                    if (coverage.scope !== query.scope || coverage.complete !== true || coverage.initialSyncComplete !== true || coverage.invalidated !== false || !date(coverage.from) || !date(coverage.through) || !date(coverage.observedAt) || Date.parse(coverage.from) > Date.parse(query.since) || Date.parse(coverage.through) < Date.parse(query.since) || Date.parse(coverage.through) > Date.parse(coverage.observedAt) || !(/^[a-f0-9]{64}$/).test(proof.scopeDigest) || !(/^(0|[1-9]\d{0,18})$/).test(proof.serviceRevision) || BigInt(proof.serviceRevision) > BigInt('9223372036854775807') || types.isProxy(proof.signal) || typeof proof.revalidate !== 'function')
                        fail();
                    peerSignal = proof.signal;
                    Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')!.get!.call(peerSignal);
                    EventTarget.prototype.addEventListener.call(peerSignal, 'abort', cancel, { once: true });
                    live();
                    const revalidate = Function.prototype.bind.call(proof.revalidate, raw);
                    client = await call(async () => {
                        const acquired = await connect();
                        if (closed || performance.now() >= deadline) {
                            acquired.release(Error('Late coverage projection session'));
                            fail();
                        }
                        return acquired;
                    });
                    const sql = Function.prototype.bind.call(client.query, client) as SqlClient['query'];
                    let inFlight = 0;
                    const tx = { query: async <Row = Record<string, unknown>>(text: string, values?: unknown[]) => call(async () => {
                            if (inFlight)
                                fail();
                            inFlight++;
                            try {
                                return await sql<Row>(text, values);
                            }
                            finally {
                                inFlight--;
                            }
                        }) };
                    await tx.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
                    await tx.query('SET LOCAL ROLE acquire_campaign_user');
                    const role = await tx.query('SELECT current_user AS role_name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
                    if (role.rows.length !== 1 || role.rows[0].role_name !== 'acquire_campaign_user' || role.rows[0].rolsuper !== false || role.rows[0].rolbypassrls !== false)
                        fail();
                    await tx.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true),set_config('statement_timeout',$3,true),set_config('lock_timeout',$4,true)", [binding.tenantId, binding.ownerId, `${Math.min(timeout, 5000)}ms`, `${Math.min(timeout, 1000)}ms`]);
                    await lockAcquireSendGate(tx, binding.tenantId, { required: true });
                    const member = async () => {
                        const r = await tx.query('SELECT public.communications_lock_send_member($1,$2) AS allowed', [binding.tenantId, binding.ownerId]);
                        if (r.rows.length !== 1 || r.rows[0].allowed !== true)
                            fail();
                    };
                    await member();
                    const local = await tx.query('SELECT * FROM public.communication_bindings WHERE id=$1 AND organization_id=$2 AND owner_user_id=$3', [bindingId, binding.tenantId, binding.ownerId]);
                    if (local.rows.length !== 1)
                        fail();
                    const b = local.rows[0];
                    assertSameBinding(binding, { applicationId: b.application_id, tenantId: b.organization_id, ownerId: b.owner_user_id, connectionId: b.service_connection_id, accountId: b.service_account_id, generation: b.generation, channel: b.channel, platform: b.platform, backend: b.backend } as ConnectionBinding);
                    if (b.id !== bindingId || b.authority !== 'service')
                        fail();
                    const fresh = await tx.query("SELECT $1::timestamptz<=clock_timestamp() AND $2::timestamptz<=clock_timestamp() AND $1::timestamptz>=clock_timestamp()-interval '5 minutes' AND $2::timestamptz>=clock_timestamp()-interval '5 minutes' AS fresh", [coverage.through, coverage.observedAt]);
                    if (fresh.rows.length !== 1 || fresh.rows[0].fresh !== true)
                        fail();
                    const old = await tx.query('SELECT observed_service_revision::text AS revision FROM public.communication_consumer_checkpoints WHERE binding_id=$1 AND subscriber_id=$2 AND scope_digest=$3 FOR UPDATE', [bindingId, subscriber, proof.scopeDigest]);
                    if (old.rows.length > 1 || old.rows[0] && (!/^(0|[1-9]\d{0,18})$/.test(String(old.rows[0].revision)) || BigInt(String(old.rows[0].revision)) > BigInt(proof.serviceRevision)))
                        fail();
                    const payload = { domain: 'acquire.coverage-projection.v1', coverage, scopeDigest: proof.scopeDigest, serviceRevision: proof.serviceRevision, subscriberId: subscriber }, snapshot = { binding, key: `acquire.coverage:${bindingId}:${proof.scopeDigest}`, operation: 'message' as const, payloadDigest: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }, envelope = encode(snapshot, 'context', payload);
                    if (envelope.keyVersion !== keyVersion)
                        fail();
                    const encrypted = JSON.stringify(envelope);
                    const monitor = await tx.query('INSERT INTO public.communication_reply_monitors(binding_id,organization_id,owner_user_id,scope_digest,encrypted_cursor,cursor_key_version,coverage_from,coverage_through,observed_at,complete,initial_sync_complete,invalidated,last_attempt_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true,true,false,clock_timestamp()) ON CONFLICT(binding_id,scope_digest) DO UPDATE SET encrypted_cursor=EXCLUDED.encrypted_cursor,cursor_key_version=EXCLUDED.cursor_key_version,coverage_from=EXCLUDED.coverage_from,coverage_through=EXCLUDED.coverage_through,observed_at=EXCLUDED.observed_at,complete=true,initial_sync_complete=true,invalidated=false,last_attempt_at=clock_timestamp(),failure_code=NULL WHERE public.communication_reply_monitors.observed_at IS NULL OR public.communication_reply_monitors.observed_at<=EXCLUDED.observed_at', [bindingId, binding.tenantId, binding.ownerId, proof.scopeDigest, encrypted, keyVersion, coverage.from, coverage.through, coverage.observedAt]);
                    if (monitor.rowCount !== 1)
                        fail();
                    await tx.query('INSERT INTO public.communication_consumer_checkpoints(binding_id,organization_id,owner_user_id,subscriber_id,scope_digest,encrypted_cursor,cursor_key_version,observed_service_revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8::bigint) ON CONFLICT(binding_id,subscriber_id,scope_digest) DO UPDATE SET encrypted_cursor=EXCLUDED.encrypted_cursor,cursor_key_version=EXCLUDED.cursor_key_version,observed_service_revision=EXCLUDED.observed_service_revision,updated_at=clock_timestamp()', [bindingId, binding.tenantId, binding.ownerId, subscriber, proof.scopeDigest, encrypted, keyVersion, proof.serviceRevision]);
                    await member();
                    await call(revalidate);
                    live();
                    await tx.query('COMMIT');
                    live();
                }, { signal: controller.signal });
            };
            try {
                const work = Promise.resolve().then(run);
                void work.catch(() => { });
                await Promise.race([work, stopped]);
            }
            catch {
                fail();
            }
            finally {
                clearTimeout(timer);
                if (peerSignal)
                    EventTarget.prototype.removeEventListener.call(peerSignal, 'abort', cancel);
                dispose();
            }
        } };
}
