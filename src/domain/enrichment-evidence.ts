import type { ResearchFinding } from './research';
// Facts from prior runs have a short, explicit freshness window. Mandate-relative
// product/relevance assessments remain scoped to the current run.
export function reusableEnrichmentEvidence(finding: { observedAt: Date | string; evidence: unknown }, now = Date.now()): ResearchFinding | null {
  const evidence = finding.evidence as ResearchFinding;
  if (!evidence || !['company', 'identifier', 'person', 'headcount', 'revenue', 'founded_year', 'location', 'company_contact', 'industry'].includes(evidence.kind)) return null;
  const observed = new Date(finding.observedAt).getTime();
  const ttl = ['person', 'company_contact'].includes(evidence.kind) ? 7 * 86400000 : 30 * 86400000;
  if (!Number.isFinite(observed) || observed > now || now - observed >= ttl) return null;
  const copy = { ...evidence };
  delete copy.relevance;
  return copy;
}
