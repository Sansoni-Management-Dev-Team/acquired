import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import type { SqlClient, SqlResult } from '../../communications/packages/storage-postgres/src/webhook-repository';
import { createAcquireSendAdmission, acquireSourceDigest, type AcquireSendAdmissionOptions } from './campaign-send-admission';
const binding = { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' } as const;
const source = { kind: 'campaign', attemptId: 'attempt', enrolmentId: 'enrolment', versionId: 'version', stepId: '11111111-1111-4111-8111-111111111111', stepIndex: 0, runtime: 'legacy' } as const;
const message = { recipient: { kind: 'phone', value: '+15550000000' }, text: 'Hi Alex' } as const;
const codec = new JournalCodec({ activeVersion: 'admission-test', keys: [{ version: 'admission-test', encryptionKey: Buffer.alloc(32, 31), digestKey: Buffer.alloc(32, 32) }] });
function fixture(channel: 'whatsapp' | 'email'|'linkedin' = 'whatsapp',bindingId='binding') {
    const selectedBinding = channel === 'email' ? { ...binding, channel: 'email' as const, platform: 'gmail' as const } : channel==='linkedin'?{...binding,channel:'linkedin' as const,platform:'linkedin' as const}:binding;
    let intent: Record<string, unknown> | undefined;
    const intents: Record<string, unknown>[] = [];
    const resolutions=new Map<unknown,Record<string,unknown>>();
    const calls: string[] = [];
    const control = { manualDemo:false,ownershipInstalled:false,driverAllowed:true, member: true, clear: true, coverage: true, lostCommit: false, originalBindingValid: true, dbNow: new Date('2026-10-14T00:00:00.000Z'), reviewedAt: new Date('2026-10-01T00:00:00.000Z') as Date | null };
    const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<SqlResult> => {
        calls.push(sql);
        if(sql.includes('agent_assert_manual_mandate_outreach_mode')){if(control.manualDemo)throw Error('Demo manual outreach is disabled');return {rows:[]};}
        if (sql === 'SELECT clock_timestamp() AS admission_now')
            return { rows: [{ admission_now: control.dbNow }] };
        if (sql.includes('pg_roles'))
            return { rows: [{ role_name: 'acquire_campaign_user', rolsuper: false, rolbypassrls: false }] };
        if(sql.includes('to_regprocedure')&&sql.includes('agent_driver_allows'))return {rows:[{installed:control.ownershipInstalled}]};
        if(sql.includes('SELECT public.agent_driver_allows'))return {rows:[{allowed:control.driverAllowed}]};
        if (sql.includes('to_regprocedure'))
            return { rows: [{ installed: true }] };
        if (sql.includes('communications_lock_send_gate'))
            return { rows: [{ revision: '1' }] };
        if (sql.includes('communications_lock_send_member'))
            return { rows: [{ allowed: control.member }] };
        if (sql.includes('SELECT binding_id FROM public.campaign_channel_bindings'))
            return { rows: control.originalBindingValid ? [{ binding_id: bindingId }] : [] };
        if (sql.includes('communication_bindings'))
            return { rows: [{ id: bindingId, application_id: 'acquire', organization_id: 'org', owner_user_id: 'owner', service_connection_id: 'connection', service_account_id: 'physical', generation: 1, channel: selectedBinding.channel, platform: selectedBinding.platform, backend: 'unipile', authority: 'service' }] };
        if (sql.includes('FROM public.messages'))
            return { rows: [{ id: 'draft', state: 'approved', subject: 'Approved subject', body: 'Approved body', updated_at: new Date('2026-10-01T00:00:00.000Z'), approved_by: 'owner', approved_at: new Date('2026-10-01T00:00:00.000Z'), mandate_id:'mandate', contact_id: 'contact', enrolment_state: 'approved', personal_data: { email: 'person@example.test' }, fictionalised: false }] };
        if (sql.includes('campaign_enrolments'))
            return { rows: [{ attempt_id: 'attempt', attempt_state: 'claimed', enrolment_id: 'enrolment', version_id: 'version', mandate_id:'mandate', contact_id: 'contact', step_index: 0, runtime: 'legacy', state: 'active', due: true, started_at: new Date('2026-10-01'), initial_conversation_reviewed: true, communication_initial_reviewed_at: control.reviewedAt, review_time_valid: control.reviewedAt !== null, definition: { schemaVersion: 1, steps: [{ id: '11111111-1111-4111-8111-111111111111', kind: 'whatsapp', title: 'Message', body: 'Hi {{first_name}}' }] }, display_name: 'Alex', company_name: 'Example', fictionalised: false, personal_data: { phone: '+15550000000' }, recipient_phone: '+15550000000', assigned: true, bound: control.originalBindingValid }] };
        if (sql.includes('communications_admission_person_clear'))
            return { rows: [{ clear: control.clear }] };
        if (sql.includes('communication_reply_monitors'))
            return { rows: [{ ready: control.coverage }] };
        if(sql.startsWith('INSERT INTO public.communication_intent_resolutions')){if(!resolutions.has(values[0]))resolutions.set(values[0],{intent_id:values[0],encrypted_proof:values[1],proof_key_version:values[2],proof_digest:values[3]});return {rows:[]};}
        if(sql.includes('FROM public.communication_intent_resolutions'))return {rows:resolutions.has(values[0])?[resolutions.get(values[0])!]:[]};
        if (sql.startsWith('INSERT INTO public.communication_dispatch_intents')) {
            intent = { id: values[0], organization_id: 'org', owner_user_id: 'owner', binding_id: bindingId, source_kind: values[4], source_id: values[5], epoch: values[6], operation_key: values[8], operation: values[9], payload_digest: values[10], intent_digest: values[11], encrypted_intent: values[12], intent_key_version: values[13], source_digest: values[14], required_since: values[15], coverage_scopes: values[16], contact_id: 'contact', ...(sql.includes('execution_mandate_id')?{execution_mandate_id:values[18],execution_context_digest:values[19],execution_mode:values[20]}:{}) };
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
    const release = vi.fn(), options: AcquireSendAdmissionOptions = { pool: { connect: async () => ({ query, release } as SqlClient) }, binding: selectedBinding, bindingId, codec, verifyServiceAdmission: async () => true };
    return { repo: createAcquireSendAdmission(options), calls, control, query, release, options, intents };
}
it.each(['legacy', 'n8n'] as const)('commits an immutable rendered intent before %s runtime dispatch authority exists', async (runtime) => {
    const f = fixture();
    if (runtime === 'n8n') {
        const old = f.query.getMockImplementation()!;
        f.query.mockImplementation(async (sql, v) => {
            const r = await old(sql, v);
            if (sql.includes('FROM public.messages'))
                return { rows: [{ id: 'draft', state: 'approved', subject: 'Approved subject', body: 'Approved body', updated_at: new Date('2026-10-01T00:00:00.000Z'), approved_by: 'owner', approved_at: new Date('2026-10-01T00:00:00.000Z'), mandate_id:'mandate', contact_id: 'contact', enrolment_state: 'approved', personal_data: { email: 'person@example.test' }, fictionalised: false }] };
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
it('draft preparation holds its app gate without requesting UPDATE permission on read-only enrollments',async()=>{
 const f=fixture('email'),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async(sql,values)=>{if(sql.includes('FROM public.messages')&&/FOR UPDATE OF m,e/.test(sql))throw Object.assign(Error('Synthetic actual-role enrollment permission denial'),{code:'42501'});return original(sql,values);});
 const prepared=await f.repo.prepare({source:{kind:'draft',messageId:'draft',revision:'2026-10-01T00:00:00.000Z'},message:{recipient:{kind:'email',value:'person@example.test'},subject:'Approved subject',text:'Approved body'},coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});
 expect(prepared.epoch).toBe(1);expect(f.calls.findIndex(sql=>sql.includes('communications_lock_send_gate($1)'))).toBeLessThan(f.calls.findIndex(sql=>sql.includes('FROM public.messages')));
});
it('authenticated immutable intent reads work with the approved SELECT/INSERT-only role',async()=>{
 const f=fixture(),prepared=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]}),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async(sql,values)=>{if(sql.includes('FROM public.communication_dispatch_intents')&&/FOR SHARE/.test(sql))throw Object.assign(Error('Synthetic immutable-intent UPDATE privilege denial'),{code:'42501'});return original(sql,values);});
 expect(await f.repo.getPreparedCoverage(prepared.submission.snapshot)).toEqual([{binding,scopeDigest:'a'.repeat(64)}]);
});

it('rejects a late sequence driver before preparing a new intent',async()=>{
 const f=fixture();f.control.ownershipInstalled=true;f.control.driverAllowed=false;
 await expect(f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]})).rejects.toThrow('Send authority unavailable');expect(f.intents).toHaveLength(0);
});
it('rechecks ownership at final admission after an intent was prepared',async()=>{
 const f=fixture();f.control.ownershipInstalled=true;
 const prepared=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});f.control.driverAllowed=false;
 const result=await f.repo.open({record:{snapshot:prepared.submission.snapshot,recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},new AbortController().signal);
 expect(result).toEqual({kind:'blocked',outcome:{status:'review',code:'forbidden'}});expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);
 expect(await f.repo.getPreparedIntent({sourceKind:'campaign',sourceId:source.attemptId})).toEqual(prepared);
});

