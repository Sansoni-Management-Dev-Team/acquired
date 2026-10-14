import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { JournalCodec } from '../../core/src/journal-codec';
import type { ConnectionBinding, OperationSnapshot } from '../../contracts/src';
import type { SqlClient, SqlResult } from './webhook-repository';
import { createPostgresEmailTracking, createTrackedEmailSubmission, type EmailTrackingOptions, type VerifiedEmailSentAssociation } from './email-tracking';
// Independent scripted correlation/rotation review only; not SQL durability or provider proof.
const binding: ConnectionBinding = { applicationId: 'tracking-review-app', tenantId: 'tracking-review-tenant', ownerId: 'tracking-review-owner', connectionId: 'tracking-review-connection', accountId: 'tracking-review-account', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' };
const snapshot: OperationSnapshot = { binding, key: 'tracking-review-original', operation: 'message', payloadDigest: 'a'.repeat(64) };
const recipient = { kind: 'email' as const, value: 'tracking-person@example.invalid' };
const reference = (id: string) => ({ binding, id });
const codec = new JournalCodec({ activeVersion: 'tracking-review-key', keys: [{ version: 'tracking-review-key', encryptionKey: Buffer.alloc(32, 211), digestKey: Buffer.alloc(32, 212) }] });
const association: VerifiedEmailSentAssociation = { receipt: { message: reference('different-outbound-email'), recipient, submittedAt: '2026-10-14T01:00:00.000Z' }, rfcMessageId: '<outbound@example.invalid>', evidenceDigest: 'e'.repeat(64) };
function fixture(knownMessage = false) {
  const statements: string[] = [], acknowledgements: Record<string, unknown>[] = [];
  const control = { expireRead: false, expireAssociation: false, grantExpired: false, futureVerification: false };
  let linked: Record<string, unknown> | undefined;
  function journal(key: string) {
    const s = { ...snapshot, key }, context = { recipient, ...(knownMessage ? { message: reference('known-before-admission') } : {}) };
    return { id: `row-${key}`, application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId, operation_key: key, connection_id: binding.connectionId, generation: 1, account_id: binding.accountId, operation: 'message', payload_digest: snapshot.payloadDigest, state: 'unknown', quota_reserved: true, digest_version: 'message-v1', encrypted_operation_context: JSON.stringify(codec.encode(s, 'context', context)), operation_context_key_version: codec.keyVersion, operation_context_digest: codec.digest(s, 'context', context), recipient_digest: 'b'.repeat(64), recipient_key_version: 'recipient-review' };
  }
  const generation = { connection_id: binding.connectionId, application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId, channel: 'email', platform: 'gmail', backend: 'unipile', generation: 1, account_id: binding.accountId, integration_id: 'tracking-review-integration', provider_api_version: 'v1', provider_configuration_reference: 'tracking-review-configuration', authority: 'service', encrypted_provider_account_id: 'synthetic-encrypted-account', provider_account_key_version: 'provider-review', provider_account_digest: 'c'.repeat(64) };
  const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<SqlResult> => {
    statements.push(sql);
    if (sql.includes('pg_roles')) return { rows: [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
    if (sql.includes('lock_reply_barrier')) return { rows: [{ revision: '0' }] };
    if (sql.includes('connection_generations')) return { rows: [generation] };
    if (sql.includes('physical_accounts')) return { rows: [{ id: binding.accountId, channel: 'email', verified_at: new Date(control.futureVerification ? '2100-01-01T00:00:00.000Z' : Date.now()), identity_verified: !control.futureVerification }] };
    if (sql.includes('access_grants')) return { rows: control.grantExpired ? [] : [{ application_id: binding.applicationId, tenant_id: binding.tenantId, owner_id: binding.ownerId }] };
    if (sql.includes('FROM communications.operation_journal')) return { rows: [journal(values[3] as string)] };
    if (sql.startsWith('INSERT INTO communications.email_tracking_acknowledgements')) {
      const row = { id: values[0], journal_id: values[1], tracking_digest: values[2], tracking_key_version: values[3], encrypted_ack: values[4], ack_key_version: values[5], ack_digest: values[6] }; acknowledgements.push(row); return { rows: [row] };
    }
    if (sql.startsWith('INSERT INTO communications.email_tracking_associations')) {
      linked = { acknowledgement_id: values[0], encrypted_association: values[1], association_key_version: values[2], association_digest: values[3], evidence_digest: values[4] }; if (control.expireAssociation) control.grantExpired = true; return { rows: [linked] };
    }
    if (sql.includes('FROM communications.email_tracking_associations')) return { rows: linked ? [linked] : [] };
    if (sql.includes('FROM communications.email_tracking_acknowledgements')) {
      if (sql.includes('SELECT DISTINCT tracking_key_version')) return { rows: [...new Set(acknowledgements.map(a => a.tracking_key_version))].map(tracking_key_version => ({ tracking_key_version })) };
      const candidates = (values[3] ?? []) as string[]; if (control.expireRead) control.grantExpired = true;
      return { rows: acknowledgements.filter(a => a.journal_id === values[0] || candidates.includes(a.tracking_digest as string)) };
    }
    return { rows: [] };
  });
  const options: EmailTrackingOptions = { pool: { connect: async () => ({ query, release() {} } as SqlClient) }, binding, integrationId: 'tracking-review-integration', providerConfigurationReference: 'tracking-review-configuration', providerAccountId: 'tracking-review-provider', codec, recipientDigest: { keyVersion: 'recipient-review', digest: () => 'b'.repeat(64) }, trackingDigest: { keyVersion: 'tracking-old', versions: ['tracking-old'], digest: (value, version) => createHmac('sha256', version).update(JSON.stringify(value)).digest('hex') }, decodeProviderAccount: () => 'tracking-review-provider', authenticateNotification: async () => true, verifySentMessage: vi.fn(async () => structuredClone(association)) };
  const notification = { rawHeaders: ['Synthetic-Auth', 'synthetic'], rawBody: Buffer.from(JSON.stringify({ event: 'mail_sent', role: 'sent', origin: 'unipile', tracking_id: 'original-tracking-ack', account_id: options.providerAccountId, email_id: 'different-outbound-email', message_id: association.rfcMessageId, date: '2026-10-14T01:00:00.000Z', to_attendees: [{ identifier: recipient.value }], cc_attendees: [], bcc_attendees: [] })) };
  return { options, acknowledgements, notification, statements, control, linked: () => linked };
}
describe('independent email tracking immutable correlation review', () => {
  it('does not record an ACK against a mailbox whose stored physical verification is still in the future', async () => {
    const f = fixture(); f.control.futureVerification = true;
    await expect(createPostgresEmailTracking(f.options).recordAcknowledgement({ snapshot, trackingId: 'future-verification-tracking' })).rejects.toThrow('Email tracking unavailable');
    expect(f.statements.some(sql => sql.startsWith('INSERT INTO communications.email_tracking_acknowledgements'))).toBe(false);
  });
  it('preserves the original acknowledgement snapshot when a producer mutates its detached request argument', async () => {
    const acknowledged = vi.fn(async () => ({ kind: 'recorded' as const }));
    const producer = { ready: async () => ({ status: 'ready' as const }), lookup: async () => null, submitAcknowledged: async (input: import('../../contracts/src').MessageSubmission) => {
      input.snapshot.key = 'producer-mutated-key';
      return { status: 'acknowledged' as const, receipt: { operation: reference('original-tracking-ack'), recipient } };
    } };
    const adapter = createTrackedEmailSubmission({ producer, tracking: { recordAcknowledgement: acknowledged } });
    await adapter.submit({ snapshot: structuredClone(snapshot), message: { recipient, text: 'Synthetic private original text' } });
    expect(acknowledged).toHaveBeenCalledExactlyOnceWith({ snapshot, trackingId: 'original-tracking-ack' });
  });

  it('does not commit a read or call the provider after authority expires while decoding its acknowledgement', async () => {
    const f = fixture(), repo = createPostgresEmailTracking(f.options);
    await repo.recordAcknowledgement({ snapshot, trackingId: 'original-tracking-ack' });
    f.statements.length = 0; f.control.expireRead = true;
    await expect(repo.associate({ snapshot, trackingId: 'original-tracking-ack', notification: f.notification })).rejects.toThrow('Email tracking unavailable');
    expect(f.options.verifySentMessage).not.toHaveBeenCalled();
    expect(f.statements).not.toContain('COMMIT');
  });
  it('does not commit an association when the grant expires during its insert', async () => {
    const f = fixture(), repo = createPostgresEmailTracking(f.options);
    await repo.recordAcknowledgement({ snapshot, trackingId: 'original-tracking-ack' });
    f.statements.length = 0; f.control.expireAssociation = true;
    await expect(repo.associate({ snapshot, trackingId: 'original-tracking-ack', notification: f.notification })).rejects.toThrow('Email tracking unavailable');
    expect(f.statements.filter(sql => sql === 'COMMIT')).toHaveLength(1); // Authorized pre-provider read only.
  });

  it('cannot associate a different sent message when immutable original context already pins its message ID', async () => {
    const f = fixture(true), repo = createPostgresEmailTracking(f.options);
    await repo.recordAcknowledgement({ snapshot, trackingId: 'original-tracking-ack' });
    expect(await repo.associate({ snapshot, trackingId: 'original-tracking-ack', notification: f.notification })).toEqual({ kind: 'review' });
    expect(f.linked()).toBeUndefined();
  });
  it('fails closed when rotated digest inventory omits a persisted version before another operation reuses the ACK', async () => {
    const f = fixture(), ordinary = createPostgresEmailTracking(f.options);
    await ordinary.recordAcknowledgement({ snapshot, trackingId: 'original-tracking-ack' });
    const rotated = createPostgresEmailTracking({ ...f.options, trackingDigest: { ...f.options.trackingDigest, keyVersion: 'tracking-new', versions: ['tracking-new'] } });
    await expect(rotated.recordAcknowledgement({ snapshot: { ...snapshot, key: 'different-operation' }, trackingId: 'original-tracking-ack' })).rejects.toThrow('Email tracking unavailable');
    expect(f.acknowledgements).toHaveLength(1);
  });
});
