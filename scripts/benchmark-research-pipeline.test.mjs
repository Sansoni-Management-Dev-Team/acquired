import { expect, it } from 'vitest';
import { pipelineBenchmark, comparePipelineBenchmarks } from './benchmark-research-pipeline.mjs';
it('deduplicates companies and labels incomplete captures', () => {
  const data = pipelineBenchmark({ jobs: [{ id: 'root', pages: 2, modelCalls: 1, status: 'complete', config: { newBusinessIds: ['a'] } }, { id: 'child', pages: 3, modelCalls: 2, status: 'crawling', config: { researchRunId: 'root', newBusinessIds: ['a', 'b'] } }], timings: { root: { measuredWindowMs: 60000, spans: 5, segments: {} } }, pendingEnrichment: [{ runId: 'root' }] });
  expect(data.runs[0]).toMatchObject({ newRelevantCompanies: 2, companiesPerMeasuredMinute: 2, activeJobs: 1, pendingDeepJobs: 1, pageReads: 5 });
  expect(comparePipelineBenchmarks(data, data).comparableCompletion).toBe(false);
});
