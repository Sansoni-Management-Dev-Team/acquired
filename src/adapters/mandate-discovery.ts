import type { CoverageSource } from "@/domain/acquisition";
import type { Mandate, TargetCandidate } from "@/domain/models";
import { mapGooglePlace } from "./firmable-mapper";
import type { ManufacturingDirectorySearch } from "./manufacturing-directory-client";
import type { GooglePlacesClient } from "./google-places-client";
import { placesQueryForMandate } from "./live-target-search";

// Enumerate the selected register index, independently of any enrichment budget.
export async function discoverMandate(options: { directory: ManufacturingDirectorySearch; places?: Pick<GooglePlacesClient, "isConfigured" | "searchText">; mandate: Mandate; organizationId: string }) {
  const checkedAt = new Date().toISOString();
  const targets: TargetCandidate[] = [];
  let source: CoverageSource;
  const originSources: CoverageSource[] = [];
  try {
    const candidates = await options.directory.search(options.mandate, Number.MAX_SAFE_INTEGER);
    const seen = new Map<string, number>();
    for (const candidate of candidates) {
      const abn = candidate.manufacturingDirectory?.abn?.replace(/\D/g, "");
      const domain = candidate.website?.replace(/^https?:\/\/(www\.)?/i, "").split("/")[0].toLowerCase();
      const keys = [abn ? `abn:${abn}` : "", domain ? `domain:${domain}` : "", `source:${candidate.id}`].filter(Boolean);
      const duplicate = keys.map(key => seen.get(key)).find(index => index !== undefined);
      const index = duplicate ?? targets.length;
      for (const key of keys) seen.set(key, index);
      if (duplicate !== undefined) {
        const existing = targets[duplicate].sourceData?.manufacturingDirectory;
        const incoming = candidate.manufacturingDirectory;
        if (existing && incoming) existing.sourceRecords = [...new Map([...existing.sourceRecords, ...incoming.sourceRecords].map(record => [`${record.source}:${record.sourceId}`, record])).values()];
        continue;
      }
      targets.push(mapGooglePlace(candidate, options.mandate, options.organizationId, "Not enriched — retained for review"));
    }
    const recordsBySource = new Map<string, Set<string>>();
    for (const candidate of candidates) for (const record of candidate.manufacturingDirectory?.sourceRecords || []) {
      const ids = recordsBySource.get(record.source) || new Set<string>(); ids.add(candidate.id); recordsBySource.set(record.source, ids);
    }
    const attributed = new Set<string>();
    for (const [name, ids] of recordsBySource) {
      const unique = [...ids].filter(id => !attributed.has(id)).length;
      originSources.push({ name, status: "partial", discovered: ids.size, unique, overlap: ids.size - unique, checkedAt, note: "Provenance within the configured index; source-wide completeness not established. Unique contribution is attributed in source order." });
      for (const id of ids) attributed.add(id);
    }
    source = { name: "Register and directory index", status: "searched", discovered: candidates.length, unique: targets.length, overlap: candidates.length - targets.length, checkedAt, note: "All matching records in the configured index processed. This is not a claim of national market completeness; validate sub-sector relevance." };
  } catch {
    source = { name: "Register and directory index", status: "failed", discovered: 0, unique: 0, overlap: 0, checkedAt, note: "Index unavailable. Import sourced register records or configure the directory index, then retry." };
  }
  const google: CoverageSource = { name: "Google Places", status: "not-configured", discovered: 0, unique: 0, overlap: 0, checkedAt, note: "Google Places is not configured." };
  if (options.places?.isConfigured()) {
    // Bound provider calls independently of the downstream enrichment allowance.
    const sectors = [...new Set(options.mandate.sectors)];
    const queries = sectors.slice(0, 12).map(sector => placesQueryForMandate({ ...options.mandate, sectors: [sector] }));
    const results = await Promise.allSettled(queries.map(query => options.places!.searchText(query, "max")));
    let succeeded = 0;
    const placesSeen = new Set<string>();
    for (const result of results) {
      if (result.status === "rejected") continue;
      succeeded++;
      for (const place of result.value) {
        if (placesSeen.has(place.id)) continue;
        placesSeen.add(place.id);
        google.discovered++;
        const target = mapGooglePlace(place, options.mandate, options.organizationId, "Not enriched — retained for review");
        const existing = targets.find(t => (target.domain && t.domain === target.domain) || t.sourceData?.googlePlaces?.placeId === place.id);
        if (existing) {
          existing.sourceData = { ...existing.sourceData, googlePlaces: target.sourceData?.googlePlaces };
          google.overlap++;
        } else {
          targets.push(target);
          google.unique++;
        }
      }
    }
    google.status = succeeded ? "partial" : "failed";
    google.note = `${succeeded}/${queries.length} sub-sector searches succeeded. Up to 20 results per query, first page only; not exhaustive coverage. ${Math.max(0, sectors.length - queries.length)} sub-sectors not searched due to the 12-query run limit. Unique contribution is counted after directory results; repeated Place IDs are counted once.`;
  }
  return { targets, sources: [source, ...originSources, google, ...["Web crawl", "Paid third-party discovery"].map(name => ({ name, status: "not-configured" as const, discovered: 0, unique: 0, overlap: 0, checkedAt, note: "No automated discovery adapter configured. Sourced records can be imported." }))] };
}
