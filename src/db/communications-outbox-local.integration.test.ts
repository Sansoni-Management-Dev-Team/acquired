import { createHash } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { CommunicationEvent } from '../../communications/packages/contracts/src';
import { EventCodec, type EventPayload } from '../../communications/packages/core/src/event-codec';
import { createPostgresOutboxRepository, type OutboxDelivery, type OutboxRepositoryOptions, type ApplicationReplyReceipt } from '../../communications/packages/storage-postgres/src/outbox-repository';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createCommunicationsLocalFixture } from './communications-local-test-support';
const enabled = process.env.COMMUNICATIONS_AUDIT_LOCAL_DB === '1';
describe.skipIf(!enabled)('isolated PostgreSQL scoped outbox leases and application acknowledgements', () => {
    const local = createCommunicationsLocalFixture();
    const codec = new EventCodec({
        activeVersion: 'outbox-event-v1', keys: [{
                version: 'outbox-event-v1', encryptionKey: Buffer.alloc(32, 121), digestKey: Buffer.alloc(32, 122)
            }]
    });
    beforeAll(() => local.preflight());
    afterAll(() => local.close());
    const subscriberId = 'outbox-fixture-subscriber';
    async function seed(channel: 'email' | 'whatsapp' | 'linkedin' = 'whatsapp', change: {
        corruptTag?: boolean;
        metadataDirection?: string;
        review?: boolean;
    } = {}) {
        const f = await local.fixture(channel), b = f.binding, receivedAt = new Date().toISOString(), occurredAt = new Date(Date.now() - 1000).toISOString();
        const sender = channel === 'email' ? {
            kind: 'email' as const, value: 'person@example.test'
        } : channel === 'whatsapp' ? {
            kind: 'phone' as const, value: '+15550000001'
        } : {
            kind: 'linkedin_profile' as const, value: 'https://www.linkedin.com/in/synthetic-person/'
        };
        const event: Extract<CommunicationEvent, {
            type: 'message';
        }> = {
            type: 'message', reference: {
                binding: b, id: f.suffix
            }, conversation: {
                binding: b, id: `chat-${f.suffix}`
            }, direction: 'inbound', sender, occurredAt
        };
        const scope = [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
        const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
        const sourceEventKey = change.review ? hash(['synthetic-receipt', f.suffix]) : hash(['communications.reply.event.v1', scope, event.conversation!.id, event.reference.id]);
        const fingerprint = change.review ? hash(['communications.reply.review.v1', scope, sourceEventKey, 'identity_pending']) : hash(['communications.reply.content.v1', scope, event.reference.id, event.conversation!.id, event.direction, event.sender.kind, event.sender.value, new Date(event.occurredAt).toISOString()]);
        const payload: EventPayload = {
            outcome: change.review ? {
                kind: 'review', code: 'identity_pending'
            } : {
                kind: 'event', event, eventKey: sourceEventKey, fingerprint
            }, fingerprint, receivedAt
        };
        const envelope = codec.encode({
            binding: b, key: sourceEventKey
        }, payload);
        if (change.corruptTag) {
            const bytes = Buffer.from(envelope.tag, 'base64');
            bytes[0] ^= 1;
            envelope.tag = bytes.toString('base64');
        }
        const client = await local.pool.connect();
        let eventId: string;
        try {
            await client.query('BEGIN');
            const inserted = await client.query(`INSERT INTO communications.events(application_id,tenant_id,owner_id,connection_id,generation,account_id,source_namespace,source_event_key,event_type,direction,occurred_at,encrypted_event,key_version)
 VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id::text`, [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, change.review ? 'reply_review/v1' : 'reply_message/v1', sourceEventKey, change.review ? 'account' : 'message', change.review ? null : change.metadataDirection ?? 'inbound', change.review ? receivedAt : occurredAt, JSON.stringify(envelope), envelope.keyVersion]);
            eventId = inserted.rows[0].id;
            await client.query('INSERT INTO communications.event_outbox(event_id,subscriber_id,application_id,tenant_id,owner_id) VALUES($1,$2,$3,$4,$5)', [eventId, subscriberId, b.applicationId, b.tenantId, b.ownerId]);
            await client.query('COMMIT');
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
        const repository = (changes: Partial<OutboxRepositoryOptions> = {}) => createPostgresOutboxRepository({
            pool: local.driver, binding: b, subscriberId, codec, ...changes
        });
        return {
            ...f, eventId: eventId!, sourceEventKey, payload, repository
        };
    }
    async function delivery(f: Awaited<ReturnType<typeof seed>>) {
        const result = await f.repository().claim();
        expect(result.kind).toBe('claimed');
        if (result.kind !== 'claimed')
            throw Error('Expected synthetic delivery');
        return result.delivery;
    }
    const receipt = (d: OutboxDelivery) => ({
        binding: d.binding, subscriberId: d.subscriberId, eventId: d.eventId, fingerprint: d.payload.fingerprint, status: 'committed' as const
    });
    async function row(eventId: string) {
        const { rows: [stored] } = await local.pool.query('SELECT state,attempts,lease_token,lease_until,acknowledged_at FROM communications.event_outbox WHERE event_id=$1 AND subscriber_id=$2', [eventId, subscriberId]);
        return stored;
    }
    it.each(['email', 'whatsapp', 'linkedin'] as const)('claims scoped encrypted %s event and acknowledges exact application receipt', async (channel) => {
        const f = await seed(channel), d = await delivery(f);
        expect(d).toMatchObject({
            binding: f.binding, subscriberId, eventId: f.eventId, sourceNamespace: 'reply_message/v1', sourceEventKey: f.sourceEventKey, payload: f.payload
        });
        expect(d.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
        expect((await row(f.eventId)).state).toBe('delivering');
        expect(await f.repository().acknowledge({
            delivery: d, receipt: receipt(d)
        })).toEqual({
            status: 'acknowledged'
        });
        const original = await row(f.eventId);
        expect(original.state).toBe('acknowledged');
        expect(await f.repository().acknowledge({
            delivery: d, receipt: {
                ...receipt(d), status: 'duplicate'
            }
        })).toEqual({
            status: 'duplicate'
        });
        expect(await row(f.eventId)).toEqual(original);
        expect(await f.repository().claim()).toEqual({
            kind: 'busy'
        });
    });
    it('compares replay scope semantically when binding property order changes',async()=>{const f=await seed(),d=await delivery(f),changed=structuredClone(d);if(changed.payload.outcome.kind!=='event'||changed.payload.outcome.event.type!=='message')throw Error('Expected message');changed.payload.outcome.event.reference.binding=Object.fromEntries(Object.entries(changed.payload.outcome.event.reference.binding).reverse()) as typeof f.binding;changed.payload.outcome.event.conversation!.binding=Object.fromEntries(Object.entries(changed.payload.outcome.event.conversation!.binding).reverse()) as typeof f.binding;expect(await f.repository().acknowledge({delivery:changed,receipt:receipt(changed)})).toEqual({status:'acknowledged'});});
  it('allows only one concurrent claim and no duplicate live lease', async () => {
        const f = await seed(), claims = await Promise.all([f.repository().claim(), f.repository().claim()]);
        expect(claims.filter(c => c.kind === 'claimed')).toHaveLength(1);
        expect(claims.filter(c => c.kind === 'busy')).toHaveLength(1);
        expect((await row(f.eventId)).attempts).toBe(1);
    });
    it('rejects stale token and mismatched receipt fingerprint, subscriber and scope without ACK', async () => {
        const f = await seed(), d = await delivery(f);
        for (const input of [{
                delivery: {
                    ...d, token: 'stale'
                }, receipt: receipt(d)
            }, {
                delivery: d, receipt: {
                    ...receipt(d), fingerprint: 'f'.repeat(64)
                }
            }, {
                delivery: d, receipt: {
                    ...receipt(d), subscriberId: 'other'
                }
            }, {
                delivery: d, receipt: {
                    ...receipt(d), binding: {
                        ...d.binding, ownerId: 'other'
                    }
                }
            }]) {
            await expect(f.repository().acknowledge(input)).resolves.toEqual({
                status: 'rejected'
            });
            expect((await row(f.eventId)).state).toBe('delivering');
        }
    });
    it('rejects coerced application receipt status without invoking user hooks or acknowledging', async () => {
        const f = await seed(), d = await delivery(f);
        let invoked = false;
        const forged = {
            ...receipt(d), status: {
                toString() {
                    invoked = true;
                    return 'committed';
                }
            }
        } as unknown as ApplicationReplyReceipt;
        expect(await f.repository().acknowledge({
            delivery: d, receipt: forged
        })).toEqual({
            status: 'rejected'
        });
        expect(invoked).toBe(false);
        expect((await row(f.eventId)).state).toBe('delivering');
    });
    it('expires and fences prior worker before reclaim', async () => {
        const f = await seed(), repo = f.repository({
            leaseSeconds: 1
        }), first = await repo.claim();
        expect(first.kind).toBe('claimed');
        if (first.kind !== 'claimed')
            throw Error('Expected delivery');
        await new Promise(resolve => setTimeout(resolve, 1200));
        expect(await repo.acknowledge({
            delivery: first.delivery, receipt: receipt(first.delivery)
        })).toEqual({
            status: 'rejected'
        });
        const next = await repo.claim();
        expect(next.kind).toBe('claimed');
        if (next.kind !== 'claimed')
            throw Error('Expected reclaimed delivery');
        expect(next.delivery.token).not.toBe(first.delivery.token);
        expect(await repo.acknowledge({
            delivery: first.delivery, receipt: receipt(first.delivery)
        })).toEqual({
            status: 'rejected'
        });
        expect(await repo.acknowledge({
            delivery: next.delivery, receipt: receipt(next.delivery)
        })).toEqual({
            status: 'acknowledged'
        });
    });
    it('rejects revoked grants for claim and acknowledgement while retaining ciphertext', async () => {
        const f = await seed(), d = await delivery(f);
        await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1', [f.binding.applicationId]);
        expect(await f.repository().claim()).toEqual({
            kind: 'forbidden'
        });
        expect(await f.repository().acknowledge({
            delivery: d, receipt: receipt(d)
        })).toEqual({
            status: 'rejected'
        });
        expect((await row(f.eventId)).state).toBe('delivering');
    });
    function delayAfterLockedOutboxRead(): SqlPool {
        return {
            async connect() {
                const client = await local.driver.connect();
                return {
                    async query<Row>(sql: string, values?: unknown[]) {
                        const result = await client.query<Row>(sql, values);
                        if (sql.includes('FROM communications.event_outbox') && sql.includes('WHERE o.event_id=$1'))
                            await client.query('SELECT pg_sleep(1.2)');
                        return result;
                    },
                    release(error?: Error) { client.release(error); }
                };
            }
        };
    }
    it('rechecks the database lease clock when expiry occurs after the locked ACK read', async () => {
        const f = await seed(), result = await f.repository({ leaseSeconds: 1 }).claim();
        if (result.kind !== 'claimed') throw Error('Expected delivery');
        const before = await row(f.eventId);
        expect(await f.repository({ pool: delayAfterLockedOutboxRead() }).acknowledge({
            delivery: result.delivery, receipt: receipt(result.delivery)
        })).toEqual({ status: 'rejected' });
        expect(await row(f.eventId)).toEqual(before);
    });
    it('rolls back the ACK when its locked owner grant expires during the transaction', async () => {
        const f = await seed(), d = await delivery(f), before = await row(f.eventId);
        await local.pool.query("UPDATE communications.access_grants SET expires_at=clock_timestamp()+interval '1 second' WHERE application_id=$1", [f.binding.applicationId]);
        expect(await f.repository({ pool: delayAfterLockedOutboxRead() }).acknowledge({
            delivery: d, receipt: receipt(d)
        })).toEqual({ status: 'rejected' });
        expect(await row(f.eventId)).toEqual(before);
    });
    it('accepts an exact terminal ACK replay after lease expiry without renewing its provenance', async () => {
        const f = await seed(), result = await f.repository({ leaseSeconds: 1 }).claim();
        if (result.kind !== 'claimed') throw Error('Expected delivery');
        expect(await f.repository().acknowledge({ delivery: result.delivery, receipt: receipt(result.delivery) }))
            .toEqual({ status: 'acknowledged' });
        const before = await row(f.eventId);
        await local.pool.query('SELECT pg_sleep(1.2)');
        expect(await f.repository().acknowledge({ delivery: result.delivery, receipt: receipt(result.delivery) }))
            .toEqual({ status: 'duplicate' });
        expect(await row(f.eventId)).toEqual(before);
    });
    it.each([{
            corruptTag: true
        }, {
            metadataDirection: 'outbound'
        }])('rejects stored authenticated ciphertext/metadata disagreement %# before leasing', async (change) => {
        const f = await seed('whatsapp', change);
        await expect(f.repository().claim()).rejects.toThrow(/^Outbox repository unavailable$/);
        expect(await row(f.eventId)).toMatchObject({
            state: 'pending', attempts: 0
        });
    });
    it('delivers already accepted original-generation evidence after reconnect and retirement', async () => {
        const f = await seed(), b = f.binding;
        await local.pool.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,2,$2,$3,$4,$5,$6,$7,'unipile','terminal-integration','v1','terminal-configuration','service','{}')", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, b.channel, b.platform]);
        await local.pool.query('UPDATE communications.connections SET current_generation=2,active=false WHERE id=$1', [b.connectionId]);
        const d = await delivery(f);
        expect(d.binding.generation).toBe(1);
        expect(await f.repository().acknowledge({
            delivery: d, receipt: receipt(d)
        })).toEqual({
            status: 'acknowledged'
        });
    });
    it('leaves delayed and dead-letter work pending for explicit recovery', async () => {
        const f = await seed();
        await local.pool.query("UPDATE communications.event_outbox SET retry_at=clock_timestamp()+interval '1 hour' WHERE event_id=$1", [f.eventId]);
        expect(await f.repository().claim()).toEqual({
            kind: 'busy'
        });
        expect((await row(f.eventId)).attempts).toBe(0);
        await local.pool.query("UPDATE communications.event_outbox SET state='dead_letter',retry_at=NULL WHERE event_id=$1", [f.eventId]);
        expect(await f.repository().claim()).toEqual({
            kind: 'busy'
        });
        expect((await row(f.eventId)).state).toBe('dead_letter');
    });
    it('never claims another configured subscriber', async () => {
        const f = await seed();
        expect(await f.repository({
            subscriberId: 'other-subscriber'
        }).claim()).toEqual({
            kind: 'busy'
        });
        expect((await row(f.eventId)).attempts).toBe(0);
    });
    it('reclaims after lost claim COMMIT only when its original lease expires', async () => {
        const f = await seed();
        let interrupted = false, discarded = false;
        const pool: SqlPool = {
            async connect() {
                const c = await local.driver.connect();
                return {
                    async query<Row>(sql: string, values?: unknown[]) {
                        const result = await c.query<Row>(sql, values);
                        if (sql === 'COMMIT' && !interrupted) {
                            interrupted = true;
                            throw Object.assign(Error('synthetic lost response'), {
                                code: 'ECONNRESET'
                            });
                        }
                        return result;
                    }, release(error?: Error) {
                        if (error)
                            discarded = true;
                        c.release(error);
                    }
                };
            }
        };
        await expect(f.repository({
            pool, leaseSeconds: 1
        }).claim()).rejects.toThrow(/^Outbox repository unavailable$/);
        expect(discarded).toBe(true);
        const previous = await row(f.eventId);
        expect(previous.state).toBe('delivering');
        expect(await f.repository().claim()).toEqual({
            kind: 'busy'
        });
        await new Promise(resolve => setTimeout(resolve, 1200));
        const next = await f.repository().claim();
        expect(next.kind).toBe('claimed');
        if (next.kind !== 'claimed')
            throw Error('Expected delivery');
        expect(next.delivery.token).not.toBe(previous.lease_token);
        expect((await row(f.eventId)).attempts).toBe(2);
        expect(await f.repository().acknowledge({
            delivery: {
                ...next.delivery, token: previous.lease_token
            }, receipt: receipt(next.delivery)
        })).toEqual({
            status: 'rejected'
        });
    });
    it('delivers encrypted review without inventing a message', async () => {
        const f = await seed('email', {
            review: true
        }), d = await delivery(f);
        expect(d.sourceNamespace).toBe('reply_review/v1');
        expect(d.payload.outcome).toEqual({
            kind: 'review', code: 'identity_pending'
        });
        expect(await f.repository().acknowledge({
            delivery: d, receipt: receipt(d)
        })).toEqual({
            status: 'acknowledged'
        });
    });
    it('recovers acknowledged outcome after lost COMMIT response without reopening', async () => {
        const f = await seed(), d = await delivery(f);
        let interrupted = false, discarded = false;
        const pool: SqlPool = {
            async connect() {
                const c = await local.driver.connect();
                return {
                    async query<Row>(sql: string, values?: unknown[]) {
                        const result = await c.query<Row>(sql, values);
                        if (sql === 'COMMIT' && !interrupted) {
                            interrupted = true;
                            throw Object.assign(Error('synthetic lost response'), {
                                code: 'ECONNRESET'
                            });
                        }
                        return result;
                    }, release(error?: Error) {
                        if (error)
                            discarded = true;
                        c.release(error);
                    }
                };
            }
        };
        await expect(f.repository({
            pool
        }).acknowledge({
            delivery: d, receipt: receipt(d)
        })).rejects.toThrow(/^Outbox repository unavailable$/);
        expect(discarded).toBe(true);
        const before = await row(f.eventId);
        expect(before.state).toBe('acknowledged');
        expect(await f.repository().acknowledge({
            delivery: d, receipt: {
                ...receipt(d), status: 'duplicate'
            }
        })).toEqual({
            status: 'duplicate'
        });
        expect(await row(f.eventId)).toEqual(before);
    });
});
