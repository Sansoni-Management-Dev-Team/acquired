import { expect, it } from 'vitest';
import { researchTimingBatchSchema, researchTimingSegment, summariseResearchTimings, type ResearchTimingSpan } from './research-timing';
import { progressSchema } from './research';

const span = (n: number, elapsedMs: number, outcome: ResearchTimingSpan['outcome'] = 'succeeded'): ResearchTimingSpan => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, step: `extract-${n}`, segment: 'extraction', startedAt: '2026-09-30T00:00:00.000Z', finishedAt: new Date(Date.parse('2026-09-30T00:00:00.000Z') + elapsedMs).toISOString(), elapsedMs, outcome });
it('separates admission, durable waits, callback overhead and actual extraction', () => {
  expect(researchTimingSegment('admit-discover-0-q-0-0-abcd-0')).toBe('provider_admission');
  expect(researchTimingSegment('wait-read-people-1-0')).toBe('provider_wait');
  expect(researchTimingSegment('discover-0-q-0-0-abcd-admitted-0')).toBe('discovery_callback');
  expect(researchTimingSegment('lookahead-read-2-admitted-0')).toBe('page_read');
  expect(researchTimingSegment('extract-1-admitted-0')).toBe('extraction');
});
it('aggregates parallel work separately from elapsed measurement window', () => {
  const spans = [span(1, 100), span(2, 300, 'failed')];
  const result = summariseResearchTimings([{ id: 'job', createdAt: new Date(), config: { pipelineTiming: Object.fromEntries(spans.map(s => [s.id, s])) } }]);
  expect(result.segments.extraction).toEqual({ calls: 2, failed: 1, totalMs: 400, maxMs: 300, meanMs: 200, p95Ms: 300 });
  expect(result.measuredWindowMs).toBe(300);
});
it('rejects malformed timing batches and ignores malformed stored data', () => {
  expect(researchTimingBatchSchema.safeParse({ spans: [] }).success).toBe(false);
  expect(researchTimingBatchSchema.safeParse({ spans: [{ ...span(1, 100), elapsedMs: -1 }] }).success).toBe(false);
  expect(summariseResearchTimings([{ id: 'job', createdAt: new Date(), config: { pipelineTiming: { invalid: {} as ResearchTimingSpan } } }]).spans).toBe(0);
});
it('accepts partial follow-up counters in progress checkpoints', () => {
  const result = progressSchema.safeParse({ revision: 1, status: 'partial', pages: 1, modelCalls: 0, message: 'Deeper research pending', enrichmentPendingFields: ['people', 'email'], followupSearchCounts: { people: 1 }, followupEmptySearchCounts: {}, followupExhaustedFields: ['people'] });
  expect(result.success).toBe(true);
});

it.each([true, false])('preserves explicit targeted capacity flag %s in progress validation', targetedSearchDeferred => {
 const checkpoint = progressSchema.parse({ revision: 1, status: 'partial', pages: 0, modelCalls: 0, message: 'Capacity checkpoint', targetedSearchDeferred });
 expect(checkpoint.targetedSearchDeferred).toBe(targetedSearchDeferred);
});

it.each([true, false])('preserves follow-up planner attempt flag %s in progress validation', followupPlannerUsed => {
 const checkpoint = progressSchema.parse({ revision: 1, status: 'partial', pages: 0, modelCalls: 1, message: 'Planner checkpoint', followupPlannerUsed });
 expect(checkpoint.followupPlannerUsed).toBe(followupPlannerUsed);
});
