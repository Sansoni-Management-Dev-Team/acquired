import {mandateCompaniesHref} from '@/domain/mandate-navigation';
import {z} from 'zod';

const preset=z.enum(['demo','live-research-test','live']);
const presentation=z.enum(['agent','workspace']);
const identity=z.object({requestId:z.string().uuid(),preset,presentation});
export const savedWorkflowSchema=z.object({id:z.string().uuid(),mandateId:z.string().uuid(),preset,presentation,state:z.enum(['accepted','researching','ready','outreach','complete','failed','cancelled','uncertain']),revision:z.number().int().positive()});
export type SavedWorkflow = z.infer<typeof savedWorkflowSchema>;
export const workflowPendingStorageKey='acquire.pending-workflow.v1';
export function pendingWorkflowIdentity(body:string){try{return identity.parse(JSON.parse(body));}catch{return null;}}
export function workflowDestination(value:SavedWorkflow){return value.presentation==='agent'?`/mandates/${value.mandateId}/agent`:mandateCompaniesHref(value.mandateId);}
const unconfirmed='Could not confirm your workflow yet. Retry to check the same saved request.';
class WorkflowRequestRefused extends Error{}

/** One POST, then one bounded read of its original receipt. A network failure is
 * never permission to change source, transport, or request ID. */
export async function saveAcquisitionWorkflowRequest(body:string,fetcher:typeof fetch=fetch):Promise<SavedWorkflow>{
 const requested=pendingWorkflowIdentity(body);if(!requested)throw Error('Invalid workflow request.');
 function saved(raw:unknown){const parsed=savedWorkflowSchema.safeParse(raw);return parsed.success&&parsed.data.id===requested!.requestId&&parsed.data.preset===requested!.preset&&parsed.data.presentation===requested!.presentation?parsed.data:null;}
 try{
  const response=await fetcher('/api/acquisition-workflows',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(15000)});
  if(response.status<500&&![404,408,429].includes(response.status)){
   const raw=await response.json();
   if(!response.ok)throw new WorkflowRequestRefused(typeof raw?.error==='string'?raw.error:'Could not start this workflow.');
   const value=saved(raw);if(value)return value;
  }
 }catch(error){if(error instanceof WorkflowRequestRefused)throw error;}
 try{
  const response=await fetcher('/api/acquisition-workflows?'+new URLSearchParams({requestId:requested.requestId}),{cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(response.ok){const value=saved(await response.json());if(value)return value;}
 }catch{/* Keep the original body for an explicit retry after an uncertain response. */}
 throw Error(unconfirmed);
}
