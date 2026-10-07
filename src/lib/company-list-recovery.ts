import {dispatchCompanyBackground} from './company-background-dispatch';
import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { ResearchRepository } from '@/db/research-repository';
import { terminalResearchStates, type ResearchConfig } from '@/domain/research';
import { researchEnabled, researchWorker } from './research-service';
import { scheduleResearchRun } from './research-scheduler';

// Recovery is independent of the progress payload and runs at a slower cadence.
export async function recoverCompanyListWork(org: string, mandateId: string, now = Date.now()) {
  if (!researchEnabled()) return;
  const db = requireDb(), repo = new ResearchRepository(org);
  const jobs = await db.select({ id: researchJobs.id, status: researchJobs.status, updatedAt: researchJobs.updatedAt, revision: researchJobs.revision, pages: researchJobs.pages,
    config: sql<ResearchConfig>`jsonb_build_object('mode', ${researchJobs.config}->'mode', 'researchRunId', ${researchJobs.config}->'researchRunId', 'automaticDeadline', ${researchJobs.config}->'automaticDeadline', 'companyBackgroundResearch', ${researchJobs.config}->'companyBackgroundResearch')`,
  }).from(researchJobs).where(and(eq(researchJobs.organizationId, org), eq(researchJobs.mandateId, mandateId)));
  await dispatchCompanyBackground(org,mandateId);
  for (const job of jobs.filter(j => !j.config.companyBackgroundResearch && !terminalResearchStates.includes(j.status) && now - j.updatedAt.getTime() > 90000)) {
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
    try { await scheduleResearchRun(org, root.id, { recovery: true }); } catch { /* Next recovery pass retries durable work. */ }
  }
  const { FirmableHistoryRepository } = await import('@/db/firmable-history-repository');
  const { targets } = await import('@/db/schema');
  const { recoverFirmableRefreshes } = await import('./firmable-run-recovery');
  const memberships = await db.select({ id: targets.id }).from(targets).where(and(eq(targets.organizationId, org), eq(targets.mandateId, mandateId)));
  const history = new FirmableHistoryRepository(db);
  await recoverFirmableRefreshes(history, await history.latestRuns(org, memberships.map(target => target.id)), mandateId, now);
}
