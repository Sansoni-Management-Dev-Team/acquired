import { expect, it } from 'vitest';
import { groundedCriterionValue } from './criterion-grounding';
import { briefSchema, briefToMandate, criterion, emptyBrief } from './acquisition';
it('rejects markup and unsupplied numeric values', () => {
  expect(groundedCriterionValue('revenueCeiling', '</arg_value>25000000', 'revenue $12m–$22m')).toBe('');
  expect(groundedCriterionValue('revenueCeiling', '25000000', 'revenue $12m–$22m')).toBe('');
  expect(groundedCriterionValue('revenue', '12000000–22000000', 'revenue $12m–$22m')).toBe('12000000–22000000');
});
it('retains supplied certifications and drops unsupported additions', () => {
  expect(groundedCriterionValue('accreditations', 'ISO 9001; ISO 14001; Safe Work Australia accredited', 'ISO 9001 and ISO 14001 accreditations')).toBe('ISO 9001; ISO 14001');
});
it('rejects malformed numeric brief values and preserves the original revenue maximum', () => {
  const b = emptyBrief(); Object.assign(criterion(b, 'revenue'), { state: 'specified', value: '12000000–22000000' });
  Object.assign(criterion(b, 'revenueCeiling'), { state: 'specified', value: '25000000' });
  expect(briefToMandate(b).revenue.max).toBe(22000000);
  expect(briefToMandate(b).revenueCeiling).toBe(25000000);
  criterion(b, 'revenueCeiling').value = '</arg_value>25000000';
  expect(briefSchema.safeParse(b).success).toBe(false);
});
it('keeps the rest of a historical brief readable without changing its stored value', async () => {
  const { readableStoredBrief } = await import('./stored-brief');
  const b = emptyBrief(); Object.assign(criterion(b, 'revenueCeiling'), { state: 'specified', value: '</arg_value>25000000' });
  Object.assign(criterion(b, 'headcount'), { state: 'specified', value: '30–80' });
  const readable = briefSchema.parse(readableStoredBrief(b));
  expect(criterion(readable, 'revenueCeiling').state).toBe('unknown');
  expect(criterion(readable, 'headcount').value).toBe('30–80');
  expect(criterion(b, 'revenueCeiling').value).toBe('</arg_value>25000000');
});
it('checks a separate ceiling even when the revenue range is open-ended', () => {
  const b=emptyBrief(); Object.assign(criterion(b,'revenue'),{state:'specified',value:'12000000'});
  Object.assign(criterion(b,'revenueCeiling'),{state:'specified',value:'10000000'});
  expect(briefSchema.safeParse(b).success).toBe(false);
});
