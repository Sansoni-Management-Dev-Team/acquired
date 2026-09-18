import type { GooglePlaceCandidate } from "./google-places-client";
import type { DerivedValue, FinancialValue, Mandate, TargetCandidate } from "@/domain/models";
import { COMPANY_DATA_SOURCE } from "@/domain/provider-display";

export function mapFirmableRevenue(value: unknown, capturedAt = new Date().toISOString()): DerivedValue<FinancialValue> {
  const provenance = { source: COMPANY_DATA_SOURCE, capturedAt, confidence: 70 };
  if (typeof value !== "string" || !value.trim()) return { value: null, missingReason: "Not provided by the company data service", provenance };
  return { value: { kind: "band", label: value.trim() }, provenance };
}

const stateNames: Record<string, string> = {
  "australian capital territory": "ACT", "new south wales": "NSW", "northern territory": "NT", queensland: "QLD",
  "south australia": "SA", tasmania: "TAS", victoria: "VIC", "western australia": "WA",
};

function value<T>(input: T, source: string, capturedAt: string, confidence: number, sourceUrl?: string): DerivedValue<T> {
  return { value: input, provenance: { source, capturedAt, confidence, sourceUrl } };
}

function missing<T>(reason: string, source: string, capturedAt: string): DerivedValue<T> {
  return { value: null, missingReason: reason, provenance: { source, capturedAt, confidence: 100 } };
}

function stringValue(input: unknown) {
  return typeof input === "string" && input.trim() ? input.trim() : undefined;
}

function numberValue(input: unknown) {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string" && /^\d+$/.test(input.trim())) return Number(input);
  return undefined;
}

function strings(input: unknown) {
  return Array.isArray(input) ? input.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}

function domainFrom(website?: string) {
  if (!website) return "";
  try { return new URL(website).hostname.replace(/^www\./, ""); } catch { return website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; }
}

function locationFrom(address: string, rawState?: string) {
  const state = rawState && (/^(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)$/.test(rawState.toUpperCase())
    ? rawState.toUpperCase()
    : stateNames[rawState.toLowerCase()]);
  const match = address.match(/(?:,\s*)?([^,]+?)\s+(ACT|NSW|NT|QLD|SA|TAS|VIC|WA)\s+\d{4}/i);
  return { state: state || match?.[2]?.toUpperCase() || "Unknown", suburb: match?.[1]?.trim() || address.split(",")[0] || "Unknown" };
}

function bestSector(raw: Record<string, unknown>, mandate: Mandate) {
  const industries = strings(raw.industries);
  const match = industries.find((industry) => mandate.sectors.some((sector) => {
    const left = industry.toLowerCase(); const right = sector.toLowerCase();
    return left.includes(right) || right.includes(left);
  }));
  return match || industries[0] || "Unclassified";
}

function googleSourceData(place: GooglePlaceCandidate) {
  if (place.discoverySource === "manufacturing-directory") return undefined;
  return { placeId: place.id, name: place.name, formattedAddress: place.formattedAddress, website: place.website, primaryType: place.primaryType, types: place.types || [] };
}

function sourceData(place: GooglePlaceCandidate, firmable?: ReturnType<typeof firmableSourceData>) {
  const googlePlaces = googleSourceData(place);
  return {
    ...(googlePlaces ? { googlePlaces } : {}),
    ...(place.manufacturingDirectory ? { manufacturingDirectory: place.manufacturingDirectory } : {}),
    ...(firmable ? { firmable } : {}),
  };
}

function sectorEvidence(raw: Record<string, unknown>, place: GooglePlaceCandidate, mandate: Mandate, capturedAt: string, website?: string) {
  const industries = strings(raw.industries);
  const exact = industries.find((industry) => mandate.sectors.some((sector) => {
    const left = industry.toLowerCase(); const right = sector.toLowerCase();
    return left.includes(right) || right.includes(left);
  }));
  if (exact) return value(exact, COMPANY_DATA_SOURCE, capturedAt, 75, website);
  const searchable = `${place.name} ${place.primaryType || ""} ${(place.types || []).join(" ")}`.toLowerCase().replace(/_/g, " ");
  const queryMatch = mandate.sectors.find((sector) => sector.toLowerCase().split(/\s+/).some((token) => searchable.includes(token.replace(/s$/, ""))));
  return value(queryMatch || bestSector(raw, mandate), queryMatch ? "Google Places query match" : COMPANY_DATA_SOURCE, capturedAt, queryMatch ? 65 : 60, website);
}

function firmableSourceData(raw: Record<string, unknown>, fallbackId: string, capturedAt: string) {
  const industryCodes = raw.industry_codes && typeof raw.industry_codes === "object" && !Array.isArray(raw.industry_codes)
    ? raw.industry_codes as Record<string, unknown>
    : {};
  return {
    firmableId: stringValue(raw.id) || fallbackId,
    capturedAt,
    // Retain the complete provider response because a company enrichment consumes
    // credits and Firmable may add fields that the normalized model does not use yet.
    rawResponse: raw,
    name: stringValue(raw.name),
    website: stringValue(raw.website),
    domain: stringValue(raw.fqdn),
    description: stringValue(raw.description),
    tagline: stringValue(raw.tagline),
    companyType: stringValue(raw.company_type),
    companySize: stringValue(raw.company_size),
    revenueBand: stringValue(raw.revenue),
    employeeCount: numberValue(raw.au_employee_count) ?? numberValue(raw.employee_count),
    yearFounded: numberValue(raw.year_founded),
    industries: strings(raw.industries),
    keywords: strings(raw.keywords),
    headquarters: stringValue(raw.hq_location),
    states: strings(raw.states),
    locations: strings(raw.locations),
    abn: stringValue(industryCodes.abn),
    acn: stringValue(industryCodes.acn),
    anzsic: stringValue(industryCodes.anzsic),
    abnStatus: stringValue(raw.abn_operation_status),
    linkedin: stringValue(raw.linkedin),
  };
}

