import type { ResearchConfig } from './research';

// Only C's first ABN attempt uses the independent HTTP queue. Subsequent
// verification searches still go through normal search-provider admission.
export function usesPublicAbnLookup(config: Pick<ResearchConfig, 'pipelineDesign' | 'targetedSearches' | 'targetedSearchAttempts'>, field: string) {
  return config.pipelineDesign === 'corpus-v1' && field === 'abn' && !config.targetedSearches?.length && !config.targetedSearchAttempts?.length;
}
