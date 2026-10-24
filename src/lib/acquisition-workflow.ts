import type {Pool} from 'pg';
import type {AgentActor} from '@/db/agent-store';
import {AcquisitionWorkflowStore} from '@/db/acquisition-workflow-store';
import {acquisitionWorkflowStartSchema} from '@/domain/acquisition-workflow';
export {acquisitionWorkflowStartSchema};
export type {AcquisitionWorkflowExecution,AcquisitionWorkflowStart} from '@/domain/acquisition-workflow';
export function acquisitionWorkflowEnabled(){return process.env.ACQUISITION_WORKFLOW_ENABLED==='true';}
export class AcquisitionWorkflowError extends Error{
 constructor(message:string,readonly status:number){super(message);}
}
function failure(error:unknown):never{
 if(error instanceof AcquisitionWorkflowError)throw error;
 const code=error&&typeof error==='object'&&'code'in error?error.code:undefined;
 if(code==='02000')throw new AcquisitionWorkflowError('No unused saved research is available. Run a live research test first, then try the demo again.',409);
 if(code==='42501')throw new AcquisitionWorkflowError('This workflow is unavailable for your account.',403);
 if(code==='23505'||code==='40001'||code==='55000')throw new AcquisitionWorkflowError('This request conflicts with saved work. Refresh its status before starting another run.',409);
 if(code==='22023')throw new AcquisitionWorkflowError('The workflow request is invalid.',400);
 throw new AcquisitionWorkflowError('The workflow could not be confirmed. Check its saved status before retrying.',503);
}
export async function startAcquisitionWorkflow(pool:Pick<Pool,'connect'>,actor:AgentActor,raw:unknown){
 if(!acquisitionWorkflowEnabled())throw new AcquisitionWorkflowError('Shared workflows are not active yet.',404);
 const parsed=acquisitionWorkflowStartSchema.safeParse(raw);
 if(!parsed.success)throw new AcquisitionWorkflowError(parsed.error.issues.map(i=>i.message).join('; '),400);
 try{return await new AcquisitionWorkflowStore(pool,actor).start(parsed.data);}catch(e){return failure(e);}
}
export async function readAcquisitionWorkflow(pool:Pick<Pool,'connect'>,actor:AgentActor,id:string){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id))throw new AcquisitionWorkflowError('Invalid workflow request.',400);
 try{return await new AcquisitionWorkflowStore(pool,actor).read(id);}catch(e){return failure(e);}
}
/** Recovery reuses the persisted command. Provider work happens after admission commits. */
const resuming=new Map<string,Promise<Awaited<ReturnType<typeof readAcquisitionWorkflow>>>>();
export function resumeAcquisitionWorkflow(pool:Pool,actor:AgentActor,id:string){
 const key=JSON.stringify([actor.organizationId,actor.userId,id]);
 const existing=resuming.get(key);if(existing)return existing;
 const pending=resume(pool,actor,id).finally(()=>resuming.delete(key));resuming.set(key,pending);return pending;
}
async function resume(pool:Pool,actor:AgentActor,id:string){
 const current=await readAcquisitionWorkflow(pool,actor,id);
 if(!current)return null;
 if(['ready','complete','failed','cancelled','uncertain','outreach'].includes(current.state))return current;
 const {ensureWorkflowResearch}=await import('./acquisition-workflow-research');
 await ensureWorkflowResearch(pool,actor,current);
 return readAcquisitionWorkflow(pool,actor,id);
}
