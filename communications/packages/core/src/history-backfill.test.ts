import { it, expect, vi } from 'vitest';
import { createHistoryBackfillWorker } from './history-backfill';
import type { ConnectionBinding } from '../../contracts/src';
const binding: ConnectionBinding = { applicationId: 'a', tenantId: 't', ownerId: 'o', connectionId: 'c', accountId: 'p', generation: 1, channel: 'email', platform: 'gmail', backend: 'unipile' }, at = '2026-10-14T09:00:00.000Z';
const query = { binding, scope: 'all', since: at, cursor: null, refresh: true }, ticket = { binding, scope: 'all', since: at, startedAt: at, token: 'token', revision: '3' }, coverage = { binding, scope: 'all', from: at, through: at, observedAt: at, complete: true, initialSyncComplete: true, invalidated: false };
function fixture() { const repository = { begin: vi.fn(async () => ticket), commit: vi.fn(async () => ({ committed: true, coverage })), invalidate: vi.fn(async () => { }), coverage: vi.fn(async () => null) }, source = { read: vi.fn(async () => ({ events: [], nextCursor: null, coverage })) }; return { repository, source, worker: createHistoryBackfillWorker({ source, repository }) }; }
it('durable checkpoint and event commit precedes complete result', async () => { const f = fixture(); expect(await f.worker.refresh(query)).toEqual({ status: 'complete', coverage }); expect(f.source.read).toHaveBeenCalledWith(query, { signal: undefined, through: at }); expect(f.repository.commit).toHaveBeenCalledWith(ticket, { events: [], nextCursor: null, coverage }, undefined); });
it('uncommitted service result never reports ready', async () => { const f = fixture(); f.repository.commit.mockResolvedValue({ committed: false, coverage }); expect(await f.worker.refresh(query)).toEqual({ status: 'retry' }); });
it('source failure invalidates durable coverage before retry', async () => { const f = fixture(); f.source.read.mockRejectedValue(Error('private error')); expect(await f.worker.refresh(query)).toEqual({ status: 'retry' }); expect(f.repository.invalidate).toHaveBeenCalledWith(query, undefined); expect(f.repository.commit).not.toHaveBeenCalled(); });
it('busy lease performs no provider read', async () => { const f = fixture(); f.repository.begin.mockResolvedValue(null as never); expect(await f.worker.refresh(query)).toEqual({ status: 'busy' }); expect(f.source.read).not.toHaveBeenCalled(); });

it('releases only its own failed claim so the next request does not wait for lease expiry', async()=>{
 const f=fixture();let claimed=false;
 f.repository.begin.mockImplementation(async()=>claimed?null as never:(claimed=true,ticket));
 const abandon=vi.fn(async()=>{claimed=false;});
 const repository={...f.repository,abandon};
 const worker=createHistoryBackfillWorker({source:f.source,repository});
 f.source.read.mockRejectedValueOnce(Error('provider failed'));
 expect(await worker.refresh(query)).toEqual({status:'retry'});
 expect(await worker.refresh(query)).toEqual({status:'complete',coverage});
 expect(abandon).toHaveBeenCalledWith(ticket);
 expect(f.repository.invalidate).not.toHaveBeenCalled();
});
it('does not invalidate another scan when acquiring a ticket fails',async()=>{
 const f=fixture();f.repository.begin.mockRejectedValue(Error('connection unavailable'));
 expect(await f.worker.refresh(query)).toEqual({status:'retry'});
 expect(f.repository.invalidate).not.toHaveBeenCalled();
});
it('cleans its claimed scan with an independent bounded transaction after caller cancellation',async()=>{
 const f=fixture(),controller=new AbortController(),abandon=vi.fn(async()=>{});
 f.source.read.mockImplementation(async()=>{controller.abort();throw Error('aborted');});
 const worker=createHistoryBackfillWorker({source:f.source,repository:{...f.repository,abandon}});
 expect(await worker.refresh(query,{signal:controller.signal})).toEqual({status:'retry'});
 expect(abandon).toHaveBeenCalledWith(ticket);
 expect(f.repository.invalidate).not.toHaveBeenCalled();
});

it('retries an invalidated read without retrying busy leases or transport failures',async()=>{
 const {refreshInvalidatedHistory}=await import('./history-backfill');
 const refresh=vi.fn().mockResolvedValueOnce({status:'pending',coverage:{...coverage,invalidated:true,complete:false}}).mockResolvedValueOnce({status:'complete',coverage});
 expect(await refreshInvalidatedHistory(refresh)).toEqual({status:'complete',coverage});expect(refresh).toHaveBeenCalledTimes(2);
 for(const status of ['busy','retry']){const blocked=vi.fn(async()=>({status}));expect(await refreshInvalidatedHistory(blocked as never)).toEqual({status});expect(blocked).toHaveBeenCalledTimes(1);}
});
it('invalidated history retries are bounded and respect cancellation',async()=>{
 const {refreshInvalidatedHistory}=await import('./history-backfill');
 const result={status:'pending' as const,coverage:{...coverage,invalidated:true,complete:false}},refresh=vi.fn(async()=>result);
 expect(await refreshInvalidatedHistory(refresh)).toEqual(result);expect(refresh).toHaveBeenCalledTimes(3);
 const controller=new AbortController(),cancelled=vi.fn(async()=>{controller.abort();return result;});
 await refreshInvalidatedHistory(cancelled,controller.signal);expect(cancelled).toHaveBeenCalledTimes(1);
});
