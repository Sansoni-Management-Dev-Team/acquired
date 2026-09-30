import type { CompanyList } from '@/domain/company-list';

// Keep only the latest discovery handoff, briefly, for the client-side transition.
let handoff: { companies: CompanyList; expiresAt: number } | undefined;

export function preloadDiscoveredCompanies(companies: CompanyList) {
  handoff = { companies, expiresAt: Date.now() + 60_000 };
}

export function clearDiscoveredCompanies(mandateId: string) {
  if (handoff?.companies.mandate.id === mandateId) handoff = undefined;
}

export function discoveredCompaniesFor(initial: CompanyList): CompanyList {
  if (!handoff || handoff.expiresAt <= Date.now()) {
    handoff = undefined;
    return initial;
  }
  return handoff.companies.mandate.id === initial.mandate.id ? handoff.companies : initial;
}
