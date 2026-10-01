import { and, eq, sql } from 'drizzle-orm';
import type { requireDb } from './client';
import { researchFindings, targets } from './schema';
import type { ResearchFinding } from '@/domain/research';
import { reconcileResearchFirmographics } from '@/domain/research-firmographics';

// Compare-and-swap keeps concurrent sibling jobs from overwriting newer values.
// Both PostgreSQL and the HTTP driver support this without a transaction.
export async function reconcileResearchTarget(database: ReturnType<typeof requireDb>, organizationId: string, targetId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const [target] = await database.select({ firmographics: targets.firmographics }).from(targets).where(and(eq(targets.id, targetId), eq(targets.organizationId, organizationId))).limit(1);
    if (!target) return;
    const observations = await database.select({ evidence: researchFindings.evidence, sourceUrl: researchFindings.sourceUrl, observedAt: researchFindings.observedAt }).from(researchFindings).where(and(eq(researchFindings.organizationId, organizationId), eq(researchFindings.targetId, targetId)));
    const next = reconcileResearchFirmographics(target.firmographics as Record<string, unknown>, observations.map(f => ({ ...f, evidence: f.evidence as ResearchFinding, observedAt: f.observedAt.toISOString() })));
    if (JSON.stringify(next) === JSON.stringify(target.firmographics)) return;
    const saved = await database.update(targets).set({ firmographics: next, updatedAt: new Date() }).where(and(eq(targets.id, targetId), eq(targets.organizationId, organizationId), sql`${targets.firmographics} = ${JSON.stringify(target.firmographics)}::jsonb`)).returning({ id: targets.id });
    if (saved.length) return;
  }
  // Do not acknowledge a page whose reconciliation was lost to contention.
  throw new Error('Company observations changed concurrently; retry persistence');
}
