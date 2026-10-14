import { expect, it, vi } from 'vitest';
import { JournalCodec } from '../../communications/packages/core/src/journal-codec';
import { createAcquireCoverageProjector, type AcquireCoverageProjectorOptions } from './communications-coverage-projector';
import type { SqlClient } from '../../communications/packages/storage-postgres/src/webhook-repository';
const binding = { applicationId: 'acquire', tenantId: 'org', ownerId: 'owner', connectionId: 'connection', accountId: 'account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile' } as const;
const coverage = { binding, scope: 'account', from: '2026-10-01T00:00:00.000Z', through: '2026-10-14T00:00:00.000Z', observedAt: '2026-10-14T00:00:01.000Z', complete: true, initialSyncComplete: true, invalidated: false };
const query = { binding, scope: 'account', since: coverage.from, cursor: null, refresh: true };
function fixture() {
    const calls: string[] = [], control = { lostCommit: false };
    const release = vi.fn(), sql = vi.fn(async (text: string) => {
        calls.push(text);
        if (text === 'COMMIT' && control.lostCommit)
            throw Error('synthetic lost COMMIT');
        if (text.includes('pg_roles'))
            return { rows: [{ role_name: 'acquire_campaign_user', rolsuper: false, rolbypassrls: false }] };
        if (text.includes('to_regprocedure'))
            return { rows: [{ installed: true }] };
        if (text.includes('communications_lock_send_gate'))
            return { rows: [{ revision: '1' }] };
        if (text.includes('communications_lock_send_member'))
            return { rows: [{ allowed: true }] };
        if (text.includes('FROM public.communication_bindings'))
            return { rows: [{ id: 'binding', application_id: 'acquire', organization_id: 'org', owner_user_id: 'owner', service_connection_id: 'connection', service_account_id: 'account', generation: 1, channel: 'whatsapp', platform: 'whatsapp', backend: 'unipile', authority: 'service' }] };
        if (text.includes('AS fresh'))
            return { rows: [{ fresh: true }] };
        return { rows: [], rowCount: 1 };
    });
    const revalidate = vi.fn(async () => { calls.push('SERVICE REVALIDATE'); });
    const options: AcquireCoverageProjectorOptions = { pool: { connect: async () => ({ query: sql, release } as SqlClient) }, binding, bindingId: 'binding', subscriberId: 'acquire-replies', codec: new JournalCodec({ activeVersion: 'projection-fixture', keys: [{ version: 'projection-fixture', encryptionKey: Buffer.alloc(32, 41), digestKey: Buffer.alloc(32, 42) }] }), async withCoverage(q, work) { expect(q).toEqual(query); calls.push('SERVICE HELD'); return work({ coverage, scopeDigest: 'a'.repeat(64), serviceRevision: '4', signal: new AbortController().signal, revalidate }); } };
    return { repo: createAcquireCoverageProjector(options), options, calls, sql, revalidate, release, control };
}
it('service authority precedes app gate and exact checkpoint writes; revalidation precedes app COMMIT', async () => { const f = fixture(); await f.repo.project(query); expect(f.calls[0]).toBe('SERVICE HELD'); const member = f.calls.findIndex(s => s.includes('communications_lock_send_member')), gate = f.calls.findIndex(s => s.includes('communications_lock_send_gate')), monitor = f.calls.findIndex(s => s.startsWith('INSERT INTO public.communication_reply_monitors')), checkpoint = f.calls.findIndex(s => s.startsWith('INSERT INTO public.communication_consumer_checkpoints')); expect(gate).toBeLessThan(member); expect(member).toBeLessThan(monitor); expect(monitor).toBeLessThan(checkpoint); expect(f.calls.indexOf('SERVICE REVALIDATE')).toBeLessThan(f.calls.indexOf('COMMIT')); });
it('service pending-work rejection cannot publish a fresh application monitor', async () => { const f = fixture(), withCoverage = vi.fn(async () => { throw Error('synthetic pending reply'); }); const repo = createAcquireCoverageProjector({ ...f.options, withCoverage }); await expect(repo.project(query)).rejects.toThrow('Coverage projection unavailable'); expect(f.sql).not.toHaveBeenCalled(); });
it('lost application coverage COMMIT retires the session without rollback racing uncertainty', async () => { const f = fixture(); f.control.lostCommit = true; await expect(f.repo.project(query)).rejects.toThrow('Coverage projection unavailable'); expect(f.calls).toContain('COMMIT'); expect(f.calls).not.toContain('ROLLBACK'); expect(f.release).toHaveBeenLastCalledWith(expect.any(Error)); });
it('service revalidation loss after staging both app rows never commits the application checkpoint', async () => { const f = fixture(); f.revalidate.mockRejectedValueOnce(Error('synthetic pending work changed')); await expect(f.repo.project(query)).rejects.toThrow('Coverage projection unavailable'); expect(f.calls.some(s => s.includes('communication_consumer_checkpoints'))).toBe(true); expect(f.calls).not.toContain('COMMIT'); expect(f.release).toHaveBeenLastCalledWith(expect.any(Error)); });
it('stalled service-held callback is bounded and never starts late application SQL', async () => { const f = fixture(), repo = createAcquireCoverageProjector({ ...f.options, timeoutMs: 20, withCoverage: async () => new Promise(() => { }) }); await expect(repo.project(query)).rejects.toThrow('Coverage projection unavailable'); expect(f.sql).not.toHaveBeenCalled(); });
it('retires its application session before notifying externally observed cancellation', async () => { const f = fixture(), original = f.options.withCoverage; let unretired = false; const repo = createAcquireCoverageProjector({ ...f.options, async withCoverage(query, work, options) { options?.signal?.addEventListener('abort', () => { if (!f.release.mock.calls.length)
        unretired = true; }); return original(query, work, options); } }); await repo.project(query); expect(unretired).toBe(false); });
