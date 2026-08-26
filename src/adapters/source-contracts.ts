import type { Mandate, TargetCandidate } from "@/domain/models";

export type CompanyIdentifier = { id?: string; abn?: string; fqdn?: string; linkedinSlug?: string; linkedinUrl?: string; website?: string };
export type PersonIdentifier = { id?: string; linkedinUrl?: string; workEmail?: string; personalEmail?: string };
export type PersonCandidate = { id: string; position?: string; seniority?: string; department?: string; emailAvailable: boolean; phoneAvailable: boolean };
export type PersonDetail = PersonCandidate & { name?: string; email?: string; phone?: string; fictionalised: boolean; doNotContact: boolean };

export interface CompanyDiscoverySource {
  search(mandate: Mandate): Promise<TargetCandidate[]>;
}

export interface CompanyEnrichmentProvider {
  enrichCompany(identifier: CompanyIdentifier): Promise<Record<string, unknown>>;
}

export interface ContactProvider {
  searchPeople(companyId: string, filters?: { position?: string; seniority?: string; department?: string; max?: number }): Promise<PersonCandidate[]>;
  enrichPerson(identifier: PersonIdentifier): Promise<PersonDetail>;
}