it('prepares and recovers a native source through its exact operation and account',async()=>{
 const bindingId='40000000-0000-4000-8000-000000000004',f=fixture('email',bindingId),original=f.query.getMockImplementation()!;
 const native={kind:'agent' as const,operationId:'10000000-0000-4000-8000-000000000001',conversationId:'10000000-0000-4000-8000-000000000002',epoch:1,fence:'1'};
 f.query.mockImplementation(async(sql,v)=>sql.includes('agent_communications_source_kind')?{rows:[{kind:'legacy_email'}]}:sql.includes('agent_communications_source')?{rows:[{source:{contactId:'10000000-0000-4000-8000-000000000003',recipient:'person@example.test',subject:'Native subject',body:'Native body',contextDigest:'d'.repeat(64),requiredSince:'2026-10-01T00:00:00.000Z'}}]}:original(sql,v));
 const nativeQuery=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,v)=>{const result=await nativeQuery(sql,v);if(sql.startsWith('INSERT INTO public.communication_dispatch_intents'))result.rows[0].contact_id='10000000-0000-4000-8000-000000000003';return result;});
 const content={recipient:{kind:'email' as const,value:'person@example.test'},subject:'Native subject',text:'Native body'};
 const p=await f.repo.prepare({source:native,message:content,coverageScopes:[{bindingId,scopeDigest:'a'.repeat(64)}]});
 expect(p.submission.snapshot.key).toBe('acquire:agent:'+native.operationId+':1');
 expect((await f.repo.getPreparedIntent({sourceKind:'agent',sourceId:native.operationId}))?.submission).toEqual(p.submission);
});
it('native final commit rechecks current authorization without clearing cold-sequence reply holds',async()=>{
 const bindingId='40000000-0000-4000-8000-000000000004',f=fixture('email',bindingId),original=f.query.getMockImplementation()!;
 let authorised=true;
 const native={kind:'agent' as const,operationId:'10000000-0000-4000-8000-000000000001',conversationId:'10000000-0000-4000-8000-000000000002',epoch:1,fence:'1'},content={recipient:{kind:'email' as const,value:'person@example.test'},subject:'Native subject',text:'Native body'};
 f.query.mockImplementation(async(sql,v)=>{
  if(sql.includes('agent_communications_source_kind'))return {rows:[{kind:'legacy_email'}]};
  if(sql.includes('agent_communications_source'))return {rows:[{source:authorised?{contactId:'10000000-0000-4000-8000-000000000003',recipient:'person@example.test',subject:content.subject,body:content.text,contextDigest:'d'.repeat(64),requiredSince:'1970-01-01T00:00:00.000Z'}:null}]};
  const result=await original(sql,v);if(sql.startsWith('INSERT INTO public.communication_dispatch_intents'))result.rows[0].contact_id='10000000-0000-4000-8000-000000000003';return result;
 });
 const prepared=await f.repo.prepare({source:native,message:content,coverageScopes:[{bindingId,scopeDigest:'a'.repeat(64)}]});
 f.control.clear=false; // A verified native reply uses its stricter native guard, never clears this old hold.
 const held=await f.repo.open({record:{snapshot:prepared.submission.snapshot,recipient:content.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},new AbortController().signal);
 expect(held.kind).toBe('held');if(held.kind!=='held')throw Error('Expected held native authority');
 authorised=false;
 await expect(held.permit.commit({permitId:held.permit.permitId,intentDigest:held.permit.intentDigest,journalId:'journal-native',admissionId:'native-admission',snapshot:prepared.submission.snapshot,fencingToken:'1',serviceRevision:'1'},new AbortController().signal)).rejects.toThrow();
 expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);
 // Original snapshot recovery does not require still-active owner/history/window.
 expect(await f.repo.getPreparedIntent({sourceKind:'agent',sourceId:native.operationId})).toEqual(prepared);
});

