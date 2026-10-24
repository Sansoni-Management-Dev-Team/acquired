import {AsyncLocalStorage} from 'node:async_hooks';
import {z} from 'zod';
const schema=z.object({id:z.string().uuid().nullable(),organizationId:z.string().min(1).max(200),ownerUserId:z.string().min(1).max(200)}).strict();
export type AcquisitionWorkflowContext=z.infer<typeof schema>;
const contexts=new AsyncLocalStorage<AcquisitionWorkflowContext>();
/** Server-resolved identity only. Explicit null denotes original legacy work;
 * it must not be upgraded to whichever execution currently owns the mandate. */
export function withAcquisitionWorkflowContext<T>(context:AcquisitionWorkflowContext,work:()=>T):T{return contexts.run(Object.freeze(schema.parse(context)),work);}
export function acquisitionWorkflowContext(){return contexts.getStore();}
/** Call only after loading/authenticating the saved job, never with request fields. */
export function withResearchJobWorkflow<T>(job:{workflowExecutionId?:string|null;organizationId:string;createdBy:string},work:()=>T):T{
 if(!job.workflowExecutionId)return contexts.run(Object.freeze({id:null,organizationId:job.organizationId??'',ownerUserId:job.createdBy??''}),work);
 return withAcquisitionWorkflowContext({id:job.workflowExecutionId,organizationId:job.organizationId,ownerUserId:job.createdBy},work);
}
