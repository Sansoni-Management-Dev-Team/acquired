import test from 'node:test';
import assert from 'node:assert/strict';
import { shardFor, serviceConfig } from './routing.mjs';

test('rendezvous assignment is deterministic, reasonably distributed and adding a shard moves only its accounts', () => {
  const counts = { a: 0, b: 0, c: 0 };
  for (let index = 0; index < 1000; index++) {
    const actor = { organizationId: 'org', userId: `user-${index}` };
    const before = shardFor(actor, ['a', 'b']);
    const after = shardFor(actor, ['a', 'b', 'c']);
    assert.equal(after, shardFor(actor, ['c', 'b', 'a']));
    if (before !== after) assert.equal(after, 'c');
    counts[after]++;
  }
  for (const value of Object.values(counts)) assert.ok(value > 250 && value < 420, JSON.stringify(counts));
});
test('service configuration rejects unsafe origins and capacity values', () => {
  assert.equal(serviceConfig().maxSessions, 32);
  assert.equal(serviceConfig({ WHATSAPP_MAX_SESSIONS: '128' }).maxSessions, 128);
  assert.throws(() => serviceConfig({ WHATSAPP_MAX_SESSIONS: 'Infinity' }));
  assert.throws(() => serviceConfig({ WHATSAPP_SHARDS: '{"other":"http://localhost"}' }));
  assert.throws(() => serviceConfig({ WHATSAPP_SHARDS: '{"primary":"https://user:secret@example.com/"}' }));
  assert.throws(() => serviceConfig({ WHATSAPP_SHARDS: '{"primary":"https://example.com/path"}' }));
});
