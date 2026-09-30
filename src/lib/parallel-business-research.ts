import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { ResearchRepository } from '@/db/research-repository';
import { DISCOVERY_CANDIDATE_LIMIT, mandateResearchSlot } from '@/domain/automatic-research';
import { directorySource, serviceBusinessDomain, unreadableDiscoverySource } from '@/domain/discovery-sources';
import { publicResearchUrl, researchDomain, researchUrlKey, terminalResearchStates, uniqueResearchUrls, type ResearchConfig, type ResearchFinding } from '@/domain/research';
import type { ResearchField } from '@/domain/research-objectives';
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
      automaticDeadline: config.automaticDeadline, parallelBusinessResearch: true,
      ...(!field ? { targetBusinesses: config.targetBusinesses, businessTargetStartedAt: config.businessTargetStartedAt || root.createdAt?.toISOString(), newBusinessIds: config.newBusinessIds } : {}),
      researchTask: task, researchField: field, purpose, targetId: business.targetId,
      companyName: business.name, companyDomain: domain, companyLocation: business.location,
      seeds: field ? [] : [url], discover: false, strategy: 'investigate',
      discoveryCandidate: task === 'website', targetedFollowup: Boolean(field), maxPeopleSearches: 2,
      budget: { maxPages: field ? 12 : 1, maxDomains: field ? 8 : 1, maxModelCalls: field ? 14 : 2, maxMinutes: 15 },
    } });
  };
  // Interleave objectives by business so all independent branches get capacity.
  for (const [domain, business] of [...domains].slice(0, DISCOVERY_CANDIDATE_LIMIT)) {
    build(`${domain}:website`, business, 'website');
    for (const field of ['abn', 'size', 'revenue', ...(config.findPeople ? ['people', 'email'] : [])] as ResearchField[]) build(`${domain}:${field}`, business, 'field', field);
    // Start page branches alongside this business's other objectives.
    const website = related.find(j => (j.config as ResearchConfig).researchTask === 'website' && (j.config as ResearchConfig).companyDomain === domain);
    for (const url of uniqueResearchUrls((website?.config as ResearchConfig | undefined)?.websitePages || []).slice(0, WEBSITE_PAGE_LIMIT)) {
      if (researchUrlKey(url) !== researchUrlKey(business.url)) build(`${domain}:page:${researchUrlKey(url)}`, business, 'page', undefined, url);
    }
  }
  return tasks;
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
  const dispatch = active.filter(j => j.status === 'queued').map(j => j.id);
  for (let slot = 1; slot <= PARALLEL_RESEARCH_JOBS; slot++) {
    const executionSlot = mandateResearchSlot(root.mandateId, `parallel-${slot}`);
    if (occupied.has(executionSlot)) continue;
    const task = planned.find(t => !scheduled.has(t.id) && (t.config.researchTask !== 'page' || pageJobs < (config.automaticPageLimit || 100)));
    if (!task) break;
    try {
      const saved = await repo.create(task.id, root.mandateId, root.createdBy, { ...task.config, executionSlot });
      snapshot.jobs.push(saved); scheduled.add(saved.id); occupied.add(executionSlot);
      if (task.config.researchTask === 'page') pageJobs++;
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
    const admissiblePending = planned.filter(t => !scheduled.has(t.id) && (t.config.researchTask !== 'page' || pageJobs < (config.automaticPageLimit || 100))).length;
    const incomplete = children.filter(j => j.status !== 'complete').length;
    const discoveryFinished = !config.discoveryPending || children.some(j => !(j.config as ResearchConfig).researchTask && (j.config as ResearchConfig).discoveryPending === false);
    await requireDb().update(researchJobs).set({
      status: pending || incomplete ? 'partial' : 'complete',
      config: sql`jsonb_set(jsonb_set(${researchJobs.config}, '{parallelResearchPendingTasks}', ${admissiblePending}::text::jsonb), '{parallelResearchSettled}', ${discoveryFinished && admissiblePending === 0}::text::jsonb)`,
      message: `Research stopped: ${children.length - incomplete} jobs completed, ${incomplete} jobs need more evidence${pending ? `, ${pending} jobs remain outside the current budget` : ''}. No jobs are active.`,
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
  const pages = uniqueResearchUrls(urls).filter(url => publicResearchUrl(url) && researchDomain(url) === config.companyDomain).slice(0, WEBSITE_PAGE_LIMIT);
  await requireDb().update(researchJobs).set({
    config: sql`jsonb_set(${researchJobs.config}, '{websitePages}', (SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) FROM (SELECT DISTINCT value FROM jsonb_array_elements(COALESCE(${researchJobs.config}->'websitePages', '[]'::jsonb) || ${JSON.stringify(pages)}::jsonb) LIMIT ${WEBSITE_PAGE_LIMIT}) urls))`,
    updatedAt: new Date(),
  }).where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, org)));
}
