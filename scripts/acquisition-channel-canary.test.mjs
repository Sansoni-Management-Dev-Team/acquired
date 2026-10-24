import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAcquisitionChannelCanary } from './acquisition-channel-canary.mjs';
const id = '00000000-0000-4000-8000-000000000001', mandate = '00000000-0000-4000-8000-000000000002', person = '00000000-0000-4000-8000-000000000003', operation = '00000000-0000-4000-8000-000000000004', binding = '00000000-0000-4000-8000-000000000005';
function fixture(channel = 'email', change = () => { }) { const state = { requestId: id, channel, prepared: true, policySaved: true, started: true, selectionApproved: true, keys: { prepare: id, policy: id, start: id } }, calls = []; let approved = false; const recipient = channel === 'email' ? 'email:lead-001@agent-test.leads.acquire.test' : channel === 'whatsapp' ? 'whatsapp:+999123456789012' : 'linkedin:https://www.linkedin.com/in/sim-agent-test-lead-001'; const op = { id: operation, name: channel + '.initial', conversationId: person, state: 'proposed', revision: 1, input_digest: 'a'.repeat(64), input: { recipientKey: recipient, routeId: id, bindingDigest: 'b'.repeat(64), body: 'Synthetic test message' } }; const workflow = { id, mandateId: mandate, organizationId: 'org', ownerUserId: 'owner', preset: 'demo', presentation: 'agent', state: 'outreach' }; const conversation = { id: person, revision: 1, epoch: 1, context_revision: 'c'.repeat(64), history_complete: true, history_coverage_fresh: true, channels: [{ channel, bindingId: binding, id, recipient: recipient.slice(recipient.indexOf(':') + 1), relationship: { status: 'connected', canMessage: true } }] }; const batch = { id, revision: 1, state: 'pending', stale: false, organization_id: 'org', owner_user_id: 'owner', mandate_id: mandate, thread_id: id, operations: [op], manifest: [{ operationId: operation, revision: 1, digest: op.input_digest }] }; const fetcher = async (url, options) => { const path = new URL(url).pathname + new URL(url).search, body = options.body && JSON.parse(options.body); calls.push({ path, body }); let value = path.endsWith('/get-session') ? { user: { id: 'owner' }, session: { activeOrganizationId: 'org' } } : path.startsWith('/api/acquisition-workflows') ? workflow : path.endsWith('/execution') ? { state: { workflowPreset: 'demo', workflowExecutionId: id, executionMode: 'demo', responsibility: { thread_id: id }, conversations: [conversation] } } : path.endsWith('/channel-policy') ? { policy: { revision: 1, channelOrder: [channel], bindings: [{ channel, bindingId: binding }] } } : path.endsWith('/reviews') ? body ? (approved = true, { batch: { id, state: 'approved' } }) : { batches: approved ? [] : [batch] } : path.includes('/operations?') ? { operationId: operation, conversationId: person, name: channel + '.initial', channel, state: 'complete', delivery: { status: 'submitted', providerMessageId: 'receipt', submittedAt: '2026-01-01T00:00:00Z' }, history: { messages: [{ direction: 'inbound', channel, text: 'AI response', at: '2026-01-01T00:00:05Z' }] } } : {}; const response = { status: 200, value, path, body }; change(response); return new Response(JSON.stringify(response.value), { status: response.status }); }; return { state, calls, op, conversation, batch, options: { execute: true, origin: 'https://acquire.example', cookie: '__Secure-better-auth.session_token=SYNTHETIC', requestId: id, channel, expectedOwnerId: 'owner', expectedOrganizationId: 'org', expectedBindingId: binding, simulatorRun: 'agent-test', state, fetcher, saveState: async () => { }, sleep: async () => { }, timeoutMs: 50 } }; }
for (const channel of ['email', 'whatsapp', 'linkedin'])
    test('verifies one separately scoped ' + channel + ' message/reply', async () => { const f = fixture(channel); const result = await runAcquisitionChannelCanary(f.options); assert.equal(result.passed, true); assert.equal(result.channel, channel); assert.equal(f.calls.filter(c => c.body?.decision === 'approved').length, 1); assert.equal(f.state.messageOperationId, operation); });
