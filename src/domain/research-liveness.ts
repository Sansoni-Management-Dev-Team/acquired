/** Company checkpoints and child callbacks are execution progress. People counter
 * refreshes are deliberately excluded; they can continue after execution stopped. */
type ExecutionJob = {
 id:string; organizationId:string; mandateId:string; createdBy:string; updatedAt:Date;
 config:unknown;
};
export function researchExecutionUpdatedAt(job:ExecutionJob,jobs:readonly ExecutionJob[]){
 let updated=job.updatedAt.getTime();
 for(const child of jobs){
  const config=child.config as {parentJobId?:string;researchTask?:string};
  if(child.organizationId===job.organizationId&&child.mandateId===job.mandateId&&child.createdBy===job.createdBy&&
    config.parentJobId===job.id&&config.researchTask==='company'){
   updated=Math.max(updated,child.updatedAt.getTime());
  }
 }
 return updated;
}
