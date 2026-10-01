import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { authCodec } from './crypto.mjs';
import { Sessions } from './sessions.mjs';
import { serviceServer } from './http.mjs';
import { serviceConfig, shardFor } from './routing.mjs';

const actor = { organizationId: 'org', userId: 'owner' };
function fixture() {
  const statuses = new Map(); const saved = new Map(); const sockets = []; let closed = 0;
  const store = {
    authorize: async a => { if (a.userId === 'outsider') throw Object.assign(new Error('forbidden'), { status: 403 }); },
    status: async a => { await store.authorize(a); return { status: statuses.get(JSON.stringify(a)) || 'disconnected' }; },
    health: async () => {},
    open: async a => {
      const key = JSON.stringify(a);
      const creds = saved.get(key) || { registered: false };
      return { state: { creds, keys: {} }, saveCreds: async () => saved.set(key, { ...creds }), update: async s => statuses.set(key, s), clear: async () => { saved.delete(key); statuses.set(key,'disconnected'); }, close: async () => { closed++; } };
    },
  };
  const factory = options => { const socket = { ev: new EventEmitter(), user: undefined, end() {}, logout: async () => {} }; sockets.push({ socket, options }); return socket; };
  return { store, sockets, saved, sessions: new Sessions(store, factory, serviceConfig({ WHATSAPP_CONNECT_SPACING_MS: '0' })), closed: () => closed };
}
async function flush(session) { await session.events; }

