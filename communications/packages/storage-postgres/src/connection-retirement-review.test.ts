import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RecordedLifecycleConnection } from '../../core/src/connection-lifecycle';
import { ConnectionRetirementCodec, createPostgresConnectionRetirement, type ConnectionRetirementOptions } from './connection-retirement';
import type { SqlClient } from './webhook-repository';
// Scripted DB-clock expiry review only; real transactional retirement proof requires approved003.
const record: RecordedLifecycleConnection = { binding: { applicationId: 'retire-review-app', tenantId: 'retire-review-tenant', ownerId: 'retire-review-owner', connectionId: 'retire-review-connection', accountId: 'retire-review-account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' }, providerAccountId: 'retire-review-provider', sourceId: 'retire-review-source', ownerIdentity: { namespace: 'unipile.v1.whatsapp.im.phone_number', value: '+15550000431' } };
const identity = { namespace: 'phone', value: '+15550000431' };
const keyed = (v: unknown) => createHmac('sha256', Buffer.alloc(32, 131)).update(JSON.stringify(v)).digest('hex');
function fixture(expireOn: 'prepare' | 'finish' | 'replay') {
  const codec = new ConnectionRetirementCodec({ activeVersion: 'review-retirement-v1', keys: [{ version: 'review-retirement-v1', encryptionKey: Buffer.alloc(32, 132), digestKey: Buffer.alloc(32, 133) }] });
  let expired = false, expireDecode = false, stored: Record<string, unknown> | undefined;
  const statements: string[] = [];
  const generation = { connection_id: record.binding.connectionId, application_id: record.binding.applicationId, tenant_id: record.binding.tenantId, owner_id: record.binding.ownerId, account_id: record.binding.accountId, generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile', current_generation: 1, current_account_id: record.binding.accountId, active: true, integration_id: 'retire-review-integration', provider_api_version: 'v1', provider_configuration_reference: 'retire-review-configuration', authority: 'service', provider_account_digest: keyed(record.providerAccountId), provider_account_key_version: 'provider-v1', encrypted_provider_account_id: 'synthetic-encrypted', credential_reference: 'synthetic-owner-vault', status_observed_future: false };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    statements.push(sql);
    if (sql.includes('pg_roles')) return { rows: [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    if (sql.includes('lock_reply_barrier')) return { rows: [{ revision: '0' }] };
    if (sql.includes('FROM communications.physical_accounts')) return { rows: [{ id: record.binding.accountId, channel: record.binding.channel, verified: true, identity_namespace: identity.namespace, identity_digest: keyed(identity), identity_key_version: 'physical-v1' }] };
    if (sql.startsWith('SELECT c.id AS connection_id')) return { rows: [generation] };
    if (sql.includes('FROM communications.access_grants')) return { rows: [{ application_id: record.binding.applicationId, tenant_id: record.binding.tenantId, owner_id: record.binding.ownerId, valid: !expired }] };
    if (sql.includes('AS shared')) return { rows: [{ shared: false, journal: false, lease: false, setup: false }] };
    if (sql.startsWith('INSERT INTO communications.connection_retirements')) {
      stored = Object.fromEntries(['id', 'application_id', 'tenant_id', 'owner_id', 'connection_id', 'generation', 'account_id', 'channel', 'platform', 'backend', 'operation_key', 'record_fingerprint', 'fingerprint_key_version', 'encrypted_record', 'record_key_version', 'token_hash'].map((key, i) => [key, values[i]]));
      Object.assign(stored, { state: 'pending', encrypted_outcome: null, outcome_key_version: null });
      if (expireOn === 'prepare') expired = true;
      return { rows: [stored] };
    }
    if (sql.startsWith('UPDATE communications.connection_retirements')) {
      Object.assign(stored!, { state: values[1], encrypted_outcome: values[2], outcome_key_version: values[3] });
      if (expireOn === 'finish') expired = true;
      return { rows: [stored!] };
    }
    if (sql.includes('FROM communications.connection_retirements')) return { rows: stored ? [stored] : [] };
    return { rows: [] };
  });
  const options: ConnectionRetirementOptions = { pool: { connect: async () => ({ query, release() {} } as SqlClient) }, record, integrationId: 'retire-review-integration', providerConfigurationReference: 'retire-review-configuration', codec: { keyVersion: codec.keyVersion, encode: codec.encode.bind(codec), digest: codec.digest.bind(codec), decode: (...args) => { const value = codec.decode(...args); if (expireDecode) expired = true; return value; } }, verifyRecordedIdentity: async () => ({ record: structuredClone(record), physicalIdentity: identity }), providerAccountDigest: v => keyed(v), physicalIdentityDigest: v => keyed(v) };
  return { repo: createPostgresConnectionRetirement(options), statements, expireOnDecode: () => { expireDecode = true; } };
}
describe('independent retirement final authorization review', () => {
  it('does not return a successful duplicate after current authority expires while decoding historical retirement evidence', async () => {
    const f = fixture('replay'), signal = new AbortController().signal;
    const prepared = await f.repo.prepareDisconnect(record, 'retire-review-operation', signal);
    if (prepared.status !== 'prepared') throw Error('Valid synthetic initial prepare required');
    expect(await f.repo.finishDisconnect(prepared.ticket, { status: 'disconnected' }, signal)).toEqual({ status: 'recorded' });
    f.statements.length = 0; f.expireOnDecode();
    const replay = await f.repo.prepareDisconnect(record, 'retire-review-operation', signal).catch(error => { expect(error).toBeInstanceOf(Error); expect(error.message).toBe('Connection retirement unavailable'); return { status: 'review' as const }; });
    expect(replay).toEqual({ status: 'review' });
    expect(f.statements.some(sql => sql.startsWith('INSERT INTO communications.connection_retirements') || sql.startsWith('UPDATE communications.connection_retirements'))).toBe(false);
  });
  it('does not attest an already-terminal result after current authority expires while decoding retained evidence', async () => {
    const f = fixture('replay'), signal = new AbortController().signal;
    const prepared = await f.repo.prepareDisconnect(record, 'retire-review-operation', signal);
    if (prepared.status !== 'prepared') throw Error('Valid synthetic initial prepare required');
    expect(await f.repo.finishDisconnect(prepared.ticket, { status: 'disconnected' }, signal)).toEqual({ status: 'recorded' });
    f.statements.length = 0; f.expireOnDecode();
    expect(await f.repo.finishDisconnect(prepared.ticket, { status: 'disconnected' }, signal)).toEqual({ status: 'unknown' });
    expect(f.statements.some(sql => sql.startsWith('INSERT INTO communications.connection_retirements') || sql.startsWith('UPDATE communications.connection_retirements'))).toBe(false);
  });
  it('does not commit or return a fresh deletion ticket after the grant expires during retirement application', async () => {
    const f = fixture('prepare');
    await expect(f.repo.prepareDisconnect(record, 'retire-review-operation', new AbortController().signal)).rejects.toThrow('Connection retirement unavailable');
    expect(f.statements).not.toContain('COMMIT');
  });
  it('does not report a terminal disconnect recorded when authority expires during the final write', async () => {
    const f = fixture('finish'), signal = new AbortController().signal;
    const prepared = await f.repo.prepareDisconnect(record, 'retire-review-operation', signal);
    if (prepared.status !== 'prepared') throw Error('Valid synthetic initial prepare required');
    f.statements.length = 0;
    expect(await f.repo.finishDisconnect(prepared.ticket, { status: 'disconnected' }, signal)).toEqual({ status: 'unknown' });
    expect(f.statements).not.toContain('COMMIT');
  });
});
