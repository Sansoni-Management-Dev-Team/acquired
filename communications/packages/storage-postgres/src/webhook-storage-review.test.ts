import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ConnectionBinding } from '../../contracts/src';
import type { WebhookCapture } from '../../core/src/reply-ingress';
import { WebhookCodec } from '../../core/src/webhook-codec';
import { createPostgresWebhookRepository, type SqlClient, type SqlResult } from './webhook-repository';

const binding: ConnectionBinding = { applicationId: 'app', tenantId: 'tenant', ownerId: 'owner', connectionId: 'conn', accountId: 'account', generation: 1, channel: 'linkedin', platform: 'linkedin', backend: 'unipile' };
const rawBody = Buffer.from('{"event":"message_received","account_id":"synthetic"}');
const key = createHash('sha256').update(JSON.stringify(['communications.webhook.receipt.v1', [binding.applicationId, binding.tenantId, binding.ownerId, binding.connectionId, binding.accountId, binding.generation, binding.channel, binding.platform, binding.backend], createHash('sha256').update(rawBody).digest('hex')])).digest('hex');
const capture: WebhookCapture = { binding, key, rawBody, receivedAt: '2026-10-12T10:00:00.000Z' };
const oldKey = { version: 'old', encryptionKey: new Uint8Array(32).fill(21), digestKey: new Uint8Array(32).fill(22) };
const newKey = { version: 'new', encryptionKey: new Uint8Array(32).fill(23), digestKey: new Uint8Array(32).fill(24) };
const originalCodec = new WebhookCodec({ activeVersion: 'old', keys: [oldKey] });
const scopeRow = { connection_id: binding.connectionId, application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId, account_id: binding.accountId, generation: binding.generation, channel: binding.channel, platform: binding.platform, backend: binding.backend, integration_id: 'integration', provider_configuration_reference: 'config', provider_api_version: 'v1', authority: 'service', active: true, grant_valid: true };
function fixture(patch: Record<string, unknown> = {}, codec = new WebhookCodec({ activeVersion: 'new', keys: [oldKey, newKey] })) {
  const row = { id: key, backend: 'unipile', integration_id: 'integration', dedupe_key: key, payload_digest: originalCodec.digest({ binding, key }, rawBody), encrypted_payload: JSON.stringify(originalCodec.encode(capture)), key_version: 'old', state: 'pending', alive: true, retry_due: true, lease_expired: true, ...patch };
  const queries: string[] = [];
  const query: SqlClient['query'] = async <Row = Record<string, unknown>>(sql: string): Promise<SqlResult<Row>> => {
    queries.push(sql);
    let rows: unknown[] = [];
    if (sql.includes('FROM pg_roles')) rows = [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }];
    else if (sql.includes('set_config')) rows = [];
    else if (sql.includes('to_regclass')) rows = [{ barrier: null }];
    else if (sql.includes('FROM communications.connections')) rows = [scopeRow];
    else if (sql.includes('FROM communications.webhook_inbox')) rows = [row];
    else if (!['BEGIN', 'COMMIT', 'ROLLBACK', 'SET LOCAL ROLE communications_control'].includes(sql) && !sql.startsWith('INSERT INTO communications.webhook_inbox')) throw new Error('Unexpected scripted SQL');
    return { rows: rows as Row[] };
  };
  const release = vi.fn();
  const client: SqlClient = { query, release };
  const repo = createPostgresWebhookRepository({ binding, integrationId: 'integration', providerConfigurationReference: 'config', subscriberId: 'acquire', pool: { connect: async () => client }, codec });
  return { repo, queries, release, row };
}
describe('independent webhook repository review with actual codec and scripted SQL (not database proof)', () => {
  it('recognizes exact retained-version duplicates after encryption and digest rotation', async () => {
    const f = fixture();
    expect(await f.repo.capture({ ...capture, receivedAt: '2026-10-12T11:00:00.000Z' })).toEqual({ binding, key, status: 'duplicate' });
    expect(f.queries.at(-1)).toBe('COMMIT');
    expect(f.queries.some(sql => sql.startsWith('UPDATE '))).toBe(false);
  });
  it('never acknowledges a duplicate when its required old key is unavailable', async () => {
    const f = fixture({}, new WebhookCodec({ activeVersion: 'new', keys: [newKey] }));
    await expect(f.repo.capture(capture)).rejects.toThrow('Webhook repository unavailable');
    expect(f.queries.at(-1)).toBe('ROLLBACK');
    expect(f.queries.some(sql => sql.includes('FROM communications.webhook_inbox'))).toBe(true);
  });
  it.each([{ state: 'pending', alive: false }, { state: 'processing', alive: false }, { state: 'dead_letter', alive: true }])('does not acknowledge an unprocessable duplicate ($state, alive=$alive)', async patch => {
    const f = fixture(patch);
    await expect(f.repo.capture(capture)).rejects.toThrow('Webhook repository unavailable');
    expect(f.queries).not.toContain('COMMIT');
    expect(f.queries.some(sql => sql.includes('FROM communications.webhook_inbox'))).toBe(true);
    expect(f.queries.some(sql => sql.startsWith('UPDATE '))).toBe(false);
  });
  it('can acknowledge a terminal processed duplicate without renewing expired retention', async () => {
    const f = fixture({ state: 'processed', alive: false });
    expect((await f.repo.capture(capture)).status).toBe('duplicate');
    expect(f.queries.some(sql => sql.startsWith('UPDATE '))).toBe(false);
  });
  it('rejects actual encrypted data authenticated to a foreign tenant before acknowledgement', async () => {
    const foreign = { ...capture, binding: { ...binding, tenantId: 'foreign' } };
    const f = fixture({ encrypted_payload: JSON.stringify(originalCodec.encode(foreign)) });
    await expect(f.repo.capture(capture)).rejects.toThrow('Webhook repository unavailable');
    expect(f.queries).not.toContain('COMMIT');
    expect(f.queries.some(sql => sql.includes('FROM communications.webhook_inbox'))).toBe(true);
  });
});
