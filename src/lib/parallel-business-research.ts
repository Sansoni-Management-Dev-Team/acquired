import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { ResearchRepository } from '@/db/research-repository';
import { DISCOVERY_CANDIDATE_LIMIT, mandateResearchSlot } from '@/domain/automatic-research';
import { directorySource, serviceBusinessDomain, unreadableDiscoverySource } from '@/domain/discovery-sources';
import { publicResearchUrl, researchDomain, researchUrlKey, terminalResearchStates, type ResearchConfig, type ResearchFinding } from '@/domain/research';
import type { ResearchField } from '@/domain/research-objectives';
import { prioritiseResearchPages, researchPagePriority } from '@/domain/research-page-priority';
import { rankDiscoveryCandidateUrls } from './automatic-discovery';
import { loadResearchSchedulingSnapshot, type ResearchSchedulingSnapshot } from './research-scheduling-snapshot';
import { researchWorker } from './research-service';

export const PARALLEL_RESEARCH_JOBS = 32;
export const WEBSITE_PAGE_LIMIT = 100;
const taskId = (root: string, key: string) => {
  const hash = createHash('sha256').update(`${root}:parallel:${key}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};

// A URL is a lead. Website assertions still determine relevance; fields can
// start immediately without waiting for that separate qualification decision.
export function parallelBusinessTasks(snapshot: ResearchSchedulingSnapshot) {
  const root = snapshot.root, config = root.config as ResearchConfig;
  const related = snapshot.jobs.filter(j => j.id === root.id || (j.config as ResearchConfig).researchRunId === root.id);
  const targetReached = new Set(config.newBusinessIds || []).size >= (config.targetBusinesses || 20);
  const admittedDomains = new Set(related.filter(j => (j.config as ResearchConfig).researchTask).map(j => (j.config as ResearchConfig).companyDomain));
  const domains = new Map<string, { url: string; name: string; targetId?: string; location?: string }>();
  const add = (url: string, name?: string, targetId?: string, location?: string) => {
    const safe = publicResearchUrl(url);
    if (!safe || directorySource(safe) || unreadableDiscoverySource(safe) || serviceBusinessDomain(safe)) return;
    const domain = researchDomain(safe);
    if (!domains.has(domain)) domains.set(domain, { url: safe, name: name || domain, targetId, location });
  };
  for (const member of snapshot.members) {
    if (member.target.domain && !['excluded', 'parked'].includes(member.assessment.stage)) add(`https://${member.target.domain}/`, member.target.companyName, member.target.id, [member.target.suburb, member.target.state].filter(Boolean).join(' '));
  }
  for (const job of related.filter(j => !(j.config as ResearchConfig).purpose)) {
    const c = job.config as ResearchConfig;
    for (const url of rankDiscoveryCandidateUrls(job.seeds as string[], config)) {
      if (targetReached && !domains.has(researchDomain(url)) && !admittedDomains.has(researchDomain(url))) continue;
      const identity = snapshot.findings.find(f => (f.evidence as ResearchFinding).kind === 'company' && researchDomain(f.sourceUrl) === researchDomain(url));
      const name = (identity?.evidence as ResearchFinding | undefined)?.name;
      // Search titles are lookup hints only, never stored as legal identities.
      const title = c.discoveryAttempts?.flatMap(a => a.results || []).find(r => researchDomain(r.url) === researchDomain(url))?.title.split(/\s+[|–—]\s+/)[0];
      add(url, name || title);
    }
  }
  const tasks: { id: string; config: ResearchConfig }[] = [];
  const build = (key: string, business: typeof domains extends Map<string, infer V> ? V : never, task: ResearchConfig['researchTask'], field?: ResearchField, url = business.url) => {
    const domain = researchDomain(business.url);
    const id = taskId(root.id, key);
    const purpose = field ? ['people', 'email'].includes(field) ? 'people' : 'firmographics' : undefined;
    tasks.push({ id, config: {
      workflow: 'business', mode: 'automatic', approved: true, geography: config.geography,
      searchTerms: config.searchTerms, researchScope: config.researchScope, findPeople: config.findPeople,
      researchRunId: root.id, parentJobId: root.id, performanceFlags: config.performanceFlags,
      ...(config.pipelineDesign ? { pipelineDesign: config.pipelineDesign } : {}),
      automaticDeadline: config.automaticDeadline, parallelBusinessResearch: true,
      ...(!field ? { targetBusinesses: config.targetBusinesses, businessTargetStartedAt: config.businessTargetStartedAt || root.createdAt?.toISOString(), newBusinessIds: config.newBusinessIds } : {}),
      researchTask: task, researchField: field, purpose, targetId: business.targetId,
      companyName: business.name, companyDomain: domain, companyLocation: business.location,
      seeds: field ? [] : [url], discover: false, strategy: 'investigate',
      discoveryCandidate: task === 'website', targetedFollowup: Boolean(field), maxPeopleSearches: 2,
      budget: { maxPages: field ? 12 : 1, maxDomains: field ? 8 : 1, maxModelCalls: field ? 14 : 2, maxMinutes: 15 },
    } });
  };
  // Build stable task identities; dispatch below balances objective waves and page coverage.
  for (const [domain, business] of [...domains].slice(0, DISCOVERY_CANDIDATE_LIMIT)) {
    build(`${domain}:website`, business, 'website');
    for (const field of ['abn', 'size', 'revenue', ...(config.findPeople ? ['people', 'email'] : [])] as ResearchField[]) build(`${domain}:${field}`, business, 'field', field);
    // Retain every discovered page; execution caps are applied without losing pending work.
    const website = related.find(j => (j.config as ResearchConfig).researchTask === 'website' && (j.config as ResearchConfig).companyDomain === domain);
    for (const url of prioritiseResearchPages((website?.config as ResearchConfig | undefined)?.websitePages || [])) {
      if (researchUrlKey(url) !== researchUrlKey(business.url)) build(`${domain}:page:${researchUrlKey(url)}`, business, 'page', undefined, url);
    }
  }
  // Objective waves let every business qualify before one receives all fields.
  const objectiveOrder = ['website', 'abn', 'size', 'revenue', 'people', 'email'];
  return tasks.sort((a, b) => {
    const rank = (task: typeof a) => task.config.researchTask === 'page' ? objectiveOrder.length : objectiveOrder.indexOf(task.config.researchField || 'website');
    return rank(a) - rank(b);
  });
}

