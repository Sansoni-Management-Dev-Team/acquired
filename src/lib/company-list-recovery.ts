import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { ResearchRepository } from '@/db/research-repository';
import { terminalResearchStates, type ResearchConfig } from '@/domain/research';
import { researchEnabled, researchWorker } from './research-service';
import { dispatchContinuation } from './research-continuation';
import { dispatchDiscoveryCandidates } from './automatic-discovery';
import { dispatchAutomaticEnrichment } from './automatic-enrichment';

// Recovery is independent of the progress payload and runs at a slower cadence.
export async function recoverCompanyListWork(org: string, mandateId: string, now = Date.now()) {
  if (!researchEnabled()) return;
  const db = requireDb(), repo = new ResearchRepository(org);
  const jobs = await db.select({ id: researchJobs.id, status: researchJobs.status, updatedAt: researchJobs.updatedAt, revision: researchJobs.revision, pages: researchJobs.pages,
    config: sql<ResearchConfig>`jsonb_build_object('mode', ${researchJobs.config}->'mode', 'researchRunId', ${researchJobs.config}->'researchRunId', 'automaticDeadline', ${researchJobs.config}->'automaticDeadline')`,
  }).from(researchJobs).where(and(eq(researchJobs.organizationId, org), eq(researchJobs.mandateId, mandateId)));
  for (const job of jobs.filter(j => !terminalResearchStates.includes(j.status) && now - j.updatedAt.getTime() > 90000)) {
    try {
      const worker = await researchWorker(`/jobs/${job.id}`) as { status: string };
      if (['running','waiting'].includes(worker.status) && now - job.updatedAt.getTime() > 600000) {
        const recovered = await researchWorker(`/jobs/${job.id}`, 'POST', { action: 'recover-stalled' }) as { recovered?: boolean };
        if (recovered.recovered) await repo.recoverStopped(job.id, job.revision, job.pages);
      }
      if (['errored','terminated','complete'].includes(worker.status)) await repo.recoverStopped(job.id, job.revision, job.pages);
    } catch { /* Unavailable status does not imply a stopped worker. */ }
  }
  for (const root of jobs.filter(j => j.config.mode === 'automatic' && !j.config.researchRunId && j.status !== 'cancelled' && now < (j.config.automaticDeadline || 0))) {
    try { await dispatchContinuation(org, root.id); await dispatchDiscoveryCandidates(org, root.id); await dispatchAutomaticEnrichment(org, root.id); } catch { /* Next recovery pass retries durable work. */ }
  }
  const result = await db.execute(sql`SELECT r.id,r.status,r.updated_at FROM public.firmable_sync_runs r JOIN public.mandate_targets m ON m.target_id=r.target_id AND m.organization_id=r.organization_id WHERE m.organization_id=${org} AND m.mandate_id=${mandateId} AND r.status IN ('queued','running')`);
  const runs = (Array.isArray(result) ? result : (result as { rows: { id: string; status: string; updated_at: string | Date }[] }).rows) as { id: string; status: string; updated_at: string | Date }[];
  const { FirmableHistoryRepository } = await import('@/db/firmable-history-repository');
  const history = new FirmableHistoryRepository(db);
  await Promise.allSettled(runs.map(async run => {
    if (run.status === 'queued') { await researchWorker(`/firmable/${run.id}`, 'POST', { mandateId }, 4000); return; }
    const age = now - new Date(run.updated_at).getTime();
    if (age < 120000) return;
    try {
      const worker = await researchWorker(`/firmable/${run.id}`, 'GET', undefined, 4000) as { status?: string };
      if (['complete','errored','terminated'].includes(worker.status || '')) await history.failRun(run.id, 'Company data refresh ended before it could report completion. Start a new refresh to retry.');
    } catch { if (age >= 600000) await history.failRun(run.id, 'Company data refresh timed out. Start a new refresh to retry; saved data remains available.'); }
  }));
}
