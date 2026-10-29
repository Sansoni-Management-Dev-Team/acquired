import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({tick:vi.fn(),after:vi.fn()}));
vi.mock('./agent-native-tick',()=>({runNativeAgentTick:f.tick}));vi.mock('next/server',()=>({after:f.after}));
import {coalescedNativeAgentTick} from './agent-native-tick-coalesced';
import {wakeNativeAgentAfterCommit} from './agent-native-wake';
beforeEach(()=>{vi.clearAllMocks();f.tick.mockResolvedValue({enabled:true,processed:1,outcome:'complete'});});
it('coalesces scheduled and postcommit callers into exactly one retained tick',async()=>{let finish!:(v:unknown)=>void;f.tick.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const a=coalescedNativeAgentTick(),b=coalescedNativeAgentTick();expect(a).toBe(b);expect(f.tick).toHaveBeenCalledOnce();finish({enabled:true,processed:1,outcome:'complete'});await a;await coalescedNativeAgentTick();expect(f.tick).toHaveBeenCalledTimes(2);});
it('schedules exactly one bounded tick after response, without eagerly executing work',async()=>{wakeNativeAgentAfterCommit();expect(f.after).toHaveBeenCalledOnce();expect(f.tick).not.toHaveBeenCalled();await f.after.mock.calls[0][0]();expect(f.tick).toHaveBeenCalledOnce();});
it('does not turn a committed response into an error if wake fails',async()=>{f.tick.mockRejectedValueOnce(Error('private'));vi.spyOn(console,'info').mockImplementation(()=>{});wakeNativeAgentAfterCommit();await expect(f.after.mock.calls[0][0]()).resolves.toBeUndefined();await coalescedNativeAgentTick();expect(f.tick).toHaveBeenCalledTimes(2);vi.mocked(console.info).mockRestore();});
it('retains a postcommit wake arriving after discovery and runs one sequential follow-up',async()=>{
 let finish!:(v:unknown)=>void;f.tick.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
 const running=coalescedNativeAgentTick();const wake=coalescedNativeAgentTick({postCommit:true});
 await Promise.resolve();await Promise.resolve();expect(f.tick).toHaveBeenCalledOnce();
 finish({enabled:true,processed:0,outcome:'idle'});await Promise.all([running,wake]);expect(f.tick).toHaveBeenCalledTimes(2);
});
it('coalesces a burst and reentrant follow-up wakes into at most two ticks without overlap',async()=>{
 let first!:(v:unknown)=>void,second!:(v:unknown)=>void;
 f.tick.mockImplementationOnce(()=>new Promise(r=>{first=r;})).mockImplementationOnce(()=>new Promise(r=>{second=r;}));
 const running=coalescedNativeAgentTick();for(let i=0;i<20;i++)expect(coalescedNativeAgentTick({postCommit:true})).toBe(running);
 expect(f.tick).toHaveBeenCalledOnce();first({enabled:true,processed:1,outcome:'complete'});
 await vi.waitFor(()=>expect(f.tick).toHaveBeenCalledTimes(2));
 for(let i=0;i<20;i++)expect(coalescedNativeAgentTick({postCommit:true})).toBe(running);
 second({enabled:true,processed:1,outcome:'complete'});await running;expect(f.tick).toHaveBeenCalledTimes(2);
});
it.each(['AbortError','Error'])('does not retry %s even with a retained wake, and releases its lane',async name=>{
 let fail!:(e:Error)=>void;f.tick.mockImplementationOnce(()=>new Promise((_,reject)=>{fail=reject;}));
 const running=coalescedNativeAgentTick();coalescedNativeAgentTick({postCommit:true});const rejected=expect(running).rejects.toThrow('bounded');
 fail(Object.assign(new Error('bounded'),{name}));await rejected;expect(f.tick).toHaveBeenCalledOnce();
 await coalescedNativeAgentTick();expect(f.tick).toHaveBeenCalledTimes(2);
});
it.each([{enabled:false,processed:0},{enabled:true,processed:1,outcome:'defer'},{enabled:true,processed:1,outcome:'lost'},{enabled:true,processed:1,outcome:'review'}])('preserves non-drain outcome %j',async outcome=>{
 let finish!:(v:unknown)=>void;f.tick.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));
 const running=coalescedNativeAgentTick();coalescedNativeAgentTick({postCommit:true});finish(outcome);
 expect(await running).toEqual(outcome);expect(f.tick).toHaveBeenCalledOnce();
});
it('retains completed progress when the follow-up is idle so the driver does not enter idle backoff',async()=>{
 let finish!:(v:unknown)=>void;f.tick.mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockResolvedValueOnce({enabled:true,processed:0,outcome:'idle'});
 const running=coalescedNativeAgentTick();coalescedNativeAgentTick({postCommit:true});finish({enabled:true,processed:1,outcome:'complete'});
 expect(await running).toEqual({enabled:true,processed:1,outcome:'complete'});
});
