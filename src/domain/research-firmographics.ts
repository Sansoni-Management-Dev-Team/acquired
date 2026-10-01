import type { SavedResearchFinding } from './research';
import { parseHeadcount } from './company-facts';
import { resolveCompanyField } from './research-resolution';

export function reconcileResearchFirmographics(current: Record<string, unknown>, findings: Pick<SavedResearchFinding, 'evidence' | 'sourceUrl' | 'observedAt'>[]) {
  const result = { ...current };
  const ordered = [...findings].sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.sourceUrl.localeCompare(b.sourceUrl));
  const protectedValue = (key: string) => {
    const field = current[key] as { value?: unknown; range?: unknown; provenance?: { source?: string } } | undefined;
    return field?.provenance?.source !== 'Public web research' && (field?.value != null || Boolean(field?.range));
  };
  for (const [key, objective] of [['headcount', 'size'], ['revenue', 'revenue']] as const) {
    if (protectedValue(key)) continue;
    const resolution = resolveCompanyField(objective, ordered.map(f => f.evidence));
    const selected = resolution.status === 'observed' ? resolution.selected : null;
    const source = ordered.find(f => f.evidence === selected);
    const count = key === 'headcount' && selected ? parseHeadcount(selected.value) : null;
    const amount = key === 'revenue' && selected ? selected.value.match(/^(?:AUD|USD|A\$|US\$|\$)\s*(\d[\d,.]*)\s*(million|billion|thousand|[KMB])?\.?$/i) : null;
    const multiplier = amount?.[2] ? ({ k: 1000, thousand: 1000, m: 1e6, million: 1e6, b: 1e9, billion: 1e9 }[amount[2].toLowerCase()] || 1) : 1;
    const value = count?.kind === 'point' ? count.min : amount && selected?.factMetadata?.currency === 'AUD' ? Number(amount[1].replaceAll(',', '')) * multiplier : null;
    result[key] = {
      value, researchState: resolution.status,
      displayValue: selected?.value || null,
      ...(count && count.kind !== 'point' ? { range: count } : {}),
      ...(selected?.factMetadata ? { factMetadata: selected.factMetadata } : {}),
      provenance: source ? { source: 'Public web research', sourceUrl: source.sourceUrl, capturedAt: source.observedAt, confidence: 60 } : { source: 'Public web research', capturedAt: ordered[0]?.observedAt || '1970-01-01T00:00:00.000Z', confidence: 0 },
      ...(value === null ? { missingReason: selected ? `Published ${key} ${selected.value}; review the source and scope` : resolution.status === 'conflicting' ? 'Published sources disagree; review required' : resolution.status === 'estimated' ? 'Only third-party estimates available; review required' : 'No accepted published observation found' } : {}),
    };
  }
  if (!protectedValue('establishedYear')) {
    const years = ordered.filter(f => f.evidence.kind === 'founded_year' && /^(18|19|20)\d{2}$/.test(f.evidence.value) && f.evidence.factMetadata?.basis !== 'search_snippet' && f.evidence.factMetadata?.basis !== 'third_party_estimate' && !f.evidence.factMetadata?.identityNote);
    if (years.length && new Set(years.map(f => f.evidence.value)).size === 1) result.establishedYear = { value: Number(years[0].evidence.value), researchState: 'observed', provenance: { source: 'Public web research', sourceUrl: years[0].sourceUrl, capturedAt: years[0].observedAt, confidence: 60 } };
    else if (years.length) result.establishedYear = { value: null, researchState: 'conflicting', missingReason: 'Published founded years disagree; review required', provenance: { source: 'Public web research', capturedAt: years[0].observedAt, confidence: 0 } };
  }
  return result;
}
