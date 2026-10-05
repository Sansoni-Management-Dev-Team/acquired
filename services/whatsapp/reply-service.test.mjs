import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Sessions } from './sessions.mjs';
import { serviceConfig } from './routing.mjs';

const actor = { organizationId: 'org', userId: 'owner' };
function fixture() {
  const journal = []; const sockets = []; let nextId = 1;
  const store = {
    replyMonitoringEnabled: true,
    authorize: async input => { if (input.userId !== actor.userId) throw new Error('Membership required'); },
    status: async () => ({ status: 'connected' }),
    open: async () => ({ connectionId: 'connection', state: { creds: { me: { id: '61400000000@s.whatsapp.net' } } }, onLeaseLost() {}, saveCreds: async () => {}, update: async () => {}, close: async () => {},
      saveReplyEvents: async (account, events) => { for (const event of events) if (!journal.some(row => row.provider_event_id === event.id)) journal.push({ id: String(nextId++), provider_event_id: event.id, remote_identity: event.remoteIdentity, from_identity: event.fromIdentity, received_at: event.receivedAt, account }); },
      readReplyEvents: async (account, after) => journal.filter(row => row.account === account && BigInt(row.id) > BigInt(after)).slice(0,501),
    }),
  };
  const factory = () => { const socket = { ev: new EventEmitter(), end() {}, signalRepository: { lidMapping: { getPNForLID: async () => null } } }; sockets.push(socket); return socket; };
  const create = () => new Sessions(store,factory,serviceConfig({ WHATSAPP_CONNECT_SPACING_MS: '0' }));
  return { journal, sockets, create, store };
}
const message = (id = 'id', remoteJid = '61412345678@s.whatsapp.net') => ({ key: { id,remoteJid,fromMe:false }, messageTimestamp: 1700000000, message: { audioMessage: {} } });
async function connect(f) {
  const sessions = f.create(); await sessions.connect(actor);
  const socket = f.sockets.at(-1); socket.ev.emit('connection.update',{ connection:'open',receivedPendingNotifications:true });
  await sessions.sessions.get(sessions.key(actor)).events;
  return { sessions,socket };
}
test('persists live and history replies before reads, deduplicates replay, and survives service restarts', async () => {
  const f = fixture(); const first = await connect(f);
  first.socket.ev.emit('messages.upsert',{messages:[message()]});
  first.socket.ev.emit('messaging-history.set',{messages:[message()],contacts:[]});
  const page = await first.sessions.readReplies(actor,null);
  assert.equal(page.events.length,1); assert.equal(page.complete,true); assert.equal(f.journal.length,1);
  await first.sessions.stop();
  const second = await connect(f);
  assert.equal((await second.sessions.readReplies(actor,null)).events.length,1);
  assert.equal((await second.sessions.readReplies(actor,page.nextCursor)).events.length,0);
  await second.sessions.stop();
});
test('cannot certify an unsynchronized or unresolved inbox, or read another account', async () => {
  const f = fixture(); const { sessions,socket } = await connect(f);
  const session = sessions.sessions.get(sessions.key(actor));
  session.replyReady = false;
  await assert.rejects(sessions.readReplies(actor,null), /synchronized/);
  session.replyReady = true;
  socket.ev.emit('messages.upsert',{messages:[message('lid','123@lid')]});
  await assert.rejects(sessions.readReplies(actor,null), /identity requires review/);
  await assert.rejects(sessions.readReplies({ ...actor,userId:'other' },null), /Membership/);
  await sessions.stop();
});
test('returns bounded pages and advances only through persisted events', async () => {
  const f = fixture(); const { sessions,socket } = await connect(f);
  socket.ev.emit('messages.upsert',{messages:Array.from({length:501},(_,index) => message(String(index)))});
  const first = await sessions.readReplies(actor,null);
  assert.equal(first.events.length,500); assert.equal(first.complete,false);
  const second = await sessions.readReplies(actor,first.nextCursor);
  assert.equal(second.events.length,1); assert.equal(second.complete,true);
  await sessions.stop();
});
