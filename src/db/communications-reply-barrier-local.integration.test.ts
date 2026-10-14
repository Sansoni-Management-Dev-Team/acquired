import { createHash, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { ConnectionBinding } from '../../communications/packages/contracts/src';
import type { WebhookCapture } from '../../communications/packages/core/src/reply-ingress';
import { EventCodec } from '../../communications/packages/core/src/event-codec';
import { createPostgresReplyBarrier } from '../../communications/packages/storage-postgres/src/reply-barrier';
import type { SqlClient } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createCommunicationsLocalFixture } from './communications-local-test-support';
// Runs only against the specifically approved/applied isolated003 schema.
// Missing schema is a prerequisite error, never a meaningful TDD red or an automatic migration.
const enabled = process.env.COMMUNICATIONS_REPLY_BARRIER_LOCAL_DB === '1';
describe.skipIf(!enabled)('approved isolated003 tenant reply barrier and immutable routing', () => {
    const local = createCommunicationsLocalFixture(), retired: ConnectionBinding[] = [];
    const eventCodec = new EventCodec({
        activeVersion: 'barrier-event-v1', keys: [{
                version: 'barrier-event-v1', encryptionKey: Buffer.alloc(32, 131), digestKey: Buffer.alloc(32, 132)
            }]
    });
    beforeAll(async () => {
        await local.preflight();
        const { rows: [schema] } = await local.pool.query("SELECT to_regclass('communications.tenant_reply_barriers')::text AS barrier,to_regclass('communications.webhook_receipt_routes')::text AS routes,to_regclass('communications.reply_review_latches')::text AS reviews");
        if (!schema.barrier || !schema.routes || !schema.reviews)
            throw Error('Exact approved003 is absent; no schema bootstrap occurs');
    });
    afterAll(async () => {
        try {
            for (const b of retired) {
                await local.pool.query('UPDATE communications.connections SET active=false WHERE id=$1', [b.connectionId]);
                await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [b.applicationId, b.tenantId, b.ownerId]);
            }
        }
        finally {
            await local.close();
        }
    });
    const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    const vector = (b: ConnectionBinding) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
    async function fixture(ch: 'email' | 'whatsapp' | 'linkedin' = 'whatsapp', shared?: {
        applicationId: string;
        tenantId: string;
        ownerId: string;
    }, backend?: ConnectionBinding['backend']) {
        const suffix = randomUUID(), binding: ConnectionBinding = {
            applicationId: shared?.applicationId ?? `barrier-${suffix}`, tenantId: shared?.tenantId ?? 'barrier-tenant', ownerId: shared?.ownerId ?? 'barrier-owner', connectionId: `barrier-connection-${suffix}`, accountId: `barrier-account-${suffix}`, generation: 1, channel: ch, platform: ch === 'email' ? 'gmail' : ch, backend: backend ?? 'unipile'
        }, integrationId = `barrier-source-${suffix}`, c = await local.pool.connect();
        try {
            await c.query('BEGIN');
            await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [binding.applicationId, binding.tenantId, binding.ownerId]);
            await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'barrier_fixture',$3,'fixture-v1',clock_timestamp())", [binding.accountId, ch, hash(suffix)]);
            await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'connected',true)", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, ch, binding.platform, binding.backend]);
            await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}')", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, ch, binding.platform, binding.backend, integrationId, binding.backend === 'unipile' ? 'v1' : null, binding.backend === 'unipile' ? 'fixture-config' : null, binding.backend === 'unipile' ? 'service' : 'legacy_port']);
            await c.query('COMMIT');
            retired.push(binding);
        }
        catch (error) {
            await c.query('ROLLBACK');
            throw error;
        }
        finally {
            c.release();
        }
        const rawBody = Buffer.from(JSON.stringify({
            event: 'message_received', account_id: 'synthetic-account', message_id: suffix
        })), key = hash(['communications.webhook.receipt.v1', vector(binding), createHash('sha256').update(rawBody).digest('hex')]), capture: WebhookCapture = {
            binding: structuredClone(binding), key, rawBody, receivedAt: new Date().toISOString()
        };
        return {
            binding, integrationId, capture, port: createPostgresReplyBarrier({
                binding, integrationId, codec: local.webhookCodec, eventCodec
            })
        };
    }
    async function transaction<T>(operation: (c: SqlClient) => Promise<T>) {
        const c = await local.driver.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            const result = await operation(c);
            await c.query('COMMIT');
            return result;
        }
        catch (error) {
            await c.query('ROLLBACK');
            throw error;
        }
        finally {
            c.release();
        }
    }
    async function insertCapture(c: SqlClient, f: Awaited<ReturnType<typeof fixture>>) {
        const envelope = local.webhookCodec.encode(f.capture);
        await c.query("INSERT INTO communications.webhook_inbox(id,backend,integration_id,dedupe_key,payload_digest,encrypted_payload,key_version,authenticated_at,received_at,expires_at) VALUES($1,$2,$3,$1,$4,$5,$6,clock_timestamp(),$7,clock_timestamp()+interval '1 hour')", [f.capture.key, f.binding.backend, f.integrationId, local.webhookCodec.digest({
                binding: f.binding, key: f.capture.key
            }, f.capture.rawBody), JSON.stringify(envelope), envelope.keyVersion, f.capture.receivedAt]);
    }
    async function routed(f: Awaited<ReturnType<typeof fixture>>) {
        return transaction(async (c) => {
            await f.port.lock(c, f.binding.applicationId, f.binding.tenantId);
            await insertCapture(c, f);
            return f.port.route(c, f.capture);
        });
    }
    it.each(['email', 'whatsapp', 'linkedin'] as const)('routes exact encrypted %s capture and retains immutable original routing', async (channel) => {
        const f = await fixture(channel);
        expect(await routed(f)).toEqual({
            revision: '1'
        });
        const { rows: [original] } = await local.pool.query('SELECT * FROM communications.webhook_receipt_routes WHERE webhook_inbox_id=$1', [f.capture.key]);
        await transaction(async (c) => {
            await f.port.lock(c, f.binding.applicationId, f.binding.tenantId);
            expect(await f.port.route(c, f.capture)).toEqual({
                revision: '1'
            });
        });
        const { rows: [after] } = await local.pool.query('SELECT * FROM communications.webhook_receipt_routes WHERE webhook_inbox_id=$1', [f.capture.key]);
        expect(after).toEqual(original);
    });
    it('blocks another owner/channel and admits no false coverage readiness', async () => {
        const a = await fixture('email'), b = await fixture('whatsapp', {
            applicationId: a.binding.applicationId, tenantId: a.binding.tenantId, ownerId: 'other-owner'
        });
        await transaction(async (c) => {
            await a.port.lock(c, a.binding.applicationId, a.binding.tenantId);
            expect((await c.query('SELECT communications.assert_dispatch_reply_barrier($1,$2)::text AS revision', [a.binding.applicationId, a.binding.tenantId])).rows[0].revision).toBe('0');
        });
        await routed(a);
        await expect(transaction(async (c) => {
            await b.port.lock(c, b.binding.applicationId, b.binding.tenantId);
            await c.query('SELECT communications.assert_dispatch_reply_barrier($1,$2)', [b.binding.applicationId, b.binding.tenantId]);
        })).rejects.toThrow(/remains pending/);
    });
    it('serializes competing tenant locks in actual PostgreSQL', async () => {
        const f = await fixture(), first = await local.driver.connect(), second = await local.driver.connect();
        let acquired = false;
        try {
            await first.query('BEGIN');
            await first.query('SET LOCAL ROLE communications_control');
            await f.port.lock(first, f.binding.applicationId, f.binding.tenantId);
            await second.query('BEGIN');
            await second.query('SET LOCAL ROLE communications_control');
            const pid = Number((await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
            const waiting = f.port.lock(second, f.binding.applicationId, f.binding.tenantId).then(() => {
                acquired = true;
            });
            void waiting.catch(() => {
            });
            let observed = false;
            for (let index = 0; index < 30; index++) {
                const { rows: [state] } = await local.pool.query('SELECT state,wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
                if (state?.state === 'active' && state.wait_event_type === 'Lock') {
                    observed = true;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            expect(observed).toBe(true);
            expect(acquired).toBe(false);
            await first.query('COMMIT');
            await waiting;
            expect(acquired).toBe(true);
            await second.query('COMMIT');
        }
        finally {
            await first.query('ROLLBACK');
            await second.query('ROLLBACK');
            first.release();
            second.release();
        }
    });
    it('preserves original accepted generation routing after reconnect', async () => {
        const f = await fixture(), b = f.binding;
        await local.pool.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,2,$2,$3,$4,$5,$6,$7,'unipile',$8,'v1','fixture-config','service','{}')", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, b.channel, b.platform, f.integrationId]);
        await local.pool.query('UPDATE communications.connections SET current_generation=2 WHERE id=$1', [b.connectionId]);
        expect(await routed(f)).toEqual({
            revision: '1'
        });
        const { rows: [route] } = await local.pool.query('SELECT generation FROM communications.webhook_receipt_routes WHERE webhook_inbox_id=$1', [f.capture.key]);
        expect(route.generation).toBe(1);
    });
    it('rejects noncontrol role and reused transaction client', async () => {
        const f = await fixture(), c = await local.driver.connect();
        try {
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_scoped');
            await expect(f.port.lock(c, f.binding.applicationId, f.binding.tenantId)).rejects.toThrow(/^Reply barrier unavailable$/);
            await c.query('ROLLBACK');
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await f.port.lock(c, f.binding.applicationId, f.binding.tenantId);
            await c.query('COMMIT');
            await c.query('BEGIN');
            await c.query('SET LOCAL ROLE communications_control');
            await expect(f.port.route(c, f.capture)).rejects.toThrow(/^Reply barrier unavailable$/);
            await c.query('ROLLBACK');
        }
        finally {
            c.release();
        }
    });
    it('keeps pending work visible for legacy backend admission on the same tenant', async () => {
        const a = await fixture('email'), b = await fixture('whatsapp', {
            applicationId: a.binding.applicationId, tenantId: a.binding.tenantId, ownerId: 'legacy-owner'
        }, 'baileys');
        await routed(a);
        await expect(transaction(async (c) => {
            await b.port.lock(c, b.binding.applicationId, b.binding.tenantId);
            await c.query('SELECT communications.assert_dispatch_reply_barrier($1,$2)', [b.binding.applicationId, b.binding.tenantId]);
        })).rejects.toThrow(/remains pending/);
    });
    it('inserts a verified service review and preserves explicit resolution on replay', async () => {
        const f = await fixture();
        await routed(f);
        const payload = {
            outcome: {
                kind: 'review' as const, code: 'identity_pending' as const
            }, fingerprint: hash(['communications.reply.review.v1', vector(f.binding), f.capture.key, 'identity_pending']), receivedAt: f.capture.receivedAt
        }, envelope = eventCodec.encode({
            binding: f.binding, key: f.capture.key
        }, payload);
        let eid: string;
        await transaction(async (c) => {
            await f.port.lock(c, f.binding.applicationId, f.binding.tenantId);
            const inserted = await c.query("INSERT INTO communications.events(application_id,tenant_id,owner_id,connection_id,generation,account_id,source_namespace,source_event_key,event_type,direction,occurred_at,encrypted_event,key_version,webhook_inbox_id) VALUES($1,$2,$3,$4,1,$5,'reply_review/v1',$6,'account',NULL,$7,$8,$9,$6) RETURNING id::text", [f.binding.applicationId, f.binding.tenantId, f.binding.ownerId, f.binding.connectionId, f.binding.accountId, f.capture.key, f.capture.receivedAt, JSON.stringify(envelope), envelope.keyVersion]);
            eid = String(inserted.rows[0].id);
            await f.port.review(c, {
                eventId: eid, code: 'identity_pending'
            });
        });
        await transaction(async (c) => {
            await f.port.lock(c, f.binding.applicationId, f.binding.tenantId);
            await c.query("UPDATE communications.reply_review_latches SET resolved_at=clock_timestamp(),resolution_reference='fixture-explicit-resolution' WHERE event_id=$1", [eid!]);
        });
        const { rows: [before] } = await local.pool.query('SELECT * FROM communications.reply_review_latches WHERE event_id=$1', [eid!]);
        await transaction(async (c) => {
            await f.port.lock(c, f.binding.applicationId, f.binding.tenantId);
            await f.port.review(c, {
                eventId: eid!, code: 'identity_pending'
            });
        });
        const { rows: [after] } = await local.pool.query('SELECT * FROM communications.reply_review_latches WHERE event_id=$1', [eid!]);
        expect(after).toEqual(before);
    });
});
