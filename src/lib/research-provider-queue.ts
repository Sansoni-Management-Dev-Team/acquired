import { eq, sql, and } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';
import { coolDownBrowser, reserveProvider, releaseProvider, localProviderPolicy, consumeProvider, reservationDelay, type ProviderQueue, type ResearchProvider } from '@/domain/research-provider-queue';

// Reuse the existing state row; no schema change. Compare-and-swap guards the
// queue across Next processes, mandates and callback retries.
async function changeQueue<T>(change: (queue: ProviderQueue, now: number) => { queue: ProviderQueue; value: T } | null): Promise<T | null> {
  const db = requireDb();
  for (let retry = 0; retry < 24; retry++) {
    const [row] = await db.select({ id: researchJobs.id, queue: sql<ProviderQueue | null>`${researchJobs.config}->'providerQueue'`, legacy: sql<number>`COALESCE((${researchJobs.config}->>'browserPermitAfter')::bigint, 0)`, now: sql<number>`(extract(epoch from clock_timestamp()) * 1000)::bigint` }).from(researchJobs).orderBy(researchJobs.createdAt, researchJobs.id).limit(1);
    if (!row) return null;
    const next = change(row.queue || { browserAfter: Number(row.legacy) }, Number(row.now));
    if (!next) return null;
    const saved = await db.update(researchJobs).set({ config: sql`jsonb_set(${researchJobs.config}, '{providerQueue}', ${JSON.stringify(next.queue)}::jsonb)` }).where(and(eq(researchJobs.id, row.id), sql`(${researchJobs.config}->'providerQueue') IS NOT DISTINCT FROM ${row.queue ? JSON.stringify(row.queue) : null}::jsonb`)).returning({ id: researchJobs.id });
    if (saved.length) return next.value;
    await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 30));
  }
  return null;
}
export async function reserveResearchProvider(jobId: string, token: string, provider: ResearchProvider, maxWaitMs?: number, paid = false) {
  return await changeQueue((queue, now) => {
    const result = reserveProvider(queue, jobId, token, provider, now, maxWaitMs, localProviderPolicy(process.env), paid);
    return { queue: result.queue, value: { managed: paid, granted: Boolean(result.reservation), queued: 'queued' in result && result.queued === true, retryAfterMs: result.retryAfterMs, ...(result.reservation ? { after: result.reservation.after, until: result.reservation.until, token } : {}) } };
  }) || { granted: false, retryAfterMs: 1000 };
}
export async function consumeResearchProvider(jobId: string, token: string) {
  return Boolean(await changeQueue((queue, now) => {
    const next = consumeProvider(queue, token, jobId, now);
    return next ? { queue: next, value: true } : null;
  }));
}

export async function claimResearchProvider(jobId: string, token: string, domain?: string) {
  return await changeQueue((queue, now) => {
    const delay = reservationDelay(queue, token, jobId, now, domain);
    const consumed = delay === 0 ? consumeProvider(queue, token, jobId, now, domain) : null;
    return { queue: consumed || queue, value: { granted: Boolean(consumed), retryAfterMs: delay ?? 0, expired: delay === null } };
  }) || { granted: false, retryAfterMs: 1000, expired: false };
}

export async function releaseResearchProvider(jobId: string, token: string) {
  return changeQueue(queue => ({ queue: releaseProvider(queue, token, jobId), value: true }));
}

export async function coolDownResearchBrowser(retryAfterMs: number) {
  return changeQueue((queue, now) => ({ queue: coolDownBrowser(queue, now, retryAfterMs), value: true }));
}
