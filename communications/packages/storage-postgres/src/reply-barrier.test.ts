import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding } from '../../contracts/src';
import type { WebhookCapture } from '../../core/src/reply-ingress';
import { createPostgresReplyBarrier, type ReplyBarrierOptions } from './reply-barrier';
import type { SqlClient, SqlResult } from './webhook-repository';
const binding: ConnectionBinding = {
    applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'conn', accountId: 'account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile'
};
const scope = [binding.applicationId, binding.tenantId, binding.ownerId, binding.connectionId, binding.accountId, binding.generation, binding.channel, binding.platform, binding.backend], hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const rawBody = new Uint8Array([1, 2, 3]), key = hash(['communications.webhook.receipt.v1', scope, createHash('sha256').update(rawBody).digest('hex')]);
const capture: WebhookCapture = {
    binding, key, rawBody, receivedAt: '2026-10-12T10:00:00.000Z'
};
const envelope = {
    format: 'communications-webhook-v1', keyVersion: 'w1', nonce: 'synthetic', ciphertext: 'synthetic-encrypted', tag: 'synthetic'
};
const role = {
    role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false, transaction_id: '100'
};
const routeRow = {
    webhook_inbox_id: key, application_id: 'app', tenant_id: 'tenant', owner_id: 'owner', connection_id: 'conn', generation: 1, account_id: 'account', capture_revision: '1', tenant_revision: '1'
};
const inbox = {
    id: key, backend: 'unipile', integration_id: 'integration', dedupe_key: key, payload_digest: 'b'.repeat(64), encrypted_payload: JSON.stringify(envelope), key_version: 'w1', connection_id: 'conn', generation: 1, application_id: 'app', tenant_id: 'tenant', owner_id: 'owner', account_id: 'account', channel: 'whatsapp', platform: 'whatsapp', generation_backend: 'unipile', generation_integration_id: 'integration'
};
type Step = {
    sql: RegExp;
    rows?: Record<string, unknown>[];
    fail?: boolean;
};
function driver(steps: Step[]) {
    const calls: {
        sql: string;
        values?: unknown[];
    }[] = [], release = vi.fn();
    const query = async <Row>(sql: string, values?: unknown[]): Promise<SqlResult<Row>> => {
        calls.push({
            sql, values
        });
        const step = steps.shift();
        if (!step || !step.sql.test(sql))
            throw Error('Unexpected scripted protocol');
        if (step.fail)
            throw Error('private database details');
        return {
            rows: (step.rows ?? []) as Row[]
        };
    };
    const client: SqlClient = {
        query, release
    };
    return {
        client, calls, release, steps
    };
}
const lockSteps = (): Step[] => [{
        sql: /FROM pg_roles/, rows: [role]
    }, {
        sql: /lock_reply_barrier/, rows: [{
                revision: '0', transaction_id: '100'
            }]
    }];
