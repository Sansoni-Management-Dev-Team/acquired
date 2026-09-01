import { FirmableError, type FirmableClient } from "./firmable-client";
import { MAX_BUSINESS_RESULTS, resolveBusinessResultLimit, type BusinessResultLimit, type GooglePlacesClient } from "./google-places-client";
import { mapFirmableCompany, mapGooglePlace } from "./firmable-mapper";
import type { Mandate, TargetCandidate } from "@/domain/models";

const stateNames: Record<string, string> = {
  ACT: "Australian Capital Territory", NSW: "New South Wales", NT: "Northern Territory", QLD: "Queensland",
  SA: "South Australia", TAS: "Tasmania", VIC: "Victoria", WA: "Western Australia",
};

export type LiveSearchSummary = {
  discovered: number;
  enriched: number;
  withoutWebsite: number;
  enrichmentFailed: number;
  warnings: string[];
  persisted?: number;
};

export function targetSearchLog(event: string, details: Record<string, unknown>) {
  const explicitlyEnabled = process.env.TARGET_SEARCH_VERBOSE_LOGGING === "true";
  const developmentDefault = process.env.TARGET_SEARCH_VERBOSE_LOGGING === undefined && process.env.NODE_ENV === "development";
  if (!explicitlyEnabled && !developmentDefault) return;
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
  mandate: Mandate;
  limit: BusinessResultLimit;
  organisationId: string;
}) {
  const { places, firmable, mandate, limit, organisationId } = options;
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
  const discovered = await places.searchText(placesQuery, "max");
  targetSearchLog("places.results", {
    count: discovered.length,
    businesses: discovered.map((place) => ({
      placeId: place.id,
      name: place.name,
      formattedAddress: place.formattedAddress,
      website: place.website,
    })),
  });
  const targets: TargetCandidate[] = [];
  const warnings: string[] = [];
  let enriched = 0;
  let withoutWebsite = 0;
  let enrichmentFailed = 0;
  let firmablePaused = false;
  const seenDomains = new Set<string>();

  // Deliberately sequential: the selected result limit also bounds Firmable calls without bursts.
  for (const place of discovered) {
    if (targets.length >= requestedTargetCount) break;
    if (!place.website) {
      withoutWebsite += 1;
      targetSearchLog("firmable.skipped", { placeId: place.id, name: place.name, reason: "Google Places returned no website" });
      continue;
    }
    const domain = hostname(place.website);
    if (seenDomains.has(domain)) continue;
    seenDomains.add(domain);
    if (firmablePaused) {
      enrichmentFailed += 1;
      targetSearchLog("firmable.skipped", { placeId: place.id, name: place.name, fqdn: domain, reason: "Provider calls paused" });
      targets.push(mapGooglePlace(place, mandate, organisationId, "Firmable enrichment paused after a provider error"));
      continue;
    }
    try {
      targetSearchLog("firmable.request", { placeId: place.id, name: place.name, identifier: { type: "fqdn", value: domain }, country: "AU" });
      const company = await firmable.enrichCompany({ fqdn: domain });
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
        fqdn: domain,
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

  if (withoutWebsite > 0) warnings.push(`${withoutWebsite} Google Places result(s) were skipped because they did not include a website.`);
  const summary: LiveSearchSummary = { discovered: discovered.length, enriched, withoutWebsite, enrichmentFailed, warnings };
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
