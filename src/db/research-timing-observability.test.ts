import { expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ database: undefined as unknown }));
vi.mock('./client', () => ({ requireDb: () => mocks.database }));
import { drizzle } from 'drizzle-orm/node-postgres';
import { saveResearchTimingSpans } from './research-timing-repository';
import { observeResearchDatabase, observeResearchRequest, researchJsonResponse } from '@/lib/research-request-observability';

it('attributes the actual awaited timing write once without generating recursive spans', async () => {
 const log = vi.spyOn(console, 'info').mockImplementation(() => {});
 try {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  mocks.database = observeResearchDatabase(drizzle({ client: { query } as never }));
  await observeResearchRequest(new Request('https://example.com'), async () => {
   await saveResearchTimingSpans('00000000-0000-4000-8000-000000000001', 'org', [{ id:'00000000-0000-4000-8000-000000000002', step:'extract-1', segment:'extraction', startedAt:'2026-10-01T00:00:00.000Z', finishedAt:'2026-10-01T00:00:01.000Z', elapsedMs:1000, outcome:'succeeded' }]);
   return researchJsonResponse({ ok:true });
  });
  expect(query).toHaveBeenCalledTimes(1);
  const events=log.mock.calls.filter(([tag])=>tag==='research-db').map(([,body])=>JSON.parse(body));
  expect(events.map(event=>event.event)).toEqual(['query_started','query_finished']);
  expect(events[0].queryId).toEqual(expect.any(String));
  expect(events[1].queryId).toBe(events[0].queryId);
  for(const event of events)expect(event).toMatchObject({ operation:'update',stage:'telemetry',action:'save-timings',organizationId:'org',tables:['research_jobs'] });
  expect(events[1]).toMatchObject({outcome:'succeeded',timingBasis:'application_database_round_trip'});
  expect(events[1].elapsedMs).toBeGreaterThanOrEqual(0);
  expect(log.mock.calls.some(([tag])=>tag==='research-pipeline')).toBe(false);
 } finally { log.mockRestore(); }
});
