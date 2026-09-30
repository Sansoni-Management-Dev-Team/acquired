import { expect, it } from 'vitest';
import { summarizeResearchEgress } from './research-egress-summary.mjs';
const event = overrides => ({ event: 'query_finished', queryId: 'one', requestId: 'request', timestamp: '2026-10-01T00:00:00Z', jobId: 'job', action: 'discover', stage: 'coordination', operation: 'select', tables: ['research_jobs'], queryFingerprint: 'fingerprint', outcome: 'succeeded', rowsReturned: 2, resultJsonBytes: 100, fieldJsonBytes: { config: 80 }, byteMeasurement: 'utf8_json_returned_rows', ...overrides });
const line = value => `research-db ${JSON.stringify(value)}`;
it('ranks cumulative bytes, preserves separate query attempts and avoids duplicate/request summary double counting', () => {
  const first = event();
  const result = summarizeResearchEgress([line(first),line(first), line(event({ queryId: 'two', resultJsonBytes: 200 })),line(event({ queryId: 'three', jobId: 'other', tables: ['contacts'], queryFingerprint: 'small', resultJsonBytes: 10, fieldJsonBytes: {} })), 'research-request {"databaseResultJsonBytes":310}', 'research-db {'].join('\n'));
  expect(result.resultJsonBytes).toBe(310); expect(result.queryCount).toBe(3);
  expect(result.queries[0]).toMatchObject({ calls: 2, resultJsonBytes: 300, meanResultJsonBytes: 150, maxResultJsonBytes: 200 });
  expect(result.fields).toEqual([{field:'config',jsonBytes:160}]);
});
it('supports Vercel JSON, filters by job and counts missing measurements honestly', () => {
  const contents = [JSON.stringify({message:line(event())}),line(event({queryId:'two',jobId:'other'})),line(event({queryId:'failed',outcome:'failed',resultJsonBytes:undefined,byteMeasurement:undefined}))].join('\n');
  expect(summarizeResearchEgress(contents,{jobId:'job'})).toMatchObject({queryCount:2,measuredQueries:1,unmeasuredQueries:1,failedQueries:1,resultJsonBytes:100});
});
