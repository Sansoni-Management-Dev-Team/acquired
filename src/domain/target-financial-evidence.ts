import { estimateEbitda } from './estimated-ebitda';
import { parseCompanyBand } from './firmable-company-pipeline';
import type { FinancialValue, TargetCandidate, Mandate } from './models';
import type { SavedResearchFinding } from './research';

/** A dollar symbol alone does not establish AUD. */
export function financialInterval(value: FinancialValue | null, currency?: string) {
  if (value === null || currency && currency !== "AUD") return null;
  if (typeof value === 'number') return { min: value, max: value, estimated: false };
  if (value.kind === 'range') return { min: value.min, max: value.max, estimated: false };
  if (currency !== 'AUD' && !/\bAUD\b|A\$/i.test(value.label)) return null;
  const band = parseCompanyBand(value.label, true);
  return band ? { min: band.min, max: band.max, estimated: true } : null;
}

export function resolveTargetEbitda(findings: SavedResearchFinding[], preferredHeadcount?: number) {
  return estimateEbitda(findings.filter(f => !f.evidence.factMetadata?.identityNote), undefined,
    preferredHeadcount === undefined ? undefined : { value: preferredHeadcount, source: 'company data' });
}

export function targetRevenueCurrency(target: TargetCandidate) {
  const raw = target.sourceData?.firmable?.rawResponse;
  return target.revenue.provenance.currency ?? (typeof raw?.revenue_currency === 'string' ? raw.revenue_currency : undefined);
}

export function effectiveRevenueRange(mandate: Mandate) {
  const max = Math.min(mandate.revenue.max ?? Infinity, mandate.revenueCeiling ?? Infinity);
  return { min: mandate.revenue.min, max: Number.isFinite(max) ? max : null };
}
