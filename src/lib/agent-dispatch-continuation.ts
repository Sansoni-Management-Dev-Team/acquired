import {z} from 'zod';
import type {AgentEventOutcome} from '@/domain/agent-events';
const progress={preparationRoot:z.string().uuid().optional(),preparationStep:z.number().int().min(0).max(12).optional()};
/** Successful read/projection checkpoints get their own bounded event. Failed
 * reads still use the ordinary retry limit. No approval or send is created. */
export async function continueAgentDispatchPreparation(store:{enqueueEvent:(threadId:string,key:string,kind:string,payload:unknown)=>Promise<unknown>},input:{event:{id:string;thread_id:string;kind:string;payload:unknown};assertCurrent:()=>Promise<void>}):Promise<AgentEventOutcome>{
 const event=input.event;
 if(!['review.approved','email.proposed','whatsapp.proposed','linkedin.proposed'].includes(event.kind))throw Error('Unsupported dispatch continuation');
 const value=event.kind==='review.approved'?z.object({reviewBatchId:z.string().uuid(),...progress}).parse(event.payload):z.object({operationId:z.string().uuid(),...progress}).parse(event.payload);
 const root=z.string().uuid().parse(value.preparationRoot??event.id),step=value.preparationStep??0;
 if(step>=12)return {kind:'review',message:'Outreach preparation could not converge within its bounded checkpoints. Review saved progress before continuing.'};
 await input.assertCurrent();
 await store.enqueueEvent(event.thread_id,`dispatch-preparation:${root}:${step+1}`,event.kind,{...value,preparationRoot:root,preparationStep:step+1});
 return {kind:'complete'};
}
