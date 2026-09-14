import type { ResearchConfig, ResearchFinding } from './research';
export const researchFields = ['size', 'revenue', 'people', 'email'] as const;
export type ResearchField = typeof researchFields[number];
export const fieldLabels: Record<ResearchField, string> = { size: 'headcount', revenue: 'revenue', people: 'decision-maker', email: 'published decision-maker email' };
export function objectiveFields(config: Pick<ResearchConfig, 'purpose'>): ResearchField[] {
  return config.purpose === 'firmographics' ? ['size', 'revenue'] : config.purpose === 'people' ? ['people', 'email'] : [];
}
export function fieldSatisfied(field: ResearchField, findings: ResearchFinding[]) {
  if (field === 'people') return findings.some(f => f.kind === 'person');
  if (field === 'email') return findings.some(f => f.kind === 'person' && Boolean(f.email));
  return findings.some(f => f.kind === (field === 'size' ? 'headcount' : 'revenue') && f.factMetadata?.basis !== 'search_snippet');
}
export function missingResearchFields(config: Pick<ResearchConfig, 'purpose'>, findings: ResearchFinding[]) {
  return objectiveFields(config).filter(field => !fieldSatisfied(field, findings));
}
export type SearchAttempt = { query: string; field: ResearchField; status: 'succeeded' | 'failed'; category?: string };
export function nextSearchQuery(queries: string[], completed: string[], attempts: SearchAttempt[]) {
  return queries.find(query => !completed.includes(query) && attempts.filter(a => a.query === query && a.status === 'failed').length < 2);
}