export async function dispatchParallelBusinessResearch(org: string, rootId: string, supplied?: ResearchSchedulingSnapshot) {
  const snapshot = supplied || await loadResearchSchedulingSnapshot(org, rootId);
  if (!snapshot || snapshot.root.status === 'cancelled') return;
  const root = snapshot.root, config = root.config as ResearchConfig;
  const related = snapshot.jobs.filter(j => j.id === rootId || (j.config as ResearchConfig).researchRunId === rootId);
  if (related.some(j => j.status === 'cancelled') || Date.now() >= (config.automaticDeadline || 0)) return;
  const planned = parallelBusinessTasks(snapshot);
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
  let activePages = active.filter(j => (j.config as ResearchConfig).researchTask === 'page').length;
  const primaryQueue = planned.filter(t => !scheduled.has(t.id) && t.config.researchTask !== 'page');
  let primaryPosition = 0;
  const pageQueues = new Map<string, { tasks: typeof planned; position: number; priority: number[] }>();
  for (const task of planned) {
    if (scheduled.has(task.id) || task.config.researchTask !== 'page') continue;
    const domain = task.config.companyDomain!;
    if (!pageQueues.has(domain)) pageQueues.set(domain, { tasks: [], position: 0, priority: [] });
    const queue = pageQueues.get(domain)!;
    queue.tasks.push(task); queue.priority.push(researchPagePriority(task.config.seeds[0]));
  }
  const nextTask = () => {
    while (primaryQueue[primaryPosition] && scheduled.has(primaryQueue[primaryPosition].id)) primaryPosition++;
    const primary = primaryQueue[primaryPosition];
    let page: typeof planned[number] | undefined, core: typeof page;
    let pageScore = Infinity, coreScore = Infinity;
    // Each domain already has a prioritised queue. Compare only queue heads,
    // using durable counts, rather than sorting thousands of pages per slot.
    for (const [domain, queue] of pageQueues) {
      while (queue.tasks[queue.position] && scheduled.has(queue.tasks[queue.position].id)) queue.position++;
      const task = queue.tasks[queue.position];
      if (!task || !pageEligible(task)) continue;
      const priority = queue.priority[queue.position];
      const score = (pageCounts.get(domain) || 0) * 4 + priority;
      if (score < pageScore) { page = task; pageScore = score; }
      if (priority <= 1 && score < coreScore) { core = task; coreScore = score; }
    }
    // Up to eight core page jobs can source evidence while 24 slots remain for
    // website/field work. Article floods wait until primary tasks are dispatched.
    return primary ? (activePages < 8 && core ? core : primary) : page;
  };
  const dispatch = active.filter(j => j.status === 'queued').map(j => j.id);
  for (let slot = 1; slot <= PARALLEL_RESEARCH_JOBS; slot++) {
    const executionSlot = mandateResearchSlot(root.mandateId, `parallel-${slot}`);
    if (occupied.has(executionSlot)) continue;
    const task = nextTask();
    if (!task) break;
    try {
      const saved = await repo.create(task.id, root.mandateId, root.createdBy, { ...task.config, executionSlot });
      snapshot.jobs.push(saved); scheduled.add(saved.id); occupied.add(executionSlot);
      if (task.config.researchTask === 'page') { pageJobs++; activePages++; pageCounts.set(task.config.companyDomain!, (pageCounts.get(task.config.companyDomain!) || 0) + 1); }
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

export async function registerWebsitePages(org: string, job: typeof researchJobs.$inferSelect, urls: string[]) {
  const config = job.config as ResearchConfig;
  if (config.researchTask !== 'website' || !config.companyDomain || terminalResearchStates.includes(job.status)) return;
  const pages = prioritiseResearchPages(urls.filter(url => publicResearchUrl(url) && researchDomain(url) === config.companyDomain));
  await requireDb().update(researchJobs).set({
    config: sql`jsonb_set(${researchJobs.config}, '{websitePages}', (SELECT COALESCE(jsonb_agg(value ORDER BY first_position), '[]'::jsonb) FROM (SELECT value, MIN(position) AS first_position FROM jsonb_array_elements(COALESCE(${researchJobs.config}->'websitePages', '[]'::jsonb) || ${JSON.stringify(pages)}::jsonb) WITH ORDINALITY AS entries(value, position) GROUP BY value) urls))`,
    updatedAt: new Date(),
  }).where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, org)));
}
