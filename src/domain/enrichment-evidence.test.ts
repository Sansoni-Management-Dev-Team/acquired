import { expect, it } from 'vitest';
import { reusableEnrichmentEvidence } from './enrichment-evidence';
const now = Date.now();
it('expires prior contacts sooner than company facts and rejects stale observations', () => {
  expect(reusableEnrichmentEvidence({ observedAt: new Date(now - 8 * 86400000), evidence: { kind: 'person' } }, now)).toBeNull();
  expect(reusableEnrichmentEvidence({ observedAt: new Date(now - 8 * 86400000), evidence: { kind: 'headcount' } }, now)).toMatchObject({ kind: 'headcount' });
  expect(reusableEnrichmentEvidence({ observedAt: new Date(now - 31 * 86400000), evidence: { kind: 'headcount' } }, now)).toBeNull();
});
it('never imports another mandate relevance assessment', () => {
  expect(reusableEnrichmentEvidence({ observedAt: new Date(now), evidence: { kind: 'product', relevance: 'relevant' } }, now)).toBeNull();
  expect(reusableEnrichmentEvidence({ observedAt: new Date(now), evidence: { kind: 'company', relevance: 'relevant' } }, now)).toEqual({ kind: 'company' });
});
