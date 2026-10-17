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
it('retries bootstrap serialization at most three times while retaining the same held service proof and deadline',async()=>{
 const f=fixture(),old=f.sql.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect'),withCoverage=vi.fn(f.options.withCoverage);let conflicts=0;f.sql.mockImplementation(async text=>{if(text.startsWith('SELECT public.communications_lock_send_gate')&&conflicts++<2)throw Object.assign(Error('serialization'),{code:'40001'});return old(text);});await expect(createAcquireCoverageProjector({...f.options,withCoverage:withCoverage as AcquireCoverageProjectorOptions['withCoverage']}).project(query)).resolves.toBeUndefined();expect(connect).toHaveBeenCalledTimes(3);expect(withCoverage).toHaveBeenCalledOnce();expect(f.revalidate).toHaveBeenCalledOnce();expect(f.calls.filter(s=>s==='ROLLBACK')).toHaveLength(2);expect(f.release).toHaveBeenCalledWith(expect.any(Error));
 const all=fixture(),prior=all.sql.getMockImplementation()!,allConnect=vi.spyOn(all.options.pool,'connect');all.sql.mockImplementation(async text=>{if(text.startsWith('SELECT public.communications_lock_send_gate'))throw Object.assign(Error('serialization'),{code:'40001'});return prior(text);});await expect(createAcquireCoverageProjector(all.options).project(query)).rejects.toThrow('Coverage projection unavailable');expect(allConnect).toHaveBeenCalledTimes(3);expect(all.calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);
});
it('never retries non40001, post-bootstrap projection reads, uncertain COMMIT or cancelled held proof',async()=>{
 for(const boundary of ['other-code','post-bootstrap','commit','cancel']as const){const f=fixture(),old=f.sql.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect'),controller=new AbortController();f.sql.mockImplementation(async text=>{const fail=boundary==='other-code'||boundary==='cancel'?text.startsWith('SELECT public.communications_lock_send_gate'):boundary==='commit'?text==='COMMIT':text.includes('FROM public.communication_bindings');if(fail){if(boundary==='cancel')controller.abort();throw Object.assign(Error('serialization'),{code:boundary==='other-code'?'40P01':'40001'});}return old(text);});const repo=createAcquireCoverageProjector({...f.options,async withCoverage(_query,work){return work({coverage,scopeDigest:'a'.repeat(64),serviceRevision:'4',signal:controller.signal,revalidate:f.revalidate});}});await expect(repo.project(query)).rejects.toThrow('Coverage projection unavailable');expect(connect,boundary).toHaveBeenCalledTimes(1);}
});
it('does not reset the outer projection deadline when bootstrap serializes repeatedly',async()=>{
 const f=fixture(),old=f.sql.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect'),withCoverage=vi.fn(f.options.withCoverage);f.sql.mockImplementation(async text=>{if(text.startsWith('SELECT public.communications_lock_send_gate')){await new Promise(r=>setTimeout(r,18));throw Object.assign(Error('serialization'),{code:'40001'});}return old(text);});await expect(createAcquireCoverageProjector({...f.options,withCoverage:withCoverage as AcquireCoverageProjectorOptions['withCoverage'],timeoutMs:30}).project(query)).rejects.toThrow('Coverage projection unavailable');expect(connect.mock.calls.length).toBeLessThanOrEqual(2);expect(withCoverage).toHaveBeenCalledOnce();expect(f.calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);
});
it('releases a conflicted client exactly once when deadline or held-proof abort occurs during rollback',async()=>{
 for(const stop of ['deadline','abort']as const){const f=fixture(),old=f.sql.getMockImplementation()!,connect=vi.spyOn(f.options.pool,'connect'),controller=new AbortController();f.sql.mockImplementation(async text=>{if(text.startsWith('SELECT public.communications_lock_send_gate'))throw Object.assign(Error('serialization'),{code:'40001'});if(text==='ROLLBACK'){if(stop==='abort')controller.abort();await new Promise(r=>setTimeout(r,25));return{rows:[]};}return old(text);});const repo=createAcquireCoverageProjector({...f.options,timeoutMs:stop==='deadline'?10:100,async withCoverage(_query,work){return work({coverage,scopeDigest:'a'.repeat(64),serviceRevision:'4',signal:controller.signal,revalidate:f.revalidate});}});await expect(repo.project(query)).rejects.toThrow('Coverage projection unavailable');await new Promise(r=>setTimeout(r,30));expect(f.release,stop).toHaveBeenCalledTimes(1);expect(connect,stop).toHaveBeenCalledTimes(1);expect(f.calls.some(s=>s.startsWith('INSERT INTO'))).toBe(false);}
});
it('preserves trusted pending only before app commit; never reclassifies uncertain commit as deferrable',async()=>{
 const {ReplyProcessingPendingError}=await import('../../communications/packages/core/src/history-pending');const first=fixture(),before=createAcquireCoverageProjector({...first.options,withCoverage:async()=>{throw new ReplyProcessingPendingError();}});await expect(before.project(query)).rejects.toBeInstanceOf(ReplyProcessingPendingError);expect(first.sql).not.toHaveBeenCalled();const late=fixture(),base=late.sql.getMockImplementation()!;late.sql.mockImplementation(async text=>{if(text==='COMMIT')throw new ReplyProcessingPendingError();return base(text);});let caught:unknown;try{await late.repo.project(query);}catch(e){caught=e;}expect(caught).toBeInstanceOf(Error);expect(caught).not.toBeInstanceOf(ReplyProcessingPendingError);expect(late.calls).not.toContain('ROLLBACK');
});
it('expired projection never returns the later pending classification or opens an app session',async()=>{
 const {ReplyProcessingPendingError}=await import('../../communications/packages/core/src/history-pending'),f=fixture(),repo=createAcquireCoverageProjector({...f.options,timeoutMs:5,withCoverage:async()=>{await new Promise(r=>setTimeout(r,20));throw new ReplyProcessingPendingError();}});let caught:unknown;try{await repo.project(query);}catch(e){caught=e;}await new Promise(r=>setTimeout(r,25));expect(caught).toBeInstanceOf(Error);expect(caught).not.toBeInstanceOf(ReplyProcessingPendingError);expect(f.sql).not.toHaveBeenCalled();
});