test('binary credentials round trip encrypted; wrong keys and tampering fail', () => {
  const codec = authCodec(randomBytes(32).toString('base64'));
  const value = { secret: 'private-credential', key: Buffer.from([0, 255, 4]) };
  const encrypted = codec.encrypt(value);
  assert.ok(!encrypted.includes(value.secret)); assert.deepEqual(codec.decrypt(encrypted), value);
  assert.throws(() => authCodec(randomBytes(32).toString('base64')).decrypt(encrypted));
  const parts = encrypted.split('.'); const body = Buffer.from(parts[3], 'base64url'); body[0] ^= 1; parts[3] = body.toString('base64url');
  assert.throws(() => codec.decrypt(parts.join('.'))); assert.throws(() => authCodec('short'));
});
test('pairing QR is scoped to owner; repeated connect reuses one socket; disconnect clears state', async () => {
  const f = fixture(); await f.sessions.connect(actor);
  const session = f.sessions.sessions.get(f.sessions.key(actor));
  f.sockets[0].socket.ev.emit('connection.update', { qr: 'test-pairing-code' }); await flush(session);
  assert.match((await f.sessions.status(actor)).qr, /^data:image\/png;base64,/);
  assert.equal((await f.sessions.status({ ...actor, userId: 'another' })).qr, null);
  await f.sessions.connect(actor); assert.equal(f.sockets.length, 1);
  await f.sessions.disconnect(actor); assert.equal(f.saved.size, 0); assert.equal(f.closed(), 1);
  assert.equal((await f.sessions.status(actor)).status, 'disconnected');
});
test('credentials survive shutdown and restore; logged out sessions are cleared', async () => {
  const f = fixture(); await f.sessions.connect(actor);
  let session = f.sessions.sessions.get(f.sessions.key(actor));
  f.sockets[0].options.auth.creds.registered = true;
  f.sockets[0].socket.ev.emit('creds.update', {}); await flush(session);
  await f.sessions.stop();
  const restored = new Sessions(f.store, options => { assert.equal(options.auth.creds.registered, true); return f.sockets[0].socket; }, serviceConfig({ WHATSAPP_CONNECT_SPACING_MS: '0' }));
  await restored.connect(actor); session = restored.sessions.get(restored.key(actor));
  f.sockets[0].socket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  await flush(session); assert.equal(f.saved.size, 0); assert.equal((await restored.status(actor)).status, 'reconnect_required');
});
test('restartRequired reconnects once and cancelled reconnect does not open another socket', async () => {
  const f = fixture(); await f.sessions.connect(actor);
  const session = f.sessions.sessions.get(f.sessions.key(actor));
  f.sockets[0].socket.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
  await flush(session); await new Promise(r => setTimeout(r, 150)); assert.equal(f.sockets.length, 2);
  f.sockets[1].socket.ev.emit('connection.update', { connection: 'close' }); await flush(session);
  await f.sessions.disconnect(actor); await new Promise(r => setTimeout(r, 1100)); assert.equal(f.sockets.length, 2);
});
test('HTTP requires service authentication and organisation membership', async () => {
  const f = fixture(); const secret = 'test-service-secret-with-more-than-32-characters';
  const server = serviceServer(f.store, f.sessions, secret); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`; const headers = { Authorization: `Bearer ${secret}` };
  try {
    assert.equal((await fetch(`${url}/health`)).status, 401);
    assert.equal((await fetch(`${url}/health`, { headers })).status, 200);
    assert.equal((await fetch(`${url}/connection`, { headers })).status, 400);
    assert.equal((await fetch(`${url}/connection?organizationId=org&userId=outsider`, { headers, method: 'POST' })).status, 403);
    assert.equal((await fetch(`${url}/connection?organizationId=org&userId=owner`, { headers, method: 'POST' })).status, 200);
    assert.equal((await fetch(`${url}/connection?organizationId=org&userId=owner`, { headers, method: 'DELETE' })).status, 200);
  } finally { await f.sessions.stop(); await new Promise(r => server.close(r)); }
});
test('concurrent connect/disconnect cannot leave a socket or credentials behind', async () => {
  const f = fixture(); const originalOpen = f.store.open;
  f.store.open = async a => { await new Promise(r => setTimeout(r, 20)); return originalOpen(a); };
  await Promise.all([f.sessions.connect(actor), f.sessions.disconnect(actor)]);
  assert.equal(f.sessions.sessions.size, 0); assert.equal(f.saved.size, 0); assert.equal(f.closed(), 1);
});
test('history is owner scoped and disconnected accounts cannot read another session cache', async () => {
  const f = fixture(); await f.sessions.connect(actor);
  const session = f.sessions.sessions.get(f.sessions.key(actor));
  const socket = f.sockets[0].socket;
  socket.ev.emit('connection.update', { connection: 'open' }); await flush(session);
  socket.ev.emit('messaging-history.set', { contacts: [{ id: 'contact@lid', name: 'Jody Wang' }], messages: [{ key: { id: 'message1', remoteJid: 'contact@lid', fromMe: false }, messageTimestamp: 100, message: { conversation: 'fixture text' } }] });
  await flush(session);
  const result = await f.sessions.readHistory(actor, 'jody wang');
  assert.equal(result.messages.length, 1); assert.equal(result.contacts.length, 1);
  assert.equal(result.messages[0].text, 'fixture text');
  await assert.rejects(f.sessions.readHistory({ ...actor, userId: 'outsider' }, 'jody wang'), e => e.status === 403);
  await assert.rejects(f.sessions.readHistory({ ...actor, userId: 'another' }, 'jody wang'), e => e.status === 409);
  await f.sessions.disconnect(actor);
});

test('group lookup resolves known LIDs and sending uses the specified direct recipient and text', async () => {
  const f = fixture(); await f.sessions.connect(actor);
  const session = f.sessions.sessions.get(f.sessions.key(actor)); const socket = f.sockets[0].socket;
  socket.ev.emit('connection.update', { connection: 'open' }); await flush(session);
  session.history.addContacts([{ id: '123@lid', name: 'Test Contact' }]);
  socket.groupMetadata = async id => ({ id, subject: 'Fixture group', participants: [{ id: '123@lid' }, { id: '456@lid' }] });
  socket.signalRepository = { lidMapping: { getPNForLID: async lid => lid === '123@lid' ? '789@s.whatsapp.net' : undefined } };
  const group = await f.sessions.readGroup(actor, '100@g.us');
  assert.equal(group.participants[0].phoneNumber, '789@s.whatsapp.net'); assert.equal(group.participants[0].name, 'Test Contact');
  assert.equal(group.participants[1].phoneNumber, null);
  let sends = 0; socket.sendMessage = async (recipient, content) => { sends++; assert.equal(recipient, '789@s.whatsapp.net'); assert.deepEqual(content, { text: 'Exact fixture text' }); return { key: { id: 'sent-1', remoteJid: recipient } }; };
  await assert.rejects(f.sessions.sendText({ ...actor, userId: 'outsider' }, '789@s.whatsapp.net', 'Exact fixture text'), e => e.status === 403);
  await assert.rejects(f.sessions.readGroup({ ...actor, userId: 'another' }, '100@g.us'), e => e.status === 409);
  assert.equal((await f.sessions.sendText(actor, '789@s.whatsapp.net', 'Exact fixture text')).id, 'sent-1'); assert.equal(sends, 1);
  await f.sessions.stop();
});

test('HTTP direct sends validate the recipient and require membership before submission', async () => {
  const f = fixture(); await f.sessions.connect(actor); const socket = f.sockets[0].socket;
  socket.ev.emit('connection.update', { connection: 'open' }); await flush(f.sessions.sessions.get(f.sessions.key(actor)));
  let sends = 0; socket.sendMessage = async recipient => { sends++; return { key: { id: 'fixture-id', remoteJid: recipient } }; };
  const secret = 'fixture-secret-at-least-32-characters'; const server = serviceServer(f.store, f.sessions, secret);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/message?organizationId=org&userId=`;
  const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
  const send = (user, recipient) => fetch(base + user, { method: 'POST', headers, body: JSON.stringify({ recipient, text: 'fixture only' }) });
  try {
    assert.equal((await send('owner', '100@g.us')).status, 400);
    assert.equal((await send('outsider', '123@s.whatsapp.net')).status, 403); assert.equal(sends, 0);
    assert.equal((await send('owner', '123@s.whatsapp.net')).status, 200); assert.equal(sends, 1);
  } finally { await f.sessions.stop(); await new Promise(r => server.close(r)); }
});

