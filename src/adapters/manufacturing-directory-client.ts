import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Mandate, ManufacturingDirectorySourceData } from "@/domain/models";
import type { GooglePlaceCandidate } from "./google-places-client";
import researchedIdentifiers from "@/data/manufacturing-directory-identifiers.json";
import manufacturingTaxonomy from "@/data/manufacturing-search-taxonomy.json";

const DEFAULT_DATA_PATH = join(process.cwd(), ".local-data", "manufacturing-search-index.json");

export type DirectoryBusiness = {
  id: string;
  name: string;
  website?: string | null;
  abn?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  state?: string | null;
  postcode?: string | null;
  description?: string | null;
  categories?: string[];
  keywords?: string[];
  capabilities?: Record<string, string[]>;
  manufacturingConfidence?: "low" | "medium" | "high";
  manufacturingScore?: number;
  australianConfidence?: "low" | "medium" | "high";
  australianScore?: number;
  sourceRecords?: Array<{ source: string; sourceId: string; sourceUrl: string }>;
};

type DirectoryFile = { businesses: DirectoryBusiness[] };

export type ResearchedCompanyIdentifier = {
  website?: string;
  abn?: string;
  evidenceUrl: string;
  confidence: number;
};

export type ResearchedCompanyIdentifiers = Record<string, ResearchedCompanyIdentifier>;

const productionIdentifiers = researchedIdentifiers as ResearchedCompanyIdentifiers;

export type ManufacturingDirectorySearch = {
  search(mandate: Mandate, limit: number): Promise<GooglePlaceCandidate[]>;
};

