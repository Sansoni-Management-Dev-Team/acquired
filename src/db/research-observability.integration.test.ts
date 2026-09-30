import { expect, it, vi } from 'vitest';
vi.mock('@/db/research-timing-repository', () => ({ saveResearchTimingSpans: vi.fn() }));
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { researchJobs } from './schema';
import { observeResearchDatabase, observeResearchRequest } from '@/lib/research-request-observability';

it('preserves actual Drizzle select/update execution and measures each database round trip once', async () => {
 const query = vi.fn().mockResolvedValue({ rows: [['job-123']] });
 const database = observeResearchDatabase(drizzle({ client: { query } as never }));
 const response = await observeResearchRequest(new Request('https://example.com'), async () => {
  const rows = await database.select({ id: researchJobs.id }).from(researchJobs).where(eq(researchJobs.id, 'job-123')).limit(1);
  expect(rows).toEqual([{ id: 'job-123' }]);
  const saved = await database.update(researchJobs).set({ message: 'Heartbeat' }).where(eq(researchJobs.id, 'job-123')).returning({ id: researchJobs.id });
  expect(saved).toEqual([{ id: 'job-123' }]);
  return Response.json({ ok: true });
 });
 expect(query).toHaveBeenCalledTimes(2);
 expect(response.headers.get('x-research-db-calls')).toBe('2');
});
