import {afterEach,expect,it,vi} from 'vitest';
import {startAgentActivityPolling} from './agent-activity-poller';
afterEach(()=>vi.useRealTimers());
it('loads background activity without overlap and aborts cleanly on unmount',async()=>{
 vi.useFakeTimers();let resolve:(value:string)=>void=()=>{};let signal:AbortSignal|undefined;
 const load=vi.fn().mockImplementation((input:AbortSignal)=>{signal=input;return new Promise<string>(done=>{resolve=done;});}),apply=vi.fn();
 const stop=startAgentActivityPolling({load,apply,isBusy:()=>false,isVisible:()=>true,version:()=>0,intervalMs:1000});await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(5000);expect(load).toHaveBeenCalledOnce();
 resolve('saved update');await vi.advanceTimersByTimeAsync(0);expect(apply).toHaveBeenCalledWith('saved update');stop();expect(signal?.aborted).toBe(true);await vi.advanceTimersByTimeAsync(10000);expect(load).toHaveBeenCalledOnce();
});
it('does not replace newer user work with a response started before that work',async()=>{
 vi.useFakeTimers();let version=0;let resolve:(value:string)=>void=()=>{};
 const apply=vi.fn(),stop=startAgentActivityPolling({load:()=>new Promise<string>(done=>{resolve=done;}),apply,isBusy:()=>false,isVisible:()=>true,version:()=>version,intervalMs:1000});await vi.advanceTimersByTimeAsync(0);version++;resolve('older response');await vi.advanceTimersByTimeAsync(0);expect(apply).not.toHaveBeenCalled();stop();
});
it('skips active turns and hidden tabs, then catches up when visible and idle',async()=>{
 vi.useFakeTimers();let busy=true,visible=false;const load=vi.fn().mockResolvedValue('saved'),apply=vi.fn();const stop=startAgentActivityPolling({load,apply,isBusy:()=>busy,isVisible:()=>visible,version:()=>0,intervalMs:1000});await vi.advanceTimersByTimeAsync(0);busy=false;await vi.advanceTimersByTimeAsync(1000);expect(load).not.toHaveBeenCalled();visible=true;await vi.advanceTimersByTimeAsync(1000);expect(apply).toHaveBeenCalledWith('saved');stop();
});
it('survives transient request failures without abandoning future updates',async()=>{
 vi.useFakeTimers();const load=vi.fn().mockRejectedValueOnce(Error('temporary')).mockResolvedValue('recovered'),apply=vi.fn(),onFailure=vi.fn();const stop=startAgentActivityPolling({load,apply,onFailure,isBusy:()=>false,isVisible:()=>true,version:()=>0,intervalMs:1000});await vi.advanceTimersByTimeAsync(0);expect(onFailure).toHaveBeenCalledWith(1);await vi.advanceTimersByTimeAsync(1000);expect(apply).toHaveBeenCalledWith('recovered');stop();
});

it('backs off repeated failures and returns to the normal interval after recovery',async()=>{
 vi.useFakeTimers();const load=vi.fn().mockRejectedValueOnce(Error('down')).mockRejectedValueOnce(Error('down')).mockResolvedValue('ok');
 const stop=startAgentActivityPolling({load,apply:vi.fn(),isBusy:()=>false,isVisible:()=>true,version:()=>0,intervalMs:1000});
 await vi.advanceTimersByTimeAsync(0);await vi.advanceTimersByTimeAsync(1000);expect(load).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(1000);expect(load).toHaveBeenCalledTimes(2);
 await vi.advanceTimersByTimeAsync(1000);expect(load).toHaveBeenCalledTimes(3);
 await vi.advanceTimersByTimeAsync(1000);expect(load).toHaveBeenCalledTimes(4);stop();
});

it('serializes independent page subscriptions and skips a queued read after unmount',async()=>{
 vi.useFakeTimers();let resolve:(value:string)=>void=()=>{};
 const first=vi.fn(()=>new Promise<string>(done=>{resolve=done;})),second=vi.fn().mockResolvedValue('second');
 const base={apply:vi.fn(),isBusy:()=>false,isVisible:()=>true,version:()=>0,intervalMs:1000};
 const stopFirst=startAgentActivityPolling({...base,load:first});
 const stopSecond=startAgentActivityPolling({...base,load:second});
 await vi.advanceTimersByTimeAsync(0);expect(first).toHaveBeenCalledOnce();expect(second).not.toHaveBeenCalled();
 stopSecond();resolve('first');await vi.advanceTimersByTimeAsync(0);expect(second).not.toHaveBeenCalled();stopFirst();
});
it('lets another subscription proceed after the first read fails',async()=>{
 vi.useFakeTimers();let reject:(error:Error)=>void=()=>{};
 const first=vi.fn(()=>new Promise<string>((_,fail)=>{reject=fail;})),second=vi.fn().mockResolvedValue('second');
 const base={apply:vi.fn(),isBusy:()=>false,isVisible:()=>true,version:()=>0,intervalMs:1000};
 const stopFirst=startAgentActivityPolling({...base,load:first});const stopSecond=startAgentActivityPolling({...base,load:second});
 await vi.advanceTimersByTimeAsync(0);expect(second).not.toHaveBeenCalled();reject(Error('timeout'));await vi.advanceTimersByTimeAsync(0);expect(second).toHaveBeenCalledOnce();stopFirst();stopSecond();
});
