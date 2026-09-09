import { cloudflareSearchResults } from './cloudflare-web-search';
import { companyResultMatches, publicCompanyName } from '@/domain/company-research-routing';
import type { ResearchConfig } from '@/domain/research';

// Exact-domain queries can return nothing even when company profiles exist.
// One bounded broader query is allowed for an automatic missing-field follow-up.
export async function automaticCompanySearch(config: ResearchConfig, field: 'size' | 'people', jobId: string, fetcher: typeof fetch = fetch) {
  const name = publicCompanyName(config.legalEntity || config.companyName || '');
  if (!name || !config.companyDomain) return [];
  const query = `"${name}" ${field === 'size' ? 'company employees LinkedIn' : 'owner founder director'} Australia`;
  const candidates = await cloudflareSearchResults(query, fetcher, jobId);
  const accepted = candidates.filter(r => companyResultMatches(r, config.companyName!, config.companyDomain!, config.legalEntity));
  console.info('research-diagnostic', JSON.stringify({ timestamp: new Date().toISOString(), jobId, event: 'broader_company_search', field, candidates: candidates.length, accepted: accepted.length }));
  return accepted.map(r => r.url);
}
