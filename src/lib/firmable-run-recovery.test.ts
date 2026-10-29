import { beforeEach, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({worker:vi.fn(),automatic:vi.fn()}));
vi.mock('./research-service',()=>({researchEnabled:()=>true,researchWorker:mocks.worker}));
vi.mock('./company-people-research',()=>({recoverAutomaticCompanyPeople:mocks.automatic}));
import {recoverFirmableRefreshes} from './firmable-run-recovery';
beforeEach(()=>vi.clearAllMocks());
it('RC-10-regression: recovery cannot fan out 53 queued automatic workflows',async()=>{
 const runs=Array.from({length:53},(_,i)=>({id:`run${i}`,trigger:'discovery',organizationId:'synthetic-org',status:'queued',updatedAt:new Date()}));
 const history={failRun:vi.fn(),claimManualRecovery:vi.fn()};
 await recoverFirmableRefreshes(history,runs,'synthetic-mandate');
 expect(mocks.automatic).toHaveBeenCalledExactlyOnceWith('synthetic-org','synthetic-mandate');
 expect(mocks.worker).not.toHaveBeenCalled();expect(history.claimManualRecovery).not.toHaveBeenCalled();
});
it('RC-10-generalization: manual dispatch requires a durable claim and terminal state cannot dispatch',async()=>{
 const history={failRun:vi.fn(),claimManualRecovery:vi.fn().mockResolvedValue(false)};
 await recoverFirmableRefreshes(history,[{id:'manual',trigger:'people',status:'queued',updatedAt:new Date()},{id:'terminal',trigger:'people',status:'failed',updatedAt:new Date(0)}],'mandate');
 expect(history.claimManualRecovery).toHaveBeenCalledExactlyOnceWith('manual');expect(mocks.worker).not.toHaveBeenCalled();
 history.claimManualRecovery.mockResolvedValue(true);
 await recoverFirmableRefreshes(history,[{id:'manual',trigger:'people',status:'queued',updatedAt:new Date()}],'mandate');
 expect(mocks.worker).toHaveBeenCalledExactlyOnceWith('/firmable/manual','POST',{mandateId:'mandate'},4000);
});
it('RC-10-generalization: stale automatic lease checks status without starting another workflow',async()=>{
 const now=Date.now();mocks.worker.mockResolvedValue({status:'errored'});
 const history={failRun:vi.fn(),claimManualRecovery:vi.fn()};
 await recoverFirmableRefreshes(history,[{id:'stale',trigger:'discovery',status:'running',updatedAt:new Date(now-120000)}],'mandate',now);
 expect(mocks.worker).toHaveBeenCalledExactlyOnceWith('/firmable/stale','GET',undefined,4000);
 expect(history.failRun).toHaveBeenCalledWith('stale',expect.stringContaining('ended before'));
});
it('retains an old running refresh when worker status is unavailable',async()=>{
 mocks.worker.mockRejectedValue(Error('Service temporarily unreachable'));
 const history={failRun:vi.fn(),claimManualRecovery:vi.fn()},now=Date.now();
 await recoverFirmableRefreshes(history,[{id:'old-running',trigger:'discovery',status:'running',updatedAt:new Date(now-3600000)}],'mandate',now);
 expect(history.failRun).not.toHaveBeenCalled();
});
