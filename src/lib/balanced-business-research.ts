// Experimental B orchestration. A remains the default and uses its original dispatcher.
import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { ResearchRepository } from '@/db/research-repository';
import { mandateResearchSlot } from '@/domain/automatic-research';
import { terminalResearchStates, type ResearchConfig } from '@/domain/research';
import { DISCOVERY_CANDIDATE_LIMIT } from '@/domain/automatic-research';
import { chooseBalancedTask } from '@/domain/balanced-research';
import { parallelBusinessTasks, PARALLEL_RESEARCH_JOBS, WEBSITE_PAGE_LIMIT } from './parallel-business-research';
import { loadResearchSchedulingSnapshot, type ResearchSchedulingSnapshot } from './research-scheduling-snapshot';
import { researchWorker } from './research-service';
export async function dispatchBalancedBusinessResearch(org: string, rootId: string, supplied?: ResearchSchedulingSnapshot, policy?: {plan: typeof parallelBusinessTasks; maxJobs: number; choose?: typeof chooseBalancedTask}) {
  const snapshot = supplied || await loadResearchSchedulingSnapshot(org, rootId);
  if (!snapshot || snapshot.root.status === 'cancelled') return;
  const root = snapshot.root, config = root.config as ResearchConfig;
  const related = snapshot.jobs.filter(j => j.id === rootId || (j.config as ResearchConfig).researchRunId === rootId);
  if (related.some(j => j.status === 'cancelled') || Date.now() >= (config.automaticDeadline || 0)) return;
  const planned = (policy?.plan || parallelBusinessTasks)(snapshot);
  const scheduled = new Set(snapshot.jobs.map(j => j.id));
  const active = snapshot.jobs.filter(j => !terminalResearchStates.includes(j.status) && (j.config as ResearchConfig).researchTask);
  const occupied = new Set(active.map(j => (j.config as ResearchConfig).executionSlot));
  const repo = new ResearchRepository(org);
  let pageJobs = related.filter(j => (j.config as ResearchConfig).researchTask === 'page').length;
  const pageCounts = new Map<string, number>();
  for (const job of related.filter(j => (j.config as ResearchConfig).researchTask === 'page')) {
    const domain = (job.config as ResearchConfig).companyDomain!;
    pageCounts.set(domain, (pageCounts.get(domain) || 0) + 1);
  }
  const domains = new Set(planned.map(t => t.config.companyDomain));
  const discoveryFinished = !config.discoveryPending || related.some(j => !(j.config as ResearchConfig).researchTask && j.id !== rootId && (j.config as ResearchConfig).discoveryPending === false);
  const websitesFinished = planned.filter(t => t.config.researchTask === 'website').every(t => related.some(j => j.id === t.id && terminalResearchStates.includes(j.status)));
  // Reserve initial coverage for late-arriving candidates. Release unused reserve
  // once discovery and website registration finish; durable job counts survive restart.
  const domainAllowance = discoveryFinished && websitesFinished ? WEBSITE_PAGE_LIMIT : Math.min(WEBSITE_PAGE_LIMIT, Math.max(1, Math.floor((config.automaticPageLimit || 100) / Math.max(domains.size, DISCOVERY_CANDIDATE_LIMIT))));
  const pageEligible = (task: typeof planned[number]) => task.config.researchTask !== 'page' || (pageJobs < (config.automaticPageLimit || 100) && (pageCounts.get(task.config.companyDomain!) || 0) < domainAllowance);
  const nextTask = () => (policy?.choose || chooseBalancedTask)(planned.filter(task => !scheduled.has(task.id) && pageEligible(task)
    && (task.config.researchTask !== 'page' || active.filter(j => (j.config as ResearchConfig).researchTask === 'page').length < 4)), active.map(job => ({config: job.config as ResearchConfig})));
  const dispatch = active.filter(j => j.status === 'queued').map(j => j.id);
  for (let slot = 1; slot <= (policy?.maxJobs || PARALLEL_RESEARCH_JOBS); slot++) {
    const executionSlot = mandateResearchSlot(root.mandateId, `parallel-${slot}`);
    if (occupied.has(executionSlot)) continue;
    const task = nextTask();
    if (!task) break;
    try {
      const saved = await repo.create(task.id, root.mandateId, root.createdBy, { ...task.config, executionSlot });
      snapshot.jobs.push(saved); active.push(saved); scheduled.add(saved.id); occupied.add(executionSlot);
      if (task.config.researchTask === 'page') { pageJobs++; pageCounts.set(task.config.companyDomain!, (pageCounts.get(task.config.companyDomain!) || 0) + 1); }
      if (saved.status === 'queued') dispatch.push(saved.id);
    } catch (error) {
      // Unique IDs and execution slots arbitrate callbacks racing to refill.
      if (error instanceof Error && error.message === 'Another research job is active. Wait for it to finish or cancel it.') break;
      throw error;
    }
  }
  const current = await repo.getExecution(rootId);
  if (!current) return;
  if (current.status === 'cancelled') { await repo.cancelRun(rootId); return; }
  const ids = [...new Set(dispatch)].filter(id => !snapshot.dispatched.has(id));
  const outcomes = await Promise.allSettled(ids.map(async id => { await researchWorker(`/jobs/${id}`, 'POST'); snapshot.dispatched.add(id); }));
  outcomes.forEach((result, index) => {
    if (result.status === 'rejected') console.info('research-diagnostic', JSON.stringify({ event: 'dispatch_deferred', rootId, jobId: ids[index], reason: 'worker_unavailable' }));
  });
  const children = snapshot.jobs.filter(j => (j.config as ResearchConfig).researchRunId === rootId);
  if (terminalResearchStates.includes(current.status) && !children.some(j => !terminalResearchStates.includes(j.status))) {
    const pending = planned.filter(t => !scheduled.has(t.id)).length;
    const admissiblePending = planned.filter(t => !scheduled.has(t.id) && pageEligible(t)).length;
    const incomplete = children.filter(j => j.status !== 'complete').length;
    const discoveryFinished = !config.discoveryPending || children.some(j => !(j.config as ResearchConfig).researchTask && (j.config as ResearchConfig).discoveryPending === false);
    await requireDb().update(researchJobs).set({
      status: pending || incomplete ? 'partial' : 'complete',
      config: sql`jsonb_set(jsonb_set(${researchJobs.config}, '{parallelResearchPendingTasks}', ${admissiblePending}::text::jsonb), '{parallelResearchSettled}', ${discoveryFinished && admissiblePending === 0}::text::jsonb)`,
      message: `Research stopped: ${children.length - incomplete} jobs completed, ${incomplete} jobs need more evidence${admissiblePending ? `, ${admissiblePending} jobs await scheduling` : ''}${pending > admissiblePending ? `, ${pending - admissiblePending} jobs remain outside the current budget or page cap` : ''}. No jobs are active.`,
      updatedAt: new Date(),
    }).where(and(eq(researchJobs.id, rootId), eq(researchJobs.organizationId, org), sql`${researchJobs.status} IN ('complete', 'partial', 'failed')`,
      sql`NOT EXISTS (SELECT 1 FROM research_jobs child WHERE child.organization_id = ${org} AND child.config->>'researchRunId' = ${rootId} AND child.status NOT IN ('complete', 'partial', 'failed', 'cancelled'))`,
      sql`(${researchJobs.config} - 'pipelineTiming' - 'scheduling') = ${JSON.stringify(current.config)}::jsonb`,
      snapshot.schedulingLease ? sql`${researchJobs.config}->'scheduling'->>'owner' = ${snapshot.schedulingLease.owner} AND (${researchJobs.config}->'scheduling'->>'generation')::bigint = ${snapshot.schedulingLease.generation}::bigint AND (${researchJobs.config}->'scheduling'->>'expiresAt')::bigint > floor(extract(epoch from clock_timestamp()) * 1000)::bigint` : undefined));
  }
}