test('rejects wrong owner, alias and channel journal before approval', async () => { for (const mode of ['owner', 'alias', 'journal']) {
    const f = fixture('email', r => { if (mode === 'owner' && r.path.endsWith('/get-session'))
        r.value.user.id = 'foreign'; });
    if (mode === 'alias')
        f.op.input.recipientKey = 'email:real@example.com';
    if (mode === 'journal')
        f.state.channel = 'whatsapp';
    await assert.rejects(runAcquisitionChannelCanary(f.options));
    assert.equal(f.calls.filter(c => c.body?.decision).length, 0);
} });
test('retains ambiguous mutation and refuses automatic resend', async () => { const f = fixture('email', r => { if (r.body?.decision)
    r.value = {}; }); await assert.rejects(runAcquisitionChannelCanary(f.options), /ambiguous/); assert(f.state.pendingMutation); const count = f.calls.length; await assert.rejects(runAcquisitionChannelCanary(f.options), /unresolved/); assert.equal(f.calls.length, count); });
test('does not count old inbound or approve another message while outcome unknown', async () => { const f = fixture('email', r => { if (r.path.includes('/operations?')) {
    r.value.delivery = { status: 'unknown' };
    r.value.state = 'uncertain';
} }); await assert.rejects(runAcquisitionChannelCanary(f.options), /deadline/); assert.equal(f.calls.filter(c => c.body?.decision).length, 1); });
test('requires original phase keys for an existing started workflow', async () => { const f = fixture(); delete f.state.keys; await assert.rejects(runAcquisitionChannelCanary(f.options), /phase keys/); assert.equal(f.calls.filter(c => c.body).length, 0); });
test('pauses after one invitation for supported external acceptance, never assumes connected', async () => { const f = fixture('linkedin', r => { if (r.path.includes('/operations?')) {
    r.value.name = 'linkedin.invitation';
    r.value.delivery.providerOperationId = 'invitation-provider-id';
} }); f.op.name = 'linkedin.invitation'; f.conversation.channels[0].relationship = { status: 'not_connected', canMessage: false }; const result = await runAcquisitionChannelCanary(f.options); assert.equal(result.status, 'awaiting_provider_invitation_acceptance'); assert.equal(f.state.invitationOperationId, operation); assert.equal(f.state.messageOperationId, undefined); assert.equal(f.calls.filter(c => c.body?.decision).length, 1); });
test('keeps ambiguous invitation acceptance pending without calling it again', async () => { const f = fixture('linkedin', r => { if (r.path.includes('/operations?'))
    r.value.name = 'linkedin.invitation'; }); f.op.name = 'linkedin.invitation'; f.conversation.channels[0].relationship = { status: 'not_connected', canMessage: false }; let accepts = 0; f.options.acceptInvitation = async () => { accepts++; throw Error('Lost acceptance receipt'); }; await assert.rejects(runAcquisitionChannelCanary(f.options)); assert(f.state.pendingAcceptance); await assert.rejects(runAcquisitionChannelCanary(f.options), /unresolved/); assert.equal(accepts, 1); });
test('verifies accepted relationship before independently approving one LinkedIn message', async () => { let f, accepted = false, invitationApproved = false; const messageId = '00000000-0000-4000-8000-000000000006'; f = fixture('linkedin', r => { if (r.path.endsWith('/reviews') && r.body)
    invitationApproved = true; if (r.path.endsWith('/reviews') && !r.body && invitationApproved && accepted) {
    const message = { ...f.op, id: messageId, name: 'linkedin.initial' };
    r.value = { batches: [{ ...f.batch, operations: [message], manifest: [{ ...f.batch.manifest[0], operationId: messageId }] }] };
} if (r.path.includes('/operations?')) {
    const invite = r.path.includes(operation);
    r.value.operationId = invite ? operation : messageId;
    r.value.name = invite ? 'linkedin.invitation' : 'linkedin.initial';
} if (r.path.endsWith('/execution') && r.body)
    r.value = { result: { status: 'accepted' } }; }); f.op.name = 'linkedin.invitation'; f.conversation.channels[0].relationship = { status: 'not_connected', canMessage: false }; f.options.acceptInvitation = async () => { accepted = true; f.conversation.channels[0].relationship = { status: 'connected', canMessage: true }; }; const result = await runAcquisitionChannelCanary(f.options); assert.equal(result.passed, true); assert.equal(f.state.messageOperationId, messageId); assert.equal(f.state.invitationOperationId, operation); assert.equal(f.calls.filter(c => c.body?.decision).length, 2); assert.equal(f.calls.filter(c => c.body?.action === 'reassess_conversation').length, 1); });
