import { z } from "zod";
import type { CompanyIdentifier, DecisionMakerSearchOptions, PersonCandidate, PersonDetail, PersonIdentifier } from "./source-contracts";
import { fictionalisePersonalData } from "@/domain/fictionalise";

const companySchema = z.object({ id: z.union([z.string(), z.number()]).transform(String) }).passthrough();
const peopleRecords = z.array(z.record(z.string(), z.unknown()));
const peoplePageSchema = z.union([
  peopleRecords,
  z.object({ data: peopleRecords }).passthrough(),
  z.object({ records: peopleRecords, success: z.literal(true), total: z.number().optional() }).passthrough(),
  z.object({ success: z.literal(false), totalPeople: z.number().optional() }).passthrough(),
]);
const personSchema = z.record(z.string(), z.unknown());

function decisionMakerPriority(position?: string) {
  const title = (position || "").toLowerCase();
  if (/owner|founder|proprietor|principal|managing director/.test(title)) return 0;
  if (/board|director|chair/.test(title)) return 1;
  if (/chief|\bceo\b|\bcfo\b|\bcoo\b|partner/.test(title)) return 2;
  if (/general manager/.test(title)) return 3;
  if (/operations|operational/.test(title)) return 4;
  return 5;
}

function contactValue(value: unknown, keys: string[] = []) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return "";
}

function firstContactValue(value: unknown, keys: string[]) {
  if (!Array.isArray(value)) return contactValue(value, keys);
  for (const item of value) {
    const found = contactValue(item, keys);
    if (found) return found;
  }
  return "";
}

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

  isConfigured() {
    return Boolean(this.apiKey);
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
      const errorPayload = await response.clone().json().catch(() => null) as { error?: unknown } | null;
      const profileNotFound = response.status === 500 && errorPayload?.error === "Company profile not found";
      const retryable = !profileNotFound && (response.status === 429 || response.status >= 500);
      if (!retryable || attempt >= this.retries) {
        throw new FirmableError(path.split("?")[0], response.status, profileNotFound ? "Firmable company profile not found" : `Firmable request failed (${response.status})`);
      }
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
    if (!Array.isArray(raw) && "success" in raw && raw.success === false) {
      throw new FirmableError("/people/search", 200, "Firmable people search was not successful");
    }
    const records: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : "records" in raw && Array.isArray(raw.records)
        ? raw.records as Array<Record<string, unknown>>
        : "data" in raw && Array.isArray(raw.data)
          ? raw.data as Array<Record<string, unknown>>
          : [];
    const deduplicated = new Map<string, PersonCandidate>();
    for (const record of records) {
      const id = String(record.person_id || record.id || "");
      if (id) deduplicated.set(id, { id, position: String(record.position || record.title || "") || undefined, seniority: String(record.seniority || "") || undefined, department: String(record.department || "") || undefined, emailAvailable: Boolean(record.email_available || record.has_email), phoneAvailable: Boolean(record.phone_available || record.has_phone) });
    }
    return [...deduplicated.values()];
  }

  async searchDecisionMakers(companyId: string, options: DecisionMakerSearchOptions = {}): Promise<PersonCandidate[]> {
    const max = Math.max(1, Math.min(options.max || 5, 100));
    const poolSize = Math.min(100, Math.max(50, max));
    const results = await this.searchPeople(companyId, { max: poolSize });
    const ranked = results
      .map((candidate, index) => ({ candidate, index }))
      .sort((a, b) => decisionMakerPriority(a.candidate.position) - decisionMakerPriority(b.candidate.position)
        || Number(b.candidate.emailAvailable) - Number(a.candidate.emailAvailable)
        || Number(b.candidate.phoneAvailable) - Number(a.candidate.phoneAvailable)
        || a.index - b.index)
      .slice(0, max)
      .map(({ candidate }) => candidate);
    options.onAttempt?.({ label: "Company people ranked locally", returnedCount: results.length, addedCount: ranked.length });
    return ranked;
  }

  async enrichPerson(identifier: PersonIdentifier): Promise<PersonDetail> {
    const selected = Object.entries({ id: identifier.id, ln_url: identifier.linkedinUrl, work_email: identifier.workEmail, personal_email: identifier.personalEmail }).find(([, value]) => value);
    if (!selected) throw new FirmableError("/people", 0, "A person identifier is required");
    const raw = personSchema.parse(await this.request(`/people?${new URLSearchParams({ [selected[0]]: selected[1] as string })}`));
    const phones = Array.isArray(raw.phones) ? raw.phones as Array<Record<string, unknown>> : [];
    const emails = raw.emails && typeof raw.emails === "object" && !Array.isArray(raw.emails) ? raw.emails as Record<string, unknown> : {};
    const email = contactValue(raw.work_email)
      || firstContactValue(emails.work, ["value", "email"])
      || contactValue(raw.personal_email)
      || firstContactValue(emails.personal, ["value", "email"]);
    const mobile = firstContactValue(phones, ["value", "number"])
      || contactValue(raw.phone);
    const source = { name: String(raw.full_name || raw.name || ""), email, mobile, linkedinUrl: String(raw.linkedin_url || raw.linkedin || "") };
    const output = this.fictionalise ? fictionalisePersonalData(source) : source;
    return { id: String(raw.id || identifier.id || ""), position: String(raw.position || raw.title || "") || undefined, seniority: String(raw.seniority || "") || undefined, department: String(raw.department || "") || undefined, emailAvailable: Boolean(source.email), phoneAvailable: Boolean(source.mobile), name: output.name, email: output.email, phone: output.mobile, fictionalised: this.fictionalise, doNotContact: phones.some((phone) => phone.is_dnd === true) };
  }
}