const checkStep = (): Step => ({
    sql: /FROM pg_roles/, rows: [role]
});
function options(changes: Partial<ReplyBarrierOptions> = {}): ReplyBarrierOptions {
    return {
        binding: structuredClone(binding), integrationId: 'integration', codec: {
            encode() {
                return envelope;
            }, decode: vi.fn(() => structuredClone(capture)), digest: vi.fn(() => 'b'.repeat(64))
        }, ...changes
    };
}
describe('tenant-first reply barrier SQL port (scripted protocol only,003 unapplied)', () => {
    it('locks only configured tenant with restricted role and validates database revision', async () => {
        const d = driver(lockSteps()), port = createPostgresReplyBarrier(options());
        await expect(port.lock(d.client, 'app', 'tenant')).resolves.toBeUndefined();
        expect(d.calls[1].values).toEqual(['app', 'tenant']);
        expect(d.client.release).not.toHaveBeenCalled();
        expect(d.calls.some(c => /BEGIN|COMMIT|ROLLBACK/.test(c.sql))).toBe(false);
    });
    it.each([{
            backend: 'direct', channel: 'email', platform: 'gmail'
        }, {
            backend: 'baileys', channel: 'whatsapp', platform: 'whatsapp'
        }, {
            backend: 'browser', channel: 'linkedin', platform: 'linkedin'
        }] as const)('locks tenant for recorded legacy $backend binding without changing its backend', async (patch) => {
        const d = driver(lockSteps()), config = options({
            binding: {
                ...binding, ...patch
            }
        }), port = createPostgresReplyBarrier(config);
        await expect(port.lock(d.client, 'app', 'tenant')).resolves.toBeUndefined();
        expect(config.binding.backend).toBe(patch.backend);
    });
    it('rejects caller tenant spoofing before SQL', async () => {
        const d = driver([]), port = createPostgresReplyBarrier(options());
        await expect(port.lock(d.client, 'other', 'tenant')).rejects.toThrow(/^Reply barrier unavailable$/);
        expect(d.calls).toHaveLength(0);
    });
    it.each(['-1', '01', 'private', '9223372036854775808', null])('rejects invalid database revision %s', async (revision) => {
        const d = driver([{
                ...lockSteps()[0]
            }, {
                sql: /lock_reply_barrier/, rows: [{
                        revision, transaction_id: '100'
                    }]
            }]);
        await expect(createPostgresReplyBarrier(options()).lock(d.client, 'app', 'tenant')).rejects.toThrow(/^Reply barrier unavailable$/);
    });
    it.each([{
            rolsuper: true
        }, {
            rolbypassrls: true
        }, {
            rolcanlogin: true
        }, {
            role_name: 'other'
        }])('rejects unsafe effective role %#', async (patch) => {
        const d = driver([{
                sql: /FROM pg_roles/, rows: [{
                        ...role, ...patch
                    }]
            }]);
        await expect(createPostgresReplyBarrier(options()).lock(d.client, 'app', 'tenant')).rejects.toThrow(/^Reply barrier unavailable$/);
        expect(d.calls.some(c => /lock_reply_barrier/.test(c.sql))).toBe(false);
    });
    it('refuses route without a prior tenant lock', async () => {
        const d = driver([]);
        await expect(createPostgresReplyBarrier(options()).route(d.client, capture)).rejects.toThrow(/^Reply barrier unavailable$/);
        expect(d.calls).toHaveLength(0);
    });
    it('rejects a reused client from another transaction before route work rows', async () => {
        const d = driver([...lockSteps(), {
                sql: /FROM pg_roles/, rows: [{
                        ...role, transaction_id: '101'
                    }]
            }]), port = createPostgresReplyBarrier(options());
        await port.lock(d.client, 'app', 'tenant');
        await expect(port.route(d.client, capture)).rejects.toThrow(/^Reply barrier unavailable$/);
        expect(d.calls.some(c => /webhook_inbox/.test(c.sql))).toBe(false);
    });
    it('routes verified original ciphertext exactly and returns persisted capture revision', async () => {
        const d = driver([...lockSteps(), checkStep(), {
                sql: /FROM communications.webhook_inbox/, rows: [inbox]
            }, {
                sql: /INSERT INTO communications.webhook_receipt_routes/
            }, {
                sql: /FROM communications.webhook_receipt_routes/, rows: [routeRow]
            }]), config = options(), port = createPostgresReplyBarrier(config);
        await port.lock(d.client, 'app', 'tenant');
        expect(await port.route(d.client, capture)).toEqual({
            revision: '1'
        });
        expect(config.codec.decode).toHaveBeenCalledWith({
            binding, key
        }, envelope);
        expect(config.codec.digest).toHaveBeenCalledWith({
            binding, key
        }, expect.any(Uint8Array), 'w1');
        expect(d.calls.find(c => /INSERT INTO/.test(c.sql))!.sql).toContain('ON CONFLICT');
    });
    it.each(['body', 'version', 'source', 'route_scope'])('rejects inconsistent original %s without changing route', async (kind) => {
        const row = {
            ...inbox, ...(kind === 'version' ? {
                key_version: 'other'
            } : kind === 'source' ? {
                integration_id: 'other'
            } : {})
        }, d = driver([...lockSteps(), checkStep(), {
                sql: /FROM communications.webhook_inbox/, rows: [row]
            }, ...(kind === 'route_scope' ? [{
                    sql: /INSERT INTO communications.webhook_receipt_routes/
                }, {
                    sql: /FROM communications.webhook_receipt_routes/, rows: [{
                            ...routeRow, owner_id: 'other'
                        }]
                }] : [])]), config = options();
        if (kind === 'body')
            config.codec.decode = () => ({
                ...capture, rawBody: new Uint8Array([9])
            });
        const port = createPostgresReplyBarrier(config);
        await port.lock(d.client, 'app', 'tenant');
        await expect(port.route(d.client, capture)).rejects.toThrow(/^Reply barrier unavailable$/);
        if (kind !== 'route_scope')
            expect(d.calls.some(c => /INSERT INTO/.test(c.sql))).toBe(false);
    });
    it('rejects foreign caller binding/key before route SQL', async () => {
        const d = driver(lockSteps()), port = createPostgresReplyBarrier(options());
        await port.lock(d.client, 'app', 'tenant');
        await expect(port.route(d.client, {
            ...capture, binding: {
                ...binding, generation: 2
            }
        })).rejects.toThrow(/^Reply barrier unavailable$/);
        expect(d.calls).toHaveLength(2);
    });
    it('captures fixed configuration before awaiting SQL', async () => {
        const d = driver(lockSteps()), config = options(), port = createPostgresReplyBarrier(config);
        config.binding.ownerId = 'other';
        config.integrationId = 'other';
        await port.lock(d.client, 'app', 'tenant');
        expect(d.calls[1].values).toEqual(['app', 'tenant']);
    });
    it('never resolves or rewrites a resolved review on replay', async () => {
        const reviewPayload = {
            outcome: {
                kind: 'review' as const, code: 'protocol' as const
            }, fingerprint: hash(['communications.reply.review.v1', scope, key, 'protocol']), receivedAt: capture.receivedAt
        }, eventEnvelope = {
            format: 'communications-event-v1' as const, keyVersion: 'e1', nonce: 'synthetic', ciphertext: 'synthetic', tag: 'synthetic'
        }, event = {
            id: '1', application_id: 'app', tenant_id: 'tenant', owner_id: 'owner', connection_id: 'conn', generation: 1, account_id: 'account', source_namespace: 'reply_review/v1', source_event_key: key, event_type: 'account', direction: null, occurred_at: capture.receivedAt, encrypted_event: JSON.stringify(eventEnvelope), key_version: 'e1'
        };
        const d = driver([...lockSteps(), checkStep(), {
                sql: /FROM communications.events/, rows: [event]
            }, {
                sql: /INSERT INTO communications.reply_review_latches/
            }, {
                sql: /FROM communications.reply_review_latches/, rows: [{
                        event_id: '1', application_id: 'app', tenant_id: 'tenant', owner_id: 'owner', code: 'protocol', resolved_at: capture.receivedAt, resolution_reference: 'approved-resolution'
                    }]
            }]), port = createPostgresReplyBarrier(options({
            eventCodec: {
                encode() {
                    return eventEnvelope;
                }, decode() {
                    return reviewPayload;
                }
            }
        }));
        await port.lock(d.client, 'app', 'tenant');
        await expect(port.review(d.client, {
            eventId: '1', code: 'protocol'
        })).resolves.toBeUndefined();
        expect(d.calls.some(c => /UPDATE|DELETE/.test(c.sql))).toBe(false);
    });
    it('requires a review codec and preceding tenant lock', async () => {
        const d = driver([]);
        await expect(createPostgresReplyBarrier(options()).review(d.client, {
            eventId: '1', code: 'protocol'
        })).rejects.toThrow(/^Reply barrier unavailable$/);
        expect(d.calls).toHaveLength(0);
    });
});
it('routes the exact authenticated local event provenance while rejecting a substituted epoch',async()=>{const {localSyncReceiptKey}=await import('../../core/src/local-sync-event'),localSync={version:'local-sync-v1' as const,eventId:'sim-event-10000000-0000-4000-8000-000000000001',setupNonce:'a'.repeat(43),bodyDigest:createHash('sha256').update(rawBody).digest('hex'),signature:'b'.repeat(64)},localCapture={...capture,localSync,key:localSyncReceiptKey(binding,rawBody,localSync)},config=options();config.codec.decode=()=>structuredClone(localCapture);const localInbox={...inbox,id:localCapture.key,dedupe_key:localCapture.key},localRoute={...routeRow,webhook_inbox_id:localCapture.key};for(const changed of [false,true]){const d=driver([...lockSteps(),checkStep(),{sql:/FROM communications.webhook_inbox/,rows:[localInbox]},...(changed?[]:[{sql:/INSERT INTO communications.webhook_receipt_routes/},{sql:/FROM communications.webhook_receipt_routes/,rows:[localRoute]}])]),port=createPostgresReplyBarrier(config);await port.lock(d.client,'app','tenant');const incoming=changed?{...localCapture,localSync:{...localSync,setupNonce:'c'.repeat(43)}}:localCapture;if(changed){await expect(port.route(d.client,incoming)).rejects.toThrow();expect(d.calls.some(c=>/INSERT INTO/.test(c.sql))).toBe(false);}else expect(await port.route(d.client,incoming)).toEqual({revision:'1'});}});
