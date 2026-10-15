import { expect, it } from 'vitest';
import { classifySearchProbe, summarizeBackgroundJobs } from './diagnose-field-search.mjs';
it('identifies admission rejection without emitting raw error bodies', () => {
  const result = classifySearchProbe(503, { category: 'browser_admission', error: 'private credential or provider payload' });
  expect(result).toEqual({ status: 503, category: 'browser_admission', admissionRejected: true });
  expect(JSON.stringify(result)).not.toContain('private');
  expect(classifySearchProbe(503, { category: 'unexpected-private-value' }).category).toBe('unknown');
  expect(classifySearchProbe(503, { category: 'provider_error' }).admissionRejected).toBe(false);
});
it('distinguishes failed field searches from successful page evidence and unattempted work', () => {
  const result = summarizeBackgroundJobs([
    { status: 'partial', result: { written: 2, attempts: [{ kind: 'search', status: 'failed' }, { kind: 'page', status: 'succeeded' }] } },
    { status: 'partial', result: { attempts: [{ kind: 'search', status: 'failed' }, { kind: 'search', status: 'succeeded' }] } },
    { status: 'queued' },
  ]);
  expect(result).toMatchObject({ companies: 3, searched: 2, allSearchesFailed: 1, someSearchSucceeded: 1, noSearch: 1, failedSearchAttempts: 2, successfulSearchAttempts: 1, withEvidence: 1, statuses: { partial: 2, queued: 1 } });
});
