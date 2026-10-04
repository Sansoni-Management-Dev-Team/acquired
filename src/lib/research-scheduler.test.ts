import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ get: vi.fn(), request: vi.fn(), finish: vi.fn(), load: vi.fn(), discovery: vi.fn(), enrichment: vi.fn(), continuation: vi.fn(), parallel: vi.fn(), balanced: vi.fn(), corpus: vi.fn() }));
vi.mock('@/db/research-repository', () => ({ ResearchRepository: class { get = m.get; getExecution = m.get; } }));
vi.mock('@/db/research-scheduler-repository', () => ({ requestSchedulingLease: m.request, finishSchedulingPass: m.finish }));
vi.mock('./research-scheduling-snapshot', () => ({ loadResearchSchedulingSnapshot: m.load }));
vi.mock('./automatic-discovery', () => ({ dispatchDiscoveryCandidates: m.discovery }));
vi.mock('./automatic-enrichment', () => ({ dispatchAutomaticEnrichment: m.enrichment }));
vi.mock('./research-continuation', () => ({ dispatchContinuation: m.continuation }));
vi.mock('./balanced-business-research', () => ({ dispatchBalancedBusinessResearch: m.balanced }));
vi.mock('./parallel-business-research', () => ({ dispatchParallelBusinessResearch: m.parallel }));
vi.mock('./corpus-business-research', () => ({ dispatchCorpusBusinessResearch: m.corpus }));
import { scheduleResearchRun } from './research-scheduler';
beforeEach(() => {
 vi.resetAllMocks();
 m.get.mockResolvedValue({ id:'root', config:{ performanceFlags:{schedulerCoalescing:true} } });
 m.request.mockResolvedValue({ acquired:true, generation:1 });
 m.finish.mockResolvedValue({ again:false });
 m.load.mockResolvedValue({root:{id:'root'},jobs:[{id:'root',status:'partial'}]});
});
it('coalesces a competing event and leaves its pending generation durable', async () => {
 m.request.mockResolvedValue({ acquired:false, generation:2 });
 await scheduleResearchRun('org','root');
 expect(m.load).not.toHaveBeenCalled();
});
it('reloads a shared snapshot when an event arrives during a pass', async () => {
 m.finish.mockResolvedValueOnce({again:true,generation:2}).mockResolvedValueOnce({again:false});
 await scheduleResearchRun('org','root');
 expect(m.load).toHaveBeenCalledTimes(2);
 expect(m.discovery.mock.calls[0][2]).toBe(m.enrichment.mock.calls[0][2]);
 expect(m.finish.mock.calls.map(c=>c[3])).toEqual([1,2]);
});
it('throttles UI recovery through the durable lease request', async () => {
 await scheduleResearchRun('org','root',{recovery:true});
 expect(m.request.mock.calls[0][3]).toBe(true);
});
it('leaves failed passes pending for lease expiry recovery', async () => {
 m.discovery.mockRejectedValue(new Error('dispatch failed'));
 await expect(scheduleResearchRun('org','root')).rejects.toThrow('dispatch failed');
 expect(m.finish).not.toHaveBeenCalled();
});
it('keeps the legacy path when its snapshotted flag is disabled', async () => {
 m.get.mockResolvedValue({id:'root',config:{}});
 await scheduleResearchRun('org','root');
 expect(m.request).not.toHaveBeenCalled();
 expect(m.discovery).toHaveBeenCalledWith('org','root');
});

it('parallel automatic runs cannot bypass a held scheduling lease',async()=>{
 m.get.mockResolvedValue({id:'root',config:{parallelBusinessResearch:true,performanceFlags:{schedulerCoalescing:true}}});
 m.request.mockResolvedValue({acquired:false,generation:2});
 expect(await scheduleResearchRun('org','root')).toBe(false);
 expect(m.parallel).not.toHaveBeenCalled();expect(m.load).not.toHaveBeenCalled();
});
it('parallel automatic runs share snapshots and recheck pending generations',async()=>{
 m.get.mockResolvedValue({id:'root',config:{parallelBusinessResearch:true,performanceFlags:{schedulerCoalescing:true}}});
 m.finish.mockResolvedValueOnce({again:true,generation:2}).mockResolvedValueOnce({again:false});
 expect(await scheduleResearchRun('org','root',{recovery:true})).toBe(true);
 expect(m.load).toHaveBeenCalledTimes(2);expect(m.parallel).toHaveBeenCalledTimes(2);
 expect(m.parallel.mock.calls[0][2]).toBe(m.load.mock.results[0].value instanceof Promise ? await m.load.mock.results[0].value : m.load.mock.results[0].value);
 expect(m.discovery).not.toHaveBeenCalled();expect(m.enrichment).not.toHaveBeenCalled();
 expect(m.finish.mock.calls.map(c=>c[3])).toEqual([1,2]);
});
it('parallel legacy runs retain dispatch when coalescing was not enabled',async()=>{
 m.get.mockResolvedValue({id:'root',config:{parallelBusinessResearch:true}});
 await scheduleResearchRun('org','root');
 expect(m.request).not.toHaveBeenCalled();expect(m.parallel).toHaveBeenCalledWith('org','root');
});

it('processes real callbacks even if an earlier pass marked the root settled',async()=>{
 m.get.mockResolvedValue({id:'root',status:'partial',config:{parallelBusinessResearch:true,parallelResearchSettled:true,performanceFlags:{schedulerCoalescing:true}}});
 await scheduleResearchRun('org','root');expect(m.request).toHaveBeenCalledTimes(1);expect(m.parallel).toHaveBeenCalledTimes(1);
});

it('selects B only when the saved run explicitly requests it',async()=>{
 m.get.mockResolvedValue({id:'root',config:{pipelineDesign:'balanced-v1',parallelBusinessResearch:true,performanceFlags:{schedulerCoalescing:true}}});
 await scheduleResearchRun('org','root');expect(m.balanced).toHaveBeenCalledTimes(1);expect(m.parallel).not.toHaveBeenCalled();
});

it("routes C to corpus dispatch without affecting A or B",async()=>{m.get.mockResolvedValue({id:"root",config:{pipelineDesign:"corpus-v1",parallelBusinessResearch:true,performanceFlags:{schedulerCoalescing:true}}});await scheduleResearchRun("org","root");expect(m.corpus).toHaveBeenCalled();expect(m.balanced).not.toHaveBeenCalled();expect(m.parallel).not.toHaveBeenCalled();});
