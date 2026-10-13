import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionBinding, OperationSnapshot } from '../../communications/packages/contracts/src';
import { EventCodec } from '../../communications/packages/core/src/event-codec';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import type { WebhookCapture } from '../../communications/packages/core/src/reply-ingress';
import { createPostgresReplyBarrier } from '../../communications/packages/storage-postgres/src/reply-barrier';
import { createCommunicationsLocalFixture } from './communications-local-test-support';

// Approved-schema characterization: synthetic DML, actual codecs and control-role SQL.
// A clear pending-work gate is necessary only; it does not attest app readiness,
// provider authentication/ownership, coverage, quotas policy or a dispatch repository.
const enabled = process.env.COMMUNICATIONS_REPLY_BARRIER_LOCAL_DB === '1';
describe.skipIf(!enabled)('isolated PostgreSQL journal dispatch pending-reply gate', () => {
  const local = createCommunicationsLocalFixture();
  const retired: ConnectionBinding[] = [];
  const journal = new JournalCodec({ activeVersion: 'dispatch-v1', keys: [{ version: 'dispatch-v1', encryptionKey: Buffer.alloc(32, 151), digestKey: Buffer.alloc(32, 152) }] });
  const events = new EventCodec({ activeVersion: 'dispatch-event-v1', keys: [{ version: 'dispatch-event-v1', encryptionKey: Buffer.alloc(32, 153), digestKey: Buffer.alloc(32, 154) }] });
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const vector = (b: ConnectionBinding) => [b.applicationId, b.tenantId, b.ownerId, b.connectionId, b.accountId, b.generation, b.channel, b.platform, b.backend];
  beforeAll(async () => {
    await local.preflight();
    const { rows: [schema] } = await local.pool.query("SELECT to_regclass('communications.tenant_reply_barriers')::text AS barrier,to_regclass('communications.operation_journal')::text AS journal");
    if (!schema.barrier || !schema.journal) throw Error('Requires exact approved service/003 schema; no schema bootstrap occurs');
  });
  afterAll(async () => {
    try {
      for (const b of retired) {
        // Durable journal history prevents retiring unresolved connection work.
        // Grants can still be revoked; synthetic connection/history stays recorded.
        await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [b.applicationId, b.tenantId, b.ownerId]);
      }
    } finally { await local.close(); }
  });
  async function transaction<T>(operation: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await local.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE communications_control');
      const value = await operation(c);
      await c.query('COMMIT');
      return value;
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally { c.release(); }
  }
  async function fixture(channel: ConnectionBinding['channel'] = 'whatsapp', share?: ConnectionBinding, backend: ConnectionBinding['backend'] = 'unipile') {
    const suffix = randomUUID();
    const b: ConnectionBinding = { applicationId: share?.applicationId ?? `dispatch-${suffix}`, tenantId: share?.tenantId ?? 'dispatch-tenant', ownerId: share ? `other-owner-${suffix}` : 'dispatch-owner', connectionId: `dispatch-connection-${suffix}`, accountId: `dispatch-account-${suffix}`, generation: 1, channel, platform: channel === 'email' ? 'gmail' : channel, backend };
    const integrationId = `dispatch-source-${suffix}`;
    await transaction(async c => {
      await c.query("INSERT INTO communications.access_grants(application_id,tenant_id,owner_id,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')", [b.applicationId, b.tenantId, b.ownerId]);
      await c.query("INSERT INTO communications.physical_accounts(id,channel,identity_namespace,identity_digest,identity_key_version,verified_at) VALUES($1,$2,'dispatch_fixture',$3,'fixture-v1',clock_timestamp())", [b.accountId, channel, hash(suffix)]);
      await c.query("INSERT INTO communications.connections(id,application_id,tenant_id,owner_id,account_id,channel,platform,backend,current_generation,status,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,'connected',true)", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, channel, b.platform, backend]);
      await c.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'{}')", [b.connectionId, b.applicationId, b.tenantId, b.ownerId, b.accountId, channel, b.platform, backend, integrationId, backend === 'unipile' ? 'v1' : null, backend === 'unipile' ? 'synthetic-config' : null, backend === 'unipile' ? 'service' : 'legacy_port']);
      await c.query("INSERT INTO communications.account_leases(account_id,owner_token,fencing_token,expires_at) VALUES($1,$2,1,clock_timestamp()+interval '1 hour')", [b.accountId, suffix]);
    });
    retired.push(b);
    const snapshot: OperationSnapshot = { key: `operation-${suffix}`, binding: b, operation: 'message', payloadDigest: hash(['synthetic-payload', suffix]) };
    const context = { recipient: { kind: channel === 'email' ? 'email' : channel === 'whatsapp' ? 'phone' : 'linkedin_profile', value: 'synthetic-recipient' }, originalSource: suffix };
    const envelope = journal.encode(snapshot, 'context', context);
    const contextDigest = journal.digest(snapshot, 'context', context);
    expect(journal.decode(snapshot, 'context', envelope)).toEqual(context);
    const capture = (): WebhookCapture => {
      const rawBody = Buffer.from(JSON.stringify({ event: 'message_received', account_id: 'synthetic-provider', message_id: suffix }));
      return { binding: structuredClone(b), key: hash(['communications.webhook.receipt.v1', vector(b), createHash('sha256').update(rawBody).digest('hex')]), rawBody, receivedAt: new Date().toISOString() };
    };
    return { b, suffix, integrationId, snapshot, envelope, contextDigest, capture, barrier: createPostgresReplyBarrier({ binding: b, integrationId, codec: local.webhookCodec, eventCodec: events }) };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function claim(f: Fixture, id = f.suffix) {
    return transaction(c => c.query("INSERT INTO communications.operation_journal(id,application_id,tenant_id,owner_id,operation_key,connection_id,generation,account_id,operation,payload_digest,recipient_digest,digest_version,recipient_key_version,encrypted_operation_context,operation_context_key_version,operation_context_digest,claim_token,claim_until,fencing_token,lease_owner_token) VALUES($1,$2,$3,$4,$5,$6,1,$7,'message',$8,$9,$10,$10,$11,$10,$12,$13,clock_timestamp()+interval '1 hour',1,$13)", [id, f.b.applicationId, f.b.tenantId, f.b.ownerId, f.snapshot.key, f.b.connectionId, f.b.accountId, f.snapshot.payloadDigest, hash(['recipient', f.suffix]), journal.keyVersion, JSON.stringify(f.envelope), f.contextDigest, f.suffix]));
  }
  async function admission(c: PoolClient, f: Fixture, lock = true) {
    if (lock) await f.barrier.lock(c, f.b.applicationId, f.b.tenantId);
    for (const kind of ['account', 'application']) {
      await c.query("INSERT INTO communications.quota_buckets(account_id,bucket_kind,application_id,window_kind,window_start,used,limit_value) VALUES($1,$2,$3,'hour',date_trunc('hour',clock_timestamp()),1,100) ON CONFLICT(account_id,bucket_kind,application_id,window_kind,window_start) DO UPDATE SET used=communications.quota_buckets.used+1", [f.b.accountId, kind, kind === 'account' ? '' : f.b.applicationId]);
    }
    const result = await c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true WHERE id=$1 AND state='claimed' AND claim_token=$2 RETURNING state", [f.suffix, f.suffix]);
    if (result.rowCount !== 1) throw Error('Original claim is unavailable for dispatch');
  }
  async function state(f: Fixture) {
    const { rows: [row] } = await local.pool.query('SELECT state,quota_reserved,encrypted_operation_context,operation_context_digest FROM communications.operation_journal WHERE id=$1', [f.suffix]);
    const { rows: [quota] } = await local.pool.query('SELECT count(*)::integer AS buckets,coalesce(sum(used),0)::integer AS used FROM communications.quota_buckets WHERE account_id=$1', [f.b.accountId]);
    return { row, quota };
  }
  async function blocked(f: Fixture, message: RegExp = /remains pending/) {
    await expect(transaction(c => admission(c, f))).rejects.toThrow(message);
    expect(await state(f)).toEqual({ row: { state: 'claimed', quota_reserved: false, encrypted_operation_context: JSON.stringify(f.envelope), operation_context_digest: f.contextDigest }, quota: { buckets: 0, used: 0 } });
  }
  async function receipt(c: PoolClient, f: Fixture, status: 'pending' | 'processing' | 'processed' | 'dead_letter' = 'pending', routed = true) {
    await f.barrier.lock(c, f.b.applicationId, f.b.tenantId);
    const raw = f.capture(), envelope = local.webhookCodec.encode(raw);
    await c.query("INSERT INTO communications.webhook_inbox(id,backend,integration_id,dedupe_key,payload_digest,encrypted_payload,key_version,authenticated_at,received_at,expires_at) VALUES($1,$2,$3,$1,$4,$5,$6,clock_timestamp(),$7,clock_timestamp()+interval '1 hour')", [raw.key, f.b.backend, f.integrationId, local.webhookCodec.digest({ binding: f.b, key: raw.key }, raw.rawBody), JSON.stringify(envelope), envelope.keyVersion, raw.receivedAt]);
    if (routed) await f.barrier.route(c, raw);
    if (status !== 'pending') await c.query('UPDATE communications.webhook_inbox SET state=$2 WHERE id=$1', [raw.key, status]);
    return raw.key;
  }
  async function event(c: PoolClient, f: Fixture) {
    await f.barrier.lock(c, f.b.applicationId, f.b.tenantId);
    const key = hash(['synthetic-review', f.suffix]), receivedAt = new Date().toISOString();
    const payload = { outcome: { kind: 'review' as const, code: 'identity_pending' as const }, fingerprint: hash(['communications.reply.review.v1', vector(f.b), key, 'identity_pending']), receivedAt };
    const envelope = events.encode({ binding: f.b, key }, payload);
    const { rows: [row] } = await c.query("INSERT INTO communications.events(application_id,tenant_id,owner_id,connection_id,generation,account_id,source_namespace,source_event_key,event_type,direction,occurred_at,encrypted_event,key_version) VALUES($1,$2,$3,$4,1,$5,'reply_review/v1',$6,'account',NULL,$7,$8,$9) RETURNING id::text", [f.b.applicationId, f.b.tenantId, f.b.ownerId, f.b.connectionId, f.b.accountId, key, receivedAt, JSON.stringify(envelope), envelope.keyVersion]);
    return String(row.id);
  }
  it.each(['email', 'whatsapp', 'linkedin'] as const)('permits %s SQL dispatch only with clear pending-work gate and valid claim authority', async channel => {
    const f = await fixture(channel);
    await claim(f);
    await transaction(c => admission(c, f));
    const { row, quota } = await state(f);
    expect(row).toMatchObject({ state: 'dispatching', quota_reserved: true, encrypted_operation_context: JSON.stringify(f.envelope), operation_context_digest: f.contextDigest });
    expect(quota).toEqual({ buckets: 2, used: 2 });
  });
  it('rejects missing tenant barrier and rolls back both quota reservations', async () => {
    const f = await fixture();
    await claim(f);
    await expect(transaction(c => admission(c, f, false))).rejects.toThrow(/not initialized/);
    expect((await state(f)).quota).toEqual({ buckets: 0, used: 0 });
    expect((await state(f)).row).toMatchObject({ state: 'claimed', quota_reserved: false });
  });
  it.each(['pending', 'processing', 'dead_letter'] as const)('rejects routed %s receipt and preserves claim/context with zero quota charge', async status => {
    const f = await fixture();
    await claim(f);
    await transaction(c => receipt(c, f, status));
    await blocked(f);
  });
  it('rejects unrouted processed receipt until explicit original routing', async () => {
    const f = await fixture();
    await claim(f);
    await transaction(c => receipt(c, f, 'processed', false));
    await blocked(f);
  });
  it.each(['pending', 'delivering', 'dead_letter'] as const)('rejects %s subscriber outbox from another owner/legacy channel', async status => {
    const f = await fixture('email'), source = await fixture('whatsapp', f.b, 'baileys');
    await claim(f);
    await transaction(async c => {
      const eid = await event(c, source);
      await c.query('INSERT INTO communications.event_outbox(event_id,subscriber_id,application_id,tenant_id,owner_id,state) VALUES($1,$2,$3,$4,$5,$6)', [eid, 'synthetic-subscriber', source.b.applicationId, source.b.tenantId, source.b.ownerId, status]);
    });
    await blocked(f);
  });
  it('permits the SQL pending-work gate after acknowledged outbox without claiming app readiness', async () => {
    const f = await fixture();
    await claim(f);
    await transaction(async c => {
      const eid = await event(c, f);
      await c.query("INSERT INTO communications.event_outbox(event_id,subscriber_id,application_id,tenant_id,owner_id,state,acknowledged_at) VALUES($1,'synthetic-ack',$2,$3,$4,'acknowledged',clock_timestamp())", [eid, f.b.applicationId, f.b.tenantId, f.b.ownerId]);
    });
    await transaction(c => admission(c, f));
    expect((await state(f)).row.state).toBe('dispatching');
  });
  it('rejects unresolved review from another owner/legacy channel', async () => {
    const f = await fixture('email'), source = await fixture('linkedin', f.b, 'browser');
    await claim(f);
    await transaction(async c => {
      const eid = await event(c, source);
      await source.barrier.review(c, { eventId: eid, code: 'identity_pending' });
    });
    await blocked(f);
  });
  it('serializes concurrent capture before admission and observes its committed pending receipt', async () => {
    const f = await fixture();
    await claim(f);
    const captureClient = await local.pool.connect(), admitClient = await local.pool.connect();
    let attempt: Promise<unknown> | undefined;
    try {
      await captureClient.query('BEGIN');
      await captureClient.query('SET LOCAL ROLE communications_control');
      await receipt(captureClient, f);
      await admitClient.query('BEGIN');
      await admitClient.query('SET LOCAL ROLE communications_control');
      const pid = (await admitClient.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      attempt = admission(admitClient, f);
      void attempt.catch(() => {});
      let waiting = false;
      for (let index = 0; index < 30; index++) {
        const { rows: [active] } = await local.pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
        if (active?.wait_event_type === 'Lock') { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(waiting).toBe(true);
      await captureClient.query('COMMIT');
      await expect(attempt).rejects.toThrow(/remains pending/);
      await admitClient.query('ROLLBACK');
      expect((await state(f)).quota).toEqual({ buckets: 0, used: 0 });
      expect((await state(f)).row.state).toBe('claimed');
    } finally {
      await captureClient.query('ROLLBACK');
      await admitClient.query('ROLLBACK');
      await attempt?.catch(() => {});
      captureClient.release();
      admitClient.release();
    }
  });
  it.each(['grant', 'claim', 'lease'] as const)('retains original admission guard when %s authority expires', async kind => {
    const f = await fixture();
    await claim(f);
    if (kind === 'grant') await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1 AND tenant_id=$2 AND owner_id=$3', [f.b.applicationId, f.b.tenantId, f.b.ownerId]);
    if (kind === 'claim') await local.pool.query("UPDATE communications.operation_journal SET claim_until=clock_timestamp()-interval '1 second' WHERE id=$1", [f.suffix]);
    if (kind === 'lease') await local.pool.query("UPDATE communications.account_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1", [f.b.accountId]);
    await blocked(f, kind === 'grant' ? /current scoped grant/ : /valid fenced account lease/);
  });
  it('refuses an unknown operation original-key claim retry and unsafe dispatch transition', async () => {
    const f = await fixture();
    await claim(f);
    await transaction(c => c.query("UPDATE communications.operation_journal SET state='unknown' WHERE id=$1", [f.suffix]));
    await expect(claim(f, `retry-${f.suffix}`)).rejects.toThrow(/duplicate key/);
    await expect(transaction(c => admission(c, f))).rejects.toThrow(/Original claim is unavailable/);
    await expect(transaction(c => c.query("UPDATE communications.operation_journal SET state='dispatching',quota_reserved=true WHERE id=$1", [f.suffix]))).rejects.toThrow(/Unsafe operation transition/);
    expect((await state(f)).row).toMatchObject({ state: 'unknown', quota_reserved: false });
    expect((await state(f)).quota).toEqual({ buckets: 0, used: 0 });
  });
  it('preserves charged quota and refuses original-key retry after dispatch becomes unknown', async () => {
    const f = await fixture();
    await claim(f);
    await transaction(c => admission(c, f));
    // Synthetic journal ambiguity; no real provider request or lost response is claimed.
    await transaction(c => c.query("UPDATE communications.operation_journal SET state='unknown' WHERE id=$1", [f.suffix]));
    await expect(claim(f, `retry-${f.suffix}`)).rejects.toThrow(/duplicate key/);
    await expect(transaction(c => admission(c, f))).rejects.toThrow(/Original claim is unavailable/);
    await expect(transaction(c => c.query("UPDATE communications.operation_journal SET state='dispatching' WHERE id=$1", [f.suffix]))).rejects.toThrow(/Unsafe operation transition/);
    const { row, quota } = await state(f);
    expect(row).toMatchObject({ state: 'unknown', quota_reserved: true, encrypted_operation_context: JSON.stringify(f.envelope), operation_context_digest: f.contextDigest });
    expect(quota).toEqual({ buckets: 2, used: 2 });
  });
});
