// Invoked inside the owned OrbStack fixture with compiled modules only. Synthetic data only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
const fixtureRequire = createRequire('/fixture/src/index.js');
const { UnipileV1Transport, createUnipileV1MessagingAdapter, normalizeV1MessageLookup, verifyUnipileV1Webhook, } = fixtureRequire('/fixture/packages/adapter-unipile/src/index.js');
const { createCommunicationsServer } = fixtureRequire('/fixture/services/api/src/server.js');
const { CommunicationsClient } = fixtureRequire('/fixture/packages/sdk/src/index.js');
const { assertOperationMatches } = fixtureRequire('/fixture/packages/contracts/src/index.js');
const { messageDigest } = fixtureRequire('/fixture/packages/core/src/message-digest.js');
const { createDispatchCoordinator } = fixtureRequire('/fixture/packages/core/src/dispatch.js');
const { JournalCodec } = fixtureRequire('/fixture/packages/core/src/journal-codec.js');
const key = 'synthetic-v1-fixture-key';
const scope = { applicationId: 'v1-fixture-app', tenantId: 'v1-fixture-tenant', ownerId: 'v1-fixture-owner' };
const writes = { whatsapp: 0, linkedin: 0, invitation: 0, email: 0, draft: 0 };
const stored = new Map();
const requests = [];
const bindings = Object.fromEntries(['whatsapp', 'linkedin', 'email'].map(channel => [channel, {
        ...scope, connectionId: `v1-${channel}`, accountId: `service-${channel}`, generation: 1,
        channel, platform: channel === 'email' ? 'gmail' : channel, backend: 'unipile',
    }]));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
