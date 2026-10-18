import {AgentRunLimitError} from '@/domain/agent-events';
import {expect,it,vi} from 'vitest';
import {runAgentEvent,type AgentEventWorkerPort} from './agent-event-worker';
const event={id:'event',thread_id:'thread',kind:'conversation.reassess',payload:{contextRevision:'v1'},lease_owner:'worker',fence:'1',attempts:1};
function fixture(){
 const port={claimEvent:vi.fn().mockResolvedValue(event),beginEventRun:vi.fn().mockResolvedValue({kind:'started',runId:'run'}),eventRunCurrent:vi.fn().mockResolvedValue(true),finishEventRun:vi.fn().mockResolvedValue(true),deferEvent:vi.fn().mockResolvedValue(true)};
 return {port:port as AgentEventWorkerPort,mocks:port,handler:vi.fn().mockResolvedValue({kind:'complete'})};
}
it('processes a persisted event with its fenced run and completes without browser state',async()=>{
 const {port,mocks,handler}=fixture();expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler}})).toBe('complete');
 expect(handler).toHaveBeenCalledWith(expect.objectContaining({event,runId:'run',signal:expect.any(AbortSignal)}));expect(mocks.finishEventRun).toHaveBeenCalledWith('run',event,{kind:'complete'});
});
it('does nothing when no event is due or another worker owns the lease',async()=>{
 const {port,mocks,handler}=fixture();mocks.claimEvent.mockResolvedValue(undefined);expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler}})).toBe('idle');expect(handler).not.toHaveBeenCalled();
});
it('does not call the handler when current run authority was lost',async()=>{
 const {port,mocks,handler}=fixture();mocks.eventRunCurrent.mockResolvedValue(false);expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler}})).toBe('lost');expect(handler).not.toHaveBeenCalled();
});
it('persists reassessment rather than sending an old scheduled draft',async()=>{
 const {port,mocks,handler}=fixture();const outcome={kind:'defer',wakeAt:'2026-10-20T10:00:00Z',reason:'Reassess current history next week'};handler.mockResolvedValue(outcome);
 expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler}})).toBe('defer');expect(mocks.finishEventRun).toHaveBeenCalledWith('run',event,outcome);
});
it('requires review for an unknown event or exhausted attempts without invoking tools',async()=>{
 for(const changes of [{kind:'unknown'},{attempts:6}]){
  const {port,mocks,handler}=fixture();mocks.claimEvent.mockResolvedValue({...event,...changes});expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler}})).toBe('review');expect(handler).not.toHaveBeenCalled();
 }
});
it('aborts a slow handler and requests review without blind side-effect retries',async()=>{
 const {port,mocks,handler}=fixture();handler.mockImplementation(({signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('late rejection')),{once:true})));
 expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler},deadlineMs:10})).toBe('review');expect(mocks.finishEventRun).toHaveBeenCalledWith('run',event,expect.objectContaining({kind:'review',stopReason:'run_duration_limit'}));
});
it('does not persist raw provider/SQL errors in the human notification',async()=>{
 const {port,mocks,handler}=fixture();handler.mockRejectedValue(new Error('raw secret provider data'));
 expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler}})).toBe('review');expect(JSON.stringify(mocks.finishEventRun.mock.calls)).not.toContain('raw secret');
});
it('defers a busy thread without starting a second run',async()=>{
 const {port,mocks,handler}=fixture();mocks.beginEventRun.mockResolvedValue({kind:'busy'} as never);
 expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler}})).toBe('defer');expect(mocks.deferEvent).toHaveBeenCalled();expect(handler).not.toHaveBeenCalled();
});

it('records an explicit bounded-run stop reason without exposing arbitrary exception details',async()=>{
 const {port,mocks,handler}=fixture();handler.mockRejectedValue(new AgentRunLimitError('run_step_limit'));
 expect(await runAgentEvent({store:port,workerId:'worker',handlers:{'conversation.reassess':handler}})).toBe('review');
 expect(mocks.finishEventRun).toHaveBeenCalledWith('run',event,{kind:'review',stopReason:'run_step_limit',message:'The background run reached its tool step limit. Review saved work before continuing.'});
});
it('claims a server-selected mandate only and refuses an unexpected returned mandate before a run starts',async()=>{
 const selected='00000000-0000-4000-8000-000000000037',f=fixture();f.mocks.claimEvent.mockResolvedValue({...event,mandate_id:selected});expect(await runAgentEvent({store:f.port,workerId:'worker',mandateId:selected,handlers:{'conversation.reassess':f.handler}})).toBe('complete');expect(f.mocks.claimEvent).toHaveBeenCalledWith('worker',60000,selected);
 const other=fixture();other.mocks.claimEvent.mockResolvedValue({...event,mandate_id:'00000000-0000-4000-8000-000000000038'});await expect(runAgentEvent({store:other.port,workerId:'worker',mandateId:selected,handlers:{'conversation.reassess':other.handler}})).rejects.toThrow('mandate scope');expect(other.mocks.beginEventRun).not.toHaveBeenCalled();expect(other.handler).not.toHaveBeenCalled();expect(other.mocks.finishEventRun).not.toHaveBeenCalled();
});
