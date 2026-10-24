/**
 * Opt-in normal-Acquire per-channel acceptance runner. No direct provider sends.
 * Example (all identities must come from the intended owned test workspace):
 * node --use-system-ca scripts/acquisition-channel-canary.mjs --execute \
 *   --origin https://acquire.example --channel email --request-id <uuid> \
 *   --owner-id <owner> --organization-id <org> --binding-id <uuid> \
 *   --simulator-run agent-example --cookie-file .local-data/auth/session-cookie.txt \
 *   --evidence-dir .local-data/channel-acceptance
 *
 * Use a distinct request UUID and channel journal for every channel. Resume with
 * identical arguments. An ambiguous mutation stops; inspect its saved receipt
 * before any journal recovery. Never delete a pending marker merely to retry.
 * LinkedIn returns awaiting_provider_invitation_acceptance: accept that exact
 * invitation through the simulator's supported interface, then resume this same
 * journal. The runner verifies the relationship through Acquire before approval.
 * Optional --buyer-guidance-file supplies explicitly reviewed simulated wording;
 * --accelerated-simulation requests the normal scoped five-second policy guard.
 * A pass proves a canonical initial receipt and a subsequent saved inbound in
 * that conversation. AI provenance must also be checked in simulator evidence.
 * Each channel is independent; no claim of all-three success is inferred.
 */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, open, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
