import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {drizzle} from 'drizzle-orm/node-postgres';
const mocks=vi.hoisted(()=>({database:undefined as unknown}));
vi.mock('./client',()=>({requireDb:()=>mocks.database}));
import {saveResearchTimingSpans} from './research-timing-repository';
import {acquisitionWorkflowContext,withAcquisitionWorkflowContext,withResearchJobWorkflow} from '@/lib/acquisition-workflow-context';
import {bufferResearchTiming,configureResearchTelemetry,observeResearchRequest,researchJsonResponse} from '@/lib/research-request-observability';

const jobId='00000000-0000-4000-8000-000000000001',executionId='00000000-0000-4000-8000-000000000002';
const span={id:'00000000-0000-4000-8000-000000000003',step:'extract-1',segment:'extraction' as const,startedAt:'2026-10-01T00:00:00.000Z',finishedAt:'2026-10-01T00:00:01.000Z',elapsedMs:1000,outcome:'succeeded' as const};
const foreign={id:'00000000-0000-4000-8000-000000000004',organizationId:'different-org',ownerUserId:'different-creator'};
function fixture(workflowExecutionId:string|null=executionId){
 const writes:Array<{sql:string;context:ReturnType<typeof acquisitionWorkflowContext>}>=[];
 const lookup=vi.fn();
 const query=vi.fn(async(config:string|{text:string},values:unknown[])=>{
  const text=typeof config==='string'?config:config.text;
  if(/^select\b/i.test(text)){
   lookup(values);
   return{rows:values[0]===jobId&&values[1]==='saved-org'?[[workflowExecutionId,'saved-org','saved-creator']]:[]};
  }
  writes.push({sql:text,context:acquisitionWorkflowContext()});return{rows:[]};
 });
 mocks.database=drizzle({client:{query} as never});return{query,lookup,writes};
}
beforeEach(()=>{vi.spyOn(console,'info').mockImplementation(()=>{});});
afterEach(()=>{vi.restoreAllMocks();});

it('resolves original managed authority before writing standalone telemetry and leaves progress timestamps alone',async()=>{
 const f=fixture();
 await saveResearchTimingSpans(jobId,'saved-org',[span]);
 expect(f.lookup).toHaveBeenCalledOnce();
 expect(f.writes).toHaveLength(1);
 expect(f.writes[0].context).toEqual({id:executionId,organizationId:'saved-org',ownerUserId:'saved-creator'});
 expect(f.writes[0].sql).not.toMatch(/"updated_at"\s*=/);
 expect(acquisitionWorkflowContext()).toBeUndefined();
});
it('uses the persisted job identity instead of unrelated ambient workflow authority',async()=>{
 const f=fixture();
 await withAcquisitionWorkflowContext(foreign,async()=>{
  await saveResearchTimingSpans(jobId,'saved-org',[span]);
  expect(acquisitionWorkflowContext()).toEqual(foreign);
 });
 expect(f.writes[0].context).toEqual({id:executionId,organizationId:'saved-org',ownerUserId:'saved-creator'});
});
it('explicitly clears unrelated workflow authority for a persisted legacy job',async()=>{
 const f=fixture(null);
 await withAcquisitionWorkflowContext(foreign,()=>saveResearchTimingSpans(jobId,'saved-org',[span]));
 expect(f.writes[0].context).toEqual({id:null,organizationId:'saved-org',ownerUserId:'saved-creator'});
});
it.each([[jobId,'foreign-org'],['00000000-0000-4000-8000-000000000099','saved-org']])('refuses unknown job or mismatched organization without a write (%s, %s)',async(id,org)=>{
 const f=fixture();
 await expect(saveResearchTimingSpans(id,org,[span])).rejects.toThrow('Research timing job unavailable');
 expect(f.writes).toHaveLength(0);
});
it('resolves authority when buffered telemetry flushes after the parent job context exits',async()=>{
 const f=fixture();
 const response=await observeResearchRequest(new Request('https://example.com/api/research/internal/'+jobId),async()=>{
  await withResearchJobWorkflow({workflowExecutionId:executionId,organizationId:'saved-org',createdBy:'saved-creator'},async()=>{
   configureResearchTelemetry(true);expect(bufferResearchTiming(jobId,'saved-org',[span])).toBe(true);
  });
  expect(acquisitionWorkflowContext()).toBeUndefined();return researchJsonResponse({ok:true});
 });
 expect(response.status).toBe(200);
 expect(f.writes).toHaveLength(1);
 expect(f.writes[0].context).toEqual({id:executionId,organizationId:'saved-org',ownerUserId:'saved-creator'});
});
