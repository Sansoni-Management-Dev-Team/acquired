import { and, eq, inArray, sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { firmableSyncRuns, researchJobs } from '@/db/schema';
import { FirmableHistoryRepository } from '@/db/firmable-history-repository';
import { companyPeopleProgress } from '@/domain/company-people-progress';
import type { ResearchConfig } from '@/domain/research';
import { researchWorker } from './research-service';
import { recoverFirmableRefreshes } from './firmable-run-recovery';

type Job = typeof researchJobs.$inferSelect;
/** One automatic people workflow per root leaves room for ongoing company reads.
 * Existing run IDs and request keys make checkpoint retries safe. */
export async function tickCompanyPeople(job: Job, stopped = false) {
  const db = requireDb(), history = new FirmableHistoryRepository(db);
  const dispatch = await db.transaction(async tx => {
    const [root] = await tx.select().from(researchJobs).where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, job.organizationId))).for('update');
    if (!root) throw Error('Company research root missing');
    const config = root.config as ResearchConfig;
    const ids = config.companyPeopleRunIds || [];
    if (!ids.length) return [];
    const runs = await tx.select().from(firmableSyncRuns).where(and(eq(firmableSyncRuns.organizationId, job.organizationId), inArray(firmableSyncRuns.id, ids)));
    if (runs.length !== ids.length) throw Error('Linked people research run missing');
    const pending = runs.filter(run => ['queued', 'running'].includes(run.status));
    if (stopped || ['complete','partial','failed','cancelled'].includes(root.status) || Date.now() >= (config.automaticDeadline || Infinity)) {
      if (pending.length) await tx.update(firmableSyncRuns).set({ status: 'failed', completedAt: new Date(), updatedAt: new Date(), message: root.status === 'cancelled' ? 'Company search cancelled; saved contacts retained' : 'Company search time limit reached; saved contacts retained' }).where(inArray(firmableSyncRuns.id, pending.map(run => run.id)));
      return [];
    }
    if (runs.some(run => run.status === 'running')) return [];
    const next = runs.filter(run => run.status === 'queued').sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!next) return [];
    await tx.update(firmableSyncRuns).set({ status: 'running', startedAt: new Date(), updatedAt: new Date(), message: 'Finding company contacts' }).where(eq(firmableSyncRuns.id, next.id));
    return [next];
  });
  for (const run of dispatch) {
    // createBatch uses a stable ID: an uncertain dispatch can be safely retried.
    try { await researchWorker(`/firmable/${run.id}`, 'POST', { mandateId: job.mandateId }, 4000); }
    catch { await db.update(firmableSyncRuns).set({ status: 'queued', updatedAt: new Date(), message: 'People workflow dispatch pending; retrying' }).where(and(eq(firmableSyncRuns.id, run.id), eq(firmableSyncRuns.status, 'running'), eq(firmableSyncRuns.message, 'Finding company contacts'))); }
  }
  const [root] = await db.select().from(researchJobs).where(eq(researchJobs.id, job.id));
  const ids = (root.config as ResearchConfig).companyPeopleRunIds || [];
  const runs = ids.length ? await db.select().from(firmableSyncRuns).where(and(eq(firmableSyncRuns.organizationId, job.organizationId), inArray(firmableSyncRuns.id, ids))) : [];
  await recoverFirmableRefreshes(history, runs.filter(run => run.status === 'running'), job.mandateId);
  const current = ids.length ? await db.select().from(firmableSyncRuns).where(and(eq(firmableSyncRuns.organizationId, job.organizationId), inArray(firmableSyncRuns.id, ids))) : [];
  const progress = companyPeopleProgress(current);
  if (JSON.stringify((root.config as ResearchConfig).companyPeopleProgress) !== JSON.stringify(progress)) await db.update(researchJobs).set({ updatedAt: ['complete','partial','failed','cancelled'].includes(root.status) ? root.updatedAt : new Date(), config: sql`${researchJobs.config} || ${JSON.stringify({ companyPeopleProgress: progress })}::jsonb` }).where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, job.organizationId)));
  return progress;
}
export async function queueCompanyPeople(job: Job, targetId: string, companyId: string) {
  if (!(job.config as ResearchConfig).includeCompanyPeople) return;
  const db = requireDb(), history = new FirmableHistoryRepository(db);
  const run = await history.queueRun({ organizationId: job.organizationId, actorId: job.createdBy, targetId, requestKey: `discovery:${job.id}:${targetId}`, trigger: 'discovery' });
  if (run.trigger === 'discovery' && run.status === 'queued') await history.linkRunCompany(run.id, companyId, 'complete');
  const linked = await db.update(researchJobs).set({ config: sql`${researchJobs.config} || jsonb_build_object('companyPeopleRunIds', (SELECT jsonb_agg(DISTINCT value) FROM jsonb_array_elements_text(COALESCE(${researchJobs.config}->'companyPeopleRunIds', '[]'::jsonb) || ${JSON.stringify([run.id])}::jsonb)))` }).where(and(eq(researchJobs.id, job.id), eq(researchJobs.organizationId, job.organizationId), sql`${researchJobs.status} <> 'cancelled'`)).returning({ id: researchJobs.id });
  if (!linked.length) { await history.failRun(run.id, 'Company search cancelled'); return; }
  await tickCompanyPeople(job);
}
