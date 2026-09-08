import { FirmableError, type FirmableClient } from "./firmable-client";
import { MAX_BUSINESS_RESULTS, resolveBusinessResultLimit, type BusinessResultLimit, type GooglePlaceCandidate, type GooglePlacesClient } from "./google-places-client";
import { mapFirmableCompany, mapGooglePlace } from "./firmable-mapper";
import { isManufacturingMandate, type ManufacturingDirectorySearch } from "./manufacturing-directory-client";
import type { Mandate, TargetCandidate } from "@/domain/models";

const stateNames: Record<string, string> = {
  ACT: "Australian Capital Territory", NSW: "New South Wales", NT: "Northern Territory", QLD: "Queensland",
  SA: "South Australia", TAS: "Tasmania", VIC: "Victoria", WA: "Western Australia",
};

export type LiveSearchSummary = {
  discovered: number;
  googlePlacesDiscovered: number;
  manufacturingDirectoryDiscovered: number;
  enriched: number;
  withoutWebsite: number;
  enrichmentFailed: number;
  warnings: string[];
  persisted?: number;
};

function normalizedName(value: string) {
  return value.toLowerCase().replace(/\b(?:pty|ltd|limited|inc|company|co)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

function discoveryKeys(candidate: GooglePlaceCandidate) {
  const keys: string[] = [];
  const domain = candidate.website ? hostname(candidate.website) : "";
  if (domain) keys.push(`domain:${domain}`);
  const abn = candidate.manufacturingDirectory?.abn?.replace(/\D/g, "");
  if (abn) keys.push(`abn:${abn}`);
  if (candidate.state && candidate.name) keys.push(`name-state:${normalizedName(candidate.name)}:${candidate.state.toUpperCase()}`);
  return keys;
}

export function mergeDiscoveryCandidates(google: GooglePlaceCandidate[], directory: GooglePlaceCandidate[]) {
  const directoryIndex = new Map<string, number>();
  directory.forEach((candidate, index) => discoveryKeys(candidate).forEach((key) => directoryIndex.set(key, index)));
  const usedDirectory = new Set<number>();
  const mergedGoogle = google.map((candidate) => {
    const match = discoveryKeys(candidate).map((key) => directoryIndex.get(key)).find((index) => index !== undefined);
    if (match === undefined) return candidate;
    usedDirectory.add(match);
    return { ...candidate, manufacturingDirectory: directory[match].manufacturingDirectory };
  });
  const remainingDirectory = directory.filter((_, index) => !usedDirectory.has(index));
  const combined: GooglePlaceCandidate[] = [];
  const length = Math.max(mergedGoogle.length, remainingDirectory.length);
  for (let index = 0; index < length; index += 1) {
    if (mergedGoogle[index]) combined.push(mergedGoogle[index]);
    if (remainingDirectory[index]) combined.push(remainingDirectory[index]);
  }
  return combined;
}

export function targetSearchLog(event: string, details: Record<string, unknown>) {
  const explicitlyEnabled = process.env.TARGET_SEARCH_VERBOSE_LOGGING === "true";
  if (!explicitlyEnabled) return;
  console.info(`[target-search] ${event}`, JSON.stringify(details));
}

export function placesQueryForMandate(mandate: Mandate) {
  const location = mandate.locations?.length
    ? mandate.locations.join(" or ")
    : mandate.states.map((state) => stateNames[state] || state).join(" or ");
  return `${mandate.sectors.join(" or ")} businesses in ${location}, Australia`;
}

export async function searchAndEnrichTargets(options: {
  places: GooglePlacesClient;
  firmable: FirmableClient;
  manufacturingDirectory?: ManufacturingDirectorySearch;
  mandate: Mandate;
  limit: BusinessResultLimit;
  organisationId: string;
}) {
  const { places, firmable, manufacturingDirectory, mandate, limit, organisationId } = options;
  const placesQuery = placesQueryForMandate(mandate);
  const requestedTargetCount = resolveBusinessResultLimit(limit);
  targetSearchLog("places.request", {
    textQuery: placesQuery,
    requestedTargetCount,
    candidateScanLimit: MAX_BUSINESS_RESULTS,
    regionCode: "AU",
  });
  // Text Search can return 20 candidates in one request. Scan that single page so missing
  // websites do not consume the user's downstream enrichment/result allowance.
  const googleDiscovered = await places.searchText(placesQuery, "max");
  targetSearchLog("places.results", {
    count: googleDiscovered.length,
    businesses: googleDiscovered.map((place) => ({
      placeId: place.id,
      name: place.name,
      formattedAddress: place.formattedAddress,
      website: place.website,
    })),
  });
  const directoryDiscovered = manufacturingDirectory && isManufacturingMandate(mandate)
    ? await manufacturingDirectory.search(mandate, MAX_BUSINESS_RESULTS)
    : [];
  const discovered = mergeDiscoveryCandidates(googleDiscovered, directoryDiscovered);
  targetSearchLog("manufacturing-directory.results", {
    enabled: Boolean(directoryDiscovered.length),
    count: directoryDiscovered.length,
    combinedCount: discovered.length,
  });
  const targets: TargetCandidate[] = [];
  const warnings: string[] = [];
  let enriched = 0;
  let withoutWebsite = 0;
  let enrichmentFailed = 0;
  let firmablePaused = false;
  const seenIdentifiers = new Set<string>();

  // Deliberately sequential: the selected result limit also bounds Firmable calls without bursts.
  for (const place of discovered) {
    if (targets.length >= requestedTargetCount) break;
    const abn = place.manufacturingDirectory?.abn?.replace(/\D/g, "");
    const domain = place.website ? hostname(place.website) : "";
    const identifier = domain ? { fqdn: domain } : /^\d{11}$/.test(abn || "") ? { abn } : undefined;
    if (!identifier) {
      withoutWebsite += 1;
      targetSearchLog("firmable.skipped", { discoveryId: place.id, name: place.name, reason: "Discovery source returned no supported company identifier" });
      continue;
    }
    const identifierKey = domain ? `fqdn:${domain}` : `abn:${abn}`;
    if (seenIdentifiers.has(identifierKey)) continue;
    seenIdentifiers.add(identifierKey);
    if (firmablePaused) {
      enrichmentFailed += 1;
      targetSearchLog("firmable.skipped", { placeId: place.id, name: place.name, fqdn: domain, reason: "Provider calls paused" });
      targets.push(mapGooglePlace(place, mandate, organisationId, "Firmable enrichment paused after a provider error"));
      continue;
    }
    try {
      targetSearchLog("firmable.request", { placeId: place.id, name: place.name, identifier, country: "AU" });
      const company = await firmable.enrichCompany(identifier);
      const target = mapFirmableCompany(company, place, mandate, organisationId);
      targets.push(target);
      enriched += 1;
      targetSearchLog("firmable.result", {
        placeId: place.id,
        firmableId: target.id.replace(/^firmable-/, ""),
        name: target.companyName,
        domain: target.domain,
        location: { suburb: target.suburb, state: target.state },
        sector: target.sector.value,
        revenue: target.revenue.value,
        headcount: target.headcount.value,
        establishedYear: target.establishedYear.value,
      });
    } catch (error) {
      enrichmentFailed += 1;
      targetSearchLog("firmable.error", {
        placeId: place.id,
        name: place.name,
        identifier,
        status: error instanceof FirmableError ? error.status : undefined,
        message: error instanceof Error ? error.message : "Unknown Firmable error",
      });
      warnings.push(`${place.name}: Firmable enrichment was unavailable; showing Google Places data only.`);
      targets.push(mapGooglePlace(place, mandate, organisationId, "Firmable enrichment failed"));
      if (error instanceof FirmableError && [401, 403, 429].includes(error.status)) {
        firmablePaused = true;
        warnings.push("Further Firmable calls were paused to avoid repeated authentication or rate-limit failures.");
      }
    }
  }

  if (withoutWebsite > 0) warnings.push(`${withoutWebsite} discovery result(s) were skipped because they did not include a website or ABN.`);
  const summary: LiveSearchSummary = {
    discovered: discovered.length,
    googlePlacesDiscovered: googleDiscovered.length,
    manufacturingDirectoryDiscovered: directoryDiscovered.length,
    enriched,
    withoutWebsite,
    enrichmentFailed,
    warnings,
  };
  targetSearchLog("pipeline.complete", { ...summary, requestedTargetCount, returnedTargetCount: targets.length });
  return { targets, summary };
}

function hostname(website: string) {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}
