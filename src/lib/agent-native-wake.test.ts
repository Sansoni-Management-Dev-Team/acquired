import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({tick:vi.fn(),after:vi.fn()}));
vi.mock('./agent-native-tick',()=>({runNativeAgentTick:f.tick}));vi.mock('next/server',()=>({after:f.after}));
import {coalescedNativeAgentTick} from './agent-native-tick-coalesced';
import {wakeNativeAgentAfterCommit} from './agent-native-wake';
beforeEach(()=>{vi.clearAllMocks();f.tick.mockResolvedValue({enabled:true,processed:1,outcome:'complete'});});
it('coalesces scheduled and postcommit callers into exactly one retained tick',async()=>{let finish!:(v:unknown)=>void;f.tick.mockImplementationOnce(()=>new Promise(r=>{finish=r;}));const a=coalescedNativeAgentTick(),b=coalescedNativeAgentTick();expect(a).toBe(b);expect(f.tick).toHaveBeenCalledOnce();finish({enabled:true,processed:1,outcome:'complete'});await a;await coalescedNativeAgentTick();expect(f.tick).toHaveBeenCalledTimes(2);});
it('schedules exactly one bounded tick after response, without eagerly executing work',async()=>{wakeNativeAgentAfterCommit();expect(f.after).toHaveBeenCalledOnce();expect(f.tick).not.toHaveBeenCalled();await f.after.mock.calls[0][0]();expect(f.tick).toHaveBeenCalledOnce();});
it('does not turn a committed response into an error if wake fails',async()=>{f.tick.mockRejectedValueOnce(Error('private'));vi.spyOn(console,'info').mockImplementation(()=>{});wakeNativeAgentAfterCommit();await expect(f.after.mock.calls[0][0]()).resolves.toBeUndefined();await coalescedNativeAgentTick();expect(f.tick).toHaveBeenCalledTimes(2);vi.mocked(console.info).mockRestore();});
