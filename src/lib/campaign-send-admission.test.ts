import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import type { SqlClient, SqlResult } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createAcquireSendAdmission, type AcquireSendAdmissionOptions } from './campaign-send-admission';
const binding = { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' } as const;
const source = { kind: 'campaign', attemptId: 'attempt', enrolmentId: 'enrolment', versionId: 'version', stepId: '11111111-1111-4111-8111-111111111111', stepIndex: 0, runtime: 'legacy' } as const;
const message = { recipient: { kind: 'phone', value: '+15550000000' }, text: 'Hi Alex' } as const;
const codec = new JournalCodec({ activeVersion: 'admission-test', keys: [{ version: 'admission-test', encryptionKey: Buffer.alloc(32, 31), digestKey: Buffer.alloc(32, 32) }] });
function fixture(channel: 'whatsapp' | 'email' = 'whatsapp') {
    const selectedBinding = channel === 'email' ? { ...binding, channel: 'email' as const, platform: 'gmail' as const } : binding;
    let intent: Record<string, unknown> | undefined;
    const intents: Record<string, unknown>[] = [];
    const calls: string[] = [];
    const control = { member: true, clear: true, coverage: true, lostCommit: false, originalBindingValid: true, dbNow: new Date('2026-10-14T00:00:00.000Z'), reviewedAt: new Date('2026-10-01T00:00:00.000Z') as Date | null };
    const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<SqlResult> => {
        calls.push(sql);
        if (sql === 'SELECT clock_timestamp() AS admission_now')
            return { rows: [{ admission_now: control.dbNow }] };
        if (sql.includes('pg_roles'))
            return { rows: [{ role_name: 'acquire_campaign_user', rolsuper: false, rolbypassrls: false }] };
        if (sql.includes('to_regprocedure'))
            return { rows: [{ installed: true }] };
        if (sql.includes('communications_lock_send_gate'))
            return { rows: [{ revision: '1' }] };
        if (sql.includes('communications_lock_send_member'))
            return { rows: [{ allowed: control.member }] };
        if (sql.includes('SELECT binding_id FROM public.campaign_channel_bindings'))
            return { rows: control.originalBindingValid ? [{ binding_id: 'binding' }] : [] };
        if (sql.includes('communication_bindings'))
            return { rows: [{ id: 'binding', application_id: 'acquire', organization_id: 'org', owner_user_id: 'owner', service_connection_id: 'connection', service_account_id: 'physical', generation: 1, channel: selectedBinding.channel, platform: selectedBinding.platform, backend: 'unipile', authority: 'service' }] };
        if (sql.includes('FROM public.messages'))
            return { rows: [{ id: 'draft', state: 'approved', subject: 'Approved subject', body: 'Approved body', updated_at: new Date('2026-10-01T00:00:00.000Z'), approved_by: 'owner', approved_at: new Date('2026-10-01T00:00:00.000Z'), contact_id: 'contact', enrolment_state: 'approved', personal_data: { email: 'person@example.test' }, fictionalised: false }] };
        if (sql.includes('campaign_enrolments'))
            return { rows: [{ attempt_id: 'attempt', attempt_state: 'claimed', enrolment_id: 'enrolment', version_id: 'version', contact_id: 'contact', step_index: 0, runtime: 'legacy', state: 'active', due: true, started_at: new Date('2026-10-01'), initial_conversation_reviewed: true, communication_initial_reviewed_at: control.reviewedAt, review_time_valid: control.reviewedAt !== null, definition: { schemaVersion: 1, steps: [{ id: '11111111-1111-4111-8111-111111111111', kind: 'whatsapp', title: 'Message', body: 'Hi {{first_name}}' }] }, display_name: 'Alex', company_name: 'Example', fictionalised: false, personal_data: { phone: '+15550000000' }, recipient_phone: '+15550000000', assigned: true, bound: control.originalBindingValid }] };
        if (sql.includes('communications_admission_person_clear'))
            return { rows: [{ clear: control.clear }] };
        if (sql.includes('communication_reply_monitors'))
            return { rows: [{ ready: control.coverage }] };
        if (sql.startsWith('INSERT INTO public.communication_dispatch_intents')) {
            intent = { id: values[0], organization_id: 'org', owner_user_id: 'owner', binding_id: 'binding', source_kind: values[4], source_id: values[5], epoch: values[6], operation_key: values[8], operation: values[9], payload_digest: values[10], intent_digest: values[11], encrypted_intent: values[12], intent_key_version: values[13], source_digest: values[14], required_since: values[15], coverage_scopes: values[16], contact_id: 'contact' };
            intents.push(intent);
            return { rows: [intent] };
        }
        if (sql.includes('FROM public.communication_dispatch_intents'))
            return { rows: sql.includes('ORDER BY epoch') ? (intent ? [intent] : []) : intents.filter(row => row.operation_key === values[2]) };
        if (sql.includes('communication_dispatch_permits'))
            return { rows: [] };
        if (sql === 'COMMIT' && control.lostCommit)
            throw Error('synthetic lost commit');
        return { rows: [] };
    });
    const release = vi.fn(), options: AcquireSendAdmissionOptions = { pool: { connect: async () => ({ query, release } as SqlClient) }, binding: selectedBinding, bindingId: 'binding', codec, verifyServiceAdmission: async () => true };
    return { repo: createAcquireSendAdmission(options), calls, control, query, release, options, intents };
}
it.each(['legacy', 'n8n'] as const)('commits an immutable rendered intent before %s runtime dispatch authority exists', async (runtime) => {
    const f = fixture();
    if (runtime === 'n8n') {
        const old = f.query.getMockImplementation()!;
        f.query.mockImplementation(async (sql, v) => {
            const r = await old(sql, v);
            if (sql.includes('FROM public.messages'))
                return { rows: [{ id: 'draft', state: 'approved', subject: 'Approved subject', body: 'Approved body', updated_at: new Date('2026-10-01T00:00:00.000Z'), approved_by: 'owner', approved_at: new Date('2026-10-01T00:00:00.000Z'), contact_id: 'contact', enrolment_state: 'approved', personal_data: { email: 'person@example.test' }, fictionalised: false }] };
            if (sql.includes('campaign_enrolments'))
                r.rows[0].runtime = 'n8n';
            return r;
        });
    }
    const p = await f.repo.prepare({ source: { ...source, runtime }, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] });
    expect(p.submission.message).toEqual(message);
    expect(p.epoch).toBe(1);
    expect(f.calls.at(-1)).toBe('COMMIT');
    expect(f.calls.some(sql => sql.includes('communication_dispatch_permits'))).toBe(false);
});
it('membership denial prevents encrypted intent INSERT', async () => { const f = fixture(); f.control.member = false; await expect(f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] })).rejects.toThrow('Send authority unavailable'); expect(f.calls.some(sql => sql.startsWith('INSERT INTO'))).toBe(false); });
it('prepared intent alone cannot authorize a person held across channels', async () => { const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); f.control.clear = false; const r = await f.repo.open({ record: { snapshot: p.submission.snapshot, recipient: message.recipient, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal); expect(r).toEqual({ kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } }); });
it('incomplete coverage blocks without application permit consumption', async () => { const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); f.control.coverage = false; const r = await f.repo.open({ record: { snapshot: p.submission.snapshot, recipient: message.recipient, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal); expect(r).toEqual({ kind: 'blocked', outcome: { status: 'waiting', code: 'incomplete' } }); });
it('historical lookup returns immutable original bytes without fresh readiness or active-source proof', async () => { const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); f.calls.length = 0; const recovered = await f.repo.getPreparedIntent({ sourceKind: 'campaign', sourceId: source.attemptId }); expect(recovered).toEqual(p); expect(f.calls.some(sql => sql.includes('campaign_enrolments') || sql.includes('communication_reply_monitors'))).toBe(false); });
it('allocates append-only epoch2 only after durable original no-submission proof', async () => { const f = fixture(), first = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); const prove = vi.fn(async () => ({ snapshot: first.submission.snapshot, journalId: 'journal-original', outcome: { status: 'waiting', code: 'rate_limited' }, evidenceDigest: 'b'.repeat(64), keyVersion: 'service-proof' })); const retry = createAcquireSendAdmission({ ...f.options, proveNoSubmission: prove }); const next = await retry.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); expect(next.epoch).toBe(2); expect(next.submission.snapshot.key).not.toBe(first.submission.snapshot.key); expect(f.intents).toHaveLength(2); expect(f.intents[0].operation_key).toBe(first.submission.snapshot.key); expect(f.calls.some(sql => sql.startsWith('INSERT INTO public.communication_intent_resolutions'))).toBe(true); });
it('unresolved original proof never grants a new key or changed bytes', async () => { const f = fixture(), first = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); const prove = vi.fn(async () => null), retry = createAcquireSendAdmission({ ...f.options, proveNoSubmission: prove }); const again = await retry.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); expect(again).toEqual(first); expect(prove).toHaveBeenCalledOnce(); expect(f.intents).toHaveLength(1); });
it('explicit approved draft prepares exact saved bytes without consuming a send permit', async () => { const f = fixture('email'), draft = { kind: 'draft' as const, messageId: 'draft', revision: '2026-10-01T00:00:00.000Z' }, content = { recipient: { kind: 'email' as const, value: 'person@example.test' }, subject: 'Approved subject', text: 'Approved body' }; const prepared = await f.repo.prepare({ source: draft, message: content, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); expect(prepared.submission.message).toEqual(content); expect(f.calls.some(sql => sql.includes('communication_dispatch_permits'))).toBe(false); });
it('edited draft bytes cannot inherit approval of the saved revision', async () => { const f = fixture('email'); await expect(f.repo.prepare({ source: { kind: 'draft', messageId: 'draft', revision: '2026-10-01T00:00:00.000Z' }, message: { recipient: { kind: 'email', value: 'person@example.test' }, subject: 'Edited subject', text: 'Approved body' }, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] })).rejects.toThrow('Send authority unavailable'); expect(f.intents).toHaveLength(0); });
it('current application authority remains held without COMMIT until exact service receipt is verified', async () => {
    const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] });
    f.calls.length = 0;
    const opened = await f.repo.open({ record: { snapshot: p.submission.snapshot, recipient: message.recipient, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal);
    expect(opened.kind).toBe('held');
    expect(f.calls).not.toContain('COMMIT');
    if (opened.kind !== 'held')
        throw Error('Expected held authority');
    const receipt = { permitId: opened.permit.permitId, intentDigest: opened.permit.intentDigest, journalId: 'journal', admissionId: 'service-admission', snapshot: p.submission.snapshot, fencingToken: '1', serviceRevision: '1' };
    expect(await opened.permit.commit(receipt, new AbortController().signal)).toBe('committed');
    expect(f.calls.at(-1)).toBe('COMMIT');
    expect(f.calls.some(sql => sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(true);
});
it('contradictory cleartext cursor scope metadata cannot attest held send permission', async () => {
    const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] });
    f.intents[0].coverage_scopes = JSON.stringify([{ bindingId: 'binding', scopeDigest: 'f'.repeat(64) }]);
    const decision = await f.repo.open({ record: { snapshot: p.submission.snapshot, recipient: message.recipient, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal);
    if (decision.kind === 'held')
        await decision.permit.abort();
    expect(decision).toEqual({ kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } });
});
it('cannot replace an enrolled original channel with a later default binding', async () => { const f = fixture(); f.control.originalBindingValid = false; await expect(f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] })).rejects.toThrow('Send authority unavailable'); expect(f.intents).toHaveLength(0); });
it('held campaign authorization rechecks the business window against the application database clock', async () => {
    const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] });
    f.control.dbNow = new Date('2026-10-17T00:00:00.000Z');
    const r = await f.repo.open({ record: { snapshot: p.submission.snapshot, recipient: message.recipient, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal);
    if (r.kind === 'held')
        await r.permit.abort();
    expect(r).toEqual({ kind: 'blocked', outcome: { status: 'waiting', code: 'busy', retryAt: '2026-10-18T22:00:00.000Z' } });
    expect(f.calls.some(sql => sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);
});
it('lost application permit COMMIT retires its session without rollback competing with uncertainty', async () => {
    const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] });
    const opened = await f.repo.open({ record: { snapshot: p.submission.snapshot, recipient: message.recipient, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal);
    if (opened.kind !== 'held')
        throw Error('expected held');
    f.calls.length = 0;
    f.control.lostCommit = true;
    await expect(opened.permit.commit({ permitId: opened.permit.permitId, intentDigest: opened.permit.intentDigest, journalId: 'journal', admissionId: 'service-admission', snapshot: p.submission.snapshot, fencingToken: '1', serviceRevision: '1' }, new AbortController().signal)).rejects.toThrow('Send authority unavailable');
    expect(f.calls).toContain('COMMIT');
    expect(f.calls).not.toContain('ROLLBACK');
    expect(f.release).toHaveBeenLastCalledWith(expect.any(Error));
});
it('a stalled service-readback verifier cannot retain application authorization past one deadline', async () => {
    const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] });
    const repo = createAcquireSendAdmission({ ...f.options, timeoutMs: 30, verifyServiceAdmission: async () => new Promise(() => { }) });
    const opened = await repo.open({ record: { snapshot: p.submission.snapshot, recipient: message.recipient, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal);
    if (opened.kind !== 'held')
        throw Error('expected held');
    f.calls.length = 0;
    await expect(opened.permit.commit({ permitId: opened.permit.permitId, intentDigest: opened.permit.intentDigest, journalId: 'journal', admissionId: 'service-admission', snapshot: p.submission.snapshot, fencingToken: '1', serviceRevision: '1' }, new AbortController().signal)).rejects.toThrow('Send authority unavailable');
    expect(f.calls).not.toContain('COMMIT');
    expect(f.calls.some(sql => sql.includes('communication_dispatch_permits'))).toBe(false);
    expect(f.release).toHaveBeenLastCalledWith(expect.any(Error));
});
it('rejects content accessors without invoking them or entering application SQL', async () => { const f = fixture(), getter = vi.fn(() => message.recipient), raw = Object.defineProperty({ text: message.text }, 'recipient', { enumerable: true, get: getter }); await expect(f.repo.prepare({ source, message: raw as typeof message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] })).rejects.toThrow('Send authority unavailable'); expect(getter).not.toHaveBeenCalled(); expect(f.query).not.toHaveBeenCalled(); });
it('observes rejected nested input Promises under strict native Node without application SQL', () => { const script = String.raw `const fs=require('node:fs'),ts=require('typescript');require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);const {createAcquireSendAdmission}=require(process.argv[1]);let connects=0;const b={applicationId:'acquire',tenantId:'org',ownerId:'owner',connectionId:'connection',accountId:'physical',generation:1,channel:'whatsapp',platform:'whatsapp',backend:'unipile'};const repo=createAcquireSendAdmission({binding:b,bindingId:'binding',pool:{connect:async()=>{connects++;throw Error('Unexpected SQL');}},codec:{keyVersion:'fixture',encode(){},decode(){},digest(){}},verifyServiceAdmission:async()=>true});repo.prepare({source:{kind:'campaign'},message:{recipient:{kind:'phone',value:Promise.reject(Error('synthetic nested rejected value'))},text:'Hi'},coverageScopes:[]}).then(()=>process.exitCode=2,()=>setTimeout(()=>process.stdout.write(JSON.stringify({connects})),20));`; const result = spawnSync(process.execPath, ['--unhandled-rejections=strict', '-e', script, fileURLToPath(new URL('./campaign-send-admission.ts', import.meta.url))], { encoding: 'utf8', timeout: 3000 }); expect(result.status).toBe(0); expect(JSON.parse(result.stdout)).toEqual({ connects: 0 }); });
it('accepts repeated references to the same binding in an exact original conversation', async () => {
    const f = fixture(), content = { ...message, conversation: { binding, id: 'original-chat' } }, prepared = await f.repo.prepare({ source, message: content, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }), shared = prepared.submission.snapshot.binding;
    const result = await f.repo.open({ record: { snapshot: prepared.submission.snapshot, recipient: message.recipient, conversation: { binding: shared, id: 'original-chat' }, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal);
    expect(result.kind).toBe('held');
    if (result.kind === 'held')
        await result.permit.abort();
});
it('an approved draft cannot borrow coverage from a different email binding', async () => {
    const f = fixture('email'), old = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, values) => {
        const r = await old(sql, values);
        if (sql.includes('SELECT * FROM public.communication_bindings') && values?.[0] === 'other-binding')
            r.rows[0].id = 'other-binding';
        return r;
    });
    await expect(f.repo.prepare({ source: { kind: 'draft', messageId: 'draft', revision: '2026-10-01T00:00:00.000Z' }, message: { recipient: { kind: 'email', value: 'person@example.test' }, subject: 'Approved subject', text: 'Approved body' }, coverageScopes: [{ bindingId: 'other-binding', scopeDigest: 'a'.repeat(64) }] })).rejects.toThrow('Send authority unavailable');
    expect(f.intents).toHaveLength(0);
});
it('an old reviewed boolean cannot fabricate original manual-history clearance timestamp', async () => { const f = fixture(); f.control.reviewedAt = null; await expect(f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] })).rejects.toThrow('Send authority unavailable'); expect(f.intents).toHaveLength(0); });
it('configured admission cannot send while application reply policy is off or observation-only', async () => {
    vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED', 'true');
    vi.stubEnv('CAMPAIGN_REPLY_MONITOR_MODE', 'observe');
    try {
        const f = fixture(), p = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] });
        const result = await f.repo.open({ record: { snapshot: p.submission.snapshot, recipient: message.recipient, state: 'claimed' }, claimToken: 'claim', serviceRevision: '1' }, new AbortController().signal);
        if (result.kind === 'held')
            await result.permit.abort();
        expect(result).toEqual({ kind: 'blocked', outcome: { status: 'review', code: 'forbidden' } });
    }
    finally {
        vi.unstubAllEnvs();
    }
});
it('a paused saved-draft enrollment cannot inherit earlier message approval', async () => {
    const f = fixture('email'), old = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, values) => {
        const r = await old(sql, values);
        if (sql.includes('FROM public.messages'))
            r.rows[0].enrolment_state = 'paused';
        return r;
    });
    await expect(f.repo.prepare({ source: { kind: 'draft', messageId: 'draft', revision: '2026-10-01T00:00:00.000Z' }, message: { recipient: { kind: 'email', value: 'person@example.test' }, subject: 'Approved subject', text: 'Approved body' }, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] })).rejects.toThrow('Send authority unavailable');
    expect(f.intents).toHaveLength(0);
});
it('preloads only the authenticated original intent coverage without consulting defaults or current source readiness', async () => { const f = fixture(), prepared = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); f.calls.length = 0; expect(await f.repo.getPreparedCoverage(prepared.submission.snapshot)).toEqual([{ binding, scopeDigest: 'a'.repeat(64) }]); expect(f.calls.some(sql => sql.includes('communication_defaults') || sql.includes('campaign_enrolments') || sql.includes('communication_reply_monitors') || sql.includes('communication_dispatch_permits'))).toBe(false); expect(f.calls.at(-1)).toBe('COMMIT'); });
it('altered lookup snapshot cannot disclose the original intent coverage', async () => { const f = fixture(), prepared = await f.repo.prepare({ source, message, coverageScopes: [{ bindingId: 'binding', scopeDigest: 'a'.repeat(64) }] }); await expect(f.repo.getPreparedCoverage({ ...prepared.submission.snapshot, payloadDigest: 'f'.repeat(64) })).rejects.toThrow('Send authority unavailable'); });
