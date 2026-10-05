import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createStore } from './store.mjs';

// Opt-in, fixed local target, existing schema only. Never connects to WhatsApp.
test('local reply journal: durable replay, bounded pages, account isolation and transactional rollback', { skip: process.env.WHATSAPP_DB_TEST !== 'true' }, async () => {
  const connectionString = process.env.DATABASE_URL;
  const target = new URL(connectionString);
  assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '5434'); assert.equal(target.pathname, '/project_acquire');
  const admin = new pg.Client({ connectionString }); await admin.connect();
  const id = `reply-journal-${randomUUID()}`, actor = { organizationId: id, userId: id };
  const store = createStore({ DATABASE_URL: connectionString, WHATSAPP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), CAMPAIGN_REPLY_MONITOR_ENABLED: 'true' });
  let handle;
  try {
    await admin.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [id, `${id}@example.invalid`]);
    await admin.query('INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)', [id]);
    await admin.query('INSERT INTO member (id,organization_id,user_id) VALUES ($1,$1,$1)', [id]);
    handle = await store.open(actor);
    const events = Array.from({ length: 502 }, (_, i) => ({ id: `synthetic-${i}`, remoteIdentity: '61412345678@s.whatsapp.net', fromIdentity: '61412345678@s.whatsapp.net', receivedAt: '2026-10-06T00:00:00Z' }));
    await handle.saveReplyEvents('synthetic-account', [...events, events[0]]);
    await handle.saveReplyEvents('synthetic-account', events);
    await handle.close(); handle = await store.open(actor);
    const first = await handle.readReplyEvents('synthetic-account', '0');
    assert.equal(first.length, 501); // One lookahead row for a 500-event page.
    const last = await handle.readReplyEvents('synthetic-account', first.at(-1).id);
    assert.equal(last.length, 1);
    assert.equal((await handle.readReplyEvents('different-account', '0')).length, 0);
    await assert.rejects(handle.saveReplyEvents('rollback-account', [...events, { ...events[0], id: 'bad-time', receivedAt: 'invalid timestamp' }]));
    assert.equal((await handle.readReplyEvents('rollback-account', '0')).length, 0, 'a failed second batch rolls back the first batch too');
    assert.equal((await admin.query('SELECT count(*)::int n FROM whatsapp_reply_events WHERE connection_id=$1', [handle.connectionId])).rows[0].n, 502);
    await admin.query("UPDATE whatsapp_session_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE connection_id=$1", [handle.connectionId]);
    await assert.rejects(handle.saveReplyEvents('synthetic-account', [{ ...events[0], id: 'stale-worker' }]), error => error.status === 409);
  } finally {
    if (handle) await handle.close(); await store.close();
    await admin.query('DELETE FROM whatsapp_connections WHERE organization_id=$1', [id]);
    await admin.query('DELETE FROM member WHERE organization_id=$1', [id]);
    await admin.query('DELETE FROM organization WHERE id=$1', [id]);
    await admin.query('DELETE FROM "user" WHERE id=$1', [id]); await admin.end();
  }
});
