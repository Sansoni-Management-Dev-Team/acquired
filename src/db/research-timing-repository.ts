import { and, eq, sql } from 'drizzle-orm';
import { requireDb } from './client';
import { researchJobs } from './schema';
import { MAX_RESEARCH_TIMING_SPANS, type ResearchTimingSpan } from '@/domain/research-timing';
import { withResearchDatabaseContext } from '@/lib/research-request-observability';

// The existing JSON config stores replay-idempotent spans. No schema migration.
// A separate update preserves concurrent discovery/runtime config changes.
export async function saveResearchTimingSpans(jobId: string, organizationId: string, spans: ResearchTimingSpan[]) {
  const incoming = JSON.stringify(Object.fromEntries(spans.map(span => [span.id, span])));
  const existing = sql`COALESCE(${researchJobs.config}->'pipelineTiming', '{}'::jsonb)`;
  await withResearchDatabaseContext({ jobId, organizationId, stage: 'telemetry', action: 'save-timings' }, async () => { await requireDb().update(researchJobs).set({
    config: sql`jsonb_set(${researchJobs.config}, '{pipelineTiming}', COALESCE((SELECT jsonb_object_agg(key, value) FROM (SELECT key, value FROM jsonb_each(${incoming}::jsonb || ${existing}) ORDER BY (value->>'startedAt'), key LIMIT ${MAX_RESEARCH_TIMING_SPANS}) bounded), '{}'::jsonb))`,
  }).where(and(eq(researchJobs.id, jobId), eq(researchJobs.organizationId, organizationId))); });
  // Timing delivery deliberately does not update updatedAt: telemetry is not
  // progress and must not conceal a stalled workflow.
}
