import { parseHeadcount } from './company-facts';
import type { ResearchFinding } from './research';

export type CompanyFieldResolution = {
 status: 'missing' | 'estimated' | 'conflicting' | 'observed';
 selected: ResearchFinding | null;
 observations: ResearchFinding[];
 superseded: ResearchFinding[];
};
const rank = (finding: ResearchFinding) => {
 const metadata = finding.factMetadata;
 if (metadata?.basis === 'search_snippet' || metadata?.identityNote) return 0;
 if (metadata?.basis === 'third_party_estimate') return 1;
 return metadata?.sourceKind === 'company_website' ? 4 : metadata?.sourceKind === 'company_profile' ? 3 : 2;
};
// Preserve the original range, scope and source. Never derive an exact employee
// count from a range or silently reconcile figures for different reporting scopes.
export function resolveCompanyField(field: 'size' | 'revenue', findings: ResearchFinding[]): CompanyFieldResolution {
 const observations = findings.filter(f => f.kind === (field === 'size' ? 'headcount' : 'revenue'));
 const usable = observations.filter(f => rank(f) > 0 && typeof f.value === 'string' && (field === 'size' ? Boolean(parseHeadcount(f.value)) : Boolean(f.factMetadata?.currency)));
 if (!usable.length) return {status:'missing',selected:null,observations,superseded:[]};
 const bestRank = Math.max(...usable.map(rank));
 const best = usable.filter(f => rank(f) === bestRank);
 const superseded = usable.filter(f => rank(f) < bestRank);
 const scopes = new Set(best.map(f => `${f.factMetadata?.scope || 'unspecified'}:${f.factMetadata?.period || ''}`));
 let conflicts = scopes.size > 1;
 if (field === 'size') {
  const intervals = best.map(f => parseHeadcount(f.value)!);
  conflicts ||= Math.max(...intervals.map(i => i.min ?? 0)) > Math.min(...intervals.map(i => i.max ?? Infinity));
 } else {
  conflicts ||= new Set(best.map(f => `${f.value.replace(/\s+/g,' ').trim()}:${f.factMetadata?.currency}`)).size > 1;
 }
 if (conflicts) return {status:'conflicting',selected:null,observations,superseded};
 return {status:bestRank === 1 ? 'estimated' : 'observed',selected:best[0],observations,superseded};
}
