import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

// Synthetic native HTTP proof. No environment credentials, real DSN, database, or provider writes.
const [dist, source, expectedSourceHash, expectedModuleHash] = process.argv.slice(2);
assert.ok(dist && source && /^[a-f0-9]{64}$/.test(expectedSourceHash) && /^[a-f0-9]{64}$/.test(expectedModuleHash));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const modulePath = resolve(dist, 'packages/adapter-unipile/src/v1-email.js');
assert.equal(sha(source), expectedSourceHash);
assert.equal(sha(modulePath), expectedModuleHash);
const require = createRequire(import.meta.url);
const { createUnipileV1EmailAdapter } = require(modulePath);
const { UnipileV1Transport } = require(resolve(dist, 'packages/adapter-unipile/src/v1-http.js'));
const { messageDigest } = require(resolve(dist, 'packages/core/src/message-digest.js'));
let posts = 0;
const cases = [];
for (const platform of ['gmail', 'outlook', 'imap']) {
  const binding = { applicationId: 'synthetic-app', tenantId: 'synthetic-tenant', ownerId: 'synthetic-owner', connectionId: `connection-${platform}`, accountId: `account-${platform}`, generation: 1, channel: 'email', platform, backend: 'unipile' };
  const ref = id => ({ binding: { ...binding }, id });
  const recipient = { kind: 'email', value: 'target@example.com' };
  const account = { object: 'Account', id: `provider-${platform}`, type: { gmail: 'GOOGLE_OAUTH', outlook: 'OUTLOOK', imap: 'MAIL' }[platform], connection_params: { mail: {} }, sources: [{ id: 'source', status: 'OK' }] };
  const mail = { object: 'Email', kind: '2_full', id: 'original/email', provider_id: 'original/provider', account_id: account.id, type: account.type, role: 'sent', date: '2026-10-14T01:00:00.000Z', message_id: '<original@example.com>', thread_id: 'original/thread', subject: 'Original subject', from_attendee: { identifier: 'owner@example.com' }, to_attendees: [{ identifier: recipient.value }], headers: [{ name: 'Message-ID', value: '<original@example.com>' }], read_date: '2026-10-14T02:00:00.000Z' };
  let drop = false;
  const requests = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, url: req.url });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      posts++;
      assert.equal(req.url, '/api/v1/emails');
      assert.equal(req.headers['idempotency-key'], drop ? 'lost-operation' : 'original-operation');
      assert.ok(body.includes(`name="account_id"\r\n\r\n${account.id}`));
      assert.ok(body.includes('text/plain; charset=utf-8'));
      assert.ok(body.includes('name="reply_to"\r\n\r\noriginal/email'));
      if (drop) { res.destroy(); return; }
      res.statusCode = 201;
      res.end(JSON.stringify({ object: 'EmailSent', tracking_id: 'action/tracking', provider_id: null, provider_immutable_id: null }));
    } else {
      if (req.url.startsWith('/api/v1/emails/')) assert.equal(req.url, `/api/v1/emails/original%2Femail?account_id=${account.id}&include_headers=true`);
      else assert.equal(req.url, `/api/v1/accounts/${account.id}`);
      res.end(JSON.stringify(req.url.startsWith('/api/v1/accounts/') ? account : mail));
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const transport = new UnipileV1Transport({ apiVersion: 'v1', baseUrl: `http://127.0.0.1:${port}/api/v1`, apiKey: 'synthetic-only-key', allowLoopbackHttp: true, timeoutMs: 500 });
    const options = { connection: { binding, status: 'connected', providerAccountId: account.id, capabilities: { messaging: { send: true, durableIdempotency: false, receiptLookup: true }, events: { read: false, history: false, realtime: false } } }, providerAccountId: account.id, sourceId: 'source', ownerAddresses: ['owner@example.com'], transport, verifyOwner: async () => true, verifyOriginal: async () => ({ providerAccountId: account.id, recipient, message: ref(mail.id), rfcMessageId: mail.message_id, conversation: ref(mail.thread_id) }) };
    const adapter = createUnipileV1EmailAdapter(options);
    const message = { recipient, text: '<plain> & content', subject: 'Re: Original subject', conversation: ref(mail.thread_id) };
    const snapshot = { binding, key: 'original-operation', operation: 'message', payloadDigest: messageDigest('message', message) };
    assert.deepEqual(await adapter.submitAcknowledged({ snapshot, message }), { status: 'acknowledged', receipt: { operation: ref('action/tracking'), recipient } });
    const receipt = await adapter.lookup({ snapshot, message: ref(mail.id), expectedRecipient: recipient, rfcMessageId: mail.message_id });
    assert.equal(receipt.status, 'submitted'); assert.equal(receipt.receipt.message.id, mail.id); assert.equal(receipt.receipt.submittedAt, mail.date); assert.equal(receipt.receipt.readAt, undefined);
    adapter.submitAcknowledged = async () => ({ status: 'rejected', code: 'mutated-public-method' });
    drop = true;
    assert.deepEqual(await adapter.submit({ snapshot: { ...snapshot, key: 'lost-operation' }, message }), { status: 'unknown' });
    assert.equal(requests.filter(r => r.method === 'POST').length, 2);
    cases.push(`${platform}: action acknowledgement, exact original read, one dropped-response POST`);
    // Native monotonic/promise characterization: synchronous verifier overrun returning an
    // already-rejected promise must neither send nor crash strict Node with unhandled rejection.
    const bounded = createUnipileV1EmailAdapter({ ...options, timeoutMs: 5, transport: { ...transport, getAccount: async () => ({ kind: 'success', status: 200, data: account }), getEmail: transport.getEmail.bind(transport), sendEmail: async () => { throw Error('must not send'); } }, verifyOwner: () => { const until = performance.now() + 15; while (performance.now() < until) { /* synthetic synchronous overrun */ } return Promise.reject(Error('synthetic rejected verifier')); } });
    assert.deepEqual(await bounded.submit({ snapshot, message }), { status: 'waiting', code: 'unavailable' });
    await new Promise(r => setImmediate(r));
    cases.push(`${platform}: monotonic verifier deadline and observed rejection`);
    if (platform === 'gmail') {
      // A forgotten await at a synchronous configuration boundary must reject safely without
      // creating an unrelated process-level rejection. These are deliberately invalid ports.
      for (const field of ['getAccount', 'verifyOwner']) {
        const rejected = Promise.reject(Error('synthetic invalid configuration promise'));
        const invalid = field === 'verifyOwner' ? { ...options, verifyOwner: rejected } : { ...options, transport: { getAccount: rejected, getEmail: transport.getEmail.bind(transport), sendEmail: transport.sendEmail.bind(transport) } };
        assert.throws(() => createUnipileV1EmailAdapter(invalid), error => error.code === 'invalid_binding');
      }
      await new Promise(r => setImmediate(r));
      cases.push('configuration rejected promises are observed without provider access');
      let ownerCalls = 0, bindCalls = 0;
      const originalOwner = async () => { ownerCalls++; return false; };
      originalOwner.bind = () => { bindCalls++; return async () => true; };
      const protectedOwner = createUnipileV1EmailAdapter({ ...options, verifyOwner: originalOwner });
      assert.deepEqual(await protectedOwner.submit({ snapshot, message }), { status: 'review', code: 'account_changed' });
      assert.equal(ownerCalls, 1); assert.equal(bindCalls, 0);
      cases.push('intrinsic binding preserves the configured ownership callback identity');
    }
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
}
assert.equal(posts, 6);
console.log(JSON.stringify({ scope: 'Native synthetic HTTP against compiled email modules; trusted fixture ownership/original correlation', sourceSha256: expectedSourceHash, moduleSha256: expectedModuleHash, cases, syntheticPosts: posts, providerWrites: 0, migrationsApplied: 0, durableAdmissionProof: false, liveAccountProof: false, sentWebhookCorrelationProof: false }));
