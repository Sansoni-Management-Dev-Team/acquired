import test from 'node:test';
import assert from 'node:assert/strict';
import { RecentHistory } from './history.mjs';
test('history deduplicates and bounds messages, excludes protocol messages and preserves sender direction', () => {
  const history = new RecentHistory(2);
  const message = (id, timestamp, fromMe = false) => ({ key: { id, remoteJid: 'jody@s.whatsapp.net', fromMe }, messageTimestamp: timestamp, message: { conversation: id } });
  history.addMessages([message('first', 1), message('second', 2), message('second', 2), message('third', 3, true), { ...message('protocol', 4), message: { protocolMessage: {} } }]);
  assert.equal(history.messages.size, 2); assert.equal(history.recent()[0].fromMe, true);
  assert.equal(history.recent()[1].text, 'second'); assert.deepEqual(history.recent(20, ['other@s.whatsapp.net']), []);
});
test('contacts match saved names and push names; partial updates preserve names', () => {
  const history = new RecentHistory();
  history.addContacts([{ id: '1@lid', name: 'Jody Wang', phoneNumber: '1@s.whatsapp.net' }, { id: '2@lid', notify: 'Another' }]);
  history.addContacts([{ id: '1@lid', name: undefined, notify: 'Jody' }]);
  assert.equal(history.searchContacts('jody wang').length, 1); assert.equal(history.searchContacts('JODY   WANG')[0].name, 'Jody Wang');
});

test('history budgets bound contacts and message bytes and skip oversized content', () => {
  const history = new RecentHistory(100, { maxContacts: 2, maxBytes: 1024 });
  history.addContacts([{ id: '1', name: 'First' }, { id: '2', name: 'Second' }, { id: '3', name: 'Third' }]);
  assert.equal(history.contacts.size, 2); assert.equal(history.contacts.has('1'), false);
  for (let i = 0; i < 20; i++) history.addMessages([{ key: { id: String(i), remoteJid: 'chat@lid' }, messageTimestamp: i, message: { conversation: 'x'.repeat(120) } }]);
  assert.ok(history.messageBytes <= 512); assert.equal(history.recent()[0].timestampSeconds, 19);
  history.addMessages([{ key: { id: 'huge', remoteJid: 'chat@lid' }, messageTimestamp: 21, message: { conversation: 'x'.repeat(2000) } }]);
  assert.ok(!history.recent().some(m => m.id === 'huge'));
  assert.ok(history.messageBytes + history.contactBytes <= 1024);
});
