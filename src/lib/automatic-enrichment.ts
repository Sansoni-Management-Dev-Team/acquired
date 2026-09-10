import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs, researchFindings } from '@/db/schema';
import { ResearchRepository } from '@/db/research-repository';
import { AcquisitionRepository } from '@/db/acquisition-repository';
import { ENRICHMENT_CONCURRENCY } from '@/domain/automatic-research';
import { eligibleForPeople, relevantBusiness } from '@/domain/business-research';
import { researchDomain, terminalResearchStates, type ResearchConfig, type ResearchFinding } from '@/domain/research';
import { researchWorker } from './research-service';

export async function dispatchAutomaticEnrichment(org: string, jobId: string) {
  const db = requireDb(), repo = new ResearchRepository(org), job = await repo.get(jobId);
  if (!job) return;
  const rootId = (job.config as ResearchConfig).researchRunId || job.id;
  const root = rootId === job.id ? job : await repo.get(rootId);
  if (!root || root.status === 'cancelled') return;
  const config = root.config as ResearchConfig;
  if (config.mode !== 'automatic' || Date.now() >= (config.automaticDeadline || Infinity)) return;
  const jobs = await db.select().from(researchJobs).where(and(eq(researchJobs.organizationId, org), sql`(${researchJobs.id} = ${rootId} OR ${researchJobs.config}->>'researchRunId' = ${rootId} OR ${researchJobs.status} NOT IN ('complete', 'partial', 'failed', 'cancelled'))`));
  const related = jobs.filter(j => j.id === rootId || (j.config as ResearchConfig).researchRunId === rootId);
  if (related.some(j => j.status === 'cancelled')) return;
  const findings = await db.select().from(researchFindings).where(and(eq(researchFindings.organizationId, org), eq(researchFindings.mandateId, root.mandateId), sql`${researchFindings.jobId} IN (SELECT ${researchJobs.id} FROM ${researchJobs} WHERE ${researchJobs.id} = ${rootId} OR ${researchJobs.config}->>'researchRunId' = ${rootId})`));
  const members = await new AcquisitionRepository(org).memberships(root.mandateId);
  const occupied = new Set(jobs.filter(j => !terminalResearchStates.includes(j.status)).map(j => (j.config as ResearchConfig).executionSlot || 0));
  const dispatch: string[] = related.filter(j => j.status === 'queued').map(j => j.id);
  const scheduled = new Set(related.filter(j => (j.config as ResearchConfig).purpose).map(j => `${(j.config as ResearchConfig).targetId}:${(j.config as ResearchConfig).purpose}`));
  const newIds = new Set(related.flatMap(j => (j.config as ResearchConfig).newBusinessIds || []));
  // Enrichment effort is spent only on businesses whose own website shows mandate-relevant evidence.
  const relevant = (id: string) => relevantBusiness(findings.filter(f => f.targetId === id).map(f => f.evidence as ResearchFinding));
  const candidates = members.filter(m => m.target.domain && !['excluded', 'parked'].includes(m.assessment.stage) && (newIds.has(m.target.id) || findings.some(f => f.targetId === m.target.id && researchDomain(f.sourceUrl) === m.target.domain)) && relevant(m.target.id)).sort((a, b) => Number(newIds.has(b.target.id)) - Number(newIds.has(a.target.id)));
  const tasks = candidates.flatMap(member => {
    const evidence = findings.filter(f => f.targetId === member.target.id).map(f => f.evidence as ResearchFinding);
    const purposes: ('firmographics' | 'people')[] = [];
    if (config.companyBudget && !evidence.some(f => f.kind === 'headcount')) purposes.push('firmographics');
    if (config.findPeople && !evidence.some(f => f.kind === 'person') && eligibleForPeople(member.target.domain!, member.assessment.stage, evidence)) purposes.push('people');
    return purposes.map(purpose => ({ member, purpose }));
  });
  const counts = { firmographics: new Set(related.filter(j => (j.config as ResearchConfig).purpose === 'firmographics').map(j => (j.config as ResearchConfig).targetId)).size, people: new Set(related.filter(j => (j.config as ResearchConfig).purpose === 'people').map(j => (j.config as ResearchConfig).targetId)).size };
  for (let slot = 1; slot <= ENRICHMENT_CONCURRENCY; slot++) {
    if (occupied.has(slot)) continue;
    const next = tasks.find(({ member, purpose }) => !scheduled.has(`${member.target.id}:${purpose}`) && (newIds.has(member.target.id) || counts[purpose] < (config.targetBusinesses || 20)));
    if (!next) break;
    const { member, purpose } = next;
    const hash = createHash('sha256').update(`${rootId}:${member.target.id}:${purpose}`).digest('hex');
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const child: ResearchConfig = { mode: 'automatic', researchRunId: rootId, executionSlot: slot, purpose, targetedFollowup: true, parentJobId: rootId, targetId: member.target.id, companyName: member.target.companyName, companyDomain: member.target.domain!, seeds: [`https://${member.target.domain}/`], searchTerms: purpose === 'people' ? ['owner founder director management team'] : config.searchTerms, geography: config.geography, approved: true, discover: true, strategy: 'investigate', maxPeopleSearches: 2, budget: { maxPages: 12, maxDomains: 8, maxModelCalls: 14, maxMinutes: 15 } };
    try {
      const saved = await repo.create(id, root.mandateId, root.createdBy, child);
      scheduled.add(`${member.target.id}:${purpose}`);
      counts[purpose]++;
      if (saved.status === 'queued') dispatch.push(saved.id);
    } catch { /* Another callback claimed this slot. The next callback/poll refills vacancies. */ }
  }
  const current = await repo.get(rootId);
  if (current?.status === 'cancelled') { await repo.cancelRun(rootId); return; }
  await Promise.allSettled([...new Set(dispatch)].map(id => researchWorker(`/jobs/${id}`, 'POST')));
}
