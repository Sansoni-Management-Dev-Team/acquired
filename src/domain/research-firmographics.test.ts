import { expect, it } from 'vitest';
import { reconcileResearchFirmographics } from './research-firmographics';
import type { ResearchFinding } from './research';
const metadata = { basis: 'reported' as const, sourceKind: 'company_profile' as const, currency: null, scope: 'unspecified' as const, period: null, identityNote: null };
const finding = (kind: ResearchFinding['kind'], value: string, overrides = {}) => ({ evidence: { kind, name: kind, value, quote: `Headland Technology ${value}`, website: 'https://headland.au/', factMetadata: metadata, ...overrides }, sourceUrl: 'https://au.linkedin.com/company/headland-technology', observedAt: '2026-09-30T22:16:00.000Z' });
it('reconciles the Headland published range without inventing an exact employee count', () => {
  const result = reconcileResearchFirmographics({ headcount: { value: null, missingReason: 'Not enriched' }, accreditations: ['ISO 9001'] }, [finding('headcount', '51-200 employees')]);
  expect(result.headcount).toMatchObject({ value: null, displayValue: '51-200 employees', range: { min: 51, max: 200 }, researchState: 'observed', provenance: { sourceUrl: 'https://au.linkedin.com/company/headland-technology' } });
  expect(result.accreditations).toEqual(['ISO 9001']);
});
it('preserves stronger provider and reviewed values while reconciling missing fields', () => {
  const current = { headcount: { value: 71, provenance: { source: 'Firmable', confidence: 90 } }, revenue: { value: null } };
  const result = reconcileResearchFirmographics(current, [finding('headcount', '51-200 employees'), finding('revenue', 'AUD 12 million', { factMetadata: { ...metadata, sourceKind: 'company_website', currency: 'AUD' } })]);
  expect(result.headcount).toEqual(current.headcount);
  expect(result.revenue).toMatchObject({ value: 12000000, researchState: 'observed' });
});
it('preserves published USD revenue without treating the amount as AUD', () => {
  const result = reconcileResearchFirmographics({}, [finding('revenue', 'USD 12 million', { factMetadata: { ...metadata, currency: 'USD' } })]);
  expect(result.revenue).toMatchObject({ value: null, displayValue: 'USD 12 million', factMetadata: { currency: 'USD' } });
});
it('clears only research-selected values when later same-quality evidence conflicts', () => {
  const first = reconcileResearchFirmographics({}, [finding('headcount', '51-200 employees')]);
  const conflicting = reconcileResearchFirmographics(first, [finding('headcount', '51-200 employees'), finding('headcount', '11-50 employees')]);
  expect(conflicting.headcount).toMatchObject({ value: null, displayValue: null, researchState: 'conflicting' });
  expect(conflicting.headcount).not.toHaveProperty('range');
});
it('is independent of sibling completion order, retains founded year and leaves snippets unselected', () => {
  const observations = [finding('headcount', '51-200 employees'), finding('founded_year', '1949'), finding('revenue', '$181.6M', { factMetadata: { ...metadata, basis: 'search_snippet', currency: null } })];
  const forward = reconcileResearchFirmographics({}, observations), reverse = reconcileResearchFirmographics({}, [...observations].reverse());
  expect(forward).toEqual(reverse);
  expect(forward.establishedYear).toMatchObject({ value: 1949 });
  expect(forward.revenue).toMatchObject({ value: null, researchState: 'missing' });
  expect(reconcileResearchFirmographics(forward, observations)).toEqual(forward);
});
