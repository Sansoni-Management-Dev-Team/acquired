import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { createStore } from './store.mjs';

// Never creates schema. Run only after specific local migration approval.
test('Postgres: encrypted creds/key persistence, lease exclusivity, isolation, deletion and RLS', { skip: process.env.WHATSAPP_DB_TEST !== 'true' }, async () => {
  const connectionString = process.env.DATABASE_URL;
  const parsed = new URL(connectionString);
  if (!['127.0.0.1', 'localhost', 'postgres'].includes(parsed.hostname)) throw new Error('Integration tests require local Postgres');
  const admin = new pg.Client({ connectionString }); await admin.connect();
  const id = `whatsapp-test-${randomUUID()}`;
  const actor = { organizationId: id, userId: id };
  const env = { DATABASE_URL: connectionString, WHATSAPP_ENCRYPTION_KEY: randomBytes(32).toString('base64') };
  let keyWriteQueries = 0;
  const pool = new pg.Pool({ connectionString });
  pool.on('connect', client => {
    const query = client.query.bind(client);
    client.query = (...args) => {
      if (typeof args[0] === 'string' && args[0].startsWith('INSERT INTO whatsapp_auth_keys')) keyWriteQueries++;
      return query(...args);
    };
  });
  const store = createStore(env, { pool }); const other = createStore(env);
  let session; let stale;
  try {
    await store.health();
    await admin.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [id, `${id}@example.invalid`]);
    await admin.query('INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)', [id]);
    await admin.query('INSERT INTO member (id,organization_id,user_id) VALUES ($1,$1,$1)', [id]);
    session = await store.open(actor);
    session.state.creds.testSecret = 'credential-must-stay-encrypted'; await session.saveCreds();
    const prekeys = Object.fromEntries(Array.from({ length: 812 }, (_, i) => [String(i), { public: Buffer.from([i % 256]), private: Buffer.from([255]) }]));
    const writesBefore = keyWriteQueries;
    await session.state.keys.set({ 'pre-key': prekeys });
    assert.equal(keyWriteQueries - writesBefore, 1, 'initial login keys require one database write round trip');
    assert.deepEqual(await session.state.keys.get('pre-key', Object.keys(prekeys)), prekeys);
    await session.state.keys.set({ 'pre-key': { '0': null, '811': { public: Buffer.from([42]) } } });
    assert.deepEqual(await session.state.keys.get('pre-key', ['0', '811']), { '811': { public: Buffer.from([42]) } });
    await session.state.keys.set({ session: { a: Buffer.from([1, 255, 3]), b: { value: 'private-key' } } });
    assert.deepEqual(await session.state.keys.get('session', ['a']), { a: Buffer.from([1, 255, 3]) });
    await assert.rejects(other.open(actor), e => e.status === 409);
    const { rows: [row] } = await admin.query('SELECT encrypted_creds FROM whatsapp_connections WHERE user_id=$1', [id]);
    assert.ok(!row.encrypted_creds.includes('credential-must-stay-encrypted'));
    const keys = await admin.query('SELECT encrypted_value FROM whatsapp_auth_keys k JOIN whatsapp_connections c ON c.id=k.connection_id WHERE c.user_id=$1', [id]);
    assert.ok(keys.rows.every(r => !r.encrypted_value.includes('private-key')));
    await session.close(); session = await other.open(actor);
    assert.equal(session.state.creds.testSecret, 'credential-must-stay-encrypted');
    assert.deepEqual(await session.state.keys.get('session', ['a']), { a: Buffer.from([1, 255, 3]) });
    let lost = false; session.onLeaseLost(() => { lost = true; });
    await admin.query('UPDATE whatsapp_session_leases SET expires_at=clock_timestamp()-interval \'1 second\' WHERE connection_id=(SELECT id FROM whatsapp_connections WHERE user_id=$1)', [id]);
    stale = session; session = await store.open(actor);
    await assert.rejects(stale.saveCreds(), e => e.status === 409); assert.equal(lost, true);
    await stale.close(); stale = undefined;
    await session.assertLease(); // stale close must not remove the successor's lease
    await session.renew();
    await assert.rejects(session.state.keys.set({ session: { rollback: 'must-not-commit', broken: 1n } }));
    assert.deepEqual(await session.state.keys.get('session', ['rollback']), {});
    await session.state.keys.set({ session: { a: null } }); assert.deepEqual(await session.state.keys.get('session', ['a']), {});
    await assert.rejects(store.status({ ...actor, userId: 'outsider' }), e => e.status === 403);
    const rls = await admin.query("SELECT relname,relrowsecurity FROM pg_class WHERE relname IN ('whatsapp_connections','whatsapp_auth_keys','whatsapp_session_leases')");
    assert.equal(rls.rows.length, 3); assert.ok(rls.rows.every(r => r.relrowsecurity));
    await session.clear(); assert.equal((await other.status(actor)).status, 'disconnected');
    assert.deepEqual(await session.state.keys.get('session', ['b']), {});
  } finally {
    if (session) await session.close(); if (stale) await stale.close();
    await store.close(); await other.close();
    await admin.query('DELETE FROM member WHERE id=$1', [id]);
    await admin.query('DELETE FROM organization WHERE id=$1', [id]);
    await admin.query('DELETE FROM "user" WHERE id=$1', [id]); await admin.end();
  }
});

test('Postgres: 100 idle accounts share two pooled connections and independent renewable leases', { skip: process.env.WHATSAPP_DB_TEST !== 'true' }, async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!['127.0.0.1', 'localhost', 'postgres'].includes(new URL(connectionString).hostname)) throw new Error('Local Postgres required');
  const admin = new pg.Client({ connectionString }); await admin.connect();
  const org = `whatsapp-pool-test-${randomUUID()}`; const actors = Array.from({ length: 100 }, (_, i) => ({ organizationId: org, userId: `${org}-${i}` }));
  const pool = new pg.Pool({ connectionString, max: 2, connectionTimeoutMillis: 5000 });
  const store = createStore({ DATABASE_URL: connectionString, WHATSAPP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), WHATSAPP_DB_POOL_SIZE: '2' }, { pool });
  const handles = [];
  try {
    await store.health();
    await admin.query('INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)', [org]);
    for (const actor of actors) {
      await admin.query('INSERT INTO "user" (id,name,email) VALUES ($1,$1,$2)', [actor.userId, `${actor.userId}@example.invalid`]);
      await admin.query('INSERT INTO member (id,organization_id,user_id) VALUES ($1,$2,$1)', [actor.userId, org]);
    }
    await Promise.all(actors.map(async actor => { const handle = await store.open(actor); handles.push(handle); await handle.saveCreds(); }));
    assert.equal(handles.length, 100); assert.ok(pool.totalCount <= 2); assert.equal(pool.idleCount, pool.totalCount);
    await Promise.all(handles.map(handle => handle.renew()));
    const leases = await admin.query('SELECT count(*)::int AS count FROM whatsapp_session_leases l JOIN whatsapp_connections c ON c.id=l.connection_id WHERE c.organization_id=$1 AND l.expires_at>clock_timestamp()', [org]);
    assert.equal(leases.rows[0].count, 100);
    await assert.rejects(store.open(actors[0]), error => error.status === 409);
    await store.health(); // not starved by idle accounts
  } finally {
    await Promise.allSettled(handles.map(handle => handle.close())); await store.close();
    await admin.query('DELETE FROM organization WHERE id=$1', [org]);
    await admin.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [actors.map(actor => actor.userId)]); await admin.end();
  }
});
