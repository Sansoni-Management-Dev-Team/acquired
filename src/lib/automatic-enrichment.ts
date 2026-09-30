import type { ResearchSchedulingSnapshot } from './research-scheduling-snapshot';
import { measureResearchSegment } from './research-segment-timing';
import { automaticContinuation } from '@/domain/research-continuation';
import { reusableEnrichmentEvidence } from '@/domain/enrichment-evidence';
import { missingResearchFields } from "@/domain/research-objectives";
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs, researchFindings } from '@/db/schema';
import { ResearchRepository } from '@/db/research-repository';
import { AcquisitionRepository } from '@/db/acquisition-repository';
import { BUSINESS_RESEARCH_CONCURRENCY, mandateResearchSlot, researchConcurrency } from '@/domain/automatic-research';
import { eligibleForPeople, relevantBusiness } from '@/domain/business-research';
import { researchDomain, terminalResearchStates, type ResearchConfig, type ResearchFinding } from '@/domain/research';
import { researchWorker } from './research-service';

export async function dispatchAutomaticEnrichment(org: string, jobId: string, snapshot?: ResearchSchedulingSnapshot) {
  return measureResearchSegment(jobId, org, 'enrichment-dispatch', 'coordination', () => dispatchEnrichment(org, jobId, snapshot), count => (count || 0) > 0);
}
async function dispatchEnrichment(org: string, jobId: string, snapshot?: ResearchSchedulingSnapshot) {
  const db = requireDb(), repo = new ResearchRepository(org), job = snapshot?.jobs.find(j => j.id === jobId) || await repo.get(jobId);
  if (!job) return;
  const rootId = (job.config as ResearchConfig).researchRunId || job.id;
  const root = snapshot?.root || (rootId === job.id ? job : await repo.get(rootId));
  if (!root || root.status === 'cancelled') return;
  const config = root.config as ResearchConfig;
  if (config.mode !== 'automatic' || Date.now() >= (config.automaticDeadline || Infinity)) return;
  const jobs = snapshot?.jobs || await db.select().from(researchJobs).where(and(eq(researchJobs.organizationId, org), sql`(${researchJobs.id} = ${rootId} OR ${researchJobs.config}->>'researchRunId' = ${rootId} OR ${researchJobs.status} NOT IN ('complete', 'partial', 'failed', 'cancelled'))`));
  const related = jobs.filter(j => j.id === rootId || (j.config as ResearchConfig).researchRunId === rootId);
  if (related.some(j => j.status === 'cancelled')) return;
  const members = snapshot?.members || await new AcquisitionRepository(org).memberships(root.mandateId);
  if (!members.length) return;
  const findings = snapshot?.findings || await db.select().from(researchFindings).where(and(eq(researchFindings.organizationId, org), sql`${researchFindings.targetId} IN (${sql.join(members.map(m => sql`${m.target.id}`), sql`, `)})`));
  const relatedIds = new Set(related.map(j => j.id));
  // Same-run evidence retains its mandate semantics; reusable historical facts
  // stay bound to the same organization/target and their original DB provenance.
  const evidenceFor = (id: string) => findings.filter(f => f.targetId === id).flatMap(f => {
    const reused = relatedIds.has(f.jobId) ? f.evidence as ResearchFinding : reusableEnrichmentEvidence(f);
    return reused ? [reused] : [];
  });
  const occupied = new Set(jobs.filter(j => (j.mandateId === root.mandateId || related.includes(j)) && !terminalResearchStates.includes(j.status)).map(j => mandateResearchSlot(root.mandateId, (j.config as ResearchConfig).executionSlot)));
  const busyDomains = new Set(jobs.filter(j => j.mandateId === root.mandateId && !terminalResearchStates.includes(j.status)).flatMap(j => (j.config as ResearchConfig).companyDomain ? [(j.config as ResearchConfig).companyDomain!] : []));
  const dispatch: string[] = related.filter(j => j.status === 'queued').map(j => j.id);
  const scheduled = new Set(related.filter(j => (j.config as ResearchConfig).purpose).map(j => {
    const c = j.config as ResearchConfig;
    return `${c.targetId}:${c.purpose}:${c.enrichmentPhase || 'legacy'}`;
  }));
  const concurrency = researchConcurrency(config.enrichmentConcurrency, BUSINESS_RESEARCH_CONCURRENCY);
  const taskKey = (targetId: string, purpose: string, phase: string) => `${targetId}:${purpose}:${phase}`;
  const newIds = new Set(related.flatMap(j => (j.config as ResearchConfig).newBusinessIds || []));
  // Enrichment effort is spent only on businesses whose own website shows mandate-relevant evidence.
  const relevant = (id: string) => relevantBusiness(findings.filter(f => f.targetId === id && relatedIds.has(f.jobId)).map(f => f.evidence as ResearchFinding));
  const candidates = members.filter(m => m.target.domain && !['excluded', 'parked'].includes(m.assessment.stage) && (newIds.has(m.target.id) || findings.some(f => f.targetId === m.target.id && researchDomain(f.sourceUrl) === m.target.domain)) && relevant(m.target.id)).sort((a, b) => Number(newIds.has(b.target.id)) - Number(newIds.has(a.target.id)));
  const tasks = candidates.flatMap(member => {
    const evidence = evidenceFor(member.target.id);
    const purposes: ('firmographics' | 'people')[] = [];
    if (config.companyBudget && missingResearchFields({ purpose: "firmographics" }, evidence).length > 0) purposes.push('firmographics');
    if (config.findPeople && missingResearchFields({ purpose: "people" }, evidence).length > 0 && eligibleForPeople(member.target.domain!, member.assessment.stage, evidence)) purposes.push('people');
    return purposes.flatMap<{ member: typeof member; purpose: 'firmographics' | 'people'; phase: 'initial' | 'deep'; previous: typeof related[number] | undefined; evidence: ResearchFinding[]; consumedPages: number; consumedModels: number }>(purpose => {
      if (scheduled.has(taskKey(member.target.id, purpose, 'legacy'))) return [];
      const initialJobs = related.filter(j => { const c = j.config as ResearchConfig; return c.targetId === member.target.id && c.purpose === purpose && c.enrichmentPhase === 'initial'; });
      if (!initialJobs.length) return [{ member, purpose, phase: 'initial', previous: undefined, evidence, consumedPages: 0, consumedModels: 0 }];
      // Admission continuations own the initial phase until its last descendant
      // finishes. Never create a competing deep job during callback races.
      if (initialJobs.some(j => !terminalResearchStates.includes(j.status) || j.status === 'cancelled')) return [];
      const initial = initialJobs.find(j => !initialJobs.some(other => (other.config as ResearchConfig).autoContinueFrom === j.id))!;
      const previousConfig = initial.config as ResearchConfig;
      if (automaticContinuation({ ...initial, config: previousConfig })) return [];
      const retained = [previousConfig.runtime?.pendingPage?.url, previousConfig.runtime?.bufferedPage?.url].filter(Boolean);
      const retainedCount = new Set(retained).size;
      const consumedPages = Math.max(0, initialJobs.reduce((sum, j) => sum + Math.max(j.pages || 0, (j.config as ResearchConfig).runtime?.attempts.filter(a => a.status !== 'pending').length || 0), 0) - retainedCount);
      const consumedModels = initialJobs.reduce((sum, j) => sum + (j.modelCalls || 0), 0);
      // Failed provider reads spend allowance too. A retained unextracted page is
      // counted in the next phase's attempt but reuses its already-paid content.
      if (consumedPages >= 12 || consumedModels >= 14) return [];
      return [{ member, purpose, phase: 'deep', previous: initial, evidence, consumedPages, consumedModels }];
    });
  }).sort((a, b) => Number(a.phase === 'deep') - Number(b.phase === 'deep'));
  const counts = { firmographics: new Set(related.filter(j => (j.config as ResearchConfig).purpose === 'firmographics').map(j => (j.config as ResearchConfig).targetId)).size, people: new Set(related.filter(j => (j.config as ResearchConfig).purpose === 'people').map(j => (j.config as ResearchConfig).targetId)).size };
  const initialCoveragePending = tasks.some(t => t.phase === 'initial' && !scheduled.has(taskKey(t.member.target.id, t.purpose, 'initial')) && (newIds.has(t.member.target.id) || counts[t.purpose] < (config.targetBusinesses || 20)));
  // A pair of slots belongs to one business until both purposes finish. This
  // bounds businesses (not merely jobs), including callbacks that race to refill.
  for (let group = 0; group < concurrency; group++) {
    const slots = [group * 2 + 1, group * 2 + 2];
    const active = jobs.filter(j => j.mandateId === root.mandateId && !terminalResearchStates.includes(j.status) && slots.some(slot => mandateResearchSlot(root.mandateId, slot) === mandateResearchSlot(root.mandateId, (j.config as ResearchConfig).executionSlot)));
    const activeTarget = active.map(j => (j.config as ResearchConfig).targetId).find(Boolean);
    const next = tasks.find(({ member, purpose, phase }) => (!initialCoveragePending || phase === 'initial') && (!active.length || (member.target.id === activeTarget || active.some(j => (j.config as ResearchConfig).companyDomain === member.target.domain))) && (busyDomains.has(member.target.domain!) || busyDomains.size < concurrency) && !scheduled.has(taskKey(member.target.id, purpose, phase)) && (phase === 'deep' || newIds.has(member.target.id) || counts[purpose] < (config.targetBusinesses || 20)));
    if (!next) continue;
    const member = next.member;
    for (const purpose of ['firmographics', 'people'] as const) {
      const slot = slots[purpose === 'firmographics' ? 0 : 1];
      const task = tasks.find(t => t.member.target.id === member.target.id && t.purpose === purpose);
      if (!task || (initialCoveragePending && task.phase === 'deep') || occupied.has(mandateResearchSlot(root.mandateId, slot)) || scheduled.has(taskKey(member.target.id, purpose, task.phase))) continue;
      const previous = task.previous;
      const previousConfig = previous?.config as ResearchConfig | undefined;
      const budget = task.phase === 'initial' ? { maxPages: 4, maxDomains: 8, maxModelCalls: 5, maxMinutes: 5 } : { maxPages: 12 - task.consumedPages, maxDomains: 8, maxModelCalls: 14 - task.consumedModels, maxMinutes: 10 };
      if (task.phase === 'initial' && !newIds.has(member.target.id) && counts[purpose] >= (config.targetBusinesses || 20)) continue;
      const hash = createHash('sha256').update(`${rootId}:${member.target.id}:${purpose}:${task.phase}`).digest('hex');
      const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
      const child: ResearchConfig = {
        mode: 'automatic', researchRunId: rootId, performanceFlags: config.performanceFlags,
        executionSlot: mandateResearchSlot(root.mandateId, slot), purpose,
        targetedFollowup: true, parentJobId: rootId, targetId: member.target.id,
        companyName: member.target.companyName, companyDomain: member.target.domain!,
        companyLocation: [member.target.suburb, member.target.state].filter(Boolean).join(' '),
        seeds: previousConfig?.runtime ? previousConfig.runtime.remaining.slice(0, 10) : [`https://${member.target.domain}/`],
        searchTerms: purpose === 'people' ? ['owner founder director management team'] : config.searchTerms,
        geography: config.geography, approved: true, discover: !previousConfig,
        strategy: 'investigate', maxPeopleSearches: 2, budget,
        enrichmentPhase: task.phase,
        enrichmentPendingFields: missingResearchFields({ purpose }, task.evidence),
        inheritedFindings: task.evidence,
        ...(previousConfig?.runtime ? { runtime: { ...previousConfig.runtime, attempts: [] } } : {}),
        ...(previousConfig ? {
          autoDomains: [...new Set([...(previousConfig.autoDomains || []), ...(previousConfig.runtime?.visited || []).map(url => researchDomain(url))])],
          targetedSearches: previousConfig.targetedSearches,
          targetedSearchAttempts: previousConfig.targetedSearchAttempts,
          legalEntity: previousConfig.legalEntity,
          peopleFollowupStarted: previousConfig.peopleFollowupStarted,
          peopleSearchLeads: previousConfig.peopleSearchLeads,
          peopleLinks: previousConfig.peopleLinks,
          followupExhaustedFields: previousConfig.followupExhaustedFields,
          followupSearchCounts: previousConfig.followupSearchCounts,
          followupEmptySearchCounts: previousConfig.followupEmptySearchCounts,
          diminishingReturnsSearches: 2,
        } : {}),
      };
      try {
        const saved = await repo.create(id, root.mandateId, root.createdBy, child);
      if (snapshot && !snapshot.jobs.some(j => j.id === saved.id)) snapshot.jobs.push(saved);
        scheduled.add(taskKey(member.target.id, purpose, task.phase));
        occupied.add(mandateResearchSlot(root.mandateId, slot));
        if (task.phase === 'initial') counts[purpose]++;
        busyDomains.add(member.target.domain!);
        console.info('research-enrichment', JSON.stringify({ event: 'phase_queued', rootId, jobId: saved.id, targetId: member.target.id, purpose, phase: task.phase, pendingFields: child.enrichmentPendingFields, inheritedFindings: task.evidence.length, budget }));
        if (saved.status === 'queued') dispatch.push(saved.id);
      } catch { break; /* A racing callback claimed this business slot. */ }
    }
  }
  const current = await repo.get(rootId);
  if (current?.status === 'cancelled') { await repo.cancelRun(rootId); return; }
  const dispatchIds = [...new Set(dispatch)].filter(id => !snapshot?.dispatched.has(id));
  const outcomes = await Promise.allSettled(dispatchIds.map(async id => { await researchWorker(`/jobs/${id}`, 'POST'); snapshot?.dispatched.add(id); }));
  outcomes.forEach((result, index) => {
    if (result.status !== 'rejected') return;
    const reason = result.reason instanceof Error && result.reason.name === 'TimeoutError' ? 'worker_timeout' : result.reason instanceof Error && result.reason.name === 'AbortError' ? 'worker_aborted' : 'worker_unavailable';
    console.info('research-diagnostic', JSON.stringify({ timestamp: new Date().toISOString(), event: 'dispatch_deferred', rootId, jobId: dispatchIds[index], reason, retry: 'queued_recovery' }));
  });
  return new Set(dispatch).size;
}
