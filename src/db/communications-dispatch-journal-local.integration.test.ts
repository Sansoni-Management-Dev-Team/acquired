import { createHash, createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CanonicalIdentity, ConnectionBinding, MessagingAdapter } from '../../communications/packages/contracts/src';
import { createDispatchCoordinator, type ClaimDecision, type DispatchJournalPort } from '../../communications/packages/core/src/dispatch';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import { messageDigest } from '../../communications/packages/core/src/message-digest';
import { createPostgresReplyBarrier } from '../../communications/packages/storage-postgres/src/reply-barrier';
import { createPostgresDispatchJournal, type PostgresDispatchJournalOptions } from '../../communications/packages/storage-postgres/src/dispatch-journal';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createCommunicationsLocalFixture } from './communications-local-test-support';

// Actual repository and PostgreSQL composition with synthetic accounts/correlation/keys only.
// Repository dispatch admission is deliberately disabled. Historical SQL fixtures
// may seed quota/accepted receipt records; they do not attest production quota policy,
// provider/app readiness, reconciliation or full dispatch repository capability.
const enabled = process.env.COMMUNICATIONS_AUDIT_LOCAL_DB === '1';
describe.skipIf(!enabled)('isolated PostgreSQL gated dispatch journal', () => {
  const local = createCommunicationsLocalFixture();
  const retired: ConnectionBinding[] = [];
  const oldKey = { version: 'journal-old-v1', encryptionKey: Buffer.alloc(32, 171), digestKey: Buffer.alloc(32, 172) };
  const newKey = { version: 'journal-new-v1', encryptionKey: Buffer.alloc(32, 173), digestKey: Buffer.alloc(32, 174) };
  const oldCodec = new JournalCodec({ activeVersion: oldKey.version, keys: [oldKey] });
  const rotatedCodec = new JournalCodec({ activeVersion: newKey.version, keys: [oldKey, newKey] });
  const identityKey = Buffer.alloc(32, 175);
  const nextIdentityKey = Buffer.alloc(32, 176);
  const recipientDigest = (identity: CanonicalIdentity, version = 'recipient-v1') => {
    if (!['recipient-v1', 'recipient-v2'].includes(version)) throw Error('Unknown synthetic recipient key version');
    return createHmac('sha256', version === 'recipient-v1' ? identityKey : nextIdentityKey).update('communications.recipient.fixture.v1\0').update(JSON.stringify([identity.kind, identity.value])).digest('hex');
  };
  beforeAll(async () => {
    await local.preflight();
    const { rows: [schema] } = await local.pool.query("SELECT to_regclass('communications.operation_journal')::text AS journal,to_regclass('communications.tenant_reply_barriers')::text AS barrier");
    if (!schema.journal || !schema.barrier) throw Error('Requires specifically approved service/003 schemas; no schema bootstrap occurs');
  });
  afterAll(async () => {
    try {
      for (const b of retired) {
        // Preserve immutable journal/correlation history. Unresolved operations forbid
        // connection retirement, so revoke authority instead of deleting/rebinding.
        await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [b.applicationId, b.tenantId, b.ownerId]);
      }
    } finally { await local.close(); }
  });
  async function fixture(channel: ConnectionBinding['channel'] = 'whatsapp') {
    const suffix = randomUUID(), integrationId = `journal-source-${suffix}`;
    const binding: ConnectionBinding = { applicationId: `journal-${suffix}`, tenantId: 'journal-tenant', ownerId: 'journal-owner', connectionId: `journal-connection-${suffix}`, accountId: `journal-account-${suffix}`, generation: 1, channel, platform: channel === 'email' ? 'gmail' : channel, backend: 'unipile' };
    const c = await local.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE communications_control');
      await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [binding.applicationId, binding.tenantId, binding.ownerId]);
      await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'journal_fixture',$3,'fixture-v1',clock_timestamp())", [binding.accountId, channel, createHash('sha256').update(suffix).digest('hex')]);
      await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,'unipile',1,'connected',true)", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, channel, binding.platform]);
      await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,$6,$7,'unipile',$8,'v1','synthetic-config','service','{}')", [binding.connectionId, binding.applicationId, binding.tenantId, binding.ownerId, binding.accountId, channel, binding.platform, integrationId]);
      await c.query('COMMIT');
      retired.push(binding);
    } catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
    const recipient: CanonicalIdentity = channel === 'email' ? { kind: 'email', value: 'journal-person@example.test' } : channel === 'whatsapp' ? { kind: 'phone', value: '+15550000175' } : { kind: 'linkedin_profile', value: 'https://www.linkedin.com/in/journal-fixture/' };
    const conversation = { binding, id: `chat-${suffix}` };
    const message = { recipient, text: 'Synthetic private fixture body', conversation };
    const snapshot = { binding, key: `journal-operation-${suffix}`, operation: 'message' as const, payloadDigest: messageDigest('message', message) };
    const input = { snapshot, recipient, conversation };
    const barrier = createPostgresReplyBarrier({ binding, integrationId, codec: local.webhookCodec });
    return { binding, suffix, integrationId, recipient, message, snapshot, input, barrier };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  function claimed(decision: ClaimDecision): Extract<ClaimDecision, { kind: 'claimed' }> {
    expect(decision.kind).toBe('claimed');
    if (decision.kind !== 'claimed') throw Error('Expected synthetic original claim');
    return decision;
  }
  async function stored(f: Fixture) {
    const { rows: [row] } = await local.pool.query('SELECT * FROM communications.operation_journal WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3 AND operation_key=$4', [f.binding.applicationId, f.binding.tenantId, f.binding.ownerId, f.snapshot.key]);
    return row;
  }
  async function lease(f: Fixture) {
    const { rows: [row] } = await local.pool.query('SELECT owner_token,fencing_token::text AS fencing_token,expires_at FROM communications.account_leases WHERE account_id=$1', [f.binding.accountId]);
    return row;
  }
  async function noQuota(f: Fixture) {
    expect((await local.pool.query('SELECT count(*)::integer AS total FROM communications.quota_buckets WHERE account_id=$1', [f.binding.accountId])).rows[0].total).toBe(0);
  }
  function lostCommitPool() {
    const errors: Error[] = [], statements: string[] = [], pids: number[] = [];
    let armed = true;
    const pool: SqlPool = { async connect() {
      const c = await local.driver.connect();
      pids.push(Number((await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid));
      return { async query<Row>(text: string, values?: unknown[]) {
        statements.push(text);
        const result = await c.query<Row>(text, values);
        if (armed && text.trim().toUpperCase() === 'COMMIT') {
          armed = false;
          throw Error('Synthetic response lost after actual database COMMIT');
        }
        return result;
      }, release(error?: Error) { if (error) errors.push(error); c.release(error); } };
    } };
    return { pool, errors, statements, pids };
  }
  function repository(f: Fixture, extra: Partial<PostgresDispatchJournalOptions> = {}): DispatchJournalPort {
    return createPostgresDispatchJournal({ pool: local.driver, binding: f.binding, integrationId: f.integrationId, providerConfigurationReference: 'synthetic-config', providerApiVersion: 'v1', authority: 'service', leaseOwnerToken: `worker-${f.suffix}`, codec: oldCodec, recipientDigest: { keyVersion: 'recipient-v1', digest: recipientDigest }, ...extra });
  }
  function completion(d: Extract<ClaimDecision, { kind: 'claimed' }>, outcome: Parameters<DispatchJournalPort['complete']>[0]['outcome']) {
    return { token: d.token, record: d.record, outcome };
  }
  it.each(['email', 'whatsapp', 'linkedin'] as const)('claims exact encrypted %s operation under a physical lease without quota admission', async channel => {
    const f = await fixture(channel), repo = repository(f), d = claimed(await repo.claim(f.input));
    expect(d.record).toEqual({ ...f.input, state: 'claimed' });
    const row = await stored(f), live = await lease(f);
    expect(row).toMatchObject({ application_id: f.binding.applicationId, tenant_id: f.binding.tenantId, owner_id: f.binding.ownerId, connection_id: f.binding.connectionId, generation: 1, account_id: f.binding.accountId, state: 'claimed', claim_token: d.token, lease_owner_token: `worker-${f.suffix}`, quota_reserved: false, operation_context_key_version: oldCodec.keyVersion, recipient_digest: recipientDigest(f.recipient) });
    expect(String(row.fencing_token)).toBe(live.fencing_token);
    expect(live.owner_token).toBe(row.lease_owner_token);
    expect(Date.parse(live.expires_at)).toBeGreaterThan(Date.now());
    expect(row.encrypted_operation_context).not.toContain(f.recipient.value);
    expect(row.encrypted_operation_context).not.toContain(f.message.text);
    expect(await repo.get(f.snapshot)).toEqual(d.record);
    expect(await repo.beginDispatch({ token: d.token, record: d.record })).toEqual({ kind: 'blocked', outcome: { status: 'review', code: 'delivery_disabled' } });
    await noQuota(f);
  });
  it('allows only one concurrent original claim without charging either quota', async () => {
    const f = await fixture(), first = repository(f), second = repository(f, { leaseOwnerToken: `other-worker-${f.suffix}` });
    const decisions = await Promise.all([first.claim(f.input), second.claim(f.input)]);
    expect(decisions.map(d => d.kind).sort()).toEqual(['claimed', 'existing']);
    expect((await local.pool.query('SELECT count(*)::integer AS count FROM communications.operation_journal WHERE application_id=$1', [f.binding.applicationId])).rows[0].count).toBe(1);
    const winner = decisions.find(d => d.kind === 'claimed');
    expect(await first.get(f.snapshot)).toEqual(winner?.record);
    await noQuota(f);
  });
  it.each(['payload', 'recipient', 'conversation', 'rfc', 'backend'] as const)('rejects same-key %s changes without replacing original context/lease', async field => {
    const f = await fixture(), repo = repository(f);
    await repo.claim(f.input);
    const before = await stored(f), originalLease = await lease(f), altered = structuredClone(f.input) as typeof f.input & { rfcMessageId?: string };
    if (field === 'payload') altered.snapshot.payloadDigest = 'f'.repeat(64);
    if (field === 'recipient') altered.recipient.value = '+15550000999';
    if (field === 'conversation') altered.conversation.id = 'another-chat';
    if (field === 'rfc') altered.rfcMessageId = '<invented@example.test>';
    if (field === 'backend') altered.snapshot.binding.backend = 'baileys';
    await expect(repo.claim(altered)).rejects.toThrow(/operation_conflict/);
    expect(await stored(f)).toEqual(before);
    expect(await lease(f)).toEqual(originalLease);
    await noQuota(f);
  });
  it.each(['claimed', 'unknown', 'blocked'] as const)('replays existing %s without new claim/lease renewal or ciphertext replacement', async status => {
    const f = await fixture(), repo = repository(f), d = claimed(await repo.claim(f.input));
    const outcome = status === 'unknown' ? { status: 'unknown' as const } : { status: 'waiting' as const, code: 'incomplete' as const };
    if (status !== 'claimed') await repo.complete(completion(d, outcome));
    const row = await stored(f), originalLease = await lease(f);
    expect((await repository(f, { leaseOwnerToken: `replay-worker-${f.suffix}` }).claim(f.input)).kind).toBe('existing');
    expect(await stored(f)).toEqual(row);
    expect(await lease(f)).toEqual(originalLease);
    await noQuota(f);
  });
  it.each([{ status: 'waiting', code: 'stale', retryAt: '2026-10-14T00:00:00.000Z' }, { status: 'review', code: 'reconnect' }, { status: 'rejected', code: 'fixture_rejected' }] as const)('commits complete typed preflight %s and replays exact original outcome', async outcome => {
    const f = await fixture(), repo = repository(f), d = claimed(await repo.claim(f.input));
    const finished = await repo.complete(completion(d, outcome));
    expect(finished).toEqual({ ...f.input, state: 'completed', outcome });
    const row = await stored(f);
    expect(row.quota_reserved).toBe(false);
    expect(row.encrypted_outcome).not.toContain(outcome.code);
    expect(await repo.complete(completion(d, outcome))).toEqual(finished);
    expect((await repo.claim(f.input))).toEqual({ kind: 'existing', record: finished });
    expect(await stored(f)).toEqual(row);
    await noQuota(f);
  });
  it('never calls provider submit when composed coordinator reaches disabled dispatch admission', async () => {
    const f = await fixture(), repo = repository(f);
    const adapter: MessagingAdapter = { ready: vi.fn(async () => ({ status: 'ready' as const })), submit: vi.fn(async () => ({ status: 'unknown' as const })), lookup: vi.fn(async () => null) };
    const coordinator = createDispatchCoordinator(f.binding, adapter, repo);
    expect(await coordinator.submit({ snapshot: f.snapshot, message: f.message })).toEqual({ status: 'review', code: 'delivery_disabled' });
    expect(adapter.ready).toHaveBeenCalledOnce();
    expect(adapter.submit).not.toHaveBeenCalled();
    expect(adapter.lookup).not.toHaveBeenCalled();
    expect((await stored(f)).state).toBe('blocked');
    await noQuota(f);
  });
  it('preserves an exact encrypted preflight skip action without dispatch or provider receipt', async () => {
    const f = await fixture('linkedin'), repo = repository(f), d = claimed(await repo.claim(f.input));
    const outcome = { status: 'skipped' as const, operation: { binding: f.binding, id: f.snapshot.key }, reason: 'Synthetic preflight policy skip' };
    expect(await repo.complete(completion(d, outcome))).toEqual({ ...f.input, state: 'completed', outcome });
    const before = await stored(f);
    expect(before.state).toBe('skipped');
    expect(before.encrypted_outcome).not.toContain(outcome.reason);
    expect((await repo.claim(f.input))).toEqual({ kind: 'existing', record: { ...f.input, state: 'completed', outcome } });
    expect(await stored(f)).toEqual(before);
    await noQuota(f);
  });
  it.each(['claim', 'complete'] as const)('retires session on lost %s COMMIT response then replays original durable history', async phase => {
    const f = await fixture(), ordinary = repository(f), lost = lostCommitPool();
    if (phase === 'claim') await expect(repository(f, { pool: lost.pool }).claim(f.input)).rejects.toThrow(/^Dispatch journal unavailable$/);
    else {
      const d = claimed(await ordinary.claim(f.input));
      await expect(repository(f, { pool: lost.pool }).complete(completion(d, { status: 'waiting', code: 'incomplete' }))).rejects.toThrow(/^Dispatch journal unavailable$/);
    }
    expect(lost.errors).toHaveLength(1);
    expect(lost.statements.map(s => s.trim().toUpperCase()).filter(s => s === 'ROLLBACK')).toHaveLength(0);
    const row = await stored(f), originalLease = await lease(f);
    expect(row.state).toBe(phase === 'claim' ? 'claimed' : 'blocked');
    expect((await ordinary.claim(f.input)).kind).toBe('existing');
    expect(await stored(f)).toEqual(row);
    expect(await lease(f)).toEqual(originalLease);
    expect((await local.pool.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE pid=ANY($1::integer[])', [lost.pids])).rows[0].count).toBe(0);
    await noQuota(f);
  });
  it('denies revoked current grants without exposing recorded data or changing history', async () => {
    const f = await fixture(), repo = repository(f), d = claimed(await repo.claim(f.input));
    const before = await stored(f);
    await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [f.binding.applicationId, f.binding.tenantId, f.binding.ownerId]);
    expect(await repo.claim(f.input)).toEqual({ kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } });
    await expect(repo.get(f.snapshot)).rejects.toThrow(/^Dispatch journal unavailable$/);
    await expect(repo.complete(completion(d, { status: 'unknown' }))).rejects.toThrow(/^Dispatch journal unavailable$/);
    expect(await stored(f)).toEqual(before);
    await noQuota(f);
  });
  it.each(['lease', 'claim'] as const)('refuses expired %s ownership without reclaim or quota admission', async kind => {
    const f = await fixture(), repo = repository(f), d = claimed(await repo.claim(f.input));
    if (kind === 'lease') await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [f.binding.accountId]);
    else await local.pool.query("UPDATE communications.operation_journal SET claim_until=clock_timestamp()-interval '1 second' WHERE id=$1", [(await stored(f)).id]);
    const before = await stored(f), originalLease = await lease(f);
    await expect(repo.beginDispatch({ token: d.token, record: d.record })).rejects.toThrow(/^Dispatch journal unavailable$/);
    await expect(repo.complete(completion(d, { status: 'waiting', code: 'stale' }))).rejects.toThrow(/^Dispatch journal unavailable$/);
    expect((await repo.claim(f.input)).kind).toBe('existing');
    expect(await stored(f)).toEqual(before);
    expect(await lease(f)).toEqual(originalLease);
    await noQuota(f);
  });
  it('replays historical blocked context after reconnect/disconnect without requiring a current lease or INSERT', async () => {
    const f = await fixture('email'), repo = repository(f), d = claimed(await repo.claim(f.input));
    const complete = await repo.complete(completion(d, { status: 'review', code: 'reconnect' })), before = await stored(f);
    const b = f.binding;
    await local.pool.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,2,$2,$3,$4,$5,$6,$7,'unipile',$8,'v1','new-synthetic-config','service','{}')", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, b.channel, b.platform, f.integrationId]);
    await local.pool.query("UPDATE communications.connections SET current_generation=2,status='disconnected' WHERE id=$1", [b.connectionId]);
    await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [b.accountId]);
    const originalLease = await lease(f);
    expect(await repo.get(f.snapshot)).toEqual(complete);
    expect(await repo.claim(f.input)).toEqual({ kind: 'existing', record: complete });
    expect(await stored(f)).toEqual(before);
    expect(await lease(f)).toEqual(originalLease);
    await noQuota(f);
  });
  it('retains original encryption/digest versions across key rotation', async () => {
    const f = await fixture(), d = claimed(await repository(f).claim(f.input)), before = await stored(f);
    expect(await repository(f, { codec: rotatedCodec }).get(f.snapshot)).toEqual(d.record);
    expect((await repository(f, { codec: rotatedCodec }).claim(f.input)).kind).toBe('existing');
    expect(await stored(f)).toEqual(before);
    expect(before.operation_context_key_version).toBe(oldKey.version);
    await noQuota(f);
  });
  it('uses original retained recipient version for history and new recipient version only on a fresh key', async () => {
    const f = await fixture(), d = claimed(await repository(f).claim(f.input)), before = await stored(f);
    const digester = { keyVersion: 'recipient-v2', digest: vi.fn(recipientDigest) }, rotated = repository(f, { codec: rotatedCodec, recipientDigest: digester });
    expect(await rotated.get(f.snapshot)).toEqual(d.record);
    expect(digester.digest).toHaveBeenCalledWith(f.recipient, 'recipient-v1');
    expect(await stored(f)).toEqual(before);
    const independent = { ...f.input, snapshot: { ...f.snapshot, key: `rotated-independent-${f.suffix}` } };
    claimed(await rotated.claim(independent));
    const { rows: [fresh] } = await local.pool.query('SELECT recipient_key_version,recipient_digest,operation_context_key_version FROM communications.operation_journal WHERE application_id=$1 AND operation_key=$2', [f.binding.applicationId, independent.snapshot.key]);
    expect(fresh).toEqual({ recipient_key_version: 'recipient-v2', recipient_digest: recipientDigest(f.recipient, 'recipient-v2'), operation_context_key_version: newKey.version });
    expect(await stored(f)).toEqual(before);
    await noQuota(f);
  });
  it('rejects submitted completion and reconciliation before any dispatch/provider/quota capability is enabled', async () => {
    const f = await fixture(), repo = repository(f), d = claimed(await repo.claim(f.input)), before = await stored(f);
    const submitted = { status: 'submitted' as const, receipt: { message: { binding: f.binding, id: 'invented-message' }, conversation: f.input.conversation, recipient: f.recipient } };
    await expect(repo.complete(completion(d, submitted))).rejects.toThrow();
    await expect(repo.reconcile({ record: d.record, outcome: submitted })).rejects.toThrow();
    expect(await stored(f)).toEqual(before);
    await noQuota(f);
  });
  it('rejects wrong original claim token before disabled admission or completion', async () => {
    const f = await fixture(), repo = repository(f), d = claimed(await repo.claim(f.input)), before = await stored(f);
    await expect(repo.beginDispatch({ token: 'another-worker-token', record: d.record })).rejects.toThrow(/^Dispatch journal unavailable$/);
    await expect(repo.complete({ ...completion(d, { status: 'unknown' }), token: 'another-worker-token' })).rejects.toThrow(/^Dispatch journal unavailable$/);
    expect(await stored(f)).toEqual(before);
    await noQuota(f);
  });
  it('blocks a fresh independent operation while another worker owns the live physical lease', async () => {
    const f = await fixture(), repo = repository(f);
    await repo.claim(f.input);
    const originalLease = await lease(f), before = await stored(f);
    const independent = { ...f.input, snapshot: { ...f.snapshot, key: `independent-${f.suffix}` } };
    expect(await repository(f, { leaseOwnerToken: `other-worker-${f.suffix}` }).claim(independent)).toEqual({ kind: 'blocked', outcome: { status: 'waiting', code: 'busy' } });
    expect(await stored(f)).toEqual(before);
    expect(await lease(f)).toEqual(originalLease);
    expect((await local.pool.query('SELECT count(*)::integer AS count FROM communications.operation_journal WHERE application_id=$1', [f.binding.applicationId])).rows[0].count).toBe(1);
    await noQuota(f);
  });
  it('caps a fresh independent claim at an existing same-worker lease without renewing it', async () => {
    const f = await fixture(), repo = repository(f);
    await repo.claim(f.input);
    await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()+interval '5 seconds' WHERE account_id=$1", [f.binding.accountId]);
    const originalLease = await lease(f), independent = { ...f.input, snapshot: { ...f.snapshot, key: `independent-${f.suffix}` } };
    claimed(await repo.claim(independent));
    const { rows: [row] } = await local.pool.query('SELECT claim_until FROM communications.operation_journal WHERE application_id=$1 AND operation_key=$2', [f.binding.applicationId, independent.snapshot.key]);
    expect(row.claim_until.getTime()).toBeLessThanOrEqual(originalLease.expires_at.getTime());
    expect(await lease(f)).toEqual(originalLease);
    await noQuota(f);
  });
  it('fences an old worker after expired lease takeover for a fresh independent operation', async () => {
    const f = await fixture(), first = repository(f), original = claimed(await first.claim(f.input));
    const before = await stored(f), oldLease = await lease(f);
    await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [f.binding.accountId]);
    const independent = { ...f.input, snapshot: { ...f.snapshot, key: `independent-${f.suffix}` } };
    const next = claimed(await repository(f, { leaseOwnerToken: `takeover-worker-${f.suffix}` }).claim(independent));
    expect(next.record.snapshot.key).toBe(independent.snapshot.key);
    const currentLease = await lease(f);
    expect(currentLease.owner_token).toBe(`takeover-worker-${f.suffix}`);
    expect(BigInt(currentLease.fencing_token)).toBe(BigInt(oldLease.fencing_token) + BigInt(1));
    await expect(first.beginDispatch({ token: original.token, record: original.record })).rejects.toThrow(/^Dispatch journal unavailable$/);
    await expect(first.complete(completion(original, { status: 'unknown' }))).rejects.toThrow(/^Dispatch journal unavailable$/);
    expect((await first.claim(f.input))).toEqual({ kind: 'existing', record: original.record });
    expect(await stored(f)).toEqual(before);
    expect(await lease(f)).toEqual(currentLease);
    await noQuota(f);
  });
  it('rejects persisted malformed context ciphertext without rewriting immutable evidence', async () => {
    const f = await fixture(), repo = repository(f);
    await repo.claim(f.input);
    const original = await stored(f), snapshot = { ...f.snapshot, key: `corrupt-fixture-${f.suffix}` };
    const context = oldCodec.decode(f.snapshot, 'context', JSON.parse(original.encrypted_operation_context));
    const envelope = oldCodec.encode(snapshot, 'context', context), tag = Buffer.from(envelope.tag, 'base64');
    tag[0] ^= 1;
    envelope.tag = tag.toString('base64');
    const id = `corrupt-journal-${f.suffix}`, digest = oldCodec.digest(snapshot, 'context', context);
    // Seed a separate malformed historical claim using INSERT only; no immutable row
    // is changed and no migration/grants/trigger bypass is used.
    const c = await local.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE communications_control');
      await c.query(`INSERT INTO communications.operation_journal(id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,claim_token,claim_until,fencing_token,lease_owner_token)
 SELECT $1,application_id,tenant_id,owner_id,$2,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,$3,operation_context_key_version,$4,claim_token,claim_until,fencing_token,lease_owner_token FROM communications.operation_journal WHERE id=$5`, [id, snapshot.key, JSON.stringify(envelope), digest, original.id]);
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
    const { rows: [before] } = await local.pool.query('SELECT * FROM communications.operation_journal WHERE id=$1', [id]);
    await expect(repo.get(snapshot)).rejects.toThrow(/^Dispatch journal unavailable$/);
    await expect(repo.claim({ ...f.input, snapshot })).rejects.toThrow(/^Dispatch journal unavailable$/);
    expect((await local.pool.query('SELECT * FROM communications.operation_journal WHERE id=$1', [id])).rows[0]).toEqual(before);
    expect(await stored(f)).toEqual(original);
    await noQuota(f);
  });
  it('replays an original submitted key with its learned receipt message after disconnect and reconnect', async () => {
    const f = await fixture('email'), repo = repository(f);
    await repo.claim(f.input);
    const source = await stored(f), submittedAt = new Date().toISOString();
    const receipt = { message: { binding: f.binding, id: `synthetic-accepted-${f.suffix}` }, conversation: f.input.conversation, recipient: f.recipient, submittedAt };
    const envelope = oldCodec.encode(f.snapshot, 'receipt', receipt);
    const c = await local.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE communications_control');
      await f.barrier.lock(c, f.binding.applicationId, f.binding.tenantId);
      // Explicit synthetic historical SQL fixture, not repository admission or an
      // application/provider readiness proof. No adapter or provider I/O occurs.
      for (const kind of ['account', 'application']) {
        await c.query("INSERT INTO communications.quota_buckets(account_id,bucket_kind,application_id,window_kind,window_start,used,limit_value) VALUES($1,$2,$3,'hour',date_trunc('hour',clock_timestamp()),1,100)", [f.binding.accountId, kind, kind === 'account' ? '' : f.binding.applicationId]);
      }
      await c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true WHERE id=$1", [source.id]);
      await c.query("UPDATE communications.operation_journal SET state='submitted',encrypted_receipt=$2,receipt_key_version=$3,submitted_at=$4 WHERE id=$1", [source.id, JSON.stringify(envelope), envelope.keyVersion, submittedAt]);
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK'); throw error; }
    finally { c.release(); }
    const completed = { ...f.input, message: receipt.message, state: 'completed' as const, outcome: { status: 'submitted' as const, receipt } };
    expect(await repo.get(f.snapshot)).toEqual(completed);
    const b = f.binding;
    await local.pool.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,2,$2,$3,$4,$5,$6,$7,'unipile',$8,'v1','new-synthetic-config','service','{}')", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, b.channel, b.platform, f.integrationId]);
    await local.pool.query("UPDATE communications.connections SET current_generation=2,status='disconnected' WHERE id=$1", [b.connectionId]);
    await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [b.accountId]);
    const before = await stored(f), originalLease = await lease(f);
    expect(await repo.get(f.snapshot)).toEqual(completed);
    expect(await repo.claim(f.input)).toEqual({ kind: 'existing', record: completed });
    expect(await stored(f)).toEqual(before);
    expect(await lease(f)).toEqual(originalLease);
    expect((await local.pool.query('SELECT count(*)::integer AS buckets,sum(used)::integer AS used FROM communications.quota_buckets WHERE account_id=$1', [b.accountId])).rows[0]).toEqual({ buckets: 2, used: 2 });
  });
  // Synthetic trusted SQL admission fixtures exercise result storage only. They
  // do not prove a held application permit or enable production dispatch.
  async function admitted(f: Fixture, repo = repository(f)) {
    const d = claimed(await repo.claim(f.input)), original = await stored(f), c = await local.pool.connect();
    try {
      await c.query('BEGIN'); await c.query('SET LOCAL ROLE communications_control');
      await f.barrier.lock(c, f.binding.applicationId, f.binding.tenantId);
      for (const kind of ['account', 'application']) await c.query("INSERT INTO communications.quota_buckets(account_id,bucket_kind,application_id,window_kind,window_start,used,limit_value) VALUES($1,$2,$3,'hour',date_trunc('hour',clock_timestamp()),1,100)", [f.binding.accountId, kind, kind === 'account' ? '' : f.binding.applicationId]);
      await c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true WHERE id=$1", [original.id]);
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
    const current = await repo.get(f.snapshot); if (!current || current.state !== 'dispatching') throw Error('Synthetic admission absent');
    return { token: d.token, record: current };
  }
  function accepted(f: Fixture) {
    return { status: 'submitted' as const, receipt: { message: { binding: f.binding, id: `accepted-${f.suffix}` }, conversation: f.input.conversation, recipient: f.recipient, submittedAt: new Date().toISOString() } };
  }
  async function quota(f: Fixture) { return (await local.pool.query('SELECT bucket_kind,used FROM communications.quota_buckets WHERE account_id=$1 ORDER BY bucket_kind', [f.binding.accountId])).rows; }
  it.each(['email','whatsapp','linkedin'] as const)('durably completes an admitted %s receipt without replacing context or charging quota again', async channel => {
    const f = await fixture(channel), repo = repository(f), d = await admitted(f, repo), outcome = accepted(f), before = await stored(f), originalQuota = await quota(f);
    const result = await repo.complete({ ...d, outcome });
    expect(result).toEqual({ ...f.input, message: outcome.receipt.message, state: 'completed', outcome });
    const finished = await stored(f);
    expect(finished.state).toBe('submitted'); expect(finished.encrypted_operation_context).toBe(before.encrypted_operation_context);
    expect(finished.encrypted_receipt).not.toContain(outcome.receipt.message.id); expect(finished.quota_reserved).toBe(true);
    expect(await repo.complete({ ...d, outcome })).toEqual(result); expect(await stored(f)).toEqual(finished);
    expect(await quota(f)).toEqual(originalQuota); expect(await repo.get(f.snapshot)).toEqual(result);
    expect(await repo.claim(f.input)).toEqual({ kind: 'existing', record: result });
  });
  it('records unknown for an expired in-flight lease without reclaiming or resubmitting', async () => {
    const f = await fixture(), repo = repository(f), d = await admitted(f, repo), before = await stored(f), originalQuota = await quota(f);
    await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [f.binding.accountId]);
    expect(await repo.complete({ ...d, outcome: { status: 'unknown' } })).toEqual({ ...d.record, state: 'unknown', outcome: { status: 'unknown' } });
    const after = await stored(f); expect(after.claim_token).toBe(before.claim_token); expect(after.quota_reserved).toBe(true);
    expect(await quota(f)).toEqual(originalQuota); expect((await repo.claim(f.input)).kind).toBe('existing');
  });
  it('persists a definite admitted rejection while retaining charged quota', async () => {
    const f = await fixture(), repo = repository(f), d = await admitted(f, repo), outcome = { status: 'rejected' as const, code: 'confirmed_not_accepted' }, before = await quota(f);
    expect(await repo.complete({ ...d, outcome })).toEqual({ ...d.record, state: 'completed', outcome });
    expect((await stored(f)).quota_reserved).toBe(true); expect(await quota(f)).toEqual(before);
  });
  it('rejects accepted completion from a stale lease without changing the unresolved journal', async () => {
    const f = await fixture(), repo = repository(f), d = await admitted(f, repo), before = await stored(f);
    await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [f.binding.accountId]);
    await expect(repo.complete({ ...d, outcome: accepted(f) })).rejects.toThrow(); expect(await stored(f)).toEqual(before);
  });
  it('preserves accepted durable result after a lost completion COMMIT response', async () => {
    const f = await fixture('email'), repo = repository(f), d = await admitted(f, repo), lost = lostCommitPool(), outcome = accepted(f);
    await expect(repository(f, { pool: lost.pool }).complete({ ...d, outcome })).rejects.toThrow();
    expect(lost.errors).toHaveLength(1); expect(lost.statements.at(-1)).toBe('COMMIT');
    expect((await repo.get(f.snapshot))?.state).toBe('completed');
    expect(await repo.complete({ ...d, outcome })).toEqual(await repo.get(f.snapshot));
  });

  it.each(['email','whatsapp','linkedin'] as const)('reconciles an admitted unknown %s only from matching trusted read-only evidence', async channel => {
    const f = await fixture(channel), ordinary = repository(f), d = await admitted(f, ordinary);
    const unknown = await ordinary.complete({ ...d, outcome: { status: 'unknown' } }), outcome = accepted(f), verify = vi.fn(async (input: unknown, signal: AbortSignal) => { void input; void signal; return outcome; });
    const repo = repository(f, { verifyReconciliation: verify } as Partial<PostgresDispatchJournalOptions>);
    await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [f.binding.accountId]);
    const before = await stored(f), charged = await quota(f);
    const result = await repo.reconcile({ record: unknown, outcome });
    expect(result).toEqual({ ...f.input, message: outcome.receipt.message, state: 'completed', outcome });
    expect(verify).toHaveBeenCalledOnce(); expect(verify.mock.calls[0][0]).toEqual({ record: unknown, outcome });
    const after = await stored(f); expect(after.resolution_evidence_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(after.encrypted_operation_context).toBe(before.encrypted_operation_context); expect(after.claim_token).toBe(before.claim_token);
    expect(await quota(f)).toEqual(charged); expect(await repo.reconcile({ record: unknown, outcome })).toEqual(result);
    expect(verify).toHaveBeenCalledOnce(); expect(await stored(f)).toEqual(after);
  });
  it('refuses caller-proposed acceptance when the read-only verifier disagrees', async () => {
    const f = await fixture('email'), ordinary = repository(f), d = await admitted(f, ordinary), unknown = await ordinary.complete({ ...d, outcome: { status: 'unknown' } }), wanted = accepted(f), before = await stored(f);
    const verify = vi.fn(async () => ({ ...wanted, receipt: { ...wanted.receipt, message: { binding: f.binding, id: 'different-original-message' } } }));
    const repo = repository(f, { verifyReconciliation: verify } as Partial<PostgresDispatchJournalOptions>);
    await expect(repo.reconcile({ record: unknown, outcome: wanted })).rejects.toThrow(); expect(verify).toHaveBeenCalledOnce(); expect(await stored(f)).toEqual(before);
  });
  it('denies revoked authority before any reconciliation provider read', async () => {
    const f = await fixture(), ordinary = repository(f), d = await admitted(f, ordinary), unknown = await ordinary.complete({ token: d.token, record: d.record, outcome: { status: 'unknown' } }), wanted = accepted(f), before = await stored(f), verify = vi.fn(async () => wanted);
    const repo = repository(f, { verifyReconciliation: verify } as Partial<PostgresDispatchJournalOptions>);
    await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1', [f.binding.applicationId]);
    await expect(repo.reconcile({ record: unknown, outcome: wanted })).rejects.toThrow(); expect(verify).not.toHaveBeenCalled(); expect(await stored(f)).toEqual(before);
  });
  it('rechecks revocation after provider evidence before changing the original unknown result', async () => {
    const f = await fixture(), ordinary = repository(f), d = await admitted(f, ordinary), unknown = await ordinary.complete({ ...d, outcome: { status: 'unknown' } }), wanted = accepted(f), before = await stored(f);
    const repo = repository(f, { verifyReconciliation: async () => { await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1', [f.binding.applicationId]); return wanted; } } as Partial<PostgresDispatchJournalOptions>);
    await expect(repo.reconcile({ record: unknown, outcome: wanted })).rejects.toThrow(); expect(await stored(f)).toEqual(before);
  });
  it('does not reconcile an unadmitted uncertain claim even with a verifier configured', async () => {
    const f = await fixture(), ordinary = repository(f), d = claimed(await ordinary.claim(f.input)), unknown = await ordinary.complete({ token: d.token, record: d.record, outcome: { status: 'unknown' } }), wanted = accepted(f), before = await stored(f), verify = vi.fn(async () => wanted);
    const repo = repository(f, { verifyReconciliation: verify } as Partial<PostgresDispatchJournalOptions>);
    await expect(repo.reconcile({ record: unknown, outcome: wanted })).rejects.toThrow(); expect(verify).not.toHaveBeenCalled(); expect(await stored(f)).toEqual(before); await noQuota(f);
  });
  it('bounds provider evidence and ignores late acceptance without a journal change', async () => {
    const f = await fixture(), ordinary = repository(f), d = await admitted(f, ordinary), unknown = await ordinary.complete({ ...d, outcome: { status: 'unknown' } }), wanted = accepted(f), before = await stored(f); let signal: AbortSignal | undefined;
    const repo = repository(f, { reconciliationTimeoutMs: 5, verifyReconciliation: async (_input: unknown, abort: AbortSignal) => { signal = abort; await new Promise(resolve => setTimeout(resolve,25)); return wanted; } } as Partial<PostgresDispatchJournalOptions>);
    await expect(repo.reconcile({ record: unknown, outcome: wanted })).rejects.toThrow(); await new Promise(resolve => setTimeout(resolve,35));
    expect(signal?.aborted).toBe(true); expect(await stored(f)).toEqual(before);
  });

});
