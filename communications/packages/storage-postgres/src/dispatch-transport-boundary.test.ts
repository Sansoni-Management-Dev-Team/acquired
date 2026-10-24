import { expect, it, vi } from 'vitest';
import { createPostgresDispatchJournal } from './dispatch-journal';
import { JournalCodec } from '../../core/src/journal-codec';
import type { SqlClient, SqlResult } from './webhook-repository';
const b = { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner', connectionId: 'connection', accountId: 'physical', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' } as const;
const snapshot = { binding: b, key: 'epoch-1', operation: 'message', payloadDigest: 'a'.repeat(64) } as const, recipient = { kind: 'phone', value: '+15550000000' } as const;
const codec = new JournalCodec({ activeVersion: 'admission-codec', keys: [{ version: 'admission-codec', encryptionKey: Buffer.alloc(32, 71), digestKey: Buffer.alloc(32, 72) }] });
function fixture(rolling = false) {
    const release = vi.fn(), control = { lostServiceCommit: false, quotaExhausted: false, rollingBlocked: false, boundary: null as string|null, expired:false };
    const calls: string[] = [], ctx = { recipient }, envelope = codec.encode(snapshot, 'context', ctx);
    let row: Record<string, unknown> = { id: 'journal', application_id: 'acquire', tenant_id: 'org', owner_id: 'owner', operation_key: snapshot.key, connection_id: 'connection', generation: 1, account_id: 'physical', operation: 'message', payload_digest: snapshot.payloadDigest, recipient_digest: 'b'.repeat(64), recipient_key_version: 'recipient-v1', digest_version: 'message-v1', encrypted_operation_context: JSON.stringify(envelope), operation_context_key_version: codec.keyVersion, operation_context_digest: codec.digest(snapshot, 'context', ctx), state: 'claimed', claim_token: 'claim', claim_until: new Date(Date.now() + 60000), fencing_token: '1', lease_owner_token: 'worker', quota_reserved: false, encrypted_receipt: null, receipt_key_version: null, outcome_status: null, encrypted_outcome: null, outcome_key_version: null, submitted_at: null, delivered_at: null, read_at: null, claim_alive: true };
    const query = vi.fn(async (sql: string, values: unknown[] = []): Promise<SqlResult> => {
        calls.push(sql);
        if(sql.startsWith('INSERT INTO communications.dispatch_transport_boundaries')){control.boundary='prewrite';return{rows:[]};}
        if(sql.startsWith('UPDATE communications.dispatch_transport_boundaries')){if(control.boundary!=='prewrite')return{rows:[]};control.boundary=sql.includes("state='write_started'")?'write_started':'closed_no_write';return{rows:[{journal_id:'journal'}]};}
        if(sql.includes('FROM communications.dispatch_transport_boundaries'))return{rows:control.boundary==='closed_no_write'?[{journal_id:'journal'}]:[]};
        if(sql.startsWith('UPDATE communications.operation_journal SET state=$5')){row={...row,state:values[4],outcome_status:values[5],encrypted_outcome:values[6],outcome_key_version:values[7]};return{rows:[row]};}

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
            return { rows: [{ account_id: 'physical', owner_token: 'worker', fencing_token: '1', alive: !control.expired }] };
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
    return { repo, calls, commit, open, query, release, abort, control, assertCoverage, row:()=>row, input: { token: 'claim', record: { snapshot, recipient, state: 'claimed' as const } } };
}

// Scripted port coverage only. Real guarded CAS/concurrency acceptance is separate.
async function admitted(){const f=fixture();const d=await f.repo.beginDispatch({...f.input,transportBoundary:true});if(d.kind!=='admitted')throw Error('admission');return{...f,record:d.record};}
it('allows a single original write gate and rejects a duplicate',async()=>{const f=await admitted();await f.repo.startTransportWrite!({token:'claim',record:f.record});expect(f.control.boundary).toBe('write_started');await expect(f.repo.startTransportWrite!({token:'claim',record:f.record})).rejects.toThrow();});
it('closes prewrite and its terminal outcome before COMMIT, retaining charged quota',async()=>{const f=await admitted(),outcome={status:'review',code:'protocol'} as const;await f.repo.complete({token:'claim',record:f.record,outcome,closeBeforeWrite:true});expect(f.control.boundary).toBe('closed_no_write');expect(f.row().quota_reserved).toBe(true);expect(await f.repo.proveNoSubmission(snapshot)).toMatchObject({journalId:'journal',outcome,evidenceDigest:expect.stringMatching(/^[a-f0-9]{64}$/)});expect(await f.repo.proveNoSubmission(snapshot)).toEqual(await f.repo.proveNoSubmission(snapshot));await expect(f.repo.startTransportWrite!({token:'claim',record:f.record})).rejects.toThrow();});
it.each(['write_started',null])('never proves or closes a %s boundary',async state=>{const f=await admitted();f.control.boundary=state;await expect(f.repo.complete({token:'claim',record:f.record,outcome:{status:'review',code:'protocol'},closeBeforeWrite:true})).rejects.toThrow();await f.repo.complete({token:'claim',record:f.record,outcome:{status:'review',code:'protocol'}});expect(await f.repo.proveNoSubmission(snapshot)).toBeNull();});
it('rejects stale fence or changed snapshot before any gate',async()=>{for(const mode of ['lease','snapshot','token']){const f=await admitted();if(mode==='lease')f.control.expired=true;const record=mode==='snapshot'?{...f.record,snapshot:{...f.record.snapshot,payloadDigest:'b'.repeat(64)}}:f.record;await expect(f.repo.startTransportWrite!({token:mode==='token'?'foreign':'claim',record})).rejects.toThrow();expect(f.control.boundary).toBe('prewrite');}});
it('lost gate COMMIT rejects rather than granting provider write',async()=>{const f=await admitted();f.control.lostServiceCommit=true;await expect(f.repo.startTransportWrite!({token:'claim',record:f.record})).rejects.toThrow();expect(f.release).toHaveBeenCalledWith(expect.any(Error));});
