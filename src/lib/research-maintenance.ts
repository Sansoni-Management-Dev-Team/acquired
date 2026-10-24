import {safeResearchFailure} from '@/domain/research-trace-context';
import {withResearchJobWorkflow} from './acquisition-workflow-context';
import {backgroundRemaining} from './background-workload';
import {dispatchCompanyBackground,recoverCompanyBackground} from './company-background-dispatch';
import {tickCompanyPeople} from './company-people-research';
import {scheduleResearchRun} from './research-scheduler';
import {researchEnabled,researchWorker} from './research-service';
import type {ResearchRepository} from '@/db/research-repository';
import {terminalResearchStates,type ResearchConfig} from '@/domain/research';

function traceMaintenance(event:string,scope:{organizationId:string;mandateId?:string;jobId?:string},counts:Record<string,string|number|boolean>={}){
  console.info('research-maintenance',JSON.stringify({event,module:'research.maintenance',timestamp:new Date().toISOString(),...scope,...counts}));
}

/** Shared recovery pass. Callers supply their already authorised mandate scope.
 * A browser can defer background dispatch; an unattended caller awaits it.
 * This function does not select tenants, launch new mandates or grant authority.
 */
export async function maintainMandateResearch(org:string,id:string,initialJobs:Awaited<ReturnType<ResearchRepository['listReview']>>,repo:Pick<ResearchRepository,'recoverStopped'>,defer?:(work:()=>Promise<unknown>)=>void,now=Date.now(),deadline=Infinity){
  // Native operations have a separate reviewed capability/lease and their own
  // original receipts. A normal recovery scope must never advance them.
  initialJobs=initialJobs.filter(job=>!(job.config as ResearchConfig).nativeAgent);
  if(performance.now()<deadline&&initialJobs.some(job=>(job.config as ResearchConfig).companyBackgroundResearch && job.status==='queued')){
    if(defer)defer(()=>dispatchCompanyBackground(org,id));
    else await dispatchCompanyBackground(org,id);
  }
  let reviewChanged = false;
  const stopped=new Set<string>();
  for (const job of initialJobs.filter(j => !(j.config as ResearchConfig).companyBackgroundResearch && !terminalResearchStates.includes(j.status) && now - j.updatedAt.getTime() > 90000)) {
    if(performance.now()>=deadline)break;
    try {
      const worker = await researchWorker(`/jobs/${job.id}`,'GET',undefined,Math.max(1,Math.min(4000,deadline-performance.now()))) as { status: string };
      traceMaintenance('worker_status_observed',{organizationId:org,mandateId:id,jobId:job.id},{stopped:['errored','terminated','complete'].includes(worker.status),stalled:['running','waiting'].includes(worker.status)&&now-job.updatedAt.getTime()>600000});
      if (["running", "waiting"].includes(worker.status) && now - job.updatedAt.getTime() > 10 * 60000) {
        if(performance.now()>=deadline)break;
        const recovery = await researchWorker(`/jobs/${job.id}`, "POST", { action: "recover-stalled" },Math.max(1,Math.min(4000,deadline-performance.now()))) as { recovered?: boolean };
        if (recovery.recovered) { await withResearchJobWorkflow(job,()=>repo.recoverStopped(job.id, job.revision, job.pages)); stopped.add(job.id); reviewChanged = true; }
      }
      if (["errored", "terminated", "complete"].includes(worker.status)) { await withResearchJobWorkflow(job,()=>repo.recoverStopped(job.id, job.revision, job.pages)); stopped.add(job.id); reviewChanged = true; }
    } catch { traceMaintenance('worker_status_unavailable',{organizationId:org,mandateId:id,jobId:job.id}); /* Unavailable never means stopped. */ }
  }
  const recoveryRuns = new Set(initialJobs.flatMap(job => {
    const config = job.config as ResearchConfig;
    return config.mode === "automatic" ? [config.researchRunId || job.id] : [];
  }));
  for (const rootId of recoveryRuns) {
    if(performance.now()>=deadline)break;
    const root = initialJobs.find(job => job.id === rootId);
    const settled = root && (root.config as ResearchConfig).parallelBusinessResearch && (root.config as ResearchConfig).parallelResearchSettled && (root.config as ResearchConfig).parallelResearchPendingTasks === 0 && terminalResearchStates.includes(root.status) && initialJobs.filter(j => (j.config as ResearchConfig).researchRunId === rootId).every(j => terminalResearchStates.includes(j.status));
    if (!root || stopped.has(rootId) || settled || ["failed","cancelled"].includes(root.status) || now >= ((root.config as ResearchConfig).automaticDeadline || 0)) continue;
    try { if (await scheduleResearchRun(org, rootId, { recovery: true }) !== false) reviewChanged = true; }
    catch { reviewChanged = true; traceMaintenance('scheduling_recovery_deferred',{organizationId:org,mandateId:id,jobId:rootId}); /* A partial pass may have saved queued jobs before failing. */ }
  }
  for (const job of initialJobs.filter(job => (job.config as ResearchConfig).includeCompanyPeople && !(job.config as ResearchConfig).companyPeopleProgress?.settled && (!(job.config as ResearchConfig).researchRunId || (job.config as ResearchConfig).researchRunId === job.id) && ['complete','partial'].includes(job.status))) {
    if(performance.now()>=deadline)break;
    await withResearchJobWorkflow(job,()=>tickCompanyPeople(job)); reviewChanged = true;
  }
  return reviewChanged;
}

