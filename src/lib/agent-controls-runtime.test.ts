import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
const status=vi.hoisted(()=>vi.fn());
vi.mock('./agent-runtime-channel-readiness',()=>({readAgentChannelReadiness:status}));
import {readAgentControlsRuntime} from './agent-controls-runtime';
const actor={organizationId:'org',userId:'owner'};
const recorded={registered:true,runtimeId:'runtime',responsibilityRevision:1,reason:null,budgets:[],channels:[]};
function fixture(){return {actor,thread:{id:'owned-thread'},store:{runtimeReadiness:vi.fn().mockResolvedValue(recorded),channelPolicy:vi.fn().mockResolvedValue({policy:{revision:2},accounts:[]}),channelPolicyForMandate:vi.fn().mockResolvedValue({policy:null,accounts:[]})}};}
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('AGENT_WORKER_SCOPE_MODE','registered');status.mockResolvedValue([]);});
afterEach(()=>vi.unstubAllEnvs());
it('reads exact scoped thread status sequentially and observes live status only after its database read',async()=>{
 const f=fixture(),result=await readAgentControlsRuntime(f,'mandate');
 expect(f.store.runtimeReadiness).toHaveBeenCalledExactlyOnceWith('owned-thread');expect(status).toHaveBeenCalledExactlyOnceWith(actor,recorded.channels);expect(f.store.channelPolicy).toHaveBeenCalledExactlyOnceWith('owned-thread');expect(f.store.channelPolicyForMandate).not.toHaveBeenCalled();
 expect(f.store.runtimeReadiness.mock.invocationCallOrder[0]).toBeLessThan(status.mock.invocationCallOrder[0]);expect(status.mock.invocationCallOrder[0]).toBeLessThan(f.store.channelPolicy.mock.invocationCallOrder[0]);
 expect(result).toMatchObject({readiness:{registered:true},channelPolicy:{enabled:true,policy:{revision:2}},channelPolicyUnavailable:false});
});
it('reads a pre-start mandate without creating a runtime or inventing registration',async()=>{
 const f=fixture();const result=await readAgentControlsRuntime({...f,thread:undefined},'owned-mandate');
 expect(f.store.runtimeReadiness).not.toHaveBeenCalled();expect(f.store.channelPolicy).not.toHaveBeenCalled();expect(f.store.channelPolicyForMandate).toHaveBeenCalledExactlyOnceWith('owned-mandate');expect(result).toMatchObject({readiness:{registered:false,channels:[]}});
});
it.each(['runtime','policy','both'])('retains explicit unavailable capabilities after %s failure',async kind=>{
 const f=fixture();if(kind!=='policy')f.store.runtimeReadiness.mockRejectedValue(Error('private failure'));if(kind!=='runtime')f.store.channelPolicy.mockRejectedValue(Error('private failure'));
 const result=await readAgentControlsRuntime(f,'mandate');
 expect(result).toMatchObject({...kind!=='policy'?{readinessUnavailable:true}:{readiness:{registered:true}},...kind!=='runtime'?{channelPolicyUnavailable:true,channelPolicy:{enabled:false,policy:null,accounts:[]}}:{channelPolicy:{enabled:true}}});
 expect(JSON.stringify(result)).not.toContain('private failure');
});
it('retains disabled policy outside registered mode without reading account choices',async()=>{
 vi.stubEnv('AGENT_WORKER_SCOPE_MODE','exact');const f=fixture();expect(await readAgentControlsRuntime(f,'mandate')).toMatchObject({channelPolicy:{enabled:false,policy:null,accounts:[]}});expect(f.store.channelPolicy).not.toHaveBeenCalled();
});
