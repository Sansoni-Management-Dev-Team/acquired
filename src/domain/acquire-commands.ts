import { z } from 'zod';
import {companyProjectionRefreshResultSchema} from './company-projection-refresh';
import { briefSchema, type MandateView } from './acquisition';
import { agentSnapshot, type AgentResearchJob } from './agent-mode';
import {companyIdentityDecisionSchema,companyIdentityReviewSchema,companyIdentityDecisionReceiptSchema,type CompanyIdentityReview,type CompanyIdentityDecision,type CompanyIdentityDecisionReceipt} from './company-identity-review';
const actorSchema=z.object({organizationId:z.string().min(1).max(200),userId:z.string().min(1).max(200)}).strict();
export type AcquireActor=z.infer<typeof actorSchema>;
const input=z.object({mandateId:z.string().uuid()}).strict();
const mutationInput=input.extend({brief:briefSchema,expectedRevision:z.string().regex(/^\d{1,30}$/)}).strict();
const requestSchema=z.discriminatedUnion('name',[
 z.object({name:z.literal('mandate.read'),input}).strict(),
 z.object({name:z.literal('research.status'),input}).strict(),
 z.object({name:z.literal('mandate.update'),input:mutationInput}).strict(),
 z.object({name:z.literal('company.identity.list'),input}).strict(),
 z.object({name:z.literal('company.identity.reconcile'),input}).strict(),
 z.object({name:z.literal('company.identity.decide'),input:z.object({mandateId:z.string().uuid(),decision:companyIdentityDecisionSchema}).strict()}).strict(),
]);
const mandateSchema=z.object({id:z.string().uuid(),brief:briefSchema,createdAt:z.string().datetime(),revision:z.string().regex(/^\d{1,30}$/).optional(),companyProjectionRefresh:companyProjectionRefreshResultSchema.optional()});
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
 z.object({name:z.literal('company.identity.list'),status:z.literal('observed'),value:z.object({reviews:z.array(companyIdentityReviewSchema).max(50)}).strict()}),
 z.object({name:z.literal('company.identity.decide'),status:z.literal('completed'),value:companyIdentityDecisionReceiptSchema}),
 z.object({name:z.literal('company.identity.reconcile'),status:z.literal('completed'),value:z.object({resolved:z.number().int().min(0).max(50)}).strict()}),
]);
export const acquireCommandCatalog={
 'mandate.read':{effect:'read',permission:'mandate.read',inputSchema:input},
 'research.status':{effect:'read',permission:'research.read',inputSchema:input},
 'mandate.update':{effect:'write',permission:'mandate.write',inputSchema:mutationInput},
 'company.identity.list':{effect:'read',permission:'company.identity.read',inputSchema:input},
 'company.identity.reconcile':{effect:'write',permission:'company.identity.review',inputSchema:input},
 'company.identity.decide':{effect:'write',permission:'company.identity.review',inputSchema:z.object({mandateId:z.string().uuid(),decision:companyIdentityDecisionSchema}).strict(),humanReviewRequired:true},
} as const;
export type AcquireCommandDependencies={
 assertMember(actor:AcquireActor):Promise<void>;
 getMandate(actor:AcquireActor,id:string):Promise<MandateView|undefined>;
 listResearch(actor:AcquireActor,id:string):Promise<AgentResearchJob[]>;
 updateMandate(actor:AcquireActor,id:string,brief:MandateView['brief'],expectedRevision:string):Promise<MandateView>;
 listCompanyIdentityReviews?(actor:AcquireActor,id:string):Promise<CompanyIdentityReview[]>;
 reconcileCompanyIdentities?(actor:AcquireActor,id:string):Promise<{resolved:number}>;
 decideCompanyIdentity?(actor:AcquireActor,id:string,decision:CompanyIdentityDecision):Promise<CompanyIdentityDecisionReceipt>;
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
  if(request.name==='company.identity.list'){
   if(!deps.listCompanyIdentityReviews)throw new AcquireCommandError('Company identity review is unavailable.',503);
   const reviews=z.array(companyIdentityReviewSchema).max(50).parse(await deps.listCompanyIdentityReviews(actor,mandate.id));
   if(reviews.some(review=>review.source.mandateId!==mandate.id))throw new AcquireCommandError('Company review scope mismatch.',503);
   return resultSchema.parse({name:request.name,status:'observed',value:{reviews}});
  }
  if(request.name==='company.identity.reconcile'){
   if(!deps.reconcileCompanyIdentities)throw new AcquireCommandError('Company identity reconciliation is unavailable.',503);
   return resultSchema.parse({name:request.name,status:'completed',value:await deps.reconcileCompanyIdentities(actor,mandate.id)});
  }
  if(request.name==='company.identity.decide'){
   if(!deps.decideCompanyIdentity)throw new AcquireCommandError('Company identity review is unavailable.',503);
   const {decision}=request.input;
   const value=companyIdentityDecisionReceiptSchema.parse(await deps.decideCompanyIdentity(actor,mandate.id,decision));
   const matches=value.reviewId===decision.reviewId&&(decision.decision==='adopt'?value.status==='adopted'&&value.targetId===decision.selectedTargetId:value.status==='skipped');
   if(!matches)throw new AcquireCommandError('Company review identity mismatch.',503);
   return resultSchema.parse({name:request.name,status:'completed',value});
  }
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
