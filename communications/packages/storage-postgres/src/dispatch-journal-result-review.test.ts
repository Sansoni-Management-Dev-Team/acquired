import { createHmac } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import type { CanonicalIdentity, ConnectionBinding, DeliveryOutcome, OperationSnapshot } from '../../contracts/src';
import type { DispatchRecord } from '../../core/src/dispatch';
import { JournalCodec } from '../../core/src/journal-codec';
import { createPostgresDispatchJournal, type PostgresDispatchJournalOptions } from './dispatch-journal';
import type { SqlClient } from './webhook-repository';

// Scripted SQL supplies valid encrypted immutable evidence only to review callback
// capture. These cases are not PostgreSQL persistence, grant or provider-read proof.
const binding: ConnectionBinding = { applicationId: 'result-review-app', tenantId: 'result-review-tenant', ownerId: 'result-review-owner', connectionId: 'result-review-connection', accountId: 'result-review-account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' };
const snapshot: OperationSnapshot = { binding, key: 'result-review-operation', operation: 'message', payloadDigest: 'a'.repeat(64) };
const recipient: CanonicalIdentity = { kind: 'phone', value: '+15550000321' };
const codec = new JournalCodec({ activeVersion: 'result-review-key', keys: [{ version: 'result-review-key', encryptionKey: Buffer.alloc(32, 121), digestKey: Buffer.alloc(32, 122) }] });
const recipientDigest = { keyVersion: 'result-review-identity', digest: (r: CanonicalIdentity, version: string) => createHmac('sha256', Buffer.alloc(32, 123)).update(JSON.stringify([version, r.kind, r.value])).digest('hex') };
const unknown: DispatchRecord = { snapshot, recipient, state: 'unknown', outcome: { status: 'unknown' } };
const accepted: DeliveryOutcome = { status: 'submitted', receipt: { message: { binding, id: 'verified-original-message' }, recipient } };
function fixture(verifyReconciliation: NonNullable<PostgresDispatchJournalOptions['verifyReconciliation']>, onQuery?: (sql: string) => void) {
  const encrypted = codec.encode(snapshot, 'context', { recipient });
  let row: Record<string, unknown> = { id: 'result-review-row', application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId, operation_key: snapshot.key, connection_id: binding.connectionId, generation: binding.generation, account_id: binding.accountId, operation: snapshot.operation, payload_digest: snapshot.payloadDigest, recipient_digest: recipientDigest.digest(recipient, recipientDigest.keyVersion), digest_version: 'message-v1', recipient_key_version: recipientDigest.keyVersion, encrypted_operation_context: JSON.stringify(encrypted), operation_context_key_version: encrypted.keyVersion, operation_context_digest: codec.digest(snapshot, 'context', { recipient }), state: 'unknown', claim_token: 'original-private-claim', claim_until: new Date(Date.now() - 60000), fencing_token: '1', lease_owner_token: 'original-worker', quota_reserved: true, encrypted_receipt: null, receipt_key_version: null, outcome_status: null, encrypted_outcome: null, outcome_key_version: null, submitted_at: null, delivered_at: null, read_at: null, claim_alive: false };
  const sql: string[] = [];
  const client = { release() {}, async query(query: string, values: unknown[] = []) {
    sql.push(query); onQuery?.(query);
    if (query.includes('FROM pg_roles')) return { rows: [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
    if (query.includes('lock_reply_barrier')) return { rows: [{ revision: '0' }] };
    if (query.includes('FROM communications.connections')) return { rows: [{ connection_id: binding.connectionId, application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId, channel: binding.channel, platform: binding.platform, backend: binding.backend, current_generation: 1, current_account_id: binding.accountId, active: true, status: 'connected', generation: 1, account_id: binding.accountId, integration_id: 'result-review-integration', provider_api_version: 'v1', provider_configuration_reference: 'result-review-configuration', authority: 'service' }] };
    if (query.includes('FROM communications.access_grants')) return { rows: [{ application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId }] };
    if (query.includes('FROM communications.physical_accounts')) return { rows: [{ id: binding.accountId, channel: binding.channel, verified_at: new Date() }] };
    if (query.startsWith('UPDATE communications.operation_journal')) {
      row = { ...row, state: 'submitted', encrypted_receipt: values[4], receipt_key_version: values[5], submitted_at: values[6], delivered_at: values[7], read_at: values[8], resolution_evidence_digest: values[9] };
      return { rows: [row] };
    }
    if (query.includes('FROM communications.operation_journal')) return { rows: [row] };
    return { rows: [] };
  } } as unknown as SqlClient;
  const options: PostgresDispatchJournalOptions = { pool: { async connect() { return client; } }, binding, integrationId: 'result-review-integration', providerConfigurationReference: 'result-review-configuration', providerApiVersion: 'v1', authority: 'service', leaseOwnerToken: 'review-reconciliation-worker', codec, recipientDigest, verifyReconciliation, transactionTimeoutMs: 1000, statementTimeoutMs: 900, lockTimeoutMs: 100 };
  return { options, sql };
}
describe('independent journal result callback capture review', () => {
  it('cannot commit reconciliation after its two database phases exceed the whole 30-second deadline', async () => {
    let clock = 0, commits = 0;
    const now = vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const verifier = vi.fn<NonNullable<PostgresDispatchJournalOptions['verifyReconciliation']>>(async () => { clock = 21000; return accepted; });
    const f = fixture(verifier, sql => {
      if (sql === 'COMMIT' && ++commits === 1) clock = 19000;
      if (sql.startsWith('UPDATE communications.operation_journal')) clock = 32000;
    });
    Object.assign(f.options, { transactionTimeoutMs: 20000, statementTimeoutMs: 5000, lockTimeoutMs: 1000, reconciliationTimeoutMs: 3000 });
    try {
      await expect(createPostgresDispatchJournal(f.options).reconcile({ record: unknown, outcome: accepted })).rejects.toThrow('Dispatch journal unavailable');
      expect(verifier).toHaveBeenCalledOnce();
      expect(f.sql.filter(sql => sql === 'COMMIT')).toHaveLength(1);
    } finally { now.mockRestore(); }
  });
  it('pins the exact configured verifier without consulting its overridden bind method', async () => {
    const verifier = vi.fn<NonNullable<PostgresDispatchJournalOptions['verifyReconciliation']>>(async () => accepted), replacement = vi.fn(async () => accepted);
    const bind = vi.fn(() => replacement);
    Object.defineProperty(verifier, 'bind', { value: bind });
    const f = fixture(verifier);
    const result = await createPostgresDispatchJournal(f.options).reconcile({ record: unknown, outcome: accepted });
    expect(result).toEqual({ snapshot, recipient, message: accepted.status === 'submitted' && 'message' in accepted.receipt ? accepted.receipt.message : undefined, state: 'completed', outcome: accepted });
    expect(bind).not.toHaveBeenCalled();
    expect(replacement).not.toHaveBeenCalled();
    expect(verifier).toHaveBeenCalledOnce();
    expect(verifier.mock.calls[0]?.[0]).toEqual({ record: unknown, outcome: accepted });
  });
});