export function mapGooglePlace(place: GooglePlaceCandidate, _mandate: Mandate, organisationId: string, enrichmentReason = "Company data enrichment not attempted") : TargetCandidate {
  const capturedAt = new Date().toISOString();
  const location = place.locality && place.state ? { suburb: place.locality, state: place.state } : locationFrom(place.formattedAddress, place.state);
  return {
    id: `google-${place.id}`,
    organisationId,
    companyName: place.name,
    domain: domainFrom(place.website),
    suburb: location.suburb,
    state: location.state,
    sector: place.manufacturingDirectory?.categories[0] || place.primaryType ? value(place.manufacturingDirectory?.categories[0] || place.primaryType!, place.discoverySource === "manufacturing-directory" ? "Register / directory classification" : "Google Places classification", capturedAt, 60, place.manufacturingDirectory?.sourceRecords[0]?.sourceUrl || place.website) : missing("Sub-sector requires review", "Discovery", capturedAt),
    revenue: missing(enrichmentReason, COMPANY_DATA_SOURCE, capturedAt),
    ebitda: missing("Company data does not include EBITDA", COMPANY_DATA_SOURCE, capturedAt),
    headcount: missing(enrichmentReason, COMPANY_DATA_SOURCE, capturedAt),
    establishedYear: missing(enrichmentReason, COMPANY_DATA_SOURCE, capturedAt),
    signals: [],
    status: "identified",
    sourceData: sourceData(place),
  };
}

export function mapFirmableCompany(raw: Record<string, unknown>, place: GooglePlaceCandidate, mandate: Mandate, organisationId: string): TargetCandidate {
  const capturedAt = new Date().toISOString();
  const states = strings(raw.states);
  const hq = stringValue(raw.hq_location) || place.formattedAddress;
  const discoveryAddress = place.formattedAddress && place.formattedAddress !== place.state ? place.formattedAddress : hq;
  const location = place.locality && place.state ? { suburb: place.locality, state: place.state } : locationFrom(discoveryAddress, states[0] || place.state);
  const website = stringValue(raw.website) || place.website;
  const headcount = numberValue(raw.au_employee_count) ?? numberValue(raw.employee_count);
  const establishedYear = numberValue(raw.year_founded);
  const firmableId = stringValue(raw.id) || place.id;
  return {
    id: `firmable-${firmableId}`,
    organisationId,
    // Enrichment adds facts to a discovered company; it must not replace the
    // discovery identity with a provider value that may be an SEO page title.
    companyName: place.name,
    domain: stringValue(raw.fqdn) || domainFrom(website),
    suburb: location.suburb,
    state: location.state,
    sector: sectorEvidence(raw, place, mandate, capturedAt, website),
    revenue: mapFirmableRevenue(raw.revenue, capturedAt),
    ebitda: missing("Company data does not include EBITDA", COMPANY_DATA_SOURCE, capturedAt),
    headcount: headcount === undefined ? missing("Not provided by the company data service", COMPANY_DATA_SOURCE, capturedAt) : value(headcount, COMPANY_DATA_SOURCE, capturedAt, 75, website),
    establishedYear: establishedYear === undefined ? missing("Not provided by the company data service", COMPANY_DATA_SOURCE, capturedAt) : value(establishedYear, COMPANY_DATA_SOURCE, capturedAt, 75, website),
    signals: [],
    status: "enriched",
    sourceData: sourceData(place, firmableSourceData(raw, firmableId, capturedAt)),
  };
}

export function applyStoredFirmableCompany(target: import("@/domain/models").RankedTarget, raw: Record<string, unknown>, capturedAt: string): import("@/domain/models").RankedTarget {
  const headcount = numberValue(raw.au_employee_count) ?? numberValue(raw.employee_count);
  const establishedYear = numberValue(raw.year_founded);
  const website = stringValue(raw.website);
  const firmableId = stringValue(raw.id);
  const hq = stringValue(raw.hq_location);
  const locations = strings(raw.locations);
  const location = hq ? locationFrom(hq, target.state) : undefined;
  const company = firmableId ? firmableSourceData(raw, firmableId, capturedAt) : undefined;
  const providerName = stringValue(raw.name);
  const directoryName = target.sourceData?.manufacturingDirectory?.name;
  return {
    ...target,
    // Older enrichment writes may have persisted the provider name. Recover a
    // retained discovery name only when the stored target still exactly matches
    // that provider value; otherwise preserve the target (including user edits).
    companyName: providerName && target.companyName === providerName && directoryName
      ? directoryName
      : target.companyName,
    domain: stringValue(raw.fqdn) || domainFrom(website) || target.domain,
    suburb: location?.suburb || locations[0]?.split(",")[0] || target.suburb,
    state: location?.state === "Unknown" ? target.state : location?.state || target.state,
    revenue: raw.revenue === undefined ? target.revenue : mapFirmableRevenue(raw.revenue, capturedAt),
    headcount: headcount === undefined ? missing("Not provided by the company data service", COMPANY_DATA_SOURCE, capturedAt) : value(headcount, COMPANY_DATA_SOURCE, capturedAt, 75, website),
    establishedYear: establishedYear === undefined ? missing("Not provided by the company data service", COMPANY_DATA_SOURCE, capturedAt) : value(establishedYear, COMPANY_DATA_SOURCE, capturedAt, 75, website),
    sourceData: company ? { ...target.sourceData, firmable: company } : target.sourceData,
  };
}
