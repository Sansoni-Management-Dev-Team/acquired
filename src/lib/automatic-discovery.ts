import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { ResearchRepository } from '@/db/research-repository';
import { BUSINESS_RESEARCH_CONCURRENCY, DISCOVERY_CANDIDATE_LIMIT, mandateResearchSlot } from '@/domain/automatic-research';
import { directorySource, serviceBusinessDomain, unreadableDiscoverySource } from '@/domain/discovery-sources';
import { researchDomain, terminalResearchStates, type ResearchConfig } from '@/domain/research';
import { researchWorker } from './research-service';

export async function dispatchDiscoveryCandidates(org: string, jobId: string) {
  const repo = new ResearchRepository(org), job = await repo.get(jobId);
  if (!job) return;
  const rootId = (job.config as ResearchConfig).researchRunId || job.id;
  const root = rootId === job.id ? job : await repo.get(rootId);
  if (!root || root.status === 'cancelled') return;
  const config = root.config as ResearchConfig;
  if (!config.parallelDiscovery || Date.now() >= (config.automaticDeadline || 0)) return;
  const jobs = await requireDb().select().from(researchJobs).where(and(eq(researchJobs.organizationId, org), sql`(${researchJobs.id} = ${rootId} OR ${researchJobs.config}->>'researchRunId' = ${rootId})`));
  if (jobs.some(j => j.status === 'cancelled')) return;
  const candidates = jobs.filter(j => (j.config as ResearchConfig).discoveryCandidate);
  const active = candidates.filter(j => !terminalResearchStates.includes(j.status));
  const scheduled = new Set(candidates.map(j => (j.config as ResearchConfig).companyDomain));
  const occupied = new Set(jobs.filter(j => !terminalResearchStates.includes(j.status)).map(j => mandateResearchSlot(root.mandateId, (j.config as ResearchConfig).executionSlot)));
  const newIds = new Set(jobs.flatMap(j => (j.config as ResearchConfig).newBusinessIds || []));
  if (newIds.size >= (config.targetBusinesses || 20)) {
    await repo.cancelDiscoveryCandidates(rootId);
    return;
  }
  const skip = new Set(jobs.flatMap(j => (j.config as ResearchConfig).skipDomains || []));
  const seeds = jobs.filter(j => !(j.config as ResearchConfig).purpose && !(j.config as ResearchConfig).discoveryCandidate).flatMap(j => j.seeds as string[]);
  seeds.push(...candidates.filter(j => directorySource((j.config as ResearchConfig).seeds?.[0] || "")).flatMap(j => (j.config as ResearchConfig).runtime?.remaining || []));
  const byDomain = new Map<string, string>();
  for (const url of rankDiscoveryCandidateUrls(seeds, config)) {
    const domain = researchDomain(url);
    if (domain && !scheduled.has(domain) && !skip.has(domain) && !unreadableDiscoverySource(url) && !serviceBusinessDomain(url)) {
      // Directory search results still need reading to uncover their linked sites.
      if (!byDomain.has(domain) || !directorySource(url)) byDomain.set(domain, url);
    }
  }
  const busyDomains = new Set(jobs.filter(j => !terminalResearchStates.includes(j.status)).flatMap(j => (j.config as ResearchConfig).companyDomain ? [(j.config as ResearchConfig).companyDomain!] : []));
  let capacity = Math.min(BUSINESS_RESEARCH_CONCURRENCY - busyDomains.size, Math.max(0, (config.targetBusinesses || 20) - newIds.size - active.length), Math.max(0, DISCOVERY_CANDIDATE_LIMIT - candidates.length));
  let pagesLeft = (config.automaticPageLimit || 100) - candidates.reduce((sum, j) => sum + (terminalResearchStates.includes(j.status) ? ((j.config as ResearchConfig).runtime?.attempts.length || j.pages) : (j.config as ResearchConfig).budget.maxPages), 0);
  const dispatch = active.filter(j => j.status === 'queued').map(j => j.id);
  for (let slot = 0; slot < BUSINESS_RESEARCH_CONCURRENCY && capacity > 0 && pagesLeft > 0; slot++) {
    const executionSlot = mandateResearchSlot(root.mandateId, slot * 2 + 1);
    if (occupied.has(executionSlot) || occupied.has(mandateResearchSlot(root.mandateId, slot * 2 + 2))) continue;
    const next = byDomain.entries().next().value;
    if (!next) break;
    const [domain, seed] = next;
    byDomain.delete(domain);
    const hash = createHash('sha256').update(`${rootId}:candidate:${domain}`).digest('hex');
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const maxPages = Math.min(2, pagesLeft);
    const child: ResearchConfig = { ...config, parallelDiscovery: false, discoveryCandidate: true, researchRunId: rootId, parentJobId: rootId, executionSlot, companyDomain: domain, seeds: [seed], discover: false, discoveryPending: false, discoveryCursor: undefined, runtime: undefined, newBusinessIds: [], autoRoot: undefined, autoContinueFrom: undefined, budget: { maxPages, maxDomains: 1, maxModelCalls: maxPages, maxMinutes: 15 } };
    try {
      const saved = await repo.create(id, root.mandateId, root.createdBy, child);
      capacity--; pagesLeft -= maxPages;
      if (saved.status === 'queued') dispatch.push(id);
    } catch { break; /* A concurrent callback won this slot; polling refills. */ }
  }
  if ((await repo.get(rootId))?.status === 'cancelled') { await repo.cancelRun(rootId); return; }
  await Promise.allSettled([...new Set(dispatch)].map(id => researchWorker(`/jobs/${id}`, 'POST')));
}

export function rankDiscoveryCandidateUrls(urls: string[], config: ResearchConfig) {
  const tokens = [...new Set(`${config.researchScope || ''} ${(config.searchTerms || []).join(' ')}`.toLowerCase().match(/[a-z0-9]{4,}/g) || [])]
    .filter(token => !['with', 'from', 'that', 'this', 'australia', 'business', 'company', 'companies'].includes(token));
  const context = new Map<string, string>();
  for (const attempt of config.discoveryAttempts || []) for (const result of attempt.results || []) {
    const domain = researchDomain(result.url);
    if (!domain) continue;
    context.set(domain, `${context.get(domain) || ''} ${result.title} ${result.snippet}`.toLowerCase());
  }
  const score = (url: string) => {
    const domain = researchDomain(url), text = `${domain} ${context.get(domain) || ''}`;
    const scope = tokens.reduce((total, token) => total + (text.includes(token) ? 4 : 0), 0);
    const business = (text.match(/manufactur|supplier|fabricat|industrial|wholesale|distribut|specialist|services/g) || []).length;
    let path = 0;
    try { path = new URL(url).pathname === '/' ? 2 : 0; } catch { /* Invalid leads sort last and are discarded by researchDomain. */ }
    return scope + Math.min(6, business) + path;
  };
  return [...new Set(urls)].sort((a, b) => score(b) - score(a));
}
