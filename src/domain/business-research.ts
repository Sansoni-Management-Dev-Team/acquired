import { extractionPrompt, publicResearchUrl, researchDomain, validateFindings, type ResearchConfig, type ResearchFinding } from "./research";
import { missingResearchFields } from "./research-objectives";
import { validatePeopleFindings } from "./people-research";
export function ownCompany(findings: ResearchFinding[], source: string) {
  return findings.find(f => f.kind === "company" && publicResearchUrl(f.website) && researchDomain(f.website) === researchDomain(source));
}
export function relevantBusiness(findings: ResearchFinding[]) {
  return findings.some(f => ["product", "capability", "customer"].includes(f.kind) && f.relevance === "relevant");
}
export function businessPrompt(markdown: string, terms: string[], source: string, people: boolean, config?: ResearchConfig) {
  const messages = extractionPrompt(markdown, config?.researchScope ? [config.researchScope] : terms, source);
  if (config?.adaptiveDiscovery) messages[0].content += ` Assess sector relevance semantically against the research scope; equivalent industry terminology is allowed. Geography: ${config.geography}. Capture explicit location evidence; do not invent it. Missing revenue, EBITDA, ownership, sale intentions or deal terms remain unknown and do not make a business irrelevant. Search results and generated queries are leads, never evidence of qualification.`;
  if (people) messages[0].content += ' Also capture a named owner, founder, director or general manager explicitly identified on this company page, if present. Use kind "person", name the full person name, value the literal role, quote a contiguous verbatim passage containing BOTH name and role, website the source URL, relevance "unclear". Never infer identity from testimonials or former staff. Include email only if this same passage explicitly associates the person with a published company-domain work email; otherwise omit it. Never guess emails. Prioritise company identity and concrete relevant products before people.';
  return messages;
}
export function validateBusinessFindings(input: unknown, markdown: string, source: string, config: ResearchConfig) {
  const business = validateFindings(input, markdown, source, config.searchTerms, config.adaptiveDiscovery === true);
  const company = ownCompany(business, source);
  if (!config.findPeople || !company) return business;
  return [...business, ...validatePeopleFindings(input, markdown, source, { ...config, companyName: company.name, companyDomain: researchDomain(source) }).filter(f => f.kind === "person")];
}

// A first-party page whose main heading is the trading name (matching the domain
// label) identifies the site owner even when the model returned no company claim.
export function headingCompanyFinding(markdown: string, source: string): ResearchFinding | null {
  const safe = publicResearchUrl(source);
  if (!safe) return null;
  const label = researchDomain(safe).split(".")[0].toLowerCase();
  const compactLabel = label.replace(/[^a-z0-9]/g, "");
  for (const match of markdown.matchAll(/^#{1,2} +([^\n#]{2,80})$/gm)) {
    const name = match[1].replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\*\*|__/g, "").trim();
    const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (name.split(/\s+/).length > 6 || compact.length < 4) continue;
    if (compact === compactLabel || (compact.length >= 5 && compactLabel.includes(compact)) || (compactLabel.length >= 5 && compact.includes(compactLabel))) {
      return { kind: "company", name, value: name, quote: match[0].trim(), website: `${new URL(safe).origin}/`, relevance: "unclear" };
    }
  }
  return null;
}
export function eligibleForPeople(domain: string, stage: string, findings: ResearchFinding[]) {
  return Boolean(domain) && !["parked", "excluded"].includes(stage) && Boolean(ownCompany(findings, `https://${domain}/`)) && relevantBusiness(findings) && missingResearchFields({ purpose: "people" }, findings).length > 0;
}
export function businessResearchStatus(domain: string, findings: ResearchFinding[], researching: boolean) {
  if (ownCompany(findings, `https://${domain}/`) && relevantBusiness(findings)) return "Ready to review";
  return researching ? "Researching" : "Needs more evidence";
}