const channels = ['email', 'whatsapp', 'linkedin'], uuid = x => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
export function channelCanaryCreationScope(o){return{kind:o.legacySource?'legacy_cached_demo':'workflow_v2',...(o.legacySource?{sourceMandateId:o.legacySource.mandateId,briefDigest:createHash('sha256').update(JSON.stringify(o.legacySource.brief)).digest('hex')}:{})};}
export function channelCanaryRequestTimeoutMs(path, body, remainingMs) { return Math.max(1, Math.min(path.endsWith('/agent/demo') && body?.action === 'start' ? 150000 : 45000, remainingMs)); }
/** One channel, one saved workflow and at most one initial message. No provider send endpoint. */
export async function runAcquisitionChannelCanary(o) {
    assert(o.execute === true && uuid(o.requestId) && channels.includes(o.channel), 'Explicit execute, channel and request UUID required');
    const origin = new URL(o.origin);
    assert(origin.origin === o.origin && origin.protocol === 'https:', 'Exact HTTPS origin required');
    assert(/^__Secure-better-auth\.session_token=[^;\r\n]+$/.test(o.cookie), 'One Acquire session cookie required');
    assert(o.expectedOwnerId && o.expectedOrganizationId && uuid(o.expectedBindingId) && (/^(?:agent-[a-z0-9-]+|hosted-demo-[a-z0-9][a-z0-9-]{0,35})$/.test(o.simulatorRun)), 'Explicit owner, workspace, binding and simulator run required');
    const s = o.state;
    const creation=channelCanaryCreationScope(o);
    if(s?.creation)assert.deepEqual(s.creation,creation,'Creation strategy changed');
    else if(s?.legacyCreation)assert(s.sourceMandateId===o.legacySource?.mandateId,'Saved source changed');
    if(s)s.creation=creation;
    assert(s?.requestId === o.requestId && s.channel === o.channel, 'Separate original channel journal required');
    assert(!s.pendingMutation && !s.pendingAcceptance, 'An unresolved mutation requires inspection');
    const scope = { origin: o.origin, owner: o.expectedOwnerId, organization: o.expectedOrganizationId, binding: o.expectedBindingId, run: o.simulatorRun };
    if (s.scope)
        assert.deepEqual(s.scope, scope, 'Journal scope changed');
    else
        s.scope = scope;
    const fetcher = o.fetcher ?? fetch, sleep = o.sleep ?? (ms => new Promise(r => setTimeout(r, ms))), deadline = Date.now() + Math.min(o.timeoutMs ?? 600000, 900000), save = () => o.saveState(s), record = o.record ?? (async () => { });
    await save();
    async function request(path, body, confirm) { assert(Date.now() < deadline, 'Canary deadline reached'); if (body) {
        s.pendingMutation = { path, body };
        await save();
    } let r, text; try {
        r = await fetcher(o.origin + path, { method: body ? 'POST' : 'GET', redirect: 'error', headers: { cookie: o.cookie, Origin: o.origin, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(channelCanaryRequestTimeoutMs(path, body, deadline - Date.now())) });
        text = await r.text();
    }
    catch {
        throw Error(body ? 'Mutation response ambiguous; inspect journal' : 'Read unavailable');
    } await record({ path, method: body ? 'POST' : 'GET', status: r.status }); if (!r.ok) {
        if (body && r.status >= 400 && r.status < 500) {
            delete s.pendingMutation;
            await save();
        }
        throw Error('Acquire HTTP ' + r.status);
    } let value; try {
        value = JSON.parse(text);
    }
    catch {
        throw Error(body ? 'Mutation response ambiguous' : 'Malformed read');
    } if (body) {
        assert(confirm?.(value), 'Mutation receipt ambiguous');
        delete s.pendingMutation;
        await save();
    } return value; }
    const session = await request('/api/auth/get-session');
    assert.equal(session.user?.id, o.expectedOwnerId);
    assert.equal(session.session?.activeOrganizationId, o.expectedOrganizationId);
    if(o.legacySource){
        assert(uuid(o.legacySource.mandateId)&&o.legacySource.brief,'Explicit owned cached source required');
        const valid=v=>v?.id===o.requestId&&v.executionMode==='demo'&&v.initialResearch?.source==='cached'&&v.initialResearch?.status==='complete';
        if(!s.legacyCreation)s.legacyCreation=await request('/api/mandates/agent',{requestId:o.requestId,executionMode:'demo',demoSourceMandateId:o.legacySource.mandateId,brief:o.legacySource.brief},valid);
        assert(valid(s.legacyCreation)&&!s.workflowId,'Original legacy demo receipt required');
        s.admissionKind='legacy_cached_demo';s.sourceMandateId=o.legacySource.mandateId;s.mandateId=s.legacyCreation.id;await save();
    }else{
    const validWorkflow = w => w && uuid(w.id) && uuid(w.mandateId) && w.ownerUserId === o.expectedOwnerId && w.organizationId === o.expectedOrganizationId && w.preset === 'demo' && w.presentation === 'agent';
    let w = await request('/api/acquisition-workflows?requestId=' + o.requestId);
    if (w.status === 'missing')
        w = await request('/api/acquisition-workflows', { requestId: o.requestId, preset: 'demo', presentation: 'agent' }, validWorkflow);
    assert(validWorkflow(w), 'Owned demo required');
    if (s.workflowId)
        assert.equal(s.workflowId, w.id);
    if (s.mandateId)
        assert.equal(s.mandateId, w.mandateId);
    s.workflowId = w.id;
    s.mandateId = w.mandateId;
    await save();
    while (!['ready', 'outreach'].includes(w.state)) {
        assert(!['failed', 'cancelled', 'uncertain', 'complete'].includes(w.state), 'Workflow stopped');
        await sleep(1000);
        w = await request('/api/acquisition-workflows?requestId=' + o.requestId);
        assert(validWorkflow(w) && w.id === s.workflowId, 'Workflow changed');
    }
    }
    const base = '/api/mandates/' + s.mandateId + '/agent', receipt = v => typeof v?.result?.status === 'string';
    const initialExecution = (await request(base + '/execution')).state;
    if(s.admissionKind==='legacy_cached_demo')assert(initialExecution?.executionMode==='demo'&&!initialExecution.workflowExecutionId,'Owned legacy execution required');
    if (initialExecution?.responsibility && s.admissionKind!=='legacy_cached_demo')
        assert(s.started && s.keys && Object.values(s.keys).every(uuid), 'Original started phase keys required');
    s.keys ??= { prepare: randomUUID(), policy: randomUUID(), start: randomUUID() };
    await save();
    if (!s.prepared) {
        await request(base + '/demo', { requestKey: s.keys.prepare }, v => Number.isSafeInteger(v?.prepared) && v.prepared > 0 && v.outreachReady === false && typeof v.replayed === 'boolean');
        s.prepared = true;
        await save();
    }
    let policy = await request(base + '/channel-policy');
    if (!s.policySaved) {
        assert(policy.accounts?.some(a => a.channel === o.channel && a.bindingId === o.expectedBindingId && a.eligibleForNewWork !== false), 'Exact eligible binding required');
        await request(base + '/channel-policy', { requestKey: s.keys.policy, expectedRevision: policy.policy?.revision ?? 0, channelOrder: [o.channel], bindings: [{ channel: o.channel, bindingId: o.expectedBindingId }], delaySeconds: o.acceleratedSimulation === true ? 5 : 86400, acceleratedSimulation: o.acceleratedSimulation === true }, receipt);
        s.policySaved = true;
        await save();
        policy = await request(base + '/channel-policy');
    }
    assert.deepEqual(policy.policy?.channelOrder, [o.channel]);
    assert.equal(policy.policy.bindings.length, 1);
    assert.equal(policy.policy.bindings[0].bindingId, o.expectedBindingId);
    if (!s.started) {
        await request(base + '/demo', { requestKey: s.keys.start, action: 'start' }, v => v?.result?.status || v?.started === true || v?.outreachReady === true);
        s.started = true;
        await save();
    }
    async function execution() { const e = (await request(base + '/execution')).state; assert(e?.executionMode === 'demo' && (s.admissionKind==='legacy_cached_demo'?!e.workflowExecutionId:e.workflowPreset === 'demo' && e.workflowExecutionId === s.workflowId), 'Exact demo execution required'); return e; }
    function alias(value) { if (o.channel === 'whatsapp')
        return /^whatsapp:\+999\d{12}$/.test(value); const prefix = o.channel === 'email' ? 'email:lead-' : 'linkedin:https://www.linkedin.com/in/sim-' + o.simulatorRun + '-lead-'; return o.channel === 'email' ? new RegExp('^email:lead-[0-9]{3}@' + o.simulatorRun.replaceAll('-', '\\-') + '\\.leads\\.acquire\\.test$').test(value) : value.startsWith(prefix) && /^\d{3}$/.test(value.slice(prefix.length)); }
    async function approve(batch, e, kind) {
        assert(batch.state === 'pending' && batch.stale === false && batch.organization_id === o.expectedOrganizationId && batch.owner_user_id === o.expectedOwnerId && batch.mandate_id === s.mandateId && batch.thread_id === e.responsibility?.thread_id, 'Exact owned review required');
        assert(batch.operations.length === 1 && batch.manifest.length === 1, 'Single-operation approval required');
        const p = batch.operations[0], m = batch.manifest[0];
        assert(p.state === 'proposed' && m.operationId === p.id && m.revision === p.revision && m.digest === p.input_digest, 'Exact manifest required');
        if (kind !== 'selection') {
            const c = e.conversations?.find(c => c.id === p.conversationId), route = c?.channels?.find(r => r.channel === o.channel && r.id === p.input?.routeId);
            assert(route && route.bindingId === o.expectedBindingId && p.input.recipientKey === o.channel + ':' + route.recipient && alias(p.input.recipientKey), 'Exact reserved owned route required');
            if (s.conversationId)
                assert.equal(p.conversationId, s.conversationId);
            if (kind === 'message' && o.channel === 'linkedin')
                assert(route.relationship?.status === 'connected' && route.relationship.canMessage === true, 'Verified LinkedIn connection required');
            s.conversationId = p.conversationId;
            s[kind + 'OperationId'] = p.id;
            await save();
        }
        await request(base + '/reviews', { action: 'decide', batchId: batch.id, revision: batch.revision, items: batch.manifest, decision: 'approved' }, v => v?.batch?.id === batch.id && v.batch.state === 'approved');
        if (kind === 'selection') {
            s.selectionApproved = true;
            s.selectionOperation = { id: p.id, revision: p.revision };
        }
        await save();
    }
    async function guidance() { if (!o.buyerGuidance || s.guidanceApproved)
        return; assert(typeof o.buyerGuidance === 'string' && o.buyerGuidance.length >= 5 && o.buyerGuidance.length <= 2000 && s.selectionOperation, 'Explicit bounded guidance and original selection required'); s.guidanceKey ??= randomUUID(); await save(); const g = await request(base + '/guidance', { action: 'feedback', requestKey: s.guidanceKey, input: { source: { kind: 'operation', ...s.selectionOperation }, category: 'buyer_context', reason: 'Reviewed buyer wording for this isolated simulated outreach test.', preference: o.buyerGuidance } }, v => uuid(v?.guidance?.id) && Number.isInteger(v.guidance.revision)); await request(base + '/guidance', { action: 'decide', id: g.guidance.id, revision: g.guidance.revision, decision: 'approved', confirmed: true }, v => v?.guidance?.id === g.guidance.id && v.guidance.state === 'approved'); s.guidanceApproved = true; await save(); }
    async function refreshRelationship() { const e = await execution(), c = e.conversations.find(c => c.id === s.conversationId); assert(c, 'Original invitation conversation required'); const tokens = { conversationId: c.id, revision: c.revision, epoch: Number(c.epoch), contextRevision: c.context_revision }; await request(base + '/execution', { action: 'refresh_review_history', requestKey: randomUUID(), ...tokens }, receipt); for (let i = 0; i < 10; i++) {
        await sleep(1000);
        const latest = (await execution()).conversations.find(c => c.id === s.conversationId);
        if (latest?.history_complete && latest.history_coverage_fresh) {
            const r = latest.channels.find(r => r.channel === 'linkedin');
            if (r?.relationship?.status !== 'connected' || r.relationship.canMessage !== true)
                return false;
            await request(base + '/execution', { action: 'reassess_conversation', requestKey: randomUUID(), conversationId: latest.id, revision: latest.revision, epoch: Number(latest.epoch), contextRevision: latest.context_revision, reason: 'Reviewed the accepted simulated LinkedIn invitation and fresh recorded history. Assess one introductory message; do not repeat the invitation.' }, receipt);
            s.relationshipVerified = true;
            await save();
            return true;
        }
    } throw Error('History refresh incomplete; inspect original state'); }
    while (Date.now() < deadline) {
        if (s.selectionApproved)
            await guidance();
        const e = await execution();
        if (s.invitationOperationId && !s.relationshipVerified) {
            const invitation = await request(base + '/operations?operationId=' + s.invitationOperationId);
            assert(invitation.operationId === s.invitationOperationId && invitation.conversationId === s.conversationId && invitation.name === 'linkedin.invitation', 'Original invitation required');
            if (invitation.delivery?.status === 'submitted') {
                const providerId = invitation.delivery.providerOperationId ?? invitation.delivery.providerMessageId;
                assert(providerId, 'Saved provider invitation required');
                if (!s.acceptanceRequested) {
                    s.acceptanceRequested = true;
                    await save();
                    if (!o.acceptInvitation)
                        return { passed: false, status: 'awaiting_provider_invitation_acceptance', channel: o.channel, workflowId: s.workflowId, invitationId: providerId };
                    s.pendingAcceptance = { invitationId: providerId, operationId: s.invitationOperationId };
                    await save();
                    await o.acceptInvitation({ ...s.pendingAcceptance, conversationId: s.conversationId });
                    delete s.pendingAcceptance;
                    await save();
                }
                if (!await refreshRelationship())
                    return { passed: false, status: 'awaiting_verified_connection', channel: o.channel, workflowId: s.workflowId, invitationId: providerId };
                continue;
            }
            else {
                await sleep(1000);
                continue;
            }
        }
        if (!s.messageOperationId) {
            const batches = (await request(base + '/reviews')).batches;
            assert(Array.isArray(batches));
            const candidates = batches.filter(b => b.state === 'pending' && !b.stale && b.operations?.length === 1);
            const selection = candidates.find(b => b.operations[0].name === 'target.select');
            if (!s.selectionApproved && selection) {
                await approve(selection, e, 'selection');
                continue;
            }
            if (!s.selectionApproved) {
                await sleep(1000);
                continue;
            }
            const invitation = !s.invitationOperationId && o.channel === 'linkedin' && candidates.find(b => b.operations[0].name === 'linkedin.invitation');
            const message = candidates.find(b => b.operations[0].name === o.channel + '.initial' && (!s.conversationId || b.operations[0].conversationId === s.conversationId));
            if (invitation) {
                await approve(invitation, e, 'invitation');
                continue;
            }
            if (message)
                await approve(message, e, 'message');
        }
        if (s.messageOperationId) {
            const p = await request(base + '/operations?operationId=' + s.messageOperationId + '&include=history');
            assert(p.operationId === s.messageOperationId && p.conversationId === s.conversationId && p.channel === o.channel && p.name === o.channel + '.initial', 'Original initial message required');
            const at = Date.parse(p.delivery?.submittedAt);
            if (p.state === 'complete' && p.delivery?.status === 'submitted' && p.delivery.providerMessageId && Number.isFinite(at) && p.history?.messages?.some(m => m.direction === 'inbound' && m.channel === o.channel && typeof m.text === 'string' && m.text.trim() && Date.parse(m.at) >= at))
                return { passed: true, admissionKind:s.admissionKind??'workflow_v2', channel: o.channel, workflowId: s.workflowId, mandateId: s.mandateId, operationId: s.messageOperationId, conversationId: s.conversationId };
        }
        await sleep(Math.min(1000, Math.max(0, deadline - Date.now())));
    }
    throw Error('Canary deadline reached; inspect saved original outcome, never resend');
}
async function main() { const args = process.argv.slice(2), value = k => { const i = args.indexOf(k); return i < 0 ? undefined : args[i + 1]; }; assert(args.includes('--execute')); const channel = value('--channel'); assert(channels.includes(channel)); const dir = resolve(value('--evidence-dir') ?? ''), cookieFile = resolve(value('--cookie-file') ?? ''); assert(dir.includes(sep + '.local-data' + sep) && cookieFile.includes(sep + '.local-data' + sep)); await mkdir(dir, { recursive: true, mode: 0o700 }); const lockPath = resolve(dir, channel + '.lock'), lock = await open(lockPath, 'wx', 0o600); try {
    const file = resolve(dir, channel + '.json'), requestId = value('--request-id');
    let state;
    try {
        state = JSON.parse(await readFile(file, 'utf8'));
    }
    catch (e) {
        if (e.code !== 'ENOENT')
            throw e;
        state = { requestId, channel };
    }
    const saveState = async (s) => { await writeFile(file + '.tmp', JSON.stringify(s), { mode: 0o600 }); await rename(file + '.tmp', file); };
    let n = 0;
    const record = async (e) => writeFile(resolve(dir, channel + '-' + Date.now() + '-' + process.pid + '-' + (++n) + '.json'), JSON.stringify(e), { mode: 0o600, flag: 'wx' });
    const result = await runAcquisitionChannelCanary({ execute: true, origin: value('--origin'), channel, requestId, state, saveState, record, cookie: (await readFile(cookieFile, 'utf8')).trim(), expectedOwnerId: value('--owner-id'), expectedOrganizationId: value('--organization-id'), expectedBindingId: value('--binding-id'), simulatorRun: value('--simulator-run'), acceleratedSimulation: args.includes('--accelerated-simulation'), ...(value('--buyer-guidance-file') ? { buyerGuidance: await readFile(value('--buyer-guidance-file'), 'utf8') } : {}) });
    await record(result);
    console.log(JSON.stringify(result));
}
finally {
    await lock.close();
    await unlink(lockPath);
} }
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
    main().catch(() => { console.error('Canary stopped; inspect private journal. No automatic resend.'); process.exitCode = 1; });
