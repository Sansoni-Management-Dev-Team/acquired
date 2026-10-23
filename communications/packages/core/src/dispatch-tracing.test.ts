import {afterEach,expect,it,vi} from 'vitest';
import {observeDispatchStage} from './dispatch-diagnostic';
import {installOperationTrace} from './operation-trace';
let dispose:undefined|(()=>void);
afterEach(()=>{dispose?.();vi.unstubAllEnvs();});
it('types the actual native handler as an agent while tracing with console logging disabled',async()=>{
 vi.stubEnv('AGENT_VERBOSE_LOGGING','false');const run=vi.fn(async(_name,_metadata,work)=>work());dispose=installOperationTrace({run,update(){}});
 await observeDispatchStage('native.handler',async()=>({kind:'complete'}));
 expect(run.mock.calls[0][1].kind).toBe('agent');
});
it('retains an unknown provider outcome instead of reporting successful completion',async()=>{
 const update=vi.fn();dispose=installOperationTrace({run:async(_n,_m,work)=>work(),update});
 const outcome={status:'unknown'}as const;expect(await observeDispatchStage('delivery.submit',async()=>outcome)).toBe(outcome);
 expect(update).toHaveBeenLastCalledWith({outcome:'unknown'});
});
