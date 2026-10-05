import test from 'node:test';
import assert from 'node:assert/strict';
import { whatsappReplyEvent, replyCursor, parseReplyCursor } from './replies.mjs';
const incoming = (extra = {}) => ({ key: { id: 'id', remoteJid: '61412345678@s.whatsapp.net', fromMe: false }, messageTimestamp: 1700000000, message: { conversation: 'private body' }, ...extra });
test('captures incoming text, voice and media metadata without storing message bodies', async () => {
  const event = await whatsappReplyEvent(incoming());
  assert.equal(event.fromIdentity, '61412345678@s.whatsapp.net');
  assert.equal(event.receivedAt, '2023-11-14T22:13:20.000Z');
  assert.ok(!JSON.stringify(event).includes('private body'));
  assert.ok(await whatsappReplyEvent(incoming({ message: { audioMessage: {} } })));
  assert.ok(await whatsappReplyEvent(incoming({ message: { imageMessage: {} } })));
});
test('ignores sent messages, groups, broadcasts, protocol events and reactions', async () => {
  for (const item of [incoming({ key: { id: 'id', remoteJid: '61412345678@s.whatsapp.net', fromMe: true } }), incoming({ key: { id: 'id', remoteJid: '123@g.us' } }), incoming({ key: { id: 'id', remoteJid: 'status@broadcast' } }), incoming({ message: { protocolMessage: {} } }), incoming({ message: { reactionMessage: {} } })]) assert.equal(await whatsappReplyEvent(item), null);
});
test('uses verified LID mappings, retains unresolved identities and refuses conflicting aliases', async () => {
  const lid = incoming({ key: { id: 'id', remoteJid: '123@lid' } });
  assert.equal((await whatsappReplyEvent(lid, async () => '61412345678@s.whatsapp.net')).fromIdentity, '61412345678@s.whatsapp.net');
  assert.equal((await whatsappReplyEvent(lid)).fromIdentity, null);
  await assert.rejects(whatsappReplyEvent({ ...lid, key: { ...lid.key, remoteJidAlt: '61499999999@s.whatsapp.net' } }, async () => '61412345678@s.whatsapp.net'), /Conflicting/);
});
test('pins cursors to the account and uses bigint safely', () => {
  const encoded = replyCursor('account', '9007199254740993');
  assert.equal(parseReplyCursor(encoded, 'account'), '9007199254740993');
  assert.throws(() => parseReplyCursor(encoded, 'other'), /account changed/);
  assert.throws(() => parseReplyCursor('invalid', 'account'));
});
