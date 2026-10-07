import type { PersonCandidate } from '@/adapters/source-contracts';

/** Bounded automatic acquisition contacts; financial uncertainty remains reviewable,
 * but geography/activity must be supported and no hard exclusion may be present. */
export const COMPANY_CONTACT_POLICY = { maxProfiles: 5, maxSearchPages: 3, concurrency: 1, minimumRemainingMs: 60_000 } as const;
export function contactCompanyEligible(qualification: unknown, screening: unknown, manual = false) {
  if (qualification === 'excluded') return false;
  if (!screening || typeof screening !== 'object') return manual;
  const evidence = screening as Record<string, unknown>;
  return (manual || (evidence.geography === 'supported' && evidence.sector === 'supported'))
    && !Object.values(evidence).includes('excluded');
}
export function selectCompanyContacts(candidates: PersonCandidate[]) {
  const score = (person: PersonCandidate) => {
    const role = `${person.position || ''} ${person.seniority || ''}`.toLowerCase();
    if (/\b(owner|founder|co-founder|chief executive|ceo|managing director|president)\b/.test(role)) return 3;
    if (/\b(chief|cfo|coo|cto|director|partner|executive)\b/.test(role)) return 2;
    if (/\b(general manager|head of|vice president|vp)\b/.test(role)) return 1;
    return 0;
  };
  return [...new Map(candidates.map(person => [person.id, person])).values()]
    .filter(person => score(person) > 0)
    .sort((a, b) => score(b) - score(a) || Number(b.emailAvailable) - Number(a.emailAvailable) || a.id.localeCompare(b.id))
    .slice(0, COMPANY_CONTACT_POLICY.maxProfiles);
}
export function contactDeadlineAdmits(deadline: number | undefined, now = Date.now()) {
  return deadline === undefined || now + COMPANY_CONTACT_POLICY.minimumRemainingMs < deadline;
}
