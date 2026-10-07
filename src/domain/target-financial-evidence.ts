import { estimateEbitda } from './estimated-ebitda';
import { parseCompanyBand } from './firmable-company-pipeline';
import type { FinancialValue, TargetCandidate, Mandate } from './models';
import { companyScopedFacts } from './company-scoped-facts';
import type { SavedResearchFinding } from './research';

/** A dollar symbol alone does not establish AUD. */
export function financialInterval(value: FinancialValue | null, currency?: string) {
  if (value === null || currency && currency !== "AUD") return null;
  if (typeof value === 'number') return currency === 'AUD' ? { min: value, max: value, estimated: false } : null;
  if (value.kind === 'range') return currency === 'AUD' ? { min: value.min, max: value.max, estimated: false } : null;
  if (currency !== 'AUD' && !/\bAUD\b|A\$/i.test(value.label)) return null;
  const band = parseCompanyBand(value.label, true);
  return band ? { min: band.min, max: band.max, estimated: true } : null;
}

export function resolveTargetEbitda(findings: SavedResearchFinding[], preferredHeadcount?: number, target?: TargetCandidate) {
  const facts=target?.sourceData?.firmable?.scopedFacts || (target?.sourceData?.firmable?.rawResponse ? companyScopedFacts(target.sourceData.firmable.rawResponse,target.sourceData.firmable.capturedAt) : undefined);
  const industryFindings:SavedResearchFinding[]=facts?.industries.value?.map((value,index)=>({id:`provider-industry-${index}`,sourceUrl:facts.industries.sourceUrl || '',observedAt:facts.industries.capturedAt,confidence:.7,evidence:{kind:'industry' as const,name:'Industry',value,quote:value,relevance:'unclear' as const}} as SavedResearchFinding)) || [];
  const scopedCount=facts?facts.headcount.AU.value ?? undefined:preferredHeadcount;
  return estimateEbitda([...findings.filter(f => !f.evidence.factMetadata?.identityNote && !(facts && f.evidence.kind === 'headcount')),...industryFindings], undefined,
    scopedCount === undefined ? undefined : { value: scopedCount, source: facts ? 'Australian company workforce' : 'company data' });
}

export function targetRevenueCurrency(target: TargetCandidate) {
  const raw = target.sourceData?.firmable?.rawResponse;
  return target.revenue.provenance.currency ?? (typeof raw?.revenue_currency === 'string' ? raw.revenue_currency : undefined);
}

export function effectiveRevenueRange(mandate: Mandate) {
  const max = Math.min(mandate.revenue.max ?? Infinity, mandate.revenueCeiling ?? Infinity);
  return { min: mandate.revenue.min, max: Number.isFinite(max) ? max : null };
}
