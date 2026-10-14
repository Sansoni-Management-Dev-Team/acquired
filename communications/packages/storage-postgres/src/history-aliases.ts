import { createHash } from 'node:crypto';
import { assertSameBinding, type CanonicalIdentity } from '../../contracts/src';
import { parseLifecycleRecord, type RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
import { parseHistoryOutbound } from '../../core/src/history-backfill';
import type { HistoryCheckpointCodec } from './history-checkpoint-codec';
import type { SqlPool, SqlClient } from './webhook-repository';
import { historyTransaction } from './history-transaction';
export interface HistoryAliasOptions {
    pool: SqlPool;
    record: RecordedLifecycleConnection;
    codec: HistoryCheckpointCodec;
    product: string;
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fail(): never { throw Error('History alias unavailable'); }
export function createPostgresHistoryAliases(options: HistoryAliasOptions): {
    get(providerId: string, signal?: AbortSignal): Promise<CanonicalIdentity | null>;
    put(providerId: string, identity: CanonicalIdentity, signal?: AbortSignal): Promise<void>;
} {
    const record = parseLifecycleRecord(options.record), b = record.binding, codec = options.codec, product = options.product, namespace = `unipile.v1.history-peer.${hash([record.sourceId, product])}`, tx = historyTransaction(options.pool), keyVersion = codec.keyVersion, versions = codec.versions();
    const alias = (p: string, v: string) => codec.digest(b, hash(['communications.history.alias.v1', namespace, p]), v), identityDigest = (i: CanonicalIdentity, v: string) => codec.digest(b, hash(['communications.history.canonical.v1', i]), v);
    const verify = async (c: SqlClient) => {
        await c.query('SELECT communications.lock_reply_barrier($1,$2)', [b.applicationId, b.tenantId]);
        await c.query('SELECT id FROM communications.physical_accounts WHERE id=$1 FOR UPDATE', [b.accountId]);
        const row = await c.query(`SELECT true AS valid FROM communications.connections c JOIN communications.access_grants ag ON ag.application_id=c.application_id AND ag.tenant_id=c.tenant_id AND ag.owner_id=c.owner_id WHERE c.id=$1 AND c.current_generation=$2 AND c.account_id=$3 AND c.application_id=$4 AND c.tenant_id=$5 AND c.owner_id=$6 AND c.active AND ag.revoked_at IS NULL AND ag.expires_at>clock_timestamp() FOR SHARE OF c,ag`, [b.connectionId, b.generation, b.accountId, b.applicationId, b.tenantId, b.ownerId]);
        if (row.rows.length !== 1 || row.rows[0].valid !== true)
            fail();
    };
    const rows = async (c: SqlClient, p: string) => c.query(`SELECT alias_digest,canonical_kind,canonical_digest,encrypted_identity,key_version,verified_at FROM communications.identity_aliases WHERE connection_id=$1 AND generation=$2 AND namespace=$3 AND alias_digest=ANY($4::text[]) FOR SHARE`, [b.connectionId, b.generation, namespace, versions.map(v => alias(p, v))]);
    const opened = (p: string, row: Record<string, unknown>) => {
        if (typeof row.key_version !== 'string' || row.alias_digest !== alias(p, row.key_version))
            fail();
        const env = JSON.parse(String(row.encrypted_identity));
        if (env.keyVersion !== row.key_version)
            fail();
        const value = codec.open(b, alias(p, row.key_version), env) as {
            record: RecordedLifecycleConnection;
            providerId: string;
            product: string;
            identity: CanonicalIdentity;
        };
        assertSameBinding(b, value.record.binding);
        if (value.record.providerAccountId !== record.providerAccountId || value.record.sourceId !== record.sourceId || value.record.ownerIdentity.namespace !== record.ownerIdentity.namespace || value.record.ownerIdentity.value !== record.ownerIdentity.value || value.providerId !== p || value.product !== product || value.identity.kind !== row.canonical_kind || identityDigest(value.identity, row.key_version) !== row.canonical_digest)
            fail();
        return parseHistoryOutbound({ binding: b, reference: { binding: b, id: 'identity-proof' }, recipient: value.identity, occurredAt: '2026-01-01T00:00:00.000Z' }, b).recipient;
    };
    const id = (p: string) => {
        if (typeof p !== 'string' || !p.length || p.length > 2048 || p.trim() !== p || /[\u0000-\u001f\u007f]/.test(p))
            fail();
    };
    return { async get(p, signal) {
            id(p);
            return tx(signal, async (c) => {
                await verify(c);
                const result = await rows(c, p);
                let identity: CanonicalIdentity | null = null;
                for (const row of result.rows) {
                    const found = opened(p, row);
                    if (identity && JSON.stringify(identity) !== JSON.stringify(found))
                        fail();
                    identity = found;
                }
                await verify(c);
                return identity;
            });
        }, async put(p, input, signal) {
            id(p);
            const identity = parseHistoryOutbound({ binding: b, reference: { binding: b, id: 'identity-proof' }, recipient: input, occurredAt: '2026-01-01T00:00:00.000Z' }, b).recipient;
            await tx(signal, async (c) => {
                await verify(c);
                const existing = await rows(c, p);
                for (const row of existing.rows)
                    if (JSON.stringify(opened(p, row)) !== JSON.stringify(identity))
                        fail();
                if (existing.rows.length === 0) {
                    const encrypted = codec.seal(b, alias(p, keyVersion), { record, providerId: p, product, identity });
                    const inserted = await c.query(`INSERT INTO communications.identity_aliases(application_id,tenant_id,owner_id,connection_id,generation,account_id,namespace,alias_digest,canonical_kind,canonical_digest,encrypted_identity,key_version,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp()) ON CONFLICT DO NOTHING RETURNING alias_digest`, [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.generation, b.accountId, namespace, alias(p, keyVersion), identity.kind, identityDigest(identity, keyVersion), JSON.stringify(encrypted), keyVersion]);
                    if (inserted.rows.length !== 1)
                        fail();
                }
                await verify(c);
            });
        } };
}
