import type { ResearchConfig, ResearchFinding } from './research';
import { resolveCompanyField } from './research-resolution';
export const researchFields = ['abn', 'size', 'revenue', 'people', 'email'] as const;
export type ResearchField = typeof researchFields[number];
export const fieldLabels: Record<ResearchField, string> = { abn: 'ABN', size: 'headcount', revenue: 'revenue', people: 'owner or director candidate', email: 'published owner or director email' };
export function objectiveFields(config: Pick<ResearchConfig, 'purpose' | 'researchField'>): ResearchField[] {
  if (config.researchField) return [config.researchField];
  return config.purpose === 'firmographics' ? ['size', 'revenue'] : config.purpose === 'people' ? ['people', 'email'] : [];
}
// An outreach candidate is a research lead, not proof of ownership or sale authority.
export function ownershipContact(finding: ResearchFinding) {
  if (finding.kind !== 'person') return false;
  const role = (finding.value || '').trim();
  return /\b(owner|co-owner|founder|co-founder|proprietor|shareholder)\b/i.test(role) || /^(?:(?:managing|executive|non-executive|company)\s+)?director$/i.test(role);
}
export function fieldSatisfied(field: ResearchField, findings: ResearchFinding[]) {
  if (field === 'abn') return findings.some(f => f.kind === 'identifier' && f.name === 'ABN' && /^\d{11}$/.test(f.value.replace(/\D/g, '')));
  if (field === 'people') return findings.some(ownershipContact);
  if (field === 'email') return findings.some(f => ownershipContact(f) && Boolean(f.email));
  return resolveCompanyField(field, findings).status === 'observed';
}
export function missingResearchFields(config: Pick<ResearchConfig, 'purpose' | 'researchField'>, findings: ResearchFinding[]) {
  return objectiveFields(config).filter(field => !fieldSatisfied(field, findings));
}
export type SearchAttempt = { query: string; field: ResearchField; status: 'succeeded' | 'failed'; category?: string };
export function nextSearchQuery(queries: string[], completed: string[], attempts: SearchAttempt[]) {
  return queries.find(query => !completed.includes(query) && attempts.filter(a => a.query === query && a.status === 'failed').length < 2);
}

export function fieldCompletionMessage(field: ResearchField) {
  return field === 'people' ? 'Sourced owner or director candidate found; email availability is checked separately.' : `Sourced ${fieldLabels[field]} found.`;
}