it.each(['whatsapp','linkedin'] as const)('admits an exact reviewed %s route and rechecks it before the final write',async channel=>{
 const bindingId='40000000-0000-4000-8000-000000000004',f=fixture(channel,bindingId),original=f.query.getMockImplementation()!;
 const recipient=channel==='whatsapp'?{kind:'phone' as const,value:'+15550000000'}:{kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/recorded-peer'};
 const native={kind:'agent' as const,operationId:'10000000-0000-4000-8000-000000000001',conversationId:'10000000-0000-4000-8000-000000000002',epoch:1,fence:'1'};
 const proof={contactId:'10000000-0000-4000-8000-000000000003',routeId:'20000000-0000-4000-8000-000000000002',channel,recipient,subject:'',body:'Reviewed contextual answer',contextDigest:'d'.repeat(64),requiredSince:'1970-01-01T00:00:00.000Z',replyParent:null,conversation:{id:'verified-existing-chat'},coverageRoutes:[{bindingId,channel,recipient}]};
 let authorised=true;
 f.query.mockImplementation(async(sql,v)=>{
  if(sql.includes('agent_communications_source_kind'))return {rows:[{kind:'recorded_channel'}]};
  if(sql.includes('agent_channel_communications_source'))return {rows:[{source:authorised?proof:null}]};
  const result=await original(sql,v);if(sql.startsWith('INSERT INTO public.communication_dispatch_intents'))result.rows[0].contact_id=proof.contactId;return result;
 });
 const content={recipient,text:proof.body,conversation:{binding:f.options.binding,id:'verified-existing-chat'}};
 const prepared=await f.repo.prepare({source:native,message:content,coverageScopes:[{bindingId,scopeDigest:'a'.repeat(64)}]});
 expect(prepared.submission.message).toEqual(content);
 const held=await f.repo.open({record:{snapshot:prepared.submission.snapshot,recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},new AbortController().signal);
 expect(held.kind).toBe('held');if(held.kind!=='held')throw Error('Expected held reviewed route');authorised=false;
 await expect(held.permit.commit({permitId:held.permit.permitId,intentDigest:held.permit.intentDigest,journalId:'journal',admissionId:'admission',snapshot:prepared.submission.snapshot,fencingToken:'1',serviceRevision:'1'},new AbortController().signal)).rejects.toThrow();
 expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);
 expect(await f.repo.getPreparedIntent({sourceKind:'agent',sourceId:native.operationId})).toEqual(prepared);
});
it('seals an explicitly reviewed LinkedIn invitation as a separate durable effect',async()=>{
 const bindingId='40000000-0000-4000-8000-000000000004',f=fixture('linkedin',bindingId),original=f.query.getMockImplementation()!,recipient={kind:'linkedin_profile' as const,value:'https://www.linkedin.com/in/recorded-peer'};
 const source={kind:'agent' as const,effect:'invitation' as const,operationId:'10000000-0000-4000-8000-000000000001',conversationId:'10000000-0000-4000-8000-000000000002',epoch:1,fence:'1'};
 const proof={effect:'invitation',contactId:'10000000-0000-4000-8000-000000000003',routeId:'20000000-0000-4000-8000-000000000002',channel:'linkedin',recipient,subject:'',body:'Reviewed invitation note',contextDigest:'d'.repeat(64),requiredSince:'1970-01-01T00:00:00.000Z',replyParent:null,conversation:null,coverageRoutes:[{bindingId,channel:'linkedin',recipient}]};
 f.query.mockImplementation(async(sql,v)=>{if(sql.includes('agent_communications_source_kind'))return{rows:[{kind:'recorded_channel'}]};if(sql.includes('agent_channel_communications_source'))return{rows:[{source:proof}]};const result=await original(sql,v);if(sql.startsWith('INSERT INTO public.communication_dispatch_intents'))result.rows[0].contact_id=proof.contactId;return result;});
 const prepared=await f.repo.prepare({source,message:{recipient,text:proof.body},coverageScopes:[{bindingId,scopeDigest:'a'.repeat(64)}]});
 expect(prepared.submission.snapshot.operation).toBe('invitation');expect(prepared.submission.message).toEqual({recipient,text:proof.body});expect(f.calls.some(sql=>sql.includes('campaign_sequence_versions'))).toBe(false);
});
it('records authenticated original no-submission proof without fresh source checks or another intent epoch',async()=>{
 const f=fixture(),first=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]}),prove=vi.fn(async()=>({snapshot:first.submission.snapshot,journalId:'original-journal',outcome:{status:'waiting',code:'rate_limited'},evidenceDigest:'b'.repeat(64),keyVersion:'service-proof'})),repo=createAcquireSendAdmission({...f.options,proveNoSubmission:prove});f.control.clear=false;f.control.driverAllowed=false;f.calls.length=0;
 expect(await repo.resolveNoSubmission!(first.submission.snapshot)).toMatchObject({intentId:first.intentId,operationKey:first.submission.snapshot.key,proofDigest:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(f.intents).toHaveLength(1);expect(f.calls.some(sql=>sql.includes('campaign_enrolments')||sql.includes('communication_reply_monitors'))).toBe(false);expect(prove).toHaveBeenCalledTimes(1);
});
it('does not resolve a missing receipt, mismatched journal scope or an unknown/submitted outcome',async()=>{
 for(const bad of ['missing','unknown','submitted','different-account']){const f=fixture(),first=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]}),prove=vi.fn(async()=>bad==='missing'?null:{snapshot:bad==='different-account'?{...first.submission.snapshot,binding:{...first.submission.snapshot.binding,accountId:'other'}}:first.submission.snapshot,journalId:'original-journal',outcome:{status:bad==='different-account'?'waiting':bad},evidenceDigest:'b'.repeat(64),keyVersion:'service-proof'}),repo=createAcquireSendAdmission({...f.options,proveNoSubmission:prove});if(bad==='missing')expect(await repo.resolveNoSubmission!(first.submission.snapshot)).toBeNull();else await expect(repo.resolveNoSubmission!(first.submission.snapshot)).rejects.toThrow('Send authority');expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_intent_resolutions'))).toBe(false);}
});
it('replays only an authenticated immutable no-submission proof and rejects corrupted metadata',async()=>{
 const f=fixture(),first=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]}),prove=vi.fn(async()=>({snapshot:first.submission.snapshot,journalId:'original-journal',outcome:{status:'waiting',code:'busy'},evidenceDigest:'b'.repeat(64),keyVersion:'service-proof'})),repo=createAcquireSendAdmission({...f.options,proveNoSubmission:prove});
 const original=await repo.resolveNoSubmission!(first.submission.snapshot);expect(await repo.resolveNoSubmission!(first.submission.snapshot)).toEqual(original);expect(prove).toHaveBeenCalledTimes(1);const old=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,values)=>{const result=await old(sql,values);return sql.includes('FROM public.communication_intent_resolutions')?{rows:result.rows.map(row=>({...row,proof_digest:'f'.repeat(64)}))}:result;});await expect(repo.resolveNoSubmission!(first.submission.snapshot)).rejects.toThrow('Send authority');expect(prove).toHaveBeenCalledTimes(1);
});
it('does not persist a service no-submission proof after original membership is revoked',async()=>{
 const f=fixture(),first=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]}),repo=createAcquireSendAdmission({...f.options,proveNoSubmission:async()=>{f.control.member=false;return {snapshot:first.submission.snapshot,journalId:'original-journal',outcome:{status:'waiting',code:'busy'},evidenceDigest:'b'.repeat(64),keyVersion:'service-proof'};}});f.calls.length=0;await expect(repo.resolveNoSubmission!(first.submission.snapshot)).rejects.toThrow('Send authority');expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_intent_resolutions'))).toBe(false);
});
it('reports only bounded server diagnostic stage and serialization SQLSTATE while preserving rejection and zero intent writes',async()=>{
 const f=fixture(),original=f.query.getMockImplementation()!,diagnostic=vi.fn();f.query.mockImplementation(async(sql,values)=>{if(sql.includes('communication_bindings'))throw Object.assign(Error('secret provider/body/account details'),{code:'40001',detail:'secret'});return original(sql,values);});
 const repo=createAcquireSendAdmission({...f.options,diagnostic}as never);await expect(repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]})).rejects.toThrow('Send authority unavailable');
 expect(diagnostic).toHaveBeenCalledWith({stage:'application.binding',outcome:'error',sqlState:'40001'});expect(JSON.stringify(diagnostic.mock.calls)).not.toContain('secret');expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_dispatch_intents'))).toBe(false);
});
it.each(['40001','55P03'])('retries only known-rollback bootstrap%s at most ten times with bounded backoff and fresh authority',async code=>{
 const f=fixture(),old=f.query.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect');let conflicts=0;f.query.mockImplementation(async(sql,v)=>{if(sql.startsWith('SELECT public.communications_lock_send_gate')&&conflicts++<4)throw Object.assign(Error('serialization'),{code});return old(sql,v);});
 const repo=createAcquireSendAdmission(f.options);expect(await repo.getPreparedIntent({sourceKind:'agent',sourceId:'missing'})).toBeNull();expect(connect).toHaveBeenCalledTimes(5);expect(f.calls.filter(s=>s==='BEGIN ISOLATION LEVEL SERIALIZABLE')).toHaveLength(5);expect(f.calls.filter(s=>s==='ROLLBACK')).toHaveLength(4);expect(f.release).toHaveBeenCalledWith(expect.any(Error));
 const all=fixture(),prior=all.query.getMockImplementation()!,connectAll=vi.spyOn(all.options.pool,'connect');all.query.mockImplementation(async(sql,v)=>{if(sql.startsWith('SELECT public.communications_lock_send_gate'))throw Object.assign(Error('serialization'),{code});return prior(sql,v);});await expect(createAcquireSendAdmission(all.options).getPreparedIntent({sourceKind:'agent',sourceId:'missing'})).rejects.toThrow('Send authority unavailable');expect(connectAll).toHaveBeenCalledTimes(10);expect(all.calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);
});
it.each(['40001','55P03'])('never retries unclassified errors, post-bootstrap %s, COMMIT uncertainty or cancellation',async code=>{
 for(const boundary of ['other-code','after-bootstrap','commit','cancel']as const){const f=fixture(),old=f.query.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect'),controller=new AbortController();f.query.mockImplementation(async(sql,v)=>{const fail=boundary==='other-code'||boundary==='cancel'?sql.startsWith('SELECT public.communications_lock_send_gate'):boundary==='commit'?sql==='COMMIT':sql.includes('FROM public.communication_dispatch_intents');if(fail){if(boundary==='cancel')controller.abort();throw Object.assign(Error('private'),{code:boundary==='other-code'?'40P01':code});}return old(sql,v);});const repo=createAcquireSendAdmission(f.options);if(boundary==='cancel')expect(await repo.open({record:{snapshot:{binding,key:'original',operation:'message',payloadDigest:'a'.repeat(64)},recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},controller.signal)).toMatchObject({kind:'blocked'});else await expect(repo.getPreparedIntent({sourceKind:'agent',sourceId:'missing'})).rejects.toThrow('Send authority unavailable');expect(connect,boundary).toHaveBeenCalledTimes(1);expect(f.calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);}
});
it('retains one absolute bootstrap deadline across serialization attempts',async()=>{
 const f=fixture(),old=f.query.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect');f.query.mockImplementation(async(sql,v)=>{if(sql.startsWith('SELECT public.communications_lock_send_gate')){await new Promise(r=>setTimeout(r,18));throw Object.assign(Error('serialization'),{code:'40001'});}return old(sql,v);});await expect(createAcquireSendAdmission({...f.options,timeoutMs:30}).getPreparedIntent({sourceKind:'agent',sourceId:'missing'})).rejects.toThrow('Send authority unavailable');expect(connect.mock.calls.length).toBeLessThanOrEqual(2);
});

it('never retries after rollback uncertainty even when bootstrap failed with40001',async()=>{
 const f=fixture(),old=f.query.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect');f.query.mockImplementation(async(sql,v)=>{if(sql.startsWith('SELECT public.communications_lock_send_gate'))throw Object.assign(Error('serialization'),{code:'40001'});if(sql==='ROLLBACK')throw Error('Rollback outcome unavailable');return old(sql,v);});await expect(createAcquireSendAdmission(f.options).getPreparedIntent({sourceKind:'agent',sourceId:'missing'})).rejects.toThrow('Send authority unavailable');expect(connect).toHaveBeenCalledTimes(1);expect(f.calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);
});
it('waits before fresh bootstrap and cancellation during backoff never opens another session',async()=>{
 const f=fixture(),old=f.query.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect'),controller=new AbortController();let lastRollback=0;f.query.mockImplementation(async(sql,v)=>{if(sql.startsWith('SELECT public.communications_lock_send_gate'))throw Object.assign(Error('serialization'),{code:'40001'});if(sql==='ROLLBACK'){lastRollback=performance.now();setTimeout(()=>controller.abort(),5);}return old(sql,v);});expect(await createAcquireSendAdmission(f.options).open({record:{snapshot:{binding,key:'original',operation:'message',payloadDigest:'a'.repeat(64)},recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},controller.signal)).toMatchObject({kind:'blocked'});expect(connect).toHaveBeenCalledTimes(1);expect(lastRollback).toBeGreaterThan(0);
});

it.each(['campaign','draft'] as const)('denies a demo-origin %s before creating any intent, even over genuine real contact data',async kind=>{const f=fixture(kind==='draft'?'email':'whatsapp');f.control.manualDemo=true;const selected=kind==='campaign'?source:{kind:'draft' as const,messageId:'draft',revision:'2026-10-01T00:00:00.000Z'},body=kind==='campaign'?message:{recipient:{kind:'email' as const,value:'person@example.test'},subject:'Approved subject',text:'Approved body'};await expect(f.repo.prepare({source:selected,message:body,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]})).rejects.toThrow();expect(f.intents).toHaveLength(0);});
it('blocks new physical authority after an origin-mode denial but retains original lookup bytes',async()=>{const f=fixture(),prepared=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});f.control.manualDemo=true;expect(await f.repo.getPreparedIntent({sourceKind:'campaign',sourceId:source.attemptId})).toEqual(prepared);expect((await f.repo.open({record:{snapshot:prepared.submission.snapshot,recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},new AbortController().signal)).kind).toBe('blocked');expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);});
it('seals server-loaded execution context for new intents and rechecks it at final admission without calling the loader for original lookup',async()=>{
 const bindingId='11111111-1111-4111-8111-111111111112',attemptId='11111111-1111-4111-8111-111111111113',contactId='11111111-1111-4111-8111-111111111114',mandateId='11111111-1111-4111-8111-111111111115',f=fixture('whatsapp',bindingId),selected={...source,attemptId},old=f.query.getMockImplementation()!;
 f.query.mockImplementation(async(sql,v)=>{const r=await old(sql,v);if(sql.includes('campaign_enrolments')){r.rows[0].attempt_id=attemptId;r.rows[0].contact_id=contactId;}if(sql.startsWith('INSERT INTO public.communication_dispatch_intents'))r.rows[0].contact_id=contactId;return r;});
 const context={version:1 as const,origin:{kind:'campaign' as const,sourceId:attemptId,mandateId},mode:'real' as const,identityScope:{kind:'organization' as const,id:'org'},contact:{sourceId:contactId,sourceRevision:'123',sourceFingerprint:'a'.repeat(64),effectiveRecipients:{whatsapp:message.recipient.value}},mapping:null,allowedBindings:[{id:bindingId,digest:acquireSourceDigest(binding),generation:binding.generation,channel:binding.channel}],policyDigest:'a'.repeat(64),manifestDigest:'b'.repeat(64)};
 context.manifestDigest=acquireSourceDigest(Object.fromEntries(Object.entries(context).filter(([key])=>key!=='manifestDigest')));
 const loadExecutionContext=vi.fn(async()=>structuredClone(context)),repo=createAcquireSendAdmission({...f.options,loadExecutionContext}),prepared=await repo.prepare({source:selected,message,coverageScopes:[{bindingId,scopeDigest:'a'.repeat(64)}]});
 expect(f.intents[0]).toMatchObject({execution_mandate_id:mandateId,execution_context_digest:context.manifestDigest,execution_mode:'real'});
 const encoded=JSON.parse(f.intents[0].encrypted_intent as string);expect(codec.decode(prepared.submission.snapshot,'context',encoded)).toMatchObject({domain:'acquire.dispatch-intent.v2',executionContext:context});
 loadExecutionContext.mockClear();expect(await repo.getPreparedIntent({sourceKind:'campaign',sourceId:attemptId})).toEqual(prepared);expect(loadExecutionContext).not.toHaveBeenCalled();
 const originalDigest=f.intents[0].execution_context_digest;f.intents[0].execution_context_digest='f'.repeat(64);await expect(repo.getPreparedIntent({sourceKind:'campaign',sourceId:attemptId})).rejects.toThrow('Send authority unavailable');f.intents[0].execution_context_digest=originalDigest;f.intents[0].execution_mode='demo';await expect(repo.getPreparedIntent({sourceKind:'campaign',sourceId:attemptId})).rejects.toThrow('Send authority unavailable');f.intents[0].execution_mode='real';
 context.policyDigest='c'.repeat(64);context.manifestDigest=acquireSourceDigest(Object.fromEntries(Object.entries(context).filter(([key])=>key!=='manifestDigest')));expect((await repo.open({record:{snapshot:prepared.submission.snapshot,recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},new AbortController().signal)).kind).toBe('blocked');expect(f.calls.some(s=>s.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);
});
it.each(['campaign','draft']as const)('preserves explicit NULL-origin ordinary %s as conservative v1 without inventing a contact mandate',async kind=>{const f=fixture(kind==='draft'?'email':'whatsapp'),old=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,v)=>{const r=await old(sql,v);if(sql.includes(kind==='draft'?'FROM public.messages':'campaign_enrolments'))r.rows[0].mandate_id=null;return r;});const loadExecutionContext=vi.fn(async()=>{throw Error('No mandate to load');}),repo=createAcquireSendAdmission({...f.options,loadExecutionContext}),selected=kind==='draft'?{kind:'draft' as const,messageId:'draft',revision:'2026-10-01T00:00:00.000Z'}:source,body=kind==='draft'?{recipient:{kind:'email' as const,value:'person@example.test'},subject:'Approved subject',text:'Approved body'}:message;const prepared=await repo.prepare({source:selected,message:body,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});expect(loadExecutionContext).not.toHaveBeenCalled();expect(f.intents[0].execution_mandate_id).toBeUndefined();expect(codec.decode(prepared.submission.snapshot,'context',JSON.parse(f.intents[0].encrypted_intent as string))).toMatchObject({domain:'acquire.dispatch-intent.v1'});expect(await repo.getPreparedIntent({sourceKind:kind,sourceId:kind==='draft'?'draft':'attempt'})).toEqual(prepared);});

