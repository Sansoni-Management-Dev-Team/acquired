import {afterEach,expect,it,vi} from 'vitest';
import {researchWorker} from './research-service';
import {observeResearchRequest,setResearchDatabaseContext} from './research-request-observability';
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('correlates shared worker dispatch by mandate/run/job/request without exposing its secret or request contents',async()=>{
 vi.stubEnv('RESEARCH_WORKER_URL','http://127.0.0.1:8787');vi.stubEnv('RESEARCH_SERVICE_SECRET','PRIVATE-service-secret');
 const log=vi.spyOn(console,'info').mockImplementation(()=>{}),fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({ok:true}));vi.stubGlobal('fetch',fetcher);
 await observeResearchRequest(new Request('http://app/api/mandates/mandate-123/research',{headers:{'x-request-id':'request-123'}}),async()=>{
  setResearchDatabaseContext({runId:'root-123',operationId:'operation-123'});
  expect(await researchWorker('/jobs/job-123','POST',{private:'PRIVATE-body'})).toEqual({ok:true});return Response.json({ok:true});
 });
 const headers=new Headers(fetcher.mock.calls[0][1]?.headers);
 expect(headers.get('x-acquire-mandate-id')).toBe('mandate-123');expect(headers.get('x-acquire-research-run')).toBe('root-123');expect(headers.get('x-acquire-research-job')).toBe('job-123');expect(headers.get('x-acquire-agent-operation')).toBe('operation-123');expect(headers.get('x-request-id')).toBe('request-123');expect(headers.has('x-acquire-native-research-key')).toBe(false);
 const events=log.mock.calls.filter(([tag])=>tag==='research-provider').map(([,body])=>JSON.parse(body));expect(events.at(-1)).toMatchObject({mandateId:'mandate-123',runId:'root-123',jobId:'job-123',event:'request_completed'});expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE/);
});
it('logs sanitized worker failures without changing rejection semantics or retrying',async()=>{
 vi.stubEnv('RESEARCH_WORKER_URL','http://127.0.0.1:8787');vi.stubEnv('RESEARCH_SERVICE_SECRET','PRIVATE-secret');const log=vi.spyOn(console,'info').mockImplementation(()=>{}),fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({error:'PRIVATE-provider-body'},{status:503}));vi.stubGlobal('fetch',fetcher);
 await expect(researchWorker('/jobs/job-123','POST')).rejects.toThrow('Research service unavailable (503)');expect(fetcher).toHaveBeenCalledOnce();expect(log.mock.calls.some(([tag,body])=>tag==='research-provider'&&JSON.parse(body).event==='request_failed')).toBe(true);expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE/);
});
