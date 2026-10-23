import {afterEach,expect,it,vi} from 'vitest';
import {readAgentStatus} from './agent-read-request';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});
function delayedResponse(ms:number){
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(new DOMException('Timed out','TimeoutError')),ms);return c.signal;});
 vi.stubGlobal('fetch',vi.fn((_url:string,options:RequestInit)=>new Promise<Response>((resolve,reject)=>{const timer=setTimeout(()=>resolve(Response.json({saved:true})),ms);options.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal?.reason);},{once:true});})));
}
it('allows a measured 23-second bundled read to return saved progress',async()=>{delayedResponse(23000);const result=readAgentStatus('/activity',new AbortController().signal);await vi.advanceTimersByTimeAsync(23000);expect(await result).toEqual({saved:true});expect(fetch).toHaveBeenCalledTimes(1);});
it('bounds a stuck read without retrying',async()=>{delayedResponse(40000);const result=expect(readAgentStatus('/activity',new AbortController().signal)).rejects.toThrow('Timed out');await vi.advanceTimersByTimeAsync(30000);await result;expect(fetch).toHaveBeenCalledTimes(1);});
it('preserves caller cancellation',async()=>{delayedResponse(23000);const c=new AbortController();const result=expect(readAgentStatus('/activity',c.signal)).rejects.toThrow('Unmounted');c.abort(new Error('Unmounted'));await result;expect(fetch).toHaveBeenCalledTimes(1);});

it('retains the bundled-control header without changing the read-only request',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({saved:true})));await readAgentStatus('/execution',new AbortController().signal,{'X-Acquire-Control-Snapshot':'1'});
 expect(fetch).toHaveBeenCalledWith('/execution',expect.objectContaining({cache:'no-store',headers:{'X-Acquire-Control-Snapshot':'1'}}));
});
