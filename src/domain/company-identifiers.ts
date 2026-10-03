import { publicResearchUrl, researchDomain, type ResearchConfig, type ResearchFinding } from './research';

export function validAbn(value: string) {
  const digits = value.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  return [...digits].reduce((sum, digit, i) => sum + (Number(digit) - (i === 0 ? 1 : 0)) * weights[i], 0) % 89 === 0;
}
export const companyIdentifierNameKey = (value: string) => value.toLowerCase().replace(/&/g, ' and ').replace(/\bproprietary\b/g, 'pty').replace(/\blimited\b/g, 'ltd').replace(/[^a-z0-9]+/g, ' ').trim();

const tradingKey = (value: string) => companyIdentifierNameKey(value).replace(/\s+(?:pty\s+ltd|ltd|pty)$/, '');
export function companyIdentifierNameMatches(entity: string, names: (string | undefined)[]) {
  return names.some(name => name && (companyIdentifierNameKey(name) === companyIdentifierNameKey(entity) || (!/\b(?:pty|ltd)$/.test(companyIdentifierNameKey(name)) && tradingKey(name) === tradingKey(entity))));
}
// Legal suffix differences require known location corroboration. Never strip
// business-name words or use a search snippet as verified registry evidence.
export function observedCompanyIdentifiers(markdown: string, source: string, config: Pick<ResearchConfig, 'companyName' | 'companyDomain' | 'companyLocation' | 'legalEntity'>): ResearchFinding[] {
  if (!publicResearchUrl(source) || !config.companyDomain) return [];
  const own = researchDomain(source) === config.companyDomain;
  const registry = new URL(source).hostname === 'abr.business.gov.au';
  if (!own && !registry) return [];
  const entity = markdown.match(/Entity name[\s:|*]*([^\n|]+)/i)?.[1]?.trim();
  if (registry) {
    const entities = [...markdown.matchAll(/Entity name[\s:|*]*([^\n|]+)/gi)].map(match => match[1].trim());
    if (!entity || new Set(entities.map(companyIdentifierNameKey)).size !== 1) return [];
    const names = [config.companyName, config.legalEntity];
    const exact = names.some(name => name && companyIdentifierNameKey(name) === companyIdentifierNameKey(entity));
    if (!exact && (!companyIdentifierNameMatches(entity, names) || !config.companyLocation?.match(/\b(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT|\d{4})\b/i))) return [];
  }
  if (registry && config.companyLocation) {
    const location = markdown.match(/Main business location[\s:|*]*([^\n]+)/i)?.[1] || '';
    const state = config.companyLocation.match(/\b(?:VIC|NSW|QLD|SA|WA|TAS|ACT|NT)\b/i)?.[0];
    const postcode = config.companyLocation.match(/\b\d{4}\b/)?.[0];
    if (state && !new RegExp(`\\b${state}\\b`, 'i').test(location) || postcode && !location.includes(postcode)) return [];
  }
  const match = markdown.match(/\bABN\s*(?:details\s*)?(?:[:|#]\s*)?((?:\d[ \t]*){11})\b/i);
  if (!match || !validAbn(match[1])) return [];
  if (own && /\.pdf$/i.test(new URL(source).pathname)) {
    // A hosted customer/supplier document is not the site's legal identity.
    // Require this labelled ABN to directly follow the target's name in its
    // paragraph, rather than finding the target elsewhere in the PDF.
    const preceding = markdown.slice(0, match.index!);
    const paragraph = preceding.split(/\n\s*\n/).at(-1) || '';
    const prefix = companyIdentifierNameKey(paragraph);
    const names = [config.companyName, config.legalEntity].filter((name): name is string => Boolean(name));
    const identifiesTarget = names.some(name => {
      const key = companyIdentifierNameKey(name);
      const endings = /\b(?:pty|ltd)$/.test(key) ? [key] : [key, `${key} pty ltd`, `${key} ltd`, `${key} pty`];
      return endings.some(ending => prefix === ending || prefix.endsWith(` ${ending}`));
    });
    if (!identifiesTarget) return [];
  }
  const recordAbn = new URL(publicResearchUrl(source)!).searchParams.get('abn');
  if (registry && recordAbn && recordAbn !== match[1].replace(/\D/g, '')) return [];
  const findings: ResearchFinding[] = [{ kind: 'identifier', name: 'ABN', value: match[1].replace(/\D/g, ''), quote: match[0].trim(), website: source, subject: config.companyName, relevance: 'unclear' }];
  if (registry && entity) findings.push({ kind: 'identifier', name: 'Legal entity', value: entity, quote: markdown.match(/Entity name[\s:|*]*[^\n|]+/i)![0].trim(), website: source, relevance: 'unclear' });
  return findings;
}

export function validateCompanyIdentifiers(input: unknown, markdown: string, source: string, config: Parameters<typeof observedCompanyIdentifiers>[2]) {
  const observed = observedCompanyIdentifiers(markdown, source, config);
  return observed.filter(f => Array.isArray(input) && input.some(candidate => candidate?.kind === f.kind && candidate?.name === f.name && candidate?.value === f.value && candidate?.quote === f.quote));
}

// Keep ordinary discovery HTML-only; ABN tasks also inspect first-party legal
// documents, where companies commonly publish statutory identifiers.
export function abnFollowUpLinks(markdown: string, source: string, companyDomain: string): string[] {
  const links: string[] = [];
  for (const match of markdown.matchAll(/\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"\n]*")?\)/g)) {
    try {
      const url = publicResearchUrl(new URL(match[2], source).href);
      if (url && researchDomain(url) === companyDomain && /\.pdf$/i.test(new URL(url).pathname) && /privacy|policy|legal|terms|conditions|abn|company/i.test(`${match[1]} ${new URL(url).pathname}`)) links.push(url);
    } catch { /* Invalid links are not evidence. */ }
  }
  return [...new Set(links)].slice(0, 10);
}