it('successful service transaction retirement after a definite app commit is not projection cancellation',async()=>{
 const f=fixture(),controller=new AbortController();
 const repo=createAcquireCoverageProjector({...f.options,async withCoverage(_query,work){
  const result=await work({coverage,scopeDigest:'a'.repeat(64),serviceRevision:'4',signal:controller.signal,revalidate:f.revalidate});
  // The concrete service transaction retires its session and then aborts its exposed signal
  // on success as well as failure. This happens after the app callback has committed.
  controller.abort();return result;
 }});
 await expect(repo.project(query)).resolves.toBeUndefined();
 expect(f.calls).toContain('COMMIT');expect(f.revalidate).toHaveBeenCalledOnce();
});
it('service failure after the app callback commit remains unavailable',async()=>{
 const f=fixture();const repo=createAcquireCoverageProjector({...f.options,async withCoverage(_query,work){await work({coverage,scopeDigest:'a'.repeat(64),serviceRevision:'4',signal:new AbortController().signal,revalidate:f.revalidate});throw Error('Synthetic lost service COMMIT');}});
 await expect(repo.project(query)).rejects.toThrow('Coverage projection unavailable');expect(f.calls).toContain('COMMIT');
});
it('service abort before app commit still retires the app session and rejects projection',async()=>{
 const f=fixture(),controller=new AbortController();f.revalidate.mockImplementationOnce(async()=>{controller.abort();});
 const repo=createAcquireCoverageProjector({...f.options,async withCoverage(_query,work){return work({coverage,scopeDigest:'a'.repeat(64),serviceRevision:'4',signal:controller.signal,revalidate:f.revalidate});}});
 await expect(repo.project(query)).rejects.toThrow('Coverage projection unavailable');expect(f.calls).not.toContain('COMMIT');expect(f.release).toHaveBeenLastCalledWith(expect.any(Error));
});
