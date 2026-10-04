import type { CriterionKey } from './acquisition';

const numericKeys = new Set<CriterionKey>(['revenue', 'revenueCeiling', 'ebitda', 'headcount']);
export function numericAmounts(value: string) {
  const matches = [...value.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(million|billion|[mkb])?\b/gi)];
  return matches.map((m, i) => Number(m[1].replaceAll(',', '')) * ({ m: 1e6, million: 1e6, k: 1e3, b: 1e9, billion: 1e9 }[m[2]?.toLowerCase() || matches[i + 1]?.[2]?.toLowerCase() || ''] || 1));
}
const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (value: string) => normalise(value).split(' ').filter(w => w.length > 3 && !['business', 'businesses', 'services', 'with', 'have', 'must', 'should', 'place', 'already', 'required'].includes(w)).map(w => w.replace(/suppliers?|supply/g, 'suppl').replace(/planning/g, 'plan').replace(/s$/, ''));
/** Conservative validation: unsupported clauses stay unknown rather than becoming buyer conditions. */
export function groundedCriterionValue(key: CriterionKey, value: string, quote: string) {
  if (/<\/?[a-z][^>]*>/i.test(value)) return '';
  if (numericKeys.has(key)) {
    const actual = numericAmounts(value), supplied = numericAmounts(quote);
    return actual.length && actual.every(n => supplied.includes(n)) ? value : '';
  }
  const supplied = new Set(words(quote));
  return value.split(';').map(v => v.trim()).filter(clause => {
    if (normalise(quote).includes(normalise(clause))) return true;
    if (key === 'accreditations') return false;
    const terms = words(clause);
    const overlap = terms.filter(w => supplied.has(w)).length;
    return terms.length > 0 && overlap / terms.length >= (key === 'subsectors' ? 0.3 : 0.75);
  }).join('; ');
}
