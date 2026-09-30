import { publicResearchUrl, researchDomain, type ResearchConfig, type ResearchFinding } from './research';

export function validAbn(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  return [...digits].reduce((sum, digit, i) => sum + (Number(digit) - (i === 0 ? 1 : 0)) * weights[i], 0) % 89 === 0;
}
const nameKey = (value: string) => value.toLowerCase().replace(/\bproprietary\b/g, 'pty').replace(/\blimited\b/g, 'ltd').replace(/[^a-z0-9]+/g, ' ').trim();

// Registry evidence requires the exact entity name and, when known, matching
// state/postcode. Search summaries never become verified identifiers.
export function observedCompanyIdentifiers(markdown: string, source: string, config: Pick<ResearchConfig, 'companyName' | 'companyDomain' | 'companyLocation' | 'legalEntity'>): ResearchFinding[] {
  if (!publicResearchUrl(source) || !config.companyDomain) return [];
  const own = researchDomain(source) === config.companyDomain;
  const registry = new URL(source).hostname === 'abr.business.gov.au';
  if (!own && !registry) return [];
  const entity = markdown.match(/Entity name[\s:|*]*([^\n|]+)/i)?.[1]?.trim();
  if (registry && (!entity || ![config.companyName, config.legalEntity].some(name => name && nameKey(name) === nameKey(entity)))) return [];
  if (registry && config.companyLocation) {
    const location = markdown.match(/Main business location[\s:|*]*([^\n]+)/i)?.[1] || '';
    const state = config.companyLocation.match(/\b(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\b/i)?.[0];
    const postcode = config.companyLocation.match(/\b\d{4}\b/)?.[0];
    if (state && !new RegExp(`\\b${state}\\b`, 'i').test(location) || postcode && !location.includes(postcode)) return [];
  }
  const match = markdown.match(/\bABN\s*(?:details\s*)?(?:[:|#]\s*)?((?:\d[ \t]*){11})\b/i);
  if (!match || !validAbn(match[1])) return [];
  const findings: ResearchFinding[] = [{ kind: 'identifier', name: 'ABN', value: match[1].replace(/\D/g, ''), quote: match[0].trim(), website: source, subject: config.companyName, relevance: 'unclear' }];
  if (registry && entity) findings.push({ kind: 'identifier', name: 'Legal entity', value: entity, quote: markdown.match(/Entity name[\s:|*]*[^\n|]+/i)![0].trim(), website: source, relevance: 'unclear' });
  return findings;
}

export function validateCompanyIdentifiers(input: unknown, markdown: string, source: string, config: Parameters<typeof observedCompanyIdentifiers>[2]) {
  const observed = observedCompanyIdentifiers(markdown, source, config);
  return observed.filter(f => Array.isArray(input) && input.some(candidate => candidate?.kind === f.kind && candidate?.name === f.name && candidate?.value === f.value && candidate?.quote === f.quote));
}
