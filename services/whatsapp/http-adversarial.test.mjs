import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceServer } from './http.mjs';
const secret = 'fixture-secret-at-least-32-characters';
async function fixture(fn) {
  let sends = 0; const sessions = { sendText: async (actor, recipient) => { sends++; return { id: 'fixture', recipient, status: 'submitted' }; } };
  const server = serviceServer({}, sessions, secret); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(`http://127.0.0.1:${server.address().port}/message?organizationId=org&userId=owner`, () => sends); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
for (const [label, body] of [
  ['null', null], ['array', []], ['missing fields', {}], ['number recipient', { recipient: 123, text: 'Hi' }],
  ['group', { recipient: '123@g.us', text: 'Hi' }], ['broadcast', { recipient: 'status@broadcast', text: 'Hi' }],
  ['recipient with newline', { recipient: '123@s.whatsapp.net\n', text: 'Hi' }], ['empty', { recipient: '123@s.whatsapp.net', text: '   ' }],
  ['object text', { recipient: '123@s.whatsapp.net', text: {} }], ['over limit', { recipient: '123@s.whatsapp.net', text: 'x'.repeat(4001) }],
]) test(`HTTP rejects ${label} without touching the provider`, async () => fixture(async (url, sends) => {
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify(body) }); assert.equal(response.status, 400); assert.equal(sends(), 0);
}));
test('HTTP rejects malformed and oversized JSON before submission', async () => fixture(async (url, sends) => {
  for (const [body, status] of [['{', 400], ['x'.repeat(16385), 413]]) {
    assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body })).status, status);
  }
  assert.equal(sends(), 0);
}));
test('HTTP rejects every unauthenticated mutation and unsupported method', async () => fixture(async (url, sends) => {
  for (const authorization of ['', 'Bearer wrong', `Basic ${secret}`, `Bearer ${secret}extra`]) assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: authorization }, body: '{}' })).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${secret}` } })).status, 405); assert.equal(sends(), 0);
}));
test('HTTP accepts the exact text limit once without rewriting its contents', async () => fixture(async (url, sends) => {
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, body: JSON.stringify({ recipient: '123@s.whatsapp.net', text: 'x'.repeat(4000) }) })).status, 200); assert.equal(sends(), 1);
}));
