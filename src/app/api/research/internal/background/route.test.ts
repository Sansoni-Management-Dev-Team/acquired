import {beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({enabled:vi.fn(),authorized:vi.fn(),observe:vi.fn(),maintain:vi.fn(),legacy:vi.fn()}));
vi.mock('@/lib/research-service',()=>({researchEnabled:mocks.enabled,researchServiceAuthorized:mocks.authorized}));
vi.mock('@/lib/agent-initial-research-observer',()=>({observeScheduledInitialResearch:mocks.observe}));
vi.mock('@/lib/research-maintenance',()=>({maintainScheduledResearch:mocks.maintain}));
vi.mock('@/lib/company-background-dispatch',()=>({recoverCompanyBackground:mocks.legacy}));
import {POST} from './route';
beforeEach(()=>{vi.resetAllMocks();mocks.enabled.mockReturnValue(true);mocks.authorized.mockReturnValue(true);mocks.maintain.mockResolvedValue(3);mocks.observe.mockResolvedValue({checked:0,recovered:0,messages:0});});
it('runs the existing shared maintenance capability without a browser read',async()=>{
 const response=await POST(new Request('http://example.test/api/research/internal/background',{method:'POST'}));
 expect(await response.json()).toEqual({pending:3});expect(mocks.maintain).toHaveBeenCalledExactlyOnceWith();expect(mocks.legacy).not.toHaveBeenCalled();
});
it('requires the current service authority before maintenance',async()=>{
 mocks.authorized.mockReturnValue(false);expect((await POST(new Request('http://example.test',{method:'POST'}))).status).toBe(403);expect(mocks.maintain).not.toHaveBeenCalled();expect(mocks.observe).not.toHaveBeenCalled();
});

it('recovers marked initial research and persists chat observations through the existing service pass before maintenance',async()=>{
 const response=await POST(new Request('http://example.test/api/research/internal/background',{method:'POST'}));
 expect(await response.json()).toEqual({pending:3});expect(mocks.observe).toHaveBeenCalledExactlyOnceWith();expect(mocks.observe.mock.invocationCallOrder[0]).toBeLessThan(mocks.maintain.mock.invocationCallOrder[0]);
});

function request(signal?:AbortSignal){return new Request('http://example.test/api/research/internal/background',{method:'POST',signal});}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return{promise,resolve};}
it('shares observation and maintenance across concurrent scheduler requests',async()=>{
 const observation=deferred(),maintenance=deferred();
 mocks.observe.mockReturnValue(observation.promise);mocks.maintain.mockReturnValue(maintenance.promise.then(()=>3));
 const first=POST(request()),second=POST(request());
 await vi.waitFor(()=>expect(mocks.observe).toHaveBeenCalled());
 observation.resolve();await vi.waitFor(()=>expect(mocks.maintain).toHaveBeenCalled());
 const third=POST(request());maintenance.resolve();
 const responses=await Promise.all([first,second,third]);
 expect(mocks.observe).toHaveBeenCalledTimes(1);expect(mocks.maintain).toHaveBeenCalledTimes(1);
 for(const response of responses)expect(await response.json()).toEqual({pending:3});
 await POST(request());expect(mocks.observe).toHaveBeenCalledTimes(2);
});
it('does not attach unauthorized callers to a running pass',async()=>{
 const observation=deferred();mocks.observe.mockReturnValue(observation.promise);
 const first=POST(request());mocks.authorized.mockReturnValue(false);
 expect((await POST(request())).status).toBe(403);observation.resolve();await first;
 expect(mocks.observe).toHaveBeenCalledTimes(1);
});
it('keeps shared work alive when one caller disconnects',async()=>{
 const observation=deferred();mocks.observe.mockReturnValue(observation.promise);
 const controller=new AbortController();const first=POST(request(controller.signal));controller.abort();
 const second=POST(request());observation.resolve();await Promise.all([first,second]);
 expect(mocks.observe).toHaveBeenCalledTimes(1);expect(mocks.maintain).toHaveBeenCalledTimes(1);
});
it('returns sanitized JSON on failure and permits a later pass',async()=>{
 mocks.observe.mockRejectedValueOnce(new Error('private database details'));
 const response=await POST(request());expect(response.status).toBe(503);
 expect(await response.json()).toEqual({error:'Background research is temporarily unavailable',status:'unavailable'});
 expect(response.headers.get('Retry-After')).toBe('30');expect(mocks.maintain).not.toHaveBeenCalled();
 expect((await POST(request())).status).toBe(200);expect(mocks.observe).toHaveBeenCalledTimes(2);
});

it('releases the whole-pass guard after maintenance fails',async()=>{
 mocks.maintain.mockRejectedValueOnce(new Error('maintenance unavailable'));
 const responses=await Promise.all([POST(request()),POST(request())]);
 expect(responses.map(response=>response.status)).toEqual([503,503]);
 expect(mocks.observe).toHaveBeenCalledTimes(1);expect(mocks.maintain).toHaveBeenCalledTimes(1);
 expect((await POST(request())).status).toBe(200);expect(mocks.maintain).toHaveBeenCalledTimes(2);
});
it('records phase durations without logging private failure details',async()=>{
 const log=vi.spyOn(console,'info').mockImplementation(()=>{});
 try{
  mocks.maintain.mockRejectedValueOnce(new Error('secret SQL and payload'));
  await POST(request());
  const entries=log.mock.calls.filter(call=>call[0]==='research-background').map(call=>JSON.parse(call[1]));
  expect(entries).toEqual([
   expect.objectContaining({event:'phase_finished',phase:'observation',durationMs:expect.any(Number),passDurationMs:expect.any(Number)}),
   expect.objectContaining({event:'phase_failed',phase:'maintenance',durationMs:expect.any(Number),passDurationMs:expect.any(Number)}),
  ]);
  expect(JSON.stringify(entries)).not.toContain('secret SQL');
 }finally{log.mockRestore();}
});

it('returns JSON before the scheduler timeout while retaining the guard for unfinished work',async()=>{
 vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date','performance']});const observation=deferred();mocks.observe.mockReturnValue(observation.promise);
 try{
  const first=POST(request());await vi.advanceTimersByTimeAsync(12001);expect((await first).status).toBe(503);
  const second=POST(request());expect(mocks.observe).toHaveBeenCalledTimes(1);
  observation.resolve();expect((await second).status).toBe(503);
 }finally{vi.useRealTimers();}
});