/** One persisted mandate scope for both explicit recovery and the scheduled worker.
 * Current memberships, rather than the original target owner, determine its People
 * refresh scope. Original run receipts and the existing claim/fencing remain intact.
 */
export async function recoverMandateResearch(org:string,id:string,now=Date.now(),deadline=Infinity){
  if(!researchEnabled())return false;
  const [{requireDb},{ResearchRepository},{FirmableHistoryRepository},{mandateTargets},{and,eq},{recoverFirmableRefreshes}]=await Promise.all([
    import('@/db/client'),import('@/db/research-repository'),import('@/db/firmable-history-repository'),import('@/db/schema'),import('drizzle-orm'),import('./firmable-run-recovery'),
  ]);
  const db=requireDb(),repo=new ResearchRepository(org);
  const jobs=await repo.listReview(id);
  traceMaintenance('mandate_recovery_started',{organizationId:org,mandateId:id},{jobs:jobs.length});
  const changed=await maintainMandateResearch(org,id,jobs,repo,undefined,now,deadline);
  if(performance.now()>=deadline)return changed;
  const memberships=await db.select({id:mandateTargets.targetId}).from(mandateTargets).where(and(eq(mandateTargets.organizationId,org),eq(mandateTargets.mandateId,id)));
  const history=new FirmableHistoryRepository(db);
  const runs=await history.latestRuns(org,memberships.map(member=>member.id));
  await recoverFirmableRefreshes(history,runs,id,now);
  traceMaintenance('mandate_recovery_completed',{organizationId:org,mandateId:id},{changed,memberships:memberships.length,refreshRuns:runs.length});
  return changed;
}

/** The existing periodic endpoint calls this instead of relying on open GUI polls.
 * Bounded database-derived scopes only; existing workflow IDs, claims and leases
 * arbitrate overlapping passes. Native actions keep their own authority/receipts.
 */
