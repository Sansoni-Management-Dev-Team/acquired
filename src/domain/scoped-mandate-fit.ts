import {companyScopedFacts} from './company-scoped-facts';
import type {CompanyScreenStatus} from './company-screening';
import type {Mandate, TargetCandidate} from './models';
import {financialInterval, resolveTargetRevenue} from './target-financial-evidence';

type Field = 'sector' | 'geography' | 'headcount' | 'revenue';

/** Explain the same scoped facts used by screening. This does not upgrade a
 * provider observation to a verified match or change its half-credit score. */
export function scopedMandateFitEvidence(target: TargetCandidate, mandate: Mandate, field: Field, status: CompanyScreenStatus) {
  const provider = target.sourceData?.firmable;
  const facts = provider?.scopedFacts ?? (provider?.rawResponse ? companyScopedFacts(provider.rawResponse, provider.capturedAt) : undefined);
  const fallbackSource = provider?.website;
  let value: string, source: string | undefined;
  if (field === 'headcount') {
    const count = facts?.headcount.AU.value ?? (target.headcount.provenance.scope === 'AU' ? target.headcount.value : null);
    source = facts?.headcount.AU.sourceUrl ?? target.headcount.provenance.sourceUrl;
    value = count !== null && count !== undefined ? `${count} Australian employees` : 'Australian workforce not reported';
    if (count === null || count === undefined) {
      const global = facts?.headcount.global.value;
      if (global !== null && global !== undefined) value += `; ${global} global employees does not establish the Australian workforce`;
    }
  } else if (field === 'geography') {
    const states = facts ? facts.operatingStates.value ?? [] : target.state !== 'Unknown' ? [target.state] : [];
    source = facts?.operatingStates.sourceUrl;
    value = states.length ? `Reported operating states: ${states.join(', ')}` : 'Australian operating locations not reported';
  } else if (field === 'revenue') {
    const revenue = resolveTargetRevenue(target, mandate.financialScope);
    source = revenue.provenance.sourceUrl;
    const interval = financialInterval(revenue.value, revenue.provenance.currency);
    const label = typeof revenue.value === 'object' && revenue.value?.kind === 'band'
      ? revenue.value.label
      : interval ? `${interval.min}–${interval.max ?? 'open'} ${revenue.provenance.currency}` : null;
    const scope = mandate.financialScope === 'AU' ? 'Australian revenue' : 'Company revenue';
    value = label ? `${scope}: ${label}${revenue.provenance.currency && !label.includes(revenue.provenance.currency) ? ` ${revenue.provenance.currency}` : ''}` : `${scope} not reported with comparable currency and scope`;
    if (label && !revenue.provenance.currency) value += '; currency unconfirmed';
    if (revenue.provenance.assumption) value += `; ${revenue.provenance.assumption}`;
  } else {
    source = facts?.industries.sourceUrl ?? target.sector.provenance.sourceUrl;
    const industries = facts?.industries.value?.length ? facts.industries.value : target.sector.value ? [target.sector.value] : [];
    value = industries.length ? `Reported activity: ${industries.join('; ')}` : 'Relevant business activity not established';
  }
  const outcome = status === 'excluded' ? 'outside the brief' : status === 'review' ? 'needs comparable evidence' : 'provisional provider match; needs verification';
  return {reason: `${value} — ${outcome}`, sources: source || fallbackSource ? [source || fallbackSource!] : []};
}