it('includes the first exact owned account read in rollback-known bootstrap before intent reads',async()=>{
 const f=fixture(),old=f.query.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect');let conflicts=0;
 f.query.mockImplementation(async(sql,v)=>{if(sql.includes('FROM public.communication_bindings')&&conflicts++===0)throw Object.assign(Error('private account detail'),{code:'40001'});return old(sql,v);});
 expect(await createAcquireSendAdmission(f.options).getPreparedIntent({sourceKind:'agent',sourceId:'missing'})).toBeNull();
 expect(connect).toHaveBeenCalledTimes(2);expect(f.calls.filter(s=>s==='ROLLBACK')).toHaveLength(1);
 expect(f.calls.filter(s=>s.includes('communications_lock_send_member'))).toHaveLength(2);
 expect(f.query.mock.calls.filter(([s])=>s.includes('FROM public.communication_dispatch_intents'))).toHaveLength(1);
 expect(f.calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);
});

it('never retries later coverage account reads after source validation',async()=>{
 const f=fixture(),old=f.query.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect');let bindings=0;
 f.query.mockImplementation(async(sql,v)=>{if(sql.includes('FROM public.communication_bindings')&&++bindings===3)throw Object.assign(Error('private'),{code:'40001'});return old(sql,v);});
 await expect(createAcquireSendAdmission(f.options).prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]})).rejects.toThrow('Send authority unavailable');
 expect(connect).toHaveBeenCalledTimes(2);expect(bindings).toBe(3);expect(f.calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);
});
it('revalidates current account ownership after a binding bootstrap rollback',async()=>{
 const f=fixture(),old=f.query.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect');let reads=0;
 f.query.mockImplementation(async(sql,v)=>{if(sql.includes('FROM public.communication_bindings')){if(reads++===0)throw Object.assign(Error('private'),{code:'40001'});return {rows:[]};}return old(sql,v);});
 await expect(createAcquireSendAdmission(f.options).getPreparedIntent({sourceKind:'agent',sourceId:'missing'})).rejects.toThrow('Send authority unavailable');
 expect(connect).toHaveBeenCalledTimes(2);expect(f.query.mock.calls.some(([s])=>s.includes('FROM public.communication_dispatch_intents'))).toBe(false);
});

