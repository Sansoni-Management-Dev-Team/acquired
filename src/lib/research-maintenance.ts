import {dispatchCompanyBackground} from './company-background-dispatch';
import {tickCompanyPeople} from './company-people-research';
import {scheduleResearchRun} from './research-scheduler';
import {researchWorker} from './research-service';
import type {ResearchRepository} from '@/db/research-repository';
import {terminalResearchStates,type ResearchConfig} from '@/domain/research';

/** Shared recovery pass. Callers supply their already authorised mandate scope.
 * A browser can defer background dispatch; an unattended caller awaits it.
 * This function does not select tenants, launch new mandates or grant authority.
 */
export async function maintainMandateResearch(org:string,id:string,initialJobs:Awaited<ReturnType<ResearchRepository['listReview']>>,repo:Pick<ResearchRepository,'recoverStopped'>,defer?:(work:()=>Promise<unknown>)=>void){
  if(initialJobs.some(job=>(job.config as ResearchConfig).companyBackgroundResearch && job.status==='queued')){
    if(defer)defer(()=>dispatchCompanyBackground(org,id));
    else await dispatchCompanyBackground(org,id);
  }
  let reviewChanged = false;
  for (const job of initialJobs.filter(j => !(j.config as ResearchConfig).companyBackgroundResearch && !terminalResearchStates.includes(j.status) && Date.now() - j.updatedAt.getTime() > 90000)) {
    try {
      const worker = await researchWorker(`/jobs/${job.id}`) as { status: string };
      if (["running", "waiting"].includes(worker.status) && Date.now() - job.updatedAt.getTime() > 10 * 60000) {
        const recovery = await researchWorker(`/jobs/${job.id}`, "POST", { action: "recover-stalled" }) as { recovered?: boolean };
        if (recovery.recovered) { await repo.recoverStopped(job.id, job.revision, job.pages); reviewChanged = true; }
      }
      if (["errored", "terminated", "complete"].includes(worker.status)) { await repo.recoverStopped(job.id, job.revision, job.pages); reviewChanged = true; }
    } catch { /* An unavailable status endpoint does not imply the job stopped. */ }
  }
  const recoveryRuns = new Set(initialJobs.flatMap(job => {
    const config = job.config as ResearchConfig;
    return config.mode === "automatic" ? [config.researchRunId || job.id] : [];
  }));
  for (const rootId of recoveryRuns) {
    const root = initialJobs.find(job => job.id === rootId);
    const settled = root && (root.config as ResearchConfig).parallelBusinessResearch && (root.config as ResearchConfig).parallelResearchSettled && (root.config as ResearchConfig).parallelResearchPendingTasks === 0 && terminalResearchStates.includes(root.status) && initialJobs.filter(j => (j.config as ResearchConfig).researchRunId === rootId).every(j => terminalResearchStates.includes(j.status));
    if (!root || settled || root.status === "cancelled" || Date.now() >= ((root.config as ResearchConfig).automaticDeadline || 0)) continue;
    try { if (await scheduleResearchRun(org, rootId, { recovery: true }) !== false) reviewChanged = true; }
    catch { reviewChanged = true; /* A partial pass may have saved queued jobs before failing. */ }
  }
  for (const job of initialJobs.filter(job => (job.config as ResearchConfig).includeCompanyPeople && !(job.config as ResearchConfig).companyPeopleProgress?.settled && (job.config as ResearchConfig).researchRunId === job.id && terminalResearchStates.includes(job.status))) {
    await tickCompanyPeople(job); reviewChanged = true;
  }
  return reviewChanged;
}