test('auth failures, malformed read and old inbound cannot prove a reply', async () => { for (const mode of ['auth', 'malformed', 'old']) {
    const f = fixture('email', r => { if (mode === 'auth')
        r.status = 401; if (mode === 'malformed')
        r.value = null; if (mode === 'old' && r.path.includes('/operations?'))
        r.value.history.messages[0].at = '2025-01-01T00:00:00Z'; });
    await assert.rejects(runAcquisitionChannelCanary(f.options));
    assert(f.calls.filter(c => c.body?.decision).length <= 1);
} });
test('never approves a message before the original target selection is recorded', async () => {
    const f = fixture();
    f.state.selectionApproved = false;
    await assert.rejects(runAcquisitionChannelCanary(f.options), /deadline/);
    assert.equal(f.calls.filter(c => c.body?.decision).length, 0);
});
test('fresh setup persists one set of phase keys and saves a single exact channel policy', async () => {
    let prepared = false, started = false, policySaved = false;
    const f = fixture('whatsapp', r => {
        if (r.path.endsWith('/execution') && !started) r.value.state.responsibility = null;
        if (r.path.endsWith('/demo')) {
            if (r.body.action === 'start') { started = true; r.value = { result: { status: 'accepted' } }; }
            else { prepared = true; r.value = { prepared: true }; }
        }
        if (r.path.endsWith('/channel-policy')) {
            if (r.body) { policySaved = true; r.value = { result: { status: 'accepted' } }; }
            else if (!policySaved) r.value = { accounts: [{ channel: 'whatsapp', bindingId: binding, eligibleForNewWork: true }], policy: null };
        }
    });
    for (const key of ['prepared', 'started', 'policySaved', 'keys']) delete f.state[key];
    const result = await runAcquisitionChannelCanary(f.options);
    assert(result.passed && prepared && started);
    const policy = f.calls.find(c => c.path.endsWith('/channel-policy') && c.body).body;
    assert.deepEqual(policy.channelOrder, ['whatsapp']);
    assert.deepEqual(policy.bindings, [{ channel: 'whatsapp', bindingId: binding }]);
    assert.equal(policy.acceleratedSimulation, false);
    assert.equal(f.calls.find(c => c.body?.action === 'start').body.requestKey, f.state.keys.start);
});
test('explicit buyer guidance uses normal feedback and decision without changing company facts', async () => {
    const f = fixture('email', r => {
        if (r.path.endsWith('/guidance')) r.value = { guidance: { id, revision: 1, state: r.body.action === 'decide' ? 'approved' : 'proposed' } };
    });
    f.state.selectionOperation = { id, revision: 1 };
    f.options.buyerGuidance = 'This is a fictional simulated buyer. Do not claim funding or reveal private financial limits.';
    assert.equal((await runAcquisitionChannelCanary(f.options)).passed, true);
    const calls = f.calls.filter(c => c.path.endsWith('/guidance'));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].body.input.preference, f.options.buyerGuidance);
    assert.equal(calls[0].body.input.category, 'buyer_context');
    assert.deepEqual(calls[0].body.input.source, { kind: 'operation', id, revision: 1 });
    assert.equal(calls[1].body.confirmed, true);
});
for (const channel of ['email','whatsapp','linkedin']) test('accepts exact hosted demo run with reserved '+channel+' alias',async()=>{const f=fixture(channel),run='hosted-demo-production-20261021';f.options.simulatorRun=run;f.op.input.recipientKey=f.op.input.recipientKey.replaceAll('agent-test',run);f.conversation.channels[0].recipient=f.conversation.channels[0].recipient.replaceAll('agent-test',run);assert.equal((await runAcquisitionChannelCanary(f.options)).passed,true);});
test('rejects malformed hosted run before any route request',async()=>{for(const run of ['hosted-demo-','hosted-demo-prod.example','hosted-demo-'+ 'x'.repeat(37)]){const f=fixture();f.options.simulatorRun=run;await assert.rejects(runAcquisitionChannelCanary(f.options));assert.equal(f.calls.length,0);}});
