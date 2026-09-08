import type { CoverageSource } from "@/domain/acquisition";
import type { Mandate, TargetCandidate } from "@/domain/models";
import { mapGooglePlace } from "./firmable-mapper";
import type { ManufacturingDirectorySearch } from "./manufacturing-directory-client";

// Enumerate the selected register index, independently of any enrichment budget.
export async function discoverMandate(options: { directory: ManufacturingDirectorySearch; mandate: Mandate; organizationId: string }) {
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
  return { targets, sources: [source, ...originSources, ...["Web crawl", "Paid third-party discovery"].map(name => ({ name, status: "not-configured" as const, discovered: 0, unique: 0, overlap: 0, checkedAt, note: "No automated discovery adapter configured. Sourced records can be imported." }))] };
}
