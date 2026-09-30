import { it as test } from 'vitest';
import assert from 'node:assert/strict';
import { summarizeResearchLog } from './research-log-summary.mjs';

test('summarizes terminal requests, ignores partial lines and deduplicates replayed log entries', () => {
  const event = { timestamp: '2026-09-30T05:00:00Z', provider: 'local-crawl4ai', event: 'request_failed', requestId: 'request-one', category: 'domain_backoff', httpStatus: 429, elapsedMs: 12, reader: { activeReads: 2, maxReads: 5, domainActive: true } };
  const line = `research-provider ${JSON.stringify(event)}`;
  const result = summarizeResearchLog([line, line, 'research-provider {', 'research-reader {}', `research-provider ${JSON.stringify({ ...event, requestId: 'request-two', elapsedMs: 20 })}`].join('\n'));
  assert.equal(result.requests.length, 1);
  assert.deepEqual(result.requests[0], { provider: 'local-crawl4ai', reason: 'domain_in_flight', status: 429, count: 2, meanMs: 16, p95Ms: 20, workMs: 32 });
  assert.equal(result.latestReader.domainActive, true);
});

test('counts retries with the same request ID as separate attempts', () => {
  const event = { provider: 'local-crawl4ai', event: 'request_failed', requestId: 'request-one', category: 'reader_busy', httpStatus: 429, elapsedMs: 1 };
  const log = ['2026-09-30T05:00:00Z', '2026-09-30T05:00:03Z'].map(timestamp => `research-provider ${JSON.stringify({ ...event, timestamp })}`).join('\n');
  assert.equal(summarizeResearchLog(log).requests[0].count, 2);
});
