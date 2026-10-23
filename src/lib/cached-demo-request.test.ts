import{afterEach,expect,it,vi}from'vitest';
import{saveCachedDemoRequest}from'./cached-demo-request';
const id='10000000-0000-4000-8000-000000000001',source='10000000-0000-4000-8000-000000000002';
const input={native:true,body:JSON.stringify({requestId:id}),sourceMandateId:source,onReconcile:vi.fn()};
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it('checks progress until the original saved request finishes, with one POST only',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn().mockRejectedValueOnce(new DOMException('timeout','TimeoutError')).mockResolvedValueOnce(Response.json({status:'missing'})).mockResolvedValueOnce(Response.json({status:'preparing'})).mockResolvedValueOnce(Response.json({status:'ready',id,revision:'8'}));
 const result=saveCachedDemoRequest(input,fetcher);await vi.advanceTimersByTimeAsync(4001);expect(await result).toEqual({status:'ready',id,revision:'8'});expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);expect(input.onReconcile).toHaveBeenCalledOnce();
});
it('does not reconcile or retry a definitive conflict',async()=>{const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:'Original source changed'},{status:409}));await expect(saveCachedDemoRequest(input,fetcher)).rejects.toThrow('Original source changed');expect(fetcher).toHaveBeenCalledOnce();});
it('keeps read-only recovery bounded when a status check is temporarily unavailable',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn().mockRejectedValueOnce(Error('lost acknowledgement')).mockRejectedValueOnce(new DOMException('timeout','TimeoutError')).mockResolvedValueOnce(Response.json({error:'temporarily unavailable'},{status:503})).mockResolvedValueOnce(Response.json({status:'ready',id,revision:'8'}));
 const result=saveCachedDemoRequest(input,fetcher).catch(e=>e);await vi.advanceTimersByTimeAsync(4001);expect(await result).toMatchObject({status:'ready',id,revision:'8'});expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
it('stops status recovery if authentication is lost',async()=>{const fetcher=vi.fn().mockRejectedValueOnce(Error('lost acknowledgement')).mockResolvedValueOnce(Response.json({error:'Sign in'},{status:401}));await expect(saveCachedDemoRequest(input,fetcher)).rejects.toThrow('same saved request');expect(fetcher).toHaveBeenCalledTimes(2);});
it('rejects a different saved request even if status says ready',async()=>{const fetcher=vi.fn().mockRejectedValueOnce(Error('connection')).mockResolvedValueOnce(Response.json({status:'ready',id:source,revision:'8'}));await expect(saveCachedDemoRequest(input,fetcher)).rejects.toThrow('same saved request');expect(fetcher).toHaveBeenCalledTimes(2);});
it('bounds reconciliation while preserving the request for a manual retry',async()=>{
 vi.useFakeTimers();const fetcher=vi.fn().mockImplementation(async()=>Response.json({status:'preparing'}));fetcher.mockRejectedValueOnce(new DOMException('timeout','TimeoutError'));
 const result=saveCachedDemoRequest(input,fetcher).catch(e=>e);await vi.advanceTimersByTimeAsync(10001);expect(await result).toMatchObject({message:expect.stringContaining('same saved request')});expect(fetcher).toHaveBeenCalledTimes(7);expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
