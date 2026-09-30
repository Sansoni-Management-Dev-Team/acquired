import { expect, it } from 'vitest';
import { observedCompanyIdentifiers, validAbn, validateCompanyIdentifiers } from './company-identifiers';
const config = { companyName: 'Fire Central Pty Ltd', companyDomain: 'firecentral.com.au', companyLocation: 'Carlton VIC 3053' };
const source = 'https://abr.business.gov.au/ABN/View?abn=56663118241';
const registry = '# Current details for ABN 56 663 118 241\nEntity name: FIRE CENTRAL PTY LTD\nABN status: Active from 14 Oct 2022\nMain business location: VIC 3053';
it('verifies the Fire Central ABN from the actual registry page, without AI', () => {
  const findings = observedCompanyIdentifiers(registry, source, config);
  expect(findings).toMatchObject([{ kind: 'identifier', name: 'ABN', value: '56663118241' }, { name: 'Legal entity', value: 'FIRE CENTRAL PTY LTD' }]);
  expect(validateCompanyIdentifiers(findings, registry, source, config)).toEqual(findings);
});
it('rejects invented identifiers, bad checksums and unrelated registry entities or locations', () => {
  expect(validAbn('56 663 118 241')).toBe(true);
  expect(validAbn('56 663 118 242')).toBe(false);
  expect(observedCompanyIdentifiers(registry.replace('FIRE CENTRAL', 'OTHER COMPANY'), source, config)).toEqual([]);
  expect(observedCompanyIdentifiers(registry.replace('VIC 3053', 'NSW 2000'), source, config)).toEqual([]);
  expect(observedCompanyIdentifiers(registry, 'https://unrelated.example/profile', config)).toEqual([]);
  expect(validateCompanyIdentifiers([{ kind: 'identifier', name: 'ABN', value: '99999999999' }], registry, source, config)).toEqual([]);
});
it('captures a labelled ABN from a first-party contact or privacy page', () => {
  expect(observedCompanyIdentifiers('Fire Central\nABN: 56 663 118 241', 'https://firecentral.com.au/privacy', config)).toMatchObject([{ value: '56663118241' }]);
});
it('accepts registry markdown tables while keeping distinct ABN record URLs intact', async () => {
  const { publicResearchUrl, researchUrlKey, uniqueResearchUrls } = await import('./research');
  const table = registry.replace('Entity name: FIRE', '| Entity name: | FIRE').replace('PTY LTD\n', 'PTY LTD |\n').replace('Main business location: VIC', '| Main business location: | VIC');
  expect(observedCompanyIdentifiers(table, source, config)).toContainEqual(expect.objectContaining({ value: '56663118241' }));
  expect(publicResearchUrl(source + '&token=secret#section')).toBe(source);
  const other = 'https://abr.business.gov.au/ABN/View?abn=12345678901';
  expect(researchUrlKey(source)).not.toBe(researchUrlKey(other));
  expect(uniqueResearchUrls([source, other])).toHaveLength(2);
});
