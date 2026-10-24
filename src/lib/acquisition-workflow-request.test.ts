import {expect,it,vi} from 'vitest';
import {saveAcquisitionWorkflowRequest,workflowDestination} from './acquisition-workflow-request';
const requestId='10000000-0000-4000-8000-000000000001',mandateId='20000000-0000-4000-8000-000000000002';
const input={requestId,preset:'demo' as const,presentation:'agent' as const};
const result={id:requestId,mandateId,preset:'demo',presentation:'agent',state:'accepted',revision:1};
it('accepts a durable execution separately from its existing mandate',async()=>{const fetcher=vi.fn().mockResolvedValue(Response.json(result));expect(await saveAcquisitionWorkflowRequest(JSON.stringify(input),fetcher)).toEqual(result);expect(fetcher).toHaveBeenCalledOnce();expect(workflowDestination(result as never)).toBe(`/mandates/${mandateId}/agent`);});
it('reconciles a lost response without posting again or selecting another source',async()=>{const fetcher=vi.fn().mockRejectedValueOnce(Error('network')).mockResolvedValueOnce(Response.json(result));expect(await saveAcquisitionWorkflowRequest(JSON.stringify(input),fetcher)).toEqual(result);expect(fetcher.mock.calls.map(([url])=>url)).toEqual(['/api/acquisition-workflows',`/api/acquisition-workflows?requestId=${requestId}`]);expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);});
it('does not treat another execution or changed routing as the saved request',async()=>{const fetcher=vi.fn().mockResolvedValueOnce(Response.json({...result,id:mandateId})).mockResolvedValueOnce(Response.json({...result,preset:'live'}));await expect(saveAcquisitionWorkflowRequest(JSON.stringify(input),fetcher)).rejects.toThrow('same saved request');});
it('preserves a useful no-source refusal and never falls back to live',async()=>{const fetcher=vi.fn().mockResolvedValue(Response.json({error:'No unused saved mandate is available.'},{status:409}));await expect(saveAcquisitionWorkflowRequest(JSON.stringify(input),fetcher)).rejects.toThrow('No unused saved mandate');expect(fetcher).toHaveBeenCalledOnce();});
it('uses a safe message for empty responses and leaves retry identity to the caller',async()=>{const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(Response.json({status:'missing'}));await expect(saveAcquisitionWorkflowRequest(JSON.stringify(input),fetcher)).rejects.toThrow('same saved request');expect(fetcher.mock.calls[0][1].body).toBe(JSON.stringify(input));});
it('opens a research-only run in its result table, even with agent presentation',()=>{expect(workflowDestination({...result,preset:'live-research-test'} as never)).toBe(`/mandates/${mandateId}?tab=targets`);});
it('reconciles a saved request when new workflow starts have been disabled',async()=>{
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:'Shared workflows are unavailable.'},{status:404})).mockResolvedValueOnce(Response.json(result));
 expect(await saveAcquisitionWorkflowRequest(JSON.stringify(input),fetcher)).toEqual(result);
 expect(fetcher).toHaveBeenCalledTimes(2);
});
