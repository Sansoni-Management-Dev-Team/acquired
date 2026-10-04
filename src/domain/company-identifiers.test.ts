import { expect, it } from 'vitest';
import { observedCompanyIdentifiers, validAbn, validateCompanyIdentifiers } from './company-identifiers';
const config = { companyName: 'Fire Central Pty Ltd', companyDomain: 'firecentral.com.au', companyLocation: 'Carlton VIC 3053' };
const source = 'https://abr.business.gov.au/ABN/View?abn=56663118241';
const registry = '# Current details for ABN 56 663 118 241\nEntity name: FIRE CENTRAL PTY LTD\nABN status: Active from 14 Oct 2022\nMain business location: VIC 3053';
it('validates an AND/& registry entity without dropping substantive name words', () => {
  const name = 'Contract Manufacturing and Packaging Services Pty Ltd';
  const record = '# Current details for ABN 70 092 250 596\nEntity name: CONTRACT MANUFACTURING & PACKAGING SERVICES PTY LTD\nMain business location: NSW 2164';
  expect(observedCompanyIdentifiers(record, 'https://abr.business.gov.au/ABN/View?abn=70092250596', { companyName: name, companyDomain: 'cmps.com.au' })).toContainEqual(expect.objectContaining({ value: '70092250596' }));
});
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

it('matches a trading name to its corporate suffix only with corroborating known location', () => {
  const headland = { companyName: 'Headland Technology', companyDomain: 'headland.au', companyLocation: 'Burwood VIC' };
  const record = '# Current details for ABN 96 004 338 961\nEntity name: HEADLAND TECHNOLOGY PTY LTD\nMain business location: VIC 3125';
  const url = 'https://abr.business.gov.au/ABN/View?abn=96004338961';
  expect(observedCompanyIdentifiers(record, url, headland)).toContainEqual(expect.objectContaining({value:'96004338961'}));
  expect(observedCompanyIdentifiers(record, url, {...headland, companyLocation:undefined})).toEqual([]);
  expect(observedCompanyIdentifiers(record.replace('VIC 3125', 'NSW 2000'), url, headland)).toEqual([]);
  expect(observedCompanyIdentifiers(record.replace('TECHNOLOGY PTY', 'TECHNOLOGY SERVICES PTY'), url, headland)).toEqual([]);
  expect(observedCompanyIdentifiers(record, url, {...headland,companyName:'Headland Technology Ltd'})).toEqual([]);
  expect(observedCompanyIdentifiers(record, url.replace('96004338961','56663118241'), headland)).toEqual([]);
});
it('discovers only first-party legal PDFs for ABN research', async () => {
  const { abnFollowUpLinks } = await import('./company-identifiers');
  expect(abnFollowUpLinks('[Privacy policy](./static/Headland-Privacy-2024.pdf)\n[Brochure](/products.pdf)\n[Other privacy](https://other.example.com/privacy.pdf)', 'https://headland.au/', 'headland.au')).toEqual(['https://headland.au/static/Headland-Privacy-2024.pdf']);
});
it('canonicalizes safe numeric registry URL formats without preserving arbitrary search terms', async () => {
  const { publicResearchUrl } = await import('./research');
  expect(publicResearchUrl('https://abr.business.gov.au/SearchByAbn.aspx?SearchText=96004338961&token=secret')).toBe('https://abr.business.gov.au/ABN/View?abn=96004338961');
  expect(publicResearchUrl('https://abr.business.gov.au/ABN/View/96004338961')).toBe('https://abr.business.gov.au/ABN/View?abn=96004338961');
  expect(publicResearchUrl('https://abr.business.gov.au/SearchByAbn.aspx?SearchText=arbitrary-secret')).not.toContain('arbitrary-secret');
});

it('requires the PDF ABN paragraph to identify the target, excluding customer documents', () => {
 const headland = {companyName:'Headland Technology',companyDomain:'headland.au',companyLocation:'Burwood VIC'};
 const source = 'https://headland.au/privacy.pdf';
 expect(observedCompanyIdentifiers('Headland Technology Pty Ltd ABN 96 004 338 961 (“We/Us/Our”) respects your privacy.',source,headland)).toMatchObject([{value:'96004338961'}]);
 expect(observedCompanyIdentifiers('Headland Technology\n\nCustomer terms: Other Supplier Pty Ltd ABN 96 004 338 961.',source,headland)).toEqual([]);
 expect(observedCompanyIdentifiers('Other Supplier Pty Ltd ABN 96 004 338 961.',source,headland)).toEqual([]);
 expect(observedCompanyIdentifiers('Headland Technology supplies Other Supplier Pty Ltd ABN 96 004 338 961.',source,headland)).toEqual([]);
});
