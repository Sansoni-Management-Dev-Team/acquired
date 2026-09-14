import { sql } from 'drizzle-orm';
import { requireDb } from '@/db/client';
import { researchJobs } from '@/db/schema';

// All jobs use the same Browser Run account. An atomic conditional update on
// one existing row coordinates isolates without adding a table or migration.
// Only the internal service-authenticated callback may request a permit.
export async function researchBrowserPermit() {
  const rows = await requireDb().update(researchJobs).set({
    config: sql`jsonb_set(${researchJobs.config}, '{browserPermitAfter}', to_jsonb((extract(epoch from clock_timestamp()) * 1000)::bigint + 11000))`,
  }).where(sql`${researchJobs.id} = (SELECT id FROM research_jobs ORDER BY created_at, id LIMIT 1)
    AND COALESCE((${researchJobs.config}->>'browserPermitAfter')::bigint, 0) <= (extract(epoch from clock_timestamp()) * 1000)::bigint`)
    .returning({ id: researchJobs.id });
  return { granted: rows.length === 1, retryAfterMs: rows.length ? 0 : 11000 };
}
