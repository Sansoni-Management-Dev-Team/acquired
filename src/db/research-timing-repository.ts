import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from './client';
import { researchJobs } from './schema';
import { MAX_RESEARCH_TIMING_SPANS, type ResearchTimingSpan } from '@/domain/research-timing';
import { withResearchDatabaseContext } from '@/lib/research-request-observability';
import { withResearchJobWorkflow } from '@/lib/acquisition-workflow-context';

// The existing JSON config stores replay-idempotent spans. No schema migration.
// A separate update preserves concurrent discovery/runtime config changes.
export async function saveResearchTimingSpans(jobId: string, organizationId: string, spans: ResearchTimingSpan[]) {
 return withResearchDatabaseContext({ jobId, organizationId, stage: 'telemetry', action: 'save-timings' }, async () => {
  const db = requireDb();
  // Timing callbacks and request-finally flushes may have no workflow context.
  // Resolve the original saved association, never an ambient or current execution.
  const [job] = await db.select({ workflowExecutionId: researchJobs.workflowExecutionId, organizationId: researchJobs.organizationId, createdBy: researchJobs.createdBy }).from(researchJobs).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, organizationId))).limit(1);
  if (!job) throw new Error('Research timing job unavailable');
  const incoming = JSON.stringify(Object.fromEntries(spans.map(span => [span.id, span])));
  const existing = sql`COALESCE(${researchJobs.config}->'pipelineTiming', '{}'::jsonb)`;
  await withResearchJobWorkflow(job, async () => { await db.update(researchJobs).set({
    config: sql`jsonb_set(${researchJobs.config}, '{pipelineTiming}', COALESCE((SELECT jsonb_object_agg(key, value) FROM (SELECT key, value FROM jsonb_each(${incoming}::jsonb || ${existing}) ORDER BY (value->>'startedAt'), key LIMIT ${MAX_RESEARCH_TIMING_SPANS}) bounded), '{}'::jsonb))`,
  }).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, organizationId))); });
  // Timing delivery deliberately does not update updatedAt: telemetry is not
  // progress and must not conceal a stalled workflow.
 });
}
