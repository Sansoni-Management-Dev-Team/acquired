import { expect, it, vi } from 'vitest';
import { createPostgresDispatchJournal } from './dispatch-journal';
import { JournalCodec } from '../../core/src/journal-codec';
import type { SqlClient, SqlResult } from './webhook-repository';
const b = { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' } as const;
const snapshot = { binding: b, key: 'epoch-1', operation: 'message', payloadDigest: 'a'.repeat(64) } as const, recipient = { kind: 'phone', value: '+15550000000' } as const;
const codec = new JournalCodec({ activeVersion: 'admission-codec', keys: [{ version: 'admission-codec', encryptionKey: Buffer.alloc(32, 71), digestKey: Buffer.alloc(32, 72) }] });
function fixture(rolling = false) {
    const release = vi.fn(), control = { lostServiceCommit: false, quotaExhausted: false, rollingBlocked: false };
    const calls: string[] = [], ctx = { recipient }, envelope = codec.encode(snapshot, 'context', ctx);
    let row: Record<string, unknown> = { id: 'journal', application_id: 'acquire', tenant_id: 'org', owner_id: 'owner', operation_key: snapshot.key, connection_id: 'connection', generation: 1, account_id: 'physical', operation: 'message', payload_digest: snapshot.payloadDigest, recipient_digest: 'b'.repeat(64), recipient_key_version: 'recipient-v1', digest_version: 'message-v1', encrypted_operation_context: JSON.stringify(envelope), operation_context_key_version: codec.keyVersion, operation_context_digest: codec.digest(snapshot, 'context', ctx), state: 'claimed', claim_token: 'claim', claim_until: new Date(Date.now() + 60000), fencing_token: '1', lease_owner_token: 'worker', quota_reserved: false, encrypted_receipt: null, receipt_key_version: null, outcome_status: null, encrypted_outcome: null, outcome_key_version: null, submitted_at: null, delivered_at: null, read_at: null, claim_alive: true };
    const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<SqlResult> => {
        calls.push(sql);
        if (sql.startsWith('WITH policy_clock'))
            return { rows: [{ policy_valid: true, unresolved: false, rolling_ready: !control.rollingBlocked, spacing_ready: true, observed_at: '2026-10-14T09:00:00.000Z', retry_at: control.rollingBlocked ? '2026-10-14T09:01:00.000Z' : null }] };
        if (sql === 'COMMIT' && control.lostServiceCommit)
            throw Error('synthetic lost service commit');
        if (sql.startsWith('UPDATE communications.operation_journal')) {
            row = { ...row, state: 'dispatching', quota_reserved: true };
            return { rows: [row] };
        }
        if (sql.includes('pg_roles'))
            return { rows: [{ role_name: 'communications_control', rolsuper: false, rolbypassrls: false, rolcanlogin: false }] };
        if (sql.includes('lock_reply_barrier') || sql.includes('assert_dispatch_reply_barrier'))
            return { rows: [{ revision: '1' }] };
        if (sql.includes('to_regclass'))
            return { rows: [{ present: true }] };
        if (sql.includes('connection_generations'))
            return { rows: [{ connection_id: 'connection', application_id: 'acquire', tenant_id: 'org', owner_id: 'owner', channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile', current_generation: 1, current_account_id: 'physical', active: true, status: 'connected', generation: 1, account_id: 'physical', integration_id: 'integration', provider_api_version: 'v1', provider_configuration_reference: 'config', authority: 'service' }] };
        if (sql.includes('physical_accounts'))
            return { rows: [{ id: 'physical', channel: 'whatsapp', verified_at: new Date(Date.now() - 1000) }] };
        if (sql.includes('access_grants'))
            return { rows: [{ application_id: 'acquire', tenant_id: 'org', owner_id: 'owner' }] };
        if (sql.includes('event_cursors'))
            return { rows: [{ ready: true }] };
        if (sql.includes('account_leases'))
            return { rows: [{ account_id: 'physical', owner_token: 'worker', fencing_token: '1', alive: true }] };
        if (sql.includes('FROM communications.operation_journal'))
            return { rows: [row] };
        if (sql.startsWith('INSERT INTO communications.quota_buckets'))
            return { rows: control.quotaExhausted ? [] : [{ used: 1 }] };
        if (sql.startsWith('INSERT INTO communications.dispatch_admissions'))
            return { rows: [{ id: values[0] }] };
        return { rows: [] };
    });
    const commit = vi.fn(async () => { calls.push('APP COMMIT'); return 'committed' as const; }), abort = vi.fn(async () => { }), open = vi.fn(async () => ({ kind: 'held' as const, permit: { permitId: 'permit', intentDigest: 'c'.repeat(64), coverageScopes: [{ binding: b, recipient, scopeDigest: 'd'.repeat(64), requiredSince: '2026-10-01T00:00:00.000Z' }], commit, abort } }));
    const assertCoverage = vi.fn(async () => { });
    const repo = createPostgresDispatchJournal({ pool: { connect: async () => ({ query, release } as SqlClient) }, binding: b, integrationId: 'integration', providerConfigurationReference: 'config', providerApiVersion: 'v1', authority: 'service', leaseOwnerToken: 'worker', codec, recipientDigest: { keyVersion: 'recipient-v1', digest: () => 'b'.repeat(64) }, admission: { application: { open }, coverage: { assertCoverage }, quota: { account: { hour: 10, day: 50, ...(rolling ? { rollingDay: 50, minimumSpacingSeconds: 60 } : {}) }, application: { hour: 20, day: 100 } } } });
    return { repo, calls, commit, open, query, release, abort, control, assertCoverage, input: { token: 'claim', record: { snapshot, recipient, state: 'claimed' as const } } };
}
it('configured journal charges quotas/CAS and service COMMIT before definite application COMMIT', async () => { const f = fixture(); expect((await f.repo.beginDispatch(f.input)).kind).toBe('admitted'); expect(f.calls.filter(s => s.startsWith('INSERT INTO communications.quota_buckets'))).toHaveLength(4); expect(f.calls.indexOf('COMMIT')).toBeLessThan(f.calls.indexOf('APP COMMIT')); expect(f.commit).toHaveBeenCalledOnce(); });
it('lost definite application COMMIT is uncertain and never recharges or readmits', async () => { const f = fixture(); f.commit.mockRejectedValueOnce(Error('private lost app commit')); expect(await f.repo.beginDispatch(f.input)).toEqual({ kind: 'uncertain' }); expect(f.calls.some(s => s.startsWith('UPDATE communications.operation_journal'))).toBe(true); await expect(f.repo.beginDispatch(f.input)).rejects.toThrow('Dispatch journal unavailable'); expect(f.calls.filter(s => s.startsWith('INSERT INTO communications.quota_buckets'))).toHaveLength(4); });
it('captures the application open method once before config can substitute a different callback', async () => { const f = fixture(); let reads = 0; const original = f.open; const changed = vi.fn(async () => ({ kind: 'blocked' as const, outcome: { status: 'review' as const, code: 'forbidden' } })); const application = Object.defineProperty({}, 'open', { get() { reads++; return reads === 1 ? original : changed; } }); const options = { pool: { connect: async () => ({ query: f.query, release() { } } as SqlClient) }, binding: b, integrationId: 'integration', providerConfigurationReference: 'config', providerApiVersion: 'v1' as const, authority: 'service' as const, leaseOwnerToken: 'worker', codec, recipientDigest: { keyVersion: 'recipient-v1', digest: () => 'b'.repeat(64) }, admission: { application: application as import('../../core/src/send-admission').HeldApplicationAdmission, coverage: { assertCoverage: async () => { } }, quota: { account: { hour: 10, day: 50 }, application: { hour: 20, day: 100 } } } }; const journal = createPostgresDispatchJournal(options); expect((await journal.beginDispatch(f.input)).kind).toBe('admitted'); expect(reads).toBe(1); expect(changed).not.toHaveBeenCalled(); });
it('lost service COMMIT retires the connection without rollback or application COMMIT', async () => { const f = fixture(); f.control.lostServiceCommit = true; await expect(f.repo.beginDispatch(f.input)).rejects.toThrow('Dispatch journal unavailable'); expect(f.commit).not.toHaveBeenCalled(); expect(f.abort).toHaveBeenCalledOnce(); expect(f.calls).not.toContain('ROLLBACK'); expect(f.release).toHaveBeenCalledWith(expect.any(Error)); });
it('quota denial closes held application permission and rolls back service admission', async () => { const f = fixture(); f.control.quotaExhausted = true; expect(await f.repo.beginDispatch(f.input)).toEqual({ kind: 'blocked', outcome: { status: 'waiting', code: 'rate_limited' } }); expect(f.commit).not.toHaveBeenCalled(); expect(f.abort).toHaveBeenCalledOnce(); expect(f.calls).toContain('ROLLBACK TO SAVEPOINT communication_admission_quota'); expect(f.calls).toContain('ROLLBACK'); expect(f.calls.some(sql => sql.startsWith('UPDATE communications.operation_journal'))).toBe(false); });
it('held coverage passes each original channel recipient to its independent outbound guard', async () => { const f = fixture(), existing = await f.open(), emailBinding = { ...b, connectionId: 'email-connection', accountId: 'email-account', channel: 'email' as const, platform: 'gmail' as const }, emailRecipient = { kind: 'email' as const, value: 'person@example.test' }; f.open.mockResolvedValue({ ...existing, permit: { ...existing.permit, coverageScopes: [...existing.permit.coverageScopes, { binding: emailBinding, recipient: emailRecipient, scopeDigest: 'e'.repeat(64), requiredSince: '2026-10-01T00:00:00.000Z' }] } } as typeof existing); expect((await f.repo.beginDispatch(f.input)).kind).toBe('admitted'); expect(f.assertCoverage.mock.calls.map(call => (call as unknown[])[1])).toEqual([expect.objectContaining({ recipient }), expect.objectContaining({ recipient: emailRecipient, binding: emailBinding })]); });
it('rolling policy denial follows held coverage but precedes every charge, admission and provider permit', async () => { const f = fixture(true); f.control.rollingBlocked = true; expect(await f.repo.beginDispatch(f.input)).toEqual({ kind: 'blocked', outcome: { status: 'waiting', code: 'rate_limited', retryAt: '2026-10-14T09:01:00.000Z' } }); expect(f.assertCoverage).toHaveBeenCalledOnce(); expect(f.commit).not.toHaveBeenCalled(); expect(f.abort).toHaveBeenCalledOnce(); expect(f.calls.some(sql => sql.startsWith('INSERT INTO communications.quota_buckets') || sql.startsWith('INSERT INTO communications.dispatch_admissions') || sql.startsWith('UPDATE communications.operation_journal'))).toBe(false); expect(f.calls).toContain('ROLLBACK'); });
it('initializes the transport boundary in the same transaction as a newly instrumented admission',async()=>{const f=fixture();expect((await f.repo.beginDispatch({...f.input,transportBoundary:true})).kind).toBe('admitted');const insert=f.calls.findIndex(sql=>sql.startsWith('INSERT INTO communications.dispatch_transport_boundaries'));expect(insert).toBeLessThan(f.calls.findIndex(sql=>sql.startsWith('INSERT INTO communications.dispatch_admissions')));expect(insert).toBeLessThan(f.calls.indexOf('COMMIT'));});
