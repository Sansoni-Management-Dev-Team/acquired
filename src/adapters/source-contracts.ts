import type { Mandate, TargetCandidate } from "@/domain/models";

export type CompanyIdentifier = { id?: string; abn?: string; fqdn?: string; linkedinSlug?: string; linkedinUrl?: string; website?: string };
export type PersonIdentifier = { id?: string; linkedinUrl?: string; workEmail?: string; personalEmail?: string };
export type PersonCandidate = { id: string; position?: string; seniority?: string; department?: string; emailAvailable: boolean; phoneAvailable: boolean; rawResponse?: Record<string, unknown> };
export type PersonDetail = PersonCandidate & { name?: string; email?: string; phone?: string; linkedinUrl?: string; fictionalised: boolean; doNotContact: boolean };
export type DecisionMakerSearchAttempt = { label: string; returnedCount: number; addedCount: number };
export type DecisionMakerSearchOptions = { max?: number; onAttempt?: (attempt: DecisionMakerSearchAttempt) => void };

export interface CompanyDiscoverySource {
  search(mandate: Mandate): Promise<TargetCandidate[]>;
}

export interface CompanyEnrichmentProvider {
  enrichCompany(identifier: CompanyIdentifier): Promise<Record<string, unknown>>;
}

export interface ContactProvider {
  searchPeople(companyId: string, filters?: { position?: string; seniority?: string; department?: string; max?: number }): Promise<PersonCandidate[]>;
  searchAllPeople(companyId: string): Promise<PersonCandidate[]>;
  searchDecisionMakers(companyId: string, options?: DecisionMakerSearchOptions): Promise<PersonCandidate[]>;
  enrichPerson(identifier: PersonIdentifier): Promise<PersonDetail>;
}
