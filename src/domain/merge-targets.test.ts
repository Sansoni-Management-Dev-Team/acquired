import { describe, expect, it } from "vitest";
import type { RankedTarget } from "./models";
import { mergeRankedTargets } from "./merge-targets";

function target(id: string, domain: string): RankedTarget {
  const missing = { value: null, missingReason: "Missing", provenance: { source: "Test", capturedAt: "2026-08-31T00:00:00.000Z", confidence: 100 } };
  return {
    id, domain, organisationId: "org-1", companyName: id, suburb: "Melbourne", state: "VIC",
    sector: { value: "Industrials", provenance: missing.provenance }, revenue: missing, ebitda: missing,
    headcount: missing, establishedYear: missing, signals: [], status: "enriched",
    scores: { fit: 10, ripeness: 0, financeability: null, confidence: 20, band: "cold", qualification: "research", tensions: [], reasons: [] },
  };
}

describe("mergeRankedTargets", () => {
  it("keeps saved businesses while placing the latest search first", () => {
    expect(mergeRankedTargets([target("new", "new.example")], [target("saved", "saved.example")]).map(({ id }) => id)).toEqual(["new", "saved"]);
  });

  it("replaces an existing business by persisted id or domain", () => {
    const returned = target("new-id", "same.example");
    expect(mergeRankedTargets([returned], [target("old-id", "same.example"), target("new-id", "old.example")])).toEqual([returned]);
  });
});