it('explains a final coverage revision gap with bounded predicate diagnostics while keeping admission blocked and private data absent',async()=>{
 const f=fixture(),original=f.query.getMockImplementation()!,trace=vi.spyOn(console,'info').mockImplementation(()=>{});
 vi.stubEnv('AGENT_VERBOSE_LOGGING','true');
 try {
  f.query.mockImplementation(async(sql,values)=>sql.includes('communication_reply_monitors')?{rows:[{ready:false,matched_scope_rows:0,coverage_diagnostics:{scopeRows:1,monitorRows:1,checkpointRows:1,allComplete:true,allInitialSync:true,anyInvalidated:false,allCoverRequiredSince:true,allCoverageFresh:true,allObservedFresh:true,allTimestampsOrdered:true,allRevisionsCurrent:false,minCheckpointRevision:'41',maxCheckpointRevision:'41',oldestCoverageAgeSeconds:2.5,oldestObservedAgeSeconds:2,privateContact:'PRIVATE person@example.invalid',providerBody:'PRIVATE body',credential:'PRIVATE token'}}]}:original(sql,values));
  const p=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});
  expect(await f.repo.open({record:{snapshot:p.submission.snapshot,recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'42'},new AbortController().signal)).toEqual({kind:'blocked',outcome:{status:'waiting',code:'incomplete'}});
  const log=trace.mock.calls.find(([tag])=>tag==='communications-admission');
  expect(log).toBeDefined();
  expect(JSON.parse(String(log![1]))).toMatchObject({event:'coverage_blocked',module:'communications.application_admission',intentId:p.intentId,expectedScopes:1,matchedScopeRows:0,requiredServiceRevision:'42',maxAgeSeconds:300,predicates:{allRevisionsCurrent:false,allCoverageFresh:true,allComplete:true,minCheckpointRevision:'41',oldestCoverageAgeSeconds:2.5}});
  const printed=JSON.stringify(trace.mock.calls);expect(printed).not.toMatch(/PRIVATE|person@example|Hi Alex|15550000000/);
  expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);
 } finally {trace.mockRestore();vi.unstubAllEnvs();}
});
it.each(['disabled','throwing'] as const)('keeps final coverage rejection unchanged when diagnostic logging is %s',async mode=>{
 const f=fixture(),trace=vi.spyOn(console,'info').mockImplementation(()=>{if(mode==='throwing')throw Error('Private sink failure');});
 vi.stubEnv('AGENT_VERBOSE_LOGGING',mode==='disabled'?'false':'true');
 try{
  const p=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});f.control.coverage=false;
  expect(await f.repo.open({record:{snapshot:p.submission.snapshot,recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},new AbortController().signal)).toEqual({kind:'blocked',outcome:{status:'waiting',code:'incomplete'}});
  if(mode==='disabled')expect(trace).not.toHaveBeenCalled();else expect(trace).toHaveBeenCalledTimes(1);
  expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);
 }finally{trace.mockRestore();vi.unstubAllEnvs();}
});

