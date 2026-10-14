import { it, expect, vi } from 'vitest';
import { createPostgresHistoryAliases } from './history-aliases';
import { HistoryCheckpointCodec } from './history-checkpoint-codec';
import type { SqlPool, SqlResult } from './webhook-repository';
import type { RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
const record: RecordedLifecycleConnection = { binding: { applicationId: 'a', tenantId: 't', ownerId: 'o', connectionId: 'c', accountId: 'p', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' }, providerAccountId: 'provider', sourceId: 'classic', ownerIdentity: { namespace: 'unipile.v1.linkedin.im.id', value: 'owner' } }, codec = new HistoryCheckpointCodec({ activeVersion: 'v1', keys: [{ version: 'v1', encryptionKey: Buffer.alloc(32, 31), digestKey: Buffer.alloc(32, 32) }] });
it('persists scoped encrypted peer identity with no provider/plain canonical identifiers in alias SQL', async () => {
    const queries: {
        sql: string;
        values: unknown[] | undefined;
    }[] = [];
    const client = { release: vi.fn(), query: async (sql: string, values?: unknown[]): Promise<SqlResult> => {
            queries.push({ sql, values });
            if (sql.includes('pg_roles'))
                return { rows: [{ role: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
            if (sql.includes('JOIN communications.access_grants'))
                return { rows: [{ valid: true }] };
            if (sql.includes('INSERT INTO communications.identity_aliases'))
                return { rows: [{ alias_digest: 'inserted' }] };
            return { rows: [] };
        } };
    const pool: SqlPool = { connect: async () => client as never };
    await createPostgresHistoryAliases({ pool, record, codec, product: 'classic' }).put('peer-private-provider', { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/peer-private/' });
    const insert = queries.find(q => q.sql.includes('INSERT INTO communications.identity_aliases'))!;
    expect(JSON.stringify(insert.values)).not.toContain('peer-private');
    expect(queries.at(-1)?.sql).toBe('COMMIT');
});
