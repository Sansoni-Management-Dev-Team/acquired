import { z } from "zod";
import type { CompanyIdentifier, PersonCandidate, PersonDetail, PersonIdentifier } from "./source-contracts";
import { fictionalisePersonalData } from "@/domain/fictionalise";

const companySchema = z.object({ id: z.union([z.string(), z.number()]).transform(String) }).passthrough();
const peoplePageSchema = z.union([
  z.array(z.record(z.string(), z.unknown())),
  z.object({ data: z.array(z.record(z.string(), z.unknown())).default([]) }).passthrough(),
]);
const personSchema = z.record(z.string(), z.unknown());

export class FirmableError extends Error {
  constructor(public endpoint: string, public status: number, message: string) { super(message); }
}

export type FirmableClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  fictionalise?: boolean;
  retries?: number;
};

export class FirmableClient {
  private apiKey: string;
  private baseUrl: string;
  private fetcher: typeof globalThis.fetch;
  private fictionalise: boolean;
  private retries: number;

  constructor(options: FirmableClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.FIRMABLE_API_KEY || "";
    this.baseUrl = options.baseUrl || process.env.FIRMABLE_BASE_URL || "https://api.firmable.com";
    this.fetcher = options.fetch || globalThis.fetch;
    this.fictionalise = options.fictionalise ?? process.env.ALLOW_REAL_PERSONAL_DATA !== "true";
    this.retries = options.retries ?? 2;
  }

  private async request(path: string, init?: RequestInit) {
    if (!this.apiKey) throw new FirmableError(path, 0, "Firmable is not configured");
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...init?.headers },
      });
      if (response.ok) return response.json();
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt >= this.retries) throw new FirmableError(path.split("?")[0], response.status, `Firmable request failed (${response.status})`);
      await new Promise((resolve) => setTimeout(resolve, 100 * (2 ** attempt)));
    }
  }

  async enrichCompany(identifier: CompanyIdentifier) {
    const ordered = Object.entries({ id: identifier.id, abn: identifier.abn?.replace(/\D/g, ""), fqdn: identifier.fqdn, ln_slug: identifier.linkedinSlug, ln_url: identifier.linkedinUrl, website: identifier.website });
    const selected = ordered.find(([, value]) => value);
    if (!selected) throw new FirmableError("/company", 0, "A company identifier is required");
    const params = new URLSearchParams({ country: "AU", [selected[0]]: selected[1] as string });
    return companySchema.parse(await this.request(`/company?${params}`));
  }

  async searchPeople(companyId: string, filters: { position?: string; seniority?: string; department?: string; max?: number } = {}): Promise<PersonCandidate[]> {
    if (!companyId) throw new FirmableError("/people/search", 0, "Firmable company ID is required");
    const size = Math.min(filters.max || 50, 100);
    const raw = peoplePageSchema.parse(await this.request("/people/search", {
      method: "POST",
      body: JSON.stringify({ companyId, selectedCountry: "AU", position: filters.position, seniority: filters.seniority, department: filters.department, from: "0", size: String(size) }),
    }));
    const records = Array.isArray(raw) ? raw : raw.data;
    const deduplicated = new Map<string, PersonCandidate>();
    for (const record of records) {
      const id = String(record.person_id || record.id || "");
      if (id) deduplicated.set(id, { id, position: String(record.position || record.title || "") || undefined, seniority: String(record.seniority || "") || undefined, department: String(record.department || "") || undefined, emailAvailable: Boolean(record.email_available || record.has_email), phoneAvailable: Boolean(record.phone_available || record.has_phone) });
    }
    return [...deduplicated.values()];
  }

  async enrichPerson(identifier: PersonIdentifier): Promise<PersonDetail> {
    const selected = Object.entries({ id: identifier.id, ln_url: identifier.linkedinUrl, work_email: identifier.workEmail, personal_email: identifier.personalEmail }).find(([, value]) => value);
    if (!selected) throw new FirmableError("/people", 0, "A person identifier is required");
    const raw = personSchema.parse(await this.request(`/people?${new URLSearchParams({ [selected[0]]: selected[1] as string })}`));
    const phones = Array.isArray(raw.phones) ? raw.phones as Array<Record<string, unknown>> : [];
    const source = { name: String(raw.full_name || raw.name || ""), email: String(raw.work_email || raw.personal_email || ""), mobile: String(phones[0]?.number || raw.phone || ""), linkedinUrl: String(raw.linkedin_url || "") };
    const output = this.fictionalise ? fictionalisePersonalData(source) : source;
    return { id: String(raw.id || identifier.id || ""), position: String(raw.position || raw.title || "") || undefined, seniority: String(raw.seniority || "") || undefined, department: String(raw.department || "") || undefined, emailAvailable: Boolean(source.email), phoneAvailable: Boolean(source.mobile), name: output.name, email: output.email, phone: output.mobile, fictionalised: this.fictionalise, doNotContact: phones.some((phone) => phone.is_dnd === true) };
  }
}
