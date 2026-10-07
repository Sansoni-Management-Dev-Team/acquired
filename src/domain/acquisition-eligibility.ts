import { screenCompanyCandidate } from './company-screening';
import type { Mandate, TargetCandidate } from './models';
import { financialInterval, targetRevenueCurrency, effectiveRevenueRange } from './target-financial-evidence';

/** Keep uncertain provider facts reviewable; only explicit entity types hard-exclude. */
export function acquisitionEligibility(target: TargetCandidate, mandate: Mandate) {
  const provider = target.sourceData?.firmable;
  if(provider?.rawResponse || provider?.scopedFacts){const screening=screenCompanyCandidate(target,mandate);return {status:screening.eligibility==='supported'?'pending' as const:screening.eligibility,reasons:screening.reasons};}
  const rawType = provider?.rawResponse?.company_type;
  const type = provider?.companyType || (typeof rawType === 'string' ? rawType : rawType && typeof rawType === 'object' ? Object.values(rawType).filter(v => typeof v === 'string').join(' ') : '');
  const excluded = /\b(?:government|local authority|municipal|public sector|council)\b/i.test(type);
  const reasons: string[] = excluded ? [`Government entity (${type}); not an acquisition candidate`] : [];
  const count = target.headcount.value;
  if (count !== null && mandate.headcount && (count < mandate.headcount.min || count > mandate.headcount.max)) reasons.push(`Headcount ${count} outside ${mandate.headcount.min}–${mandate.headcount.max}; verify provider scope`);
  const requested = effectiveRevenueRange(mandate);
  const revenue = financialInterval(target.revenue.value, targetRevenueCurrency(target));
  if (revenue && (revenue.max !== null && revenue.max < requested.min || requested.max !== null && revenue.min > requested.max)) reasons.push('Revenue outside mandate; verify provider scope');
  return { status: excluded ? 'excluded' as const : reasons.length ? 'review' as const : 'pending' as const, reasons };
}
