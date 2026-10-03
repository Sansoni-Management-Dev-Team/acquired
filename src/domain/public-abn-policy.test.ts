import { expect, it } from 'vitest';
import { usesPublicAbnLookup } from './public-abn-policy';
it('bypasses browser search admission only for the first C ABN lookup', () => {
  expect(usesPublicAbnLookup({ pipelineDesign: 'corpus-v1' }, 'abn')).toBe(true);
  expect(usesPublicAbnLookup({ pipelineDesign: 'balanced-v1' }, 'abn')).toBe(false);
  expect(usesPublicAbnLookup({}, 'abn')).toBe(false);
  expect(usesPublicAbnLookup({ pipelineDesign: 'corpus-v1' }, 'size')).toBe(false);
  expect(usesPublicAbnLookup({ pipelineDesign: 'corpus-v1', targetedSearches: ['first'] }, 'abn')).toBe(false);
  expect(usesPublicAbnLookup({ pipelineDesign: 'corpus-v1', targetedSearchAttempts: [{ query: 'first', field: 'abn', status: 'failed' }] }, 'abn')).toBe(false);
});
