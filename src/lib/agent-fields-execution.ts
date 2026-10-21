import{and,eq}from'drizzle-orm';
import{requireDb}from'@/db/client';
import{researchJobs}from'@/db/schema';
import{agentStore}from'./agent-runtime';
import{createNativeFieldsDependencies}from'./agent-fields-dependencies';
import{executeCompanyBackground}from'./company-background-execution';
import{assertNativeFieldsPersistence}from'./agent-fields-source';
import{assertNativeResearchPersistence}from'./agent-research-context';
import type{ResearchConfig}from'@/domain/research';
export async function executeNativeFieldsResearch(root:typeof researchJobs.$inferSelect,targetId:string){
 const config=root.config as ResearchConfig,meta=config.nativeAgent;if(meta?.providerAdmission!=='public-fields-v1')throw Error('Reviewed public-field root required');
 const store=agentStore({organizationId:root.organizationId,userId:root.createdBy}),plan=await store.nativeFieldsPlan(meta.threadId,meta.operationId),company=plan.selected.find(c=>c.targetId===targetId);if(!company)throw Error('Company is outside the exact public-field manifest');
 const db=requireDb(),child=(await db.select().from(researchJobs).where(and(eq(researchJobs.id,company.childJobId),eq(researchJobs.organizationId,root.organizationId))).limit(1))[0];if(!child||child.mandateId!==root.mandateId||(child.config as ResearchConfig).parentJobId!==root.id)throw Error('Exact saved public-field child required');
 if(['complete','partial','failed','cancelled'].includes(child.status))return{accepted:false,status:child.status};
 const deps=createNativeFieldsDependencies({store,threadId:meta.threadId,researchOperationId:meta.operationId,researchJobId:root.id,targetId});
 return executeCompanyBackground(child,false,{deadline:config.automaticDeadline,resolveAbn:deps.resolveAbn,researchFields:deps.researchFields,assertCurrent:async()=>{await store.nativeFieldsPlan(meta.threadId,meta.operationId);},beforePersist:async(tx,job)=>{await assertNativeResearchPersistence(tx,job);await assertNativeFieldsPersistence(tx,job);}});
}
export async function finishNativeFieldsResearch(root:typeof researchJobs.$inferSelect){
 const meta=(root.config as ResearchConfig).nativeAgent;if(meta?.providerAdmission!=='public-fields-v1')throw Error('Reviewed public-field root required');const store=agentStore({organizationId:root.organizationId,userId:root.createdBy}),plan=await store.nativeFieldsPlan(meta.threadId,meta.operationId),db=requireDb();let partial=false;
 for(const company of plan.selected){const child=(await db.select({status:researchJobs.status}).from(researchJobs).where(and(eq(researchJobs.id,company.childJobId),eq(researchJobs.organizationId,root.organizationId))).limit(1))[0];if(child?.status!=='complete')partial=true;}
 await db.transaction(async tx=>{await assertNativeResearchPersistence(tx,root);await tx.update(researchJobs).set({status:partial?'partial':'complete',updatedAt:new Date(),message:partial?'Public company fields retained with incomplete sources or budget coverage; review unresolved fields':'Public company fields settled; undisclosed values remain unknown'}).where(and(eq(researchJobs.id,root.id),eq(researchJobs.organizationId,root.organizationId)));});
 return store.finishNativeResearchJob(meta.threadId,meta.operationId);
}
