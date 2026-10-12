import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConnectionBinding, CommunicationEvent } from '../../communications/packages/contracts/src';
import type { ClaimedWebhook } from '../../communications/packages/core/src/reply-ingress';
import type { NormalizedWebhookOutcome, NormalizedWebhookPort } from '../../communications/packages/core/src/webhook-events';
import { EventCodec } from '../../communications/packages/core/src/event-codec';
import { createPostgresWebhookRepository, type SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createCommunicationsLocalFixture } from './communications-local-test-support';

const enabled = process.env.COMMUNICATIONS_AUDIT_LOCAL_DB === '1';
describe.skipIf(!enabled)('isolated PostgreSQL normalized event and outbox completion', () => {
  const local = createCommunicationsLocalFixture();
  const eventCodec = new EventCodec({ activeVersion: 'terminal-event-v1', keys: [{ version: 'terminal-event-v1', encryptionKey: Buffer.alloc(32, 111), digestKey: Buffer.alloc(32, 112) }] });
  beforeAll(() => local.preflight());
  afterAll(() => local.close());
  const subscriberId = 'terminal-subscriber';
  function repository(binding: ConnectionBinding, overrides: { pool?: SqlPool; leaseSeconds?: number } = {}) {
    return createPostgresWebhookRepository({ pool: local.driver, binding, integrationId: 'terminal-integration', providerConfigurationReference: 'terminal-configuration', subscriberId, codec: local.webhookCodec, eventCodec, ...overrides } as Parameters<typeof createPostgresWebhookRepository>[0]) as ReturnType<typeof createPostgresWebhookRepository> & NormalizedWebhookPort;
  }
  async function claim(repo: ReturnType<typeof repository>, capture: ReturnType<Awaited<ReturnType<typeof local.fixture>>['capture']>): Promise<ClaimedWebhook> {
    await repo.capture(capture); const claimed = await repo.claim({ binding: capture.binding, key: capture.key });
    if (claimed.kind !== 'claimed') throw Error('Synthetic fixture claim failed'); return claimed.record;
  }
  function outcome(binding: ConnectionBinding, suffix: string, change: Partial<Extract<CommunicationEvent, { type: 'message' }>> = {}): Extract<NormalizedWebhookOutcome, { kind: 'event' }> & { event: Extract<CommunicationEvent, { type: 'message' }> } {
    const sender = binding.channel === 'email' ? { kind: 'email' as const, value: 'person@example.test' } : binding.channel === 'whatsapp' ? { kind: 'phone' as const, value: '+15550000001' } : { kind: 'linkedin_profile' as const, value: 'https://www.linkedin.com/in/synthetic-person/' };
    const event: Extract<CommunicationEvent, { type: 'message' }> = { type: 'message', reference: { binding: structuredClone(binding), id: suffix }, conversation: { binding: structuredClone(binding), id: `chat-${suffix}` }, direction: 'inbound', sender, occurredAt: '2026-10-12T10:00:00.000Z', ...change };
    const scope = [binding.applicationId, binding.tenantId, binding.ownerId, binding.connectionId, binding.accountId, binding.generation, binding.channel, binding.platform, binding.backend];
    const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
    return { kind: 'event', event, eventKey: hash(['communications.reply.event.v1', scope, event.conversation?.id ?? null, event.reference.id]), fingerprint: hash(['communications.reply.content.v1', scope, event.reference.id, event.conversation?.id ?? null, event.direction, event.sender.kind, event.sender.value, new Date(event.occurredAt).toISOString()]) };
  }
  async function rows(binding: ConnectionBinding) {
    const events = await local.pool.query('SELECT * FROM communications.events WHERE connection_id=$1 ORDER BY id', [binding.connectionId]);
    const outbox = await local.pool.query('SELECT * FROM communications.event_outbox WHERE application_id=$1', [binding.applicationId]);
    return { events: events.rows, outbox: outbox.rows };
  }
  it.each(['email', 'whatsapp', 'linkedin'] as const)('atomically persists encrypted %s event, scoped subscriber and terminal inbox', async channel => {
    const f = await local.fixture(channel), repo = repository(f.binding), record = await claim(repo, f.capture()), normalized = outcome(f.binding, f.suffix);
    expect(typeof repo.finish).toBe('function');
    expect(await repo.finish({ record, outcome: normalized })).toEqual({ binding: f.binding, key: record.key, committed: true });
    const stored = await rows(f.binding); expect(stored.events).toHaveLength(1); expect(stored.outbox).toHaveLength(1);
    expect(stored.events[0]).toMatchObject({ source_namespace: 'reply_message/v1', source_event_key: normalized.eventKey, event_type: 'message', direction: 'inbound', webhook_inbox_id: record.key });
    expect(JSON.stringify(stored)).not.toContain(normalized.event.sender.value); expect(JSON.stringify(stored)).not.toContain('synthetic-private-message');
    expect(eventCodec.decode({ binding: f.binding, key: normalized.eventKey }, JSON.parse(stored.events[0].encrypted_event))).toMatchObject({ outcome: normalized, fingerprint: normalized.fingerprint, receivedAt: record.receivedAt });
    expect(stored.outbox[0]).toMatchObject({ subscriber_id: subscriberId, application_id: f.binding.applicationId, tenant_id: f.binding.tenantId, owner_id: f.binding.ownerId, state: 'pending' });
    const { rows: [inbox] } = await local.pool.query('SELECT state,lease_token,lease_until FROM communications.webhook_inbox WHERE id=$1', [record.key]); expect(inbox).toEqual({ state: 'processed', lease_token: null, lease_until: null });
  });
  it('deduplicates concurrent semantic events without replacing ciphertext or subscriber', async () => {
    const f = await local.fixture(), repo = repository(f.binding), a = await claim(repo, f.capture()), b = await claim(repo, f.capture({ delivery_attempt: 2 })), normalized = outcome(f.binding, f.suffix);
    expect(typeof repo.finish).toBe('function');
    expect((await Promise.all([repo.finish({ record: a, outcome: normalized }), repo.finish({ record: b, outcome: normalized })])).map(r => r.committed)).toEqual([true, true]);
    const stored = await rows(f.binding); expect(stored.events).toHaveLength(1); expect(stored.outbox).toHaveLength(1);
    expect((await repo.claim({ binding: f.binding, key: a.key })).kind).toBe('completed'); expect((await repo.claim({ binding: f.binding, key: b.key })).kind).toBe('completed');
  });
  it('persists semantic conflict as review and invalidates every cursor without a second message', async () => {
    const f = await local.fixture(), repo = repository(f.binding), a = await claim(repo, f.capture());
    const normalized = outcome(f.binding, f.suffix); expect(typeof repo.finish).toBe('function'); await repo.finish({ record: a, outcome: normalized });
    for (const digest of ['a'.repeat(64), 'b'.repeat(64)]) await local.pool.query("INSERT INTO communications.event_cursors(connection_id,generation,application_id,tenant_id,owner_id,account_id,scope_digest,coverage_from,coverage_through,observed_at,complete,initial_sync_complete,invalidated,lease_token,lease_until) VALUES($1,1,$2,$3,$4,$5,$6,clock_timestamp()-interval '1 minute',clock_timestamp(),clock_timestamp(),true,true,false,'old-worker',clock_timestamp()+interval '1 hour')", [f.binding.connectionId, f.binding.applicationId, f.binding.tenantId, f.binding.ownerId, f.binding.accountId, digest]);
    const b = await claim(repo, f.capture({ delivery_attempt: 'contradictory' })), contradictory = outcome(f.binding, f.suffix, { sender: { kind: 'phone', value: '+15550000002' } });
    expect((await repo.finish({ record: b, outcome: contradictory })).committed).toBe(true);
    const stored = await rows(f.binding); expect(stored.events.filter(e => e.event_type === 'message')).toHaveLength(1); expect(stored.events.filter(e => e.event_type === 'account')).toHaveLength(1); expect(stored.outbox).toHaveLength(2);
    const review = stored.events.find(e => e.event_type === 'account'); expect(review).toMatchObject({ source_namespace: 'reply_review/v1', source_event_key: b.key, direction: null });
    expect(eventCodec.decode({ binding: f.binding, key: b.key }, JSON.parse(review.encrypted_event)).outcome).toEqual({ kind: 'review', code: 'protocol' });
    const { rows: cursors } = await local.pool.query('SELECT invalidated,complete,lease_token,lease_until FROM communications.event_cursors WHERE connection_id=$1', [f.binding.connectionId]); expect(cursors).toEqual([{ invalidated: true, complete: false, lease_token: null, lease_until: null }, { invalidated: true, complete: false, lease_token: null, lease_until: null }]);
  });
  it('finishes ignored events without inventing an event/outbox', async () => {
    const f = await local.fixture(), repo = repository(f.binding), record = await claim(repo, f.capture()); expect(typeof repo.finish).toBe('function');
    expect((await repo.finish({ record, outcome: { kind: 'ignore', reason: 'not_inbound' } })).committed).toBe(true); const stored = await rows(f.binding); expect(stored.events).toHaveLength(0); expect(stored.outbox).toHaveLength(0);
  });
  it('rejects a stale token, expired lease, changed owner and revoked grant', async () => {
    const f = await local.fixture(), repo = repository(f.binding, { leaseSeconds: 1 }), record = await claim(repo, f.capture()), normalized = outcome(f.binding, f.suffix); expect(typeof repo.finish).toBe('function');
    expect((await repo.finish({ record: { ...record, token: 'other-token' }, outcome: normalized })).committed).toBe(false);
    await expect(repo.finish({ record: { ...record, binding: { ...f.binding, ownerId: 'other' } }, outcome: normalized })).rejects.toThrow('Webhook repository unavailable');
    await new Promise(resolve => setTimeout(resolve, 1200)); expect((await repo.finish({ record, outcome: normalized })).committed).toBe(false);
    const reclaimed = await repo.claim({ binding: f.binding, key: record.key }); if (reclaimed.kind !== 'claimed') throw Error('Expected reclaimed fixture');
    await local.pool.query('UPDATE communications.access_grants SET revoked_at=clock_timestamp() WHERE application_id=$1', [f.binding.applicationId]); expect((await repo.finish({ record: reclaimed.record, outcome: normalized })).committed).toBe(false); expect((await rows(f.binding)).events).toHaveLength(0);
  });
  it('publishes an explicit review account event without inventing a message', async () => {
    const f = await local.fixture(), repo = repository(f.binding), record = await claim(repo, f.capture());
    expect((await repo.finish({ record, outcome: { kind: 'review', code: 'identity_pending' } })).committed).toBe(true);
    const stored = await rows(f.binding); expect(stored.events).toHaveLength(1); expect(stored.events[0]).toMatchObject({ event_type: 'account', direction: null, source_namespace: 'reply_review/v1', source_event_key: record.key }); expect(stored.outbox).toHaveLength(1);
    expect(eventCodec.decode({ binding: f.binding, key: record.key }, JSON.parse(stored.events[0].encrypted_event)).outcome).toEqual({ kind: 'review', code: 'identity_pending' });
  });
  it('rejects a forged original receipt timestamp without writing an event', async () => {
    const f = await local.fixture(), repo = repository(f.binding), record = await claim(repo, f.capture());
    const forged = { ...record, receivedAt: new Date(Date.parse(record.receivedAt) + 1).toISOString() };
    await expect(repo.finish({ record: forged, outcome: outcome(f.binding, f.suffix) })).rejects.toThrow('Webhook repository unavailable'); expect((await rows(f.binding)).events).toHaveLength(0);
  });
  it('rolls back event/outbox when the worker lease expires during completion', async () => {
    const f = await local.fixture(), good = repository(f.binding, { leaseSeconds: 1 }), record = await claim(good, f.capture());
    const driver: SqlPool = { async connect() { const client = await local.driver.connect(); return { async query<Row>(text: string, values?: unknown[]) { if (text.includes('INSERT INTO communications.event_outbox')) await new Promise(resolve => setTimeout(resolve, 1200)); return client.query<Row>(text, values); }, release(error?: Error) { client.release(error); } }; } };
    expect((await repository(f.binding, { pool: driver }).finish({ record, outcome: outcome(f.binding, f.suffix) })).committed).toBe(false);
    const stored = await rows(f.binding); expect(stored.events).toHaveLength(0); expect(stored.outbox).toHaveLength(0); const { rows: [inbox] } = await local.pool.query('SELECT state FROM communications.webhook_inbox WHERE id=$1', [record.key]); expect(inbox.state).toBe('processing');
  });
  it('rejects an old generation after a connection generation change', async () => {
    const f = await local.fixture(), repo = repository(f.binding), record = await claim(repo, f.capture()); const b = f.binding;
    await local.pool.query("INSERT INTO communications.connection_generations(connection_id,generation,application_id,tenant_id,owner_id,account_id,channel,platform,backend,integration_id,provider_api_version,provider_configuration_reference,authority,capabilities) VALUES($1,2,$2,$3,$4,$5,$6,$7,'unipile','terminal-integration','v1','terminal-configuration','service','{}')", [b.connectionId,b.applicationId,b.tenantId,b.ownerId,b.accountId,b.channel,b.platform]);
    await local.pool.query('UPDATE communications.connections SET current_generation=2 WHERE id=$1', [b.connectionId]);
    expect((await repo.finish({ record, outcome: outcome(b, f.suffix) })).committed).toBe(false); expect((await rows(b)).events).toHaveLength(0);
  });
  it('preserves an acknowledged subscriber receipt during semantic replay', async () => {
    const f = await local.fixture(), repo = repository(f.binding), first = await claim(repo, f.capture()), normalized = outcome(f.binding, f.suffix);
    await repo.finish({ record: first, outcome: normalized }); await local.pool.query("UPDATE communications.event_outbox SET state='acknowledged',acknowledged_at=clock_timestamp() WHERE application_id=$1", [f.binding.applicationId]);
    const replay = await claim(repo, f.capture({ delivery_attempt: 'replay' })); expect((await repo.finish({ record: replay, outcome: normalized })).committed).toBe(true);
    const stored = await rows(f.binding); expect(stored.events).toHaveLength(1); expect(stored.outbox).toHaveLength(1); expect(stored.outbox[0].state).toBe('acknowledged');
  });
  it('rolls back event/outbox/terminal state on an injected outbox failure, then recovers', async () => {
    const f = await local.fixture(), good = repository(f.binding), record = await claim(good, f.capture()); let failed = false;
    const driver: SqlPool = { async connect() { const client = await local.driver.connect(); return { async query<Row>(text: string, values?: unknown[]) { if (!failed && text.includes('INSERT INTO communications.event_outbox')) { failed = true; throw Error('synthetic interruption'); } return client.query<Row>(text, values); }, release(error?: Error) { client.release(error); } }; } };
    const broken = repository(f.binding, { pool: driver }); expect(typeof broken.finish).toBe('function'); await expect(broken.finish({ record, outcome: outcome(f.binding, f.suffix) })).rejects.toThrow('Webhook repository unavailable');
    const stored = await rows(f.binding); expect(stored.events).toHaveLength(0); expect(stored.outbox).toHaveLength(0); const { rows: [inbox] } = await local.pool.query('SELECT state FROM communications.webhook_inbox WHERE id=$1', [record.key]); expect(inbox.state).toBe('processing');
    expect((await good.finish({ record, outcome: outcome(f.binding, f.suffix) })).committed).toBe(true);
  });
  it('recovers a committed outcome after a lost COMMIT response without duplicating delivery', async () => {
    const f = await local.fixture(), good = repository(f.binding), record = await claim(good, f.capture()); let interrupted = false;
    const driver: SqlPool = { async connect() { const client = await local.driver.connect(); return { async query<Row>(text: string, values?: unknown[]) { const result = await client.query<Row>(text, values); if (!interrupted && text === 'COMMIT') { interrupted = true; throw Object.assign(Error('synthetic lost response'), { code: 'ECONNRESET' }); } return result; }, release(error?: Error) { client.release(error); } }; } };
    const broken = repository(f.binding, { pool: driver }); expect(typeof broken.finish).toBe('function'); await expect(broken.finish({ record, outcome: outcome(f.binding, f.suffix) })).rejects.toThrow('Webhook repository unavailable'); expect((await good.claim({ binding: f.binding, key: record.key })).kind).toBe('completed'); const stored = await rows(f.binding); expect(stored.events).toHaveLength(1); expect(stored.outbox).toHaveLength(1);
  });
});