function words(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

const genericWords = new Set([
  "a", "an", "and", "australia", "australian", "business", "businesses", "company", "companies",
  "industrial", "industrials", "manufacture", "manufacturer", "manufacturers", "manufacturing", "or", "the",
]);

function normalizedManufacturingIntent(value: string) {
  return words(value)
    .filter((word) => !["a", "an", "and", "business", "businesses", "company", "companies", "manufacture", "manufacturer", "manufacturers", "manufacturing", "or", "the"].includes(word))
    .join(" ")
    .replace(/\bmolding\b/g, "moulding");
}

export function isManufacturingMandate(mandate: Mandate) {
  return mandate.sectors.some((sector) => {
    if (/\bmanufactur(?:e|er|ers|ing)\b/i.test(sector)) return true;
    const requested = normalizedManufacturingIntent(sector);
    if (!requested) return false;
    const requestedWordCount = requested.split(" ").length;
    return manufacturingTaxonomy.some((category) => {
      const known = normalizedManufacturingIntent(category);
      return requested === known || (requestedWordCount >= 2 && (known.includes(requested) || requested.includes(known)));
    });
  });
}

function specificSectorTerms(mandate: Mandate) {
  return [...new Set(mandate.sectors.flatMap(words).filter((word) => !genericWords.has(word)))];
}

function localityFrom(address?: string | null, state?: string | null) {
  if (!address) return undefined;
  const statePattern = state ? new RegExp(`\\b${state}\\b`, "i") : /\b(?:ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\b/i;
  const beforeState = address.split(statePattern)[0]?.replace(/,\s*$/, "").trim();
  const pieces = beforeState?.split(",").map((piece) => piece.trim()).filter(Boolean) || [];
  return pieces.length > 1 ? pieces.at(-1) : undefined;
}

function sourceData(business: DirectoryBusiness, identifier?: ResearchedCompanyIdentifier): ManufacturingDirectorySourceData {
  const capabilities = Object.entries(business.capabilities || {}).flatMap(([category, values]) =>
    values.length ? values.map((value) => `${category}: ${value}`) : [category],
  );
  return {
    recordId: business.id,
    name: business.name,
    website: business.website || identifier?.website,
    abn: business.abn || identifier?.abn,
    ...(identifier ? { identifierEvidence: { sourceUrl: identifier.evidenceUrl, confidence: identifier.confidence } } : {}),
    phone: business.phone || undefined,
    email: business.email || undefined,
    address: business.address || undefined,
    state: business.state || undefined,
    postcode: business.postcode || undefined,
    description: business.description || undefined,
    categories: business.categories || [],
    keywords: business.keywords || [],
    capabilities,
    manufacturingConfidence: business.manufacturingConfidence,
    manufacturingScore: business.manufacturingScore,
    australianConfidence: business.australianConfidence,
    australianScore: business.australianScore,
    sourceRecords: (business.sourceRecords || []).map(({ source, sourceId, sourceUrl }) => ({ source, sourceId, sourceUrl })),
  };
}

function credibleManufacturingEvidence(business: DirectoryBusiness, searchable: string) {
  if (business.manufacturingConfidence === "high" || business.manufacturingConfidence === "medium") return true;
  if (business.sourceRecords?.some((record) => record.source === "amtil")) return true;
  return /\b(?:manufactur|fabricat|machin|mould|factory|production|processing|forging|casting|toolmaking)\w*/.test(searchable);
}

export function searchManufacturingBusinesses(
  businesses: DirectoryBusiness[],
  mandate: Mandate,
  limit: number,
  identifiers: ResearchedCompanyIdentifiers = {},
) {

  const terms = specificSectorTerms(mandate);
  const states = new Set(mandate.states.map((state) => state.toUpperCase()));

  return businesses
    .flatMap((business) => {
      const identifier = identifiers[business.id];
      const website = business.website || identifier?.website;
      if (states.size && business.state && !states.has(business.state.toUpperCase())) return [];
      const capabilities = Object.entries(business.capabilities || {}).flatMap(([category, values]) => [category, ...values]);
      const searchable = [business.name, ...(business.categories || []), ...(business.keywords || []), ...capabilities, business.description || ""]
        .join(" ")
        .toLowerCase();
      const groups = mandate.sectors.map(sector => specificSectorTerms({ ...mandate, sectors: [sector] }));
      if (terms.length && !groups.some(group => group.length && group.every(term => searchable.includes(term)))) return [];
      if (!terms.length && !credibleManufacturingEvidence(business, searchable)) return [];
      const exactSector = mandate.sectors.some((sector) => searchable.includes(sector.toLowerCase()));
      const termScore = terms.reduce((score, term) => score + (searchable.includes(term) ? 10 : 0), 0);
      const manufacturingEvidence = /manufactur/.test(searchable) ? 6 : 0;
      const confidenceScore = business.manufacturingConfidence === "high" ? 20 : business.manufacturingConfidence === "medium" ? 10 : 0;
      const completeness = [business.phone, business.email, business.address, business.description].filter(Boolean).length;
      return [{ business, identifier, website, score: (exactSector ? 25 : 0) + termScore + manufacturingEvidence + confidenceScore + completeness }];
    })
    .sort((left, right) => right.score - left.score || left.business.name.localeCompare(right.business.name))
    .slice(0, Math.max(0, limit))
    .map(({ business, identifier, website }) => ({
      id: business.id,
      name: business.name,
      formattedAddress: business.address || `${business.state} ${business.postcode || ""}`.trim(),
      website: website || undefined,
      primaryType: business.categories?.[0] || "manufacturer",
      types: business.categories || [],
      locality: localityFrom(business.address, business.state),
      state: business.state || undefined,
      discoverySource: "manufacturing-directory" as const,
      manufacturingDirectory: sourceData(business, identifier),
    }));
}

export class ManufacturingDirectoryClient implements ManufacturingDirectorySearch {
  private data?: Promise<DirectoryBusiness[]>;

  constructor(private filePath = process.env.MANUFACTURING_DIRECTORY_DATA_PATH || DEFAULT_DATA_PATH) {}

  private load() {
    this.data ??= readFile(resolve(this.filePath), "utf8").then((contents) => {
      const parsed = JSON.parse(contents) as Partial<DirectoryFile>;
      if (!Array.isArray(parsed.businesses)) throw new Error("Manufacturing directory data is invalid");
      return parsed.businesses;
    });
    return this.data;
  }

  async search(mandate: Mandate, limit: number) {

    return searchManufacturingBusinesses(await this.load(), mandate, limit, productionIdentifiers);
  }
}