it.each(['stale revision','missing checkpoint'] as const)('final held admission rejects %s even after advisory scope preparation',async reason=>{
 const f=fixture(),original=f.query.getMockImplementation()!;
 f.query.mockImplementation(async(sql,values)=>{
  if(sql.includes('communication_reply_monitors')){
   expect(sql).toContain('p.observed_service_revision>=$7::bigint');
   expect(values?.[6]).toBe('8186');
   // PostgreSQL evaluates the exact sealed vector against the service-held
   // revision; earlier advisory hints never substitute for this decision.
   return {rows:[{ready:false,matched_scope_rows:reason==='missing checkpoint'?0:1}]};
  }
  return original(sql,values);
 });
 const prepared=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});
 const result=await f.repo.open({record:{snapshot:prepared.submission.snapshot,recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'8186'},new AbortController().signal);
 expect(result).toEqual({kind:'blocked',outcome:{status:'waiting',code:'incomplete'}});
 expect(f.calls.some(sql=>sql.startsWith('INSERT INTO public.communication_dispatch_permits'))).toBe(false);
});
it('logs an exact intent workflow guard rejection without leaking SQL or changing the public preparation error',async()=>{
 const f=fixture(),original=f.query.getMockImplementation()!,log=vi.spyOn(console,'warn').mockImplementation(()=>{});
 f.query.mockImplementation(async(sql,values)=>{if(sql.startsWith('INSERT INTO public.communication_dispatch_intents'))throw Object.assign(Error('Exact active outreach workflow required for new dispatch'),{code:'P0001',detail:'PRIVATE SQL body recipient@example.invalid'});return original(sql,values);});
 try{
  const repo=createAcquireSendAdmission(f.options as never);await expect(repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]})).rejects.toThrow('Send authority unavailable');
  const events=log.mock.calls.filter(call=>call[0]==='communications-admission-failure').map(call=>JSON.parse(call[1] as string));
  expect(events).toContainEqual(expect.objectContaining({stage:'application.intent',category:'workflow_dispatch_guard_rejected',sqlState:'P0001',submission:'not_attempted_by_this_prepare',automaticResend:false}));
  expect(JSON.stringify(events)).not.toMatch(/PRIVATE|recipient@|Exact active/);expect(f.query.mock.calls.filter(([sql])=>sql.startsWith('INSERT INTO public.communication_dispatch_intents'))).toHaveLength(1);
 }finally{log.mockRestore();}
});
it('accepts an authenticated terminal prewrite review proof through existing resolution without preparing a replacement',async()=>{
 const f=fixture(),first=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});
 // Service owns the quota/boundary verification; the application receives the
 // unchanged authenticated proof contract, not an untrusted quota flag.
 const prove=vi.fn(async()=>({snapshot:first.submission.snapshot,journalId:'original-instrumented-journal',outcome:{status:'review',code:'protocol'},evidenceDigest:'b'.repeat(64),keyVersion:'service-proof'}));
 const repo=createAcquireSendAdmission({...f.options,proveNoSubmission:prove});f.calls.length=0;
 const resolution=await repo.resolveNoSubmission!(first.submission.snapshot);expect(resolution).toMatchObject({intentId:first.intentId,operationKey:first.submission.snapshot.key});expect(await repo.resolveNoSubmission!(first.submission.snapshot)).toEqual(resolution);expect(f.intents).toHaveLength(1);expect(f.calls.some(sql=>sql.includes('quota_buckets'))).toBe(false);
});