async function form(request) {
    const parts = [];
    for await (const chunk of request)
        parts.push(Buffer.from(chunk));
    const bytes = Buffer.concat(parts);
    if (String(request.headers['content-type']).startsWith('multipart/form-data')) {
        return Object.fromEntries(await new Response(bytes, { headers: { 'content-type': request.headers['content-type'] } }).formData());
    }
    return JSON.parse(bytes.toString());
}
(async () => {
    const provider = createServer((request, response) => {
        void (async () => {
            assert.equal(request.headers['x-api-key'], key);
            const url = new URL(request.url, 'http://synthetic.local');
            requests.push({ method: request.method, path: url.pathname });
            const json = (status, data) => response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
            if (request.method === 'GET') {
                assert.equal(request.headers['cache-control'], 'no-store');
                if (url.pathname === '/api/v1/accounts')
                    return json(200, { object: 'AccountList', items: [], cursor: null });
                if (url.pathname.startsWith('/api/v1/accounts/')) {
                    const channel = url.pathname.split('/').at(-1).replace('provider-', '');
                    return json(200, { object: 'Account', id: `provider-${channel}`, type: channel === 'email' ? 'GOOGLE_OAUTH' : channel.toUpperCase(),
                        sources: [{ id: 'explicit-fixture-source', status: 'OK' }], connection_params: { [channel === 'email' ? 'mail' : 'im']: { synthetic: true } } });
                }
                if (url.pathname.startsWith('/api/v1/chats/')) {
                    const channel = url.pathname.split('/').at(-1).replace('chat-', '');
                    assert.equal(url.searchParams.get('account_id'), `provider-${channel}`);
                    return json(200, { object: 'Chat', id: `chat-${channel}`, account_id: `provider-${channel}`, type: 0, read_only: 0 });
                }
                if (url.pathname.startsWith('/api/v1/messages/')) {
                    const found = stored.get(url.pathname.split('/').at(-1));
                    return json(found ? 200 : 404, found || { type: 'errors/resource_not_found' });
                }
                throw new Error('Unexpected fixture read');
            }
            const body = await form(request);
            if (url.pathname.endsWith('/messages')) {
                const channel = url.pathname.split('/')[4].replace('chat-', '');
                assert.equal(body.account_id, `provider-${channel}`);
                assert.equal(request.headers['idempotency-key'], undefined);
                assert.equal(typeof body.text, 'string');
                writes[channel]++;
                const id = `message-${channel}-${writes[channel]}`;
                stored.set(id, { object: 'Message', id, account_id: body.account_id, chat_id: `chat-${channel}`, is_sender: 1, is_event: 0, deleted: 0, hidden: 0, timestamp: '2026-10-12T00:00:00.000Z' });
                if (body.text === 'lost-response')
                    return request.socket.destroy();
                if (body.text === 'ambiguous-error')
                    return json(422, { type: 'errors/provider_unreachable', title: 'synthetic private detail' });
                return json(201, { object: 'MessageSent', message_id: body.text === 'null-id' ? null : id });
            }
            if (url.pathname === '/api/v1/users/invite') {
                assert.equal(body.account_id, 'provider-linkedin');
                assert.equal(body.provider_id, 'ACo_fixture');
                writes.invitation++;
                return json(200, { object: 'UserInvitationSent', invitation_id: 'invitation-fixture' });
            }
            if (['/api/v1/emails', '/api/v1/drafts'].includes(url.pathname)) {
                assert.equal(body.account_id, 'provider-email');
                assert.deepEqual(JSON.parse(body.to), [{ identifier: 'recipient@example.test' }]);
                assert.deepEqual(JSON.parse(body.custom_headers), [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }]);
                assert.equal(body.reply_to, undefined);
                if (url.pathname === '/api/v1/emails') {
                    writes.email++;
                    assert.equal(request.headers['idempotency-key'], 'original-email-key');
                    return json(201, { object: 'EmailSent', tracking_id: 'tracking-is-not-message', provider_id: null, provider_immutable_id: null });
                }
                writes.draft++;
                assert.equal(request.headers['idempotency-key'], undefined);
                return json(200, { object: 'DraftCreated', draft_id: 'draft-fixture' });
            }
            throw new Error('Unexpected fixture write');
        })().catch(() => { response.writeHead(500).end(); });
    });
    await listen(provider);
    const transport = new UnipileV1Transport({ apiVersion: 'v1', baseUrl: `http://127.0.0.1:${provider.address().port}/api/v1`, apiKey: key, allowLoopbackHttp: true, timeoutMs: 2000 });
    // Synthetic storage port only; this map is not a database/journal durability implementation.
    const journal = new Map();
    let dispatchAdmissions = 0;
    const journalPort = {
        claim: async ({snapshot, recipient, conversation, rfcMessageId}) => {
            const previous = journal.get(snapshot.key);
            if (previous) {
                assertOperationMatches(previous.record.snapshot, snapshot);
                assert.deepEqual(previous.record.recipient, recipient);
                return {kind: 'existing', record: structuredClone(previous.record)};
            }
            const token = `fixture-claim-${journal.size + 1}`;
            const record = {snapshot: structuredClone(snapshot), recipient: structuredClone(recipient), state: 'claimed',
                ...(conversation ? {conversation:structuredClone(conversation)} : {}), ...(rfcMessageId ? {rfcMessageId} : {})};
            journal.set(snapshot.key, {token, record});
            return {kind:'claimed', token, record: structuredClone(record)};
        },
        beginDispatch: async ({token, record}) => {
            const previous = journal.get(record.snapshot.key);
            assert.equal(previous.token, token);
            assert.deepEqual(previous.record, record);
            assert.equal(record.state, 'claimed');
            previous.record = {...structuredClone(record), state:'dispatching'};
            dispatchAdmissions++;
            return {kind:'admitted', record: structuredClone(previous.record)};
        },
        complete: async ({token, record, outcome}) => {
            const previous = journal.get(record.snapshot.key);
            assert.equal(previous.token, token);
            assert.deepEqual(previous.record, record);
            previous.record = {...structuredClone(record), state: outcome.status === 'unknown'?'unknown':'completed', outcome: structuredClone(outcome),
              ...(outcome.status==='submitted' && 'message' in outcome.receipt ? {message:structuredClone(outcome.receipt.message)} : {})};
            return structuredClone(previous.record);
        },
        get: async snapshot => {
            const previous = journal.get(snapshot.key);
            if(!previous) return null;
            assertOperationMatches(previous.record.snapshot, snapshot);
            return structuredClone(previous.record);
        },
        reconcile: async ({record, outcome}) => {
            const previous = journal.get(record.snapshot.key);
            assert.deepEqual(previous.record, record);
            previous.record = {...structuredClone(record), state:'completed', outcome:structuredClone(outcome)};
            return structuredClone(previous.record);
        },
    };
    const service = createCommunicationsServer({
        authorize: async (request) => request.headers.authorization === 'Bearer synthetic-service-token' ? scope : null,
        connections: { get: async (_scope, id, generation) => {
                const binding = Object.values(bindings).find(value => value.connectionId === id && value.generation === generation);
                return binding ? { binding, providerAccountId: `provider-${binding.channel}`, status: 'connected', capabilities: { messaging: { send: true, durableIdempotency: false, receiptLookup: binding.channel !== 'email' }, events: { read: false, history: false, realtime: false }, ...(binding.channel === 'linkedin' ? { linkedin: { resolveProfile: false, relationships: false, invitations: true } } : {}) } } : null;
            } },
        resolveAdapter: async connection => {
            const adapter = createUnipileV1MessagingAdapter({
                connection, providerAccountId:connection.providerAccountId, sourceId:'explicit-fixture-source', transport,
                verifyChatRecipient:async input => {
                    const channel=connection.binding.channel;
                    const recipient={kind:channel==='whatsapp'?'phone':'linkedin_profile',value:channel==='whatsapp'?'+61400000002':'https://www.linkedin.com/in/fixture/'};
                    assert.deepEqual(input.recipient,recipient);
                    const conversation={binding:connection.binding,id:`chat-${channel}`};
                    if(input.conversation) assert.deepEqual(input.conversation,conversation);
                    if(input.message) {
                        const known=journal.get(input.snapshot.key)?.record;
                        assert.equal(known?.message?.id,input.message.id);
                    }
                    return {providerAccountId:connection.providerAccountId, conversation, recipient};
                },
                ...(connection.binding.channel==='linkedin'?{verifyInvitationRecipient:async input=>{
                    assert.deepEqual(input.recipient,{kind:'linkedin_profile',value:'https://www.linkedin.com/in/fixture/'});
                    return {providerAccountId:connection.providerAccountId,providerId:'ACo_fixture',recipient:input.recipient};
                }}:{}),
            });
            return createDispatchCoordinator(connection.binding, adapter, journalPort);
        },
    });
    await listen(service);
    try {
        assert.equal((await transport.listAccounts()).kind, 'success');
        const client = new CommunicationsClient({ baseUrl: `http://127.0.0.1:${service.address().port}`, apiKey: 'synthetic-service-token', contractVersion: '1', allowLoopbackHttp: true, timeoutMs: 4000 });
        const submissions = {};
        for (const channel of ['whatsapp', 'linkedin']) {
            const binding = bindings[channel];
            const recipient = { kind: channel === 'whatsapp' ? 'phone' : 'linkedin_profile', value: channel === 'whatsapp' ? '+61400000002' : 'https://www.linkedin.com/in/fixture/' };
            const message = { recipient, text: `fixture ${channel}`, conversation: { binding, id: `chat-${channel}` } };
            const input = { snapshot: { binding, key: `original-${channel}-key`, operation: 'message', payloadDigest: messageDigest('message', message) }, message };
            submissions[channel] = input;
            assert.equal((await client.ready(binding)).status, 'ready');
            const [sent, replayed] = await Promise.all([client.submit(input), client.submit(input)]);
            assert.equal(sent.status, 'submitted');
            assert.ok(['unknown','submitted'].includes(replayed.status));
            if(replayed.status==='submitted') assert.deepEqual(replayed,sent);
            assert.equal(writes[channel], 1);
            assert.deepEqual(await client.lookup({ snapshot: input.snapshot, expectedRecipient: recipient }), sent);
            const found = await transport.getMessage(sent.receipt.message.id);
            const expectation = { lookup: { snapshot: input.snapshot, message: sent.receipt.message, expectedRecipient: recipient }, providerAccountId: `provider-${channel}`, conversation: message.conversation, recipient };
            assert.equal(normalizeV1MessageLookup(found.data, expectation).status, 'submitted');
            assert.equal(normalizeV1MessageLookup({ ...found.data, account_id: 'other-account' }, expectation).status, 'unknown');
            await assert.rejects(client.ready({ ...binding, ownerId: 'other-owner' }));
            await assert.rejects(client.ready({ ...binding, generation: 2 }));
            const changed = { ...message, text: 'changed under key' };
            const changedInput = { ...input, message: changed, snapshot: { ...input.snapshot, payloadDigest: messageDigest('message', changed) } };
            assert.equal((await client.submit(changedInput)).status, 'unknown');
            assert.equal(writes[channel], 1);
        }
        const invitationMessage = { recipient: submissions.linkedin.message.recipient, text: 'synthetic invitation' };
        const invitation = { snapshot: { binding: bindings.linkedin, key: 'invitation-key', operation: 'invitation', payloadDigest: messageDigest('invitation', invitationMessage) }, message: invitationMessage };
        const invited = await client.submit(invitation);
        assert.equal(invited.status, 'submitted');
        assert.equal(invited.receipt.operation.id, 'invitation-fixture');
        assert.equal('message' in invited.receipt, false);
        assert.equal(writes.invitation, 1);
        for (const text of ['lost-response', 'ambiguous-error', 'null-id']) {
            const original = submissions.whatsapp;
            const message = { ...original.message, text };
            const input = { ...original, message, snapshot: { ...original.snapshot, key: `unknown-${text}`, payloadDigest: messageDigest('message', message) } };
            const before = writes.whatsapp;
            assert.equal((await client.submit(input)).status, 'unknown');
            assert.equal((await client.submit(input)).status, 'unknown');
            assert.equal(writes.whatsapp, before + 1);
        }
        const codec=new JournalCodec({activeVersion:'fixture-v1',keys:[{version:'fixture-v1',encryptionKey:new Uint8Array(32).fill(7),digestKey:new Uint8Array(32).fill(9)}]});
        const original=submissions.whatsapp;
        const context={recipient:original.message.recipient,conversation:original.message.conversation};
        const encrypted=codec.encode(original.snapshot,'context',context);
        assert.deepEqual(codec.decode(original.snapshot,'context',encrypted),context);
        assert.notEqual(encrypted.nonce,codec.encode(original.snapshot,'context',context).nonce);
        assert.equal(JSON.stringify(encrypted).includes(original.message.recipient.value),false);
        assert.throws(()=>codec.decode({...original.snapshot,binding:{...original.snapshot.binding,ownerId:'other-owner'}},'context',encrypted));
        assert.throws(()=>codec.decode(original.snapshot,'receipt',encrypted));
        assert.equal(codec.digest(original.snapshot,'context',context).length,64);
        const email = { to: [{ identifier: 'recipient@example.test' }], body: 'Synthetic plain text', custom_headers: [{ name: 'Content-Type', value: 'text/plain; charset=utf-8' }] };
        const emailed = await transport.sendEmail('provider-email', email, 'original-email-key');
        assert.equal(emailed.kind, 'success');
        assert.equal(emailed.data.provider_id, null);
        assert.equal(writes.email, 1);
        assert.equal((await transport.createDraft('provider-email', email)).data.draft_id, 'draft-fixture');
        assert.equal(writes.draft, 1);
        const hook = { rawHeaders: ['Unipile-Auth', 'synthetic-separate-webhook-secret'], headerName: 'Unipile-Auth', secret: 'synthetic-separate-webhook-secret' };
        assert.equal(verifyUnipileV1Webhook(hook).verified, true);
        assert.equal(verifyUnipileV1Webhook({ ...hook, rawHeaders: [...hook.rawHeaders, ...hook.rawHeaders] }).verified, false);
        process.stdout.write(JSON.stringify({ apiVersion: 'v1', nativeMultipart: true, serviceSdkChannels: ['whatsapp', 'linkedin'], concurrentFixtureReplay: true, unknownWritesNoRetry: true, emailAndDraftTransport: true, staticWebhookAuthentication: true, dispatchCoordinator:true, journalCodec:true, dispatchAdmissions, syntheticWrites: writes, providerWrites: 0, persistentJournalVerified: false }));
    }
    finally {
        await close(service);
        await close(provider);
    }
})().catch(() => { process.stderr.write('V1 container fixture verification failed\n'); process.exitCode = 1; });