test('one service holds 100 isolated simulated accounts, enforces capacity, and drops a lost lease without logout', async () => {
  const f = fixture(); f.sessions.config = serviceConfig({ WHATSAPP_MAX_SESSIONS: '100', WHATSAPP_CONNECT_SPACING_MS: '0', WHATSAPP_MAX_RSS_MB: '2048' });
  const lost = new Map(); const originalOpen = f.store.open;
  f.store.open = async a => ({ ...await originalOpen(a), onLeaseLost: fn => lost.set(a.userId, fn) });
  const actors = Array.from({ length: 100 }, (_, i) => ({ organizationId: 'org', userId: `account-${i}` }));
  await Promise.all(actors.map(a => f.sessions.connect(a)));
  assert.equal(f.sockets.length, 100); assert.equal(f.sessions.metrics().sessions, 100);
  await assert.rejects(f.sessions.connect({ ...actor, userId: 'overflow' }), e => e.status === 503);
  let logouts = 0; f.sockets[0].socket.logout = async () => logouts++;
  lost.get('account-0')(); assert.equal(f.sessions.sessions.size, 99); assert.equal(logouts, 0);
  assert.equal(f.sessions.sessions.has(f.sessions.key(actors[1])), true);
  await f.sessions.stop(); assert.equal(f.sessions.sessions.size, 0);
});
test('recovery restores only listed accounts and shutdown cancels queued paced starts', async () => {
  const f = fixture(); f.store.list = async () => [actor];
  await f.sessions.reconcile(); await f.sessions.reconcile(); assert.equal(f.sockets.length, 1);
  f.sessions.config.connectSpacingMs = 10000;
  const first = f.sessions.connect({ ...actor, userId: 'second' });
  await first;
  const waiting = f.sessions.connect({ ...actor, userId: 'third' });
  await new Promise(r => setTimeout(r, 10));
  await f.sessions.stop(); await assert.rejects(waiting); assert.equal(f.sockets.length, 2);
});
test('requests entering any shared shard forward once to their assigned owner', async () => {
  const a = fixture(); const b = fixture(); const secret = 'shared-routing-test-secret-over-32-characters';
  const bServer = serviceServer(b.store, b.sessions, secret); await new Promise(r => bServer.listen(0, '127.0.0.1', r));
  const aServer = serviceServer(a.store, a.sessions, secret); await new Promise(r => aServer.listen(0, '127.0.0.1', r));
  const aUrl = `http://127.0.0.1:${aServer.address().port}`; const bUrl = `http://127.0.0.1:${bServer.address().port}`;
  const shards = JSON.stringify({ a: aUrl, b: bUrl });
  a.store.config = serviceConfig({ WHATSAPP_SHARD_ID: 'a', WHATSAPP_SHARDS: shards });
  b.store.config = serviceConfig({ WHATSAPP_SHARD_ID: 'b', WHATSAPP_SHARDS: shards });
  let userId; for (let i = 0; i < 100; i++) if (shardFor({ organizationId: 'org', userId: String(i) }, ['a', 'b']) === 'b') { userId = String(i); break; }
  const headers = { Authorization: `Bearer ${secret}` };
  try {
    const path = `/connection?organizationId=org&userId=${userId}`;
    assert.equal((await fetch(aUrl + path, { method: 'POST', headers })).status, 200);
    assert.equal(a.sockets.length, 0); assert.equal(b.sockets.length, 1);
    assert.equal((await fetch(aUrl + path, { headers: { ...headers, 'x-whatsapp-forwarded': '1' } })).status, 421);
    assert.equal((await fetch(aUrl + path, { headers })).status, 200);
  } finally {
    await a.sessions.stop(); await b.sessions.stop();
    await Promise.all([new Promise(r => aServer.close(r)), new Promise(r => bServer.close(r))]);
  }
});