it.each([true,false])('sets actor and optional runtime scope in one statement before authority locks (registered=%s)',async registered=>{
 vi.stubEnv('AGENT_WORKER_SCOPE_MODE',registered?'registered':'global');vi.stubEnv('AGENT_WORKER_RUNTIME_ID','hosted-session-test');
 try{
  const f=fixture();await expect(f.repo.getPreparedIntent({sourceKind:'agent',sourceId:'operation'})).resolves.toBeNull();
  const settings=f.query.mock.calls.filter(([sql])=>sql.includes('set_config'));
  expect(settings).toHaveLength(1);
  expect(settings[0][0]).toContain("set_config('app.acquire_org',$3,true)");
  expect(settings[0][1]?.slice(2,4)).toEqual(['org','owner']);
  if(registered){expect(settings[0][0]).toContain("set_config('app.acquire_runtime_id',$5,true)");expect(settings[0][1]?.slice(4)).toEqual(['hosted-session-test','false']);}
  else{expect(settings[0][0]).not.toContain('app.acquire_runtime_id');expect(settings[0][1]).toHaveLength(4);}
  expect(f.calls[0]).toBe('BEGIN ISOLATION LEVEL SERIALIZABLE');
  expect(f.calls.indexOf('SET LOCAL ROLE acquire_campaign_user')).toBeLessThan(f.calls.indexOf(settings[0][0]));
  expect(f.calls.findIndex(sql=>sql.includes('pg_roles'))).toBeLessThan(f.calls.indexOf(settings[0][0]));
  expect(f.calls.indexOf(settings[0][0])).toBeLessThan(f.calls.findIndex(sql=>sql.includes('communications_lock_send_gate')));
  expect(f.calls.some(sql=>sql.includes('communications_lock_send_member'))).toBe(true);
  expect(f.calls.at(-1)).toBe('COMMIT');
 }finally{vi.unstubAllEnvs();}
});
it('uses the explicit held-session budget only for open and never renews it at permit creation',async()=>{
 const f=fixture(),p=await f.repo.prepare({source,message,coverageScopes:[{bindingId:'binding',scopeDigest:'a'.repeat(64)}]});
 vi.useFakeTimers();try{
 const original=f.query.getMockImplementation()!;let delay=true;f.query.mockImplementation(async(sql,args)=>{if(delay&&sql.includes('FROM public.communication_dispatch_intents')){delay=false;await new Promise(r=>setTimeout(r,25000));}return original(sql,args);});
 const repo=createAcquireSendAdmission({...f.options,heldSessionTimeoutMs:45000});
 const pending=repo.open({record:{snapshot:p.submission.snapshot,recipient:message.recipient,state:'claimed'},claimToken:'claim',serviceRevision:'1'},new AbortController().signal);
 await vi.advanceTimersByTimeAsync(25000);const held=await pending;expect(held.kind).toBe('held');if(held.kind!=='held')throw Error('Expected held');
 await vi.advanceTimersByTimeAsync(20001);expect(f.release).toHaveBeenLastCalledWith(expect.any(Error));
 await expect(held.permit.commit({permitId:held.permit.permitId,intentDigest:held.permit.intentDigest,journalId:'journal',admissionId:'admission',snapshot:p.submission.snapshot,fencingToken:'1',serviceRevision:'1'},new AbortController().signal)).rejects.toThrow();
 }finally{vi.useRealTimers();}
});
