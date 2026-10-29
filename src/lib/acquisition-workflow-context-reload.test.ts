import {afterEach,expect,it,vi} from 'vitest';
afterEach(()=>vi.resetModules());
it('keeps cached database wrappers and reloaded callers in the same async context',async()=>{
 const original=await import('./acquisition-workflow-context');
 vi.resetModules();
 const reloaded=await import('./acquisition-workflow-context');
 const scope={id:'00000000-0000-4000-8000-000000000001',organizationId:'org',ownerUserId:'owner'};
 await reloaded.withAcquisitionWorkflowContext(scope,async()=>{
  await Promise.resolve();
  expect(original.acquisitionWorkflowContext()).toEqual(scope);
 });
 expect(original.acquisitionWorkflowContext()).toBeUndefined();
});
it('initializes authority in a pool cached before the caller module reloads',async()=>{
 const {acquisitionWorkflowPool}=await import('@/db/acquisition-workflow-pool');
 const client={query:vi.fn(async()=>({rows:[]})),release:vi.fn()};
 const pool=acquisitionWorkflowPool({connect:async()=>client,query:vi.fn()} as never);
 vi.resetModules();
 const caller=await import('./acquisition-workflow-context');
 const scope={id:'00000000-0000-4000-8000-000000000002',organizationId:'org',ownerUserId:'owner'};
 await caller.withAcquisitionWorkflowContext(scope,()=>pool.query('SELECT 1'));
 expect(client.query).toHaveBeenCalledWith(expect.stringContaining('app.acquire_workflow_execution'),['1',scope.id,'org','owner']);
 expect(client.release).toHaveBeenCalledOnce();
});