let scheduledResearchPass:Promise<number>|undefined;
export function maintainScheduledResearch(now=Date.now()):Promise<number>{
  if(!researchEnabled())return Promise.resolve(0);
  // This deployment has one persistent app process. A late cron request shares
  // the existing pass instead of starting another global scan beside it.
  return scheduledResearchPass??=runScheduledResearch(now).finally(()=>{scheduledResearchPass=undefined;});
}
async function runScheduledResearch(now:number){
  const deadline=performance.now()+Math.min(10000,backgroundRemaining());
  await recoverCompanyBackground(deadline);
  if(performance.now()>=deadline)return 0;
  const [{requireDb},{researchJobs,firmableSyncRuns,mandateTargets},{sql}]=await Promise.all([import('@/db/client'),import('@/db/schema'),import('drizzle-orm')]);
  const database=requireDb(),query=sql`
    WITH pending_scopes AS (
    SELECT organization_id, mandate_id, MIN(due_at) AS due_at
    FROM (
      SELECT ${researchJobs.organizationId} AS organization_id, ${researchJobs.mandateId} AS mandate_id, ${researchJobs.updatedAt} AS due_at
      FROM ${researchJobs}
      WHERE ${researchJobs.config}->'nativeAgent' IS NULL AND (
        ${researchJobs.status} NOT IN ('complete','partial','failed','cancelled')
        OR (${researchJobs.status} IN ('complete','partial')
          AND (${researchJobs.config}->>'researchRunId' IS NULL OR ${researchJobs.config}->>'researchRunId' = ${researchJobs.id}::text)
          AND ((COALESCE((${researchJobs.config}->>'includeCompanyPeople')::boolean,false)
            AND NOT COALESCE((${researchJobs.config}->'companyPeopleProgress'->>'settled')::boolean,false))
          OR (${researchJobs.config}->>'mode' = 'automatic'
            AND COALESCE((${researchJobs.config}->>'automaticDeadline')::bigint,0) > ${now}
            AND NOT (COALESCE((${researchJobs.config}->>'parallelResearchSettled')::boolean,false)
              AND COALESCE((${researchJobs.config}->>'parallelResearchPendingTasks')::integer,-1) = 0)))))
      UNION ALL
      SELECT ${firmableSyncRuns.organizationId}, ${mandateTargets.mandateId}, ${firmableSyncRuns.updatedAt}
      FROM ${firmableSyncRuns} INNER JOIN ${mandateTargets}
        ON ${mandateTargets.organizationId} = ${firmableSyncRuns.organizationId}
        AND ${mandateTargets.targetId} = ${firmableSyncRuns.targetId}
      WHERE ${firmableSyncRuns.status} IN ('queued','running')
    ) AS pending_research
    GROUP BY organization_id, mandate_id
    ), ordered_scopes AS (
      SELECT organization_id,mandate_id,
        row_number() OVER(ORDER BY due_at,organization_id,mandate_id)-1 AS position,
        count(*) OVER() AS total FROM pending_scopes
    )
    SELECT organization_id AS "organizationId",mandate_id AS "mandateId" FROM ordered_scopes
    -- Advance the first scope every existing one-minute worker pass, even when
    -- an unavailable old scope consumed the whole preceding pass. No synthetic
    -- progress timestamp or process-local cursor is needed across cold starts.
    ORDER BY (position - (${Math.floor(now/60000)}::bigint % total) + total) % total LIMIT 50`;
  let result:unknown;
  try{
    // The loop deadline cannot interrupt a database read. PostgreSQL enforces
    // the same remaining budget while the original selection runs unchanged.
    // Other configured drivers retain their existing execution contract.
    result=process.env.DATABASE_DRIVER==='postgres'
      ?await database.transaction(async tx=>{
        const remaining=Math.max(1,Math.floor(deadline-performance.now()));
        await tx.execute(sql`SELECT set_config('statement_timeout',${String(remaining)},true),set_config('lock_timeout','1000ms',true)`);
        return tx.execute(query);
      },{accessMode:'read only'})
      :await database.execute(query);
  }catch(error){
    console.info('research-maintenance',JSON.stringify({event:'scope_scan_deferred',module:'research.maintenance',timestamp:new Date().toISOString(),...safeResearchFailure(error)}));
    return 0;
  }
  const scopes=(result as unknown as {rows:{organizationId:string;mandateId:string}[]}).rows;
  let completed=0;
  for(const scope of scopes){
    if(performance.now()>=deadline)break;
    try{await recoverMandateResearch(scope.organizationId,scope.mandateId,now,deadline);if(performance.now()<deadline)completed++;}
    catch(error){traceMaintenance('mandate_recovery_deferred',scope,safeResearchFailure(error));}
  }
  return completed;
}
