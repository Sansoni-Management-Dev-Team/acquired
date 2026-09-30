import {beforeEach,expect,it,vi} from 'vitest';
import type {ResearchSchedulingSnapshot} from './research-scheduling-snapshot';
const m=vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),cancelRun:vi.fn(),worker:vi.fn(),config:vi.fn()}));
vi.mock('@/db/research-repository',()=>({ResearchRepository:class {get=m.get;create=m.create;cancelRun=m.cancelRun;}}));
vi.mock('@/domain/research-continuation',()=>({automaticContinuation:m.config}));
vi.mock('./research-service',()=>({researchWorker:m.worker}));
import {dispatchContinuation} from './research-continuation';
const root={id:'root',status:'partial',mandateId:'mandate',createdBy:'user',config:{}};
beforeEach(()=>{vi.resetAllMocks();m.get.mockResolvedValue(root);m.create.mockImplementation(async id=>({...root,id,status:'queued'}));});
it('adds a created continuation to the shared snapshot and dispatches it only once',async()=>{
 const snapshot={root,jobs:[root],dispatched:new Set()} as unknown as ResearchSchedulingSnapshot;
 m.config.mockReturnValue({researchRunId:'root'});
 await dispatchContinuation('org','root',snapshot);
 await dispatchContinuation('org','root',snapshot);
 expect(m.create).toHaveBeenCalledTimes(1);expect(m.worker).toHaveBeenCalledTimes(1);
 expect(snapshot.jobs).toHaveLength(2);
});
it('retains a queued continuation for retry after failed dispatch',async()=>{
 const snapshot={root,jobs:[root],dispatched:new Set()} as unknown as ResearchSchedulingSnapshot;
 m.config.mockReturnValue({});m.worker.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
 await expect(dispatchContinuation('org','root',snapshot)).rejects.toThrow('offline');
 await dispatchContinuation('org','root',snapshot);
 expect(m.create).toHaveBeenCalledTimes(1);expect(m.worker).toHaveBeenCalledTimes(2);
});
it('cleans up a continuation created during cancellation',async()=>{
 m.get.mockResolvedValueOnce(root).mockResolvedValueOnce(undefined).mockResolvedValueOnce({...root,status:'cancelled'});
 m.config.mockReturnValue({researchRunId:'root'});
 expect(await dispatchContinuation('org','root')).toBe(false);
 expect(m.cancelRun).toHaveBeenCalledWith('root');expect(m.worker).not.toHaveBeenCalled();
});
