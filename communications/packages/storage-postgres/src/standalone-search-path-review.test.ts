import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding } from '../../contracts/src';
import { WebhookCodec } from '../../core/src/webhook-codec';
import { createPostgresOutboxRepository } from './outbox-repository';
import { createPostgresWebhookRepository, type SqlClient, type SqlResult } from './webhook-repository';

const binding: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' };
const rawBody = Buffer.from('{"event":"synthetic"}');
const key = createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1', Object.values(binding), createHash('sha256').update(rawBody).digest('hex')])).digest('hex');
const capture = { binding, key, rawBody, receivedAt: '2026-10-13T00:00:00.000Z' };
const codec = new WebhookCodec({ activeVersion: 'search-path-v1', keys: [{ version: 'search-path-v1', encryptionKey: Buffer.alloc(32, 81), digestKey: Buffer.alloc(32, 82) }] });

// Models PostgreSQL's actual regclass display behavior reproduced on approved5446.
// Scripted driver assertions cover protocol ordering only, not SQL durability.
function fixture(kind: 'webhook' | 'outbox', installed: boolean, withFence: boolean) {
    const calls: string[] = [], lock = vi.fn(async () => { calls.push('fence.lock'); });
    const client: SqlClient = { async query<Row>(sql: string): Promise<SqlResult<Row>> {
        calls.push(sql); let rows: unknown[] = [];
        if (sql.includes('FROM pg_roles')) rows = [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }];
        else if (sql.includes('to_regclass')) rows = [{ barrier: /IS NOT NULL/.test(sql) ? installed : installed ? 'tenant_reply_barriers' : null }];
        else if (sql.includes('FROM communications.connections')) rows = [{ connection_id: binding.connectionId, application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId, account_id: binding.accountId, generation: binding.generation, channel: binding.channel, platform: binding.platform, backend: binding.backend, grant_valid: true, integration_id: 'integration', provider_configuration_reference: 'config', provider_api_version: 'v1', authority: 'service', active: true }];
        else if (sql.startsWith('INSERT INTO communications.webhook_inbox')) rows = [{ id: key }];
        return { rows: rows as Row[] };
    }, release: vi.fn() };
    const pool = { async connect() { return client; } };
    const run = kind === 'webhook'
        ? () => createPostgresWebhookRepository({ pool, binding, integrationId: 'integration', providerConfigurationReference: 'config', subscriberId: 'subscriber', codec, ...(withFence ? { replyBarrier: { lock, async route() { return { revision: '1' }; }, async review() {} } } : {}) }).capture(capture)
        : () => createPostgresOutboxRepository({ pool, binding, subscriberId: 'subscriber', codec: { decode() { throw Error('Unexpected event decode'); } }, ...(withFence ? { replyBarrier: { lock } } : {}) }).claim();
    return { calls, lock, run };
}

describe.each(['webhook', 'outbox'] as const)('%s standalone schema presence protocol', kind => {
    it('accepts an installed fence when communications is visible in search_path', async () => {
        const f = fixture(kind, true, true);
        await expect(f.run()).resolves.toMatchObject(kind === 'webhook' ? { status: 'accepted' } : { kind: 'busy' });
        expect(f.lock).toHaveBeenCalledOnce();
        expect(f.calls.find(sql => sql.includes('to_regclass'))).toContain('IS NOT NULL');
        expect(f.calls.indexOf('fence.lock')).toBeLessThan(f.calls.findIndex(sql => sql.includes('FROM communications.connections')));
        expect(f.calls.at(-1)).toBe('COMMIT');
    });
    it('requires the fence port before scope/work queries when the table exists', async () => {
        const f = fixture(kind, true, false);
        await expect(f.run()).rejects.toThrow();
        expect(f.lock).not.toHaveBeenCalled();
        expect(f.calls.some(sql => sql.includes('FROM communications.connections'))).toBe(false);
        expect(f.calls).not.toContain('COMMIT');
    });
    it('preserves the unfenced pre-barrier schema path when the table is absent', async () => {
        const f = fixture(kind, false, false);
        await expect(f.run()).resolves.toMatchObject(kind === 'webhook' ? { status: 'accepted' } : { kind: 'busy' });
        expect(f.lock).not.toHaveBeenCalled();
        expect(f.calls.at(-1)).toBe('COMMIT');
    });
});
