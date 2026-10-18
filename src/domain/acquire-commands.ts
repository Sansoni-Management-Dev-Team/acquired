import { z } from 'zod';
import { briefSchema, type MandateView } from './acquisition';
import { agentSnapshot, type AgentResearchJob } from './agent-mode';
const actorSchema=z.object({organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)}).strict();
export type AcquireActor=z.infer<typeof actorSchema>;
const input=z.object({mandateId:z.string().uuid()}).strict();
const mutationInput=input.extend({brief:briefSchema,expectedRevision:z.string().regex(/^\d{1,30}$/)}).strict();
const requestSchema=z.discriminatedUnion('name',[
 z.object({name:z.literal('mandate.read'),input}).strict(),
 z.object({name:z.literal('research.status'),input}).strict(),
 z.object({name:z.literal('mandate.update'),input:mutationInput}).strict(),
]);
const mandateSchema=z.object({id:z.string().uuid(),brief:briefSchema,createdAt:z.string().datetime(),revision:z.string().regex(/^\d{1,30}$/).optional()});
const count=z.number().int().nonnegative();
const snapshotSchema=z.object({
 mandate:z.object({id:z.string().uuid(),name:z.string(),description:z.string()}),scope:z.literal('research-only'),
 research:z.object({total:count,queued:count,active:count,complete:count,needsReview:count,cancelled:count}),
 jobs:z.array(z.object({id:z.string().optional(),status:z.string(),updatedAt:z.union([z.date(),z.string()]).optional(),message:z.string().optional(),pages:count,modelCalls:count}).transform(job=>({...job,id:job.id,updatedAt:job.updatedAt,message:job.message}))),
 links:z.object({brief:z.string(),companies:z.string()}),
});
const resultSchema=z.discriminatedUnion('name',[
 z.object({name:z.literal('mandate.read'),status:z.literal('observed'),value:mandateSchema}),
 z.object({name:z.literal('research.status'),status:z.literal('observed'),value:snapshotSchema}),
 z.object({name:z.literal('mandate.update'),status:z.literal('completed'),value:mandateSchema.required({revision:true})}),
]);
export const acquireCommandCatalog={
 'mandate.read':{effect:'read',permission:'mandate.read',inputSchema:input},
 'research.status':{effect:'read',permission:'research.read',inputSchema:input},
 'mandate.update':{effect:'write',permission:'mandate.write',inputSchema:mutationInput},
} as const;
export type AcquireCommandDependencies={
 assertMember(actor:AcquireActor):Promise<void>;
 getMandate(actor:AcquireActor,id:string):Promise<MandateView|undefined>;
 listResearch(actor:AcquireActor,id:string):Promise<AgentResearchJob[]>;
 updateMandate(actor:AcquireActor,id:string,brief:MandateView['brief'],expectedRevision:string):Promise<MandateView>;
};
export class AcquireCommandError extends Error { constructor(message:string,readonly status:number){super(message);} }
/** Both manual HTTP and agent adapters use this boundary. No provider/SQL tool. */
export function createAcquireCommands(deps:AcquireCommandDependencies) {
 return {async execute(serverActor:AcquireActor,raw:unknown){
  const actor=actorSchema.parse(serverActor);const request=requestSchema.parse(raw);
  await deps.assertMember(actor);
  const saved=await deps.getMandate(actor,request.input.mandateId);
  if(!saved)throw new AcquireCommandError('Mandate not found',404);
  const mandate=mandateSchema.parse(saved);
  if(mandate.id!==request.input.mandateId)throw new AcquireCommandError("Mandate identity mismatch",503);
  if(request.name==='mandate.read')return resultSchema.parse({name:request.name,status:'observed',value:mandate});
  if(request.name==='mandate.update'){
   if(mandate.revision!==request.input.expectedRevision)throw new AcquireCommandError('The saved brief changed. Reload it before saving your changes.',409);
   const value=await deps.updateMandate(actor,mandate.id,request.input.brief,request.input.expectedRevision);
   if(value.id!==mandate.id)throw new AcquireCommandError('Mandate identity mismatch',503);
   return resultSchema.parse({name:request.name,status:'completed',value});
  }
  const jobs=await deps.listResearch(actor,mandate.id);
  return resultSchema.parse({name:request.name,status:'observed',value:agentSnapshot(mandate,jobs)});
 }};
}
