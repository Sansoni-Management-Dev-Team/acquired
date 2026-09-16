import { describe, expect, it } from "vitest";
import { targetRecordToRankedTarget } from "./target-record-mapper";

describe("targetRecordToRankedTarget", () => {
  it("reconstructs persisted provider data, evidence, and an unscored financeability result", () => {
    const capturedAt = "2026-08-31T00:00:00.000Z";
    const row = {
      id: "00000000-0000-4000-8000-000000000001", organizationId: "org-1", mandateId: null,
      companyName: "Example Industrial", domain: "example.com",
      identifiers: { googlePlaceId: "place-1", firmableId: "firmable-1" },
      firmographics: {
        suburb: "Melbourne", state: "VIC",
        sector: { value: "Industrials", provenance: { source: "Firmable", capturedAt, confidence: 75 } },
        revenue: { value: { kind: "band", label: "$5M-$10M" }, provenance: { source: "Firmable", capturedAt, confidence: 70 } },
        ebitda: { value: null, missingReason: "Firmable does not provide EBITDA", provenance: { source: "Firmable", capturedAt, confidence: 100 } },
        headcount: { value: 42, provenance: { source: "Firmable", capturedAt, confidence: 75 } },
        establishedYear: { value: 1984, provenance: { source: "Firmable", capturedAt, confidence: 75 } },
        firmable: { firmableId: "firmable-1", website: "https://example.com", industries: ["Industrials"], keywords: [], states: ["VIC"], locations: ["Melbourne"], rawResponse: { id: "firmable-1", provider_only_field: "retained" } },
        scoreExplanation: { tensions: ["Financeability is unscored until operating and lender evidence is collected."], reasons: [{ axis: "fit", label: "Located in VIC", contribution: 10, source: "Discovery record" }] },
      },
      fitScore: 40, ripenessScore: 6, financeabilityScore: null, confidenceScore: 51,
      band: "cold" as const, qualification: "research" as const, status: "enriched" as const,
      createdAt: new Date(capturedAt), updatedAt: new Date(capturedAt),
    };
    const signal = {
      id: "00000000-0000-4000-8000-000000000002", organizationId: "org-1", targetId: row.id, contactId: null,
      kind: "company_longevity", value: "Example Industrial has operated since 1984", weight: "low" as const,
      direction: "positive", confidence: 75, source: "Firmable", sourceUrl: "https://example.com", capturedAt: new Date(capturedAt),
    };

    const target = targetRecordToRankedTarget(row, [signal]);

    expect(target).toMatchObject({
      id: row.id, companyName: "Example Industrial", suburb: "Melbourne", state: "VIC",
      scores: { fit: 40, ripeness: 6, financeability: null, confidence: 51 },
      sourceData: { googlePlaces: { placeId: "place-1" }, firmable: { firmableId: "firmable-1", rawResponse: { id: "firmable-1", provider_only_field: "retained" } } },
    });
    expect(target.signals).toEqual([expect.objectContaining({ kind: "company_longevity", weight: "low" })]);
    expect(target.scores.reasons).toEqual([expect.objectContaining({ label: "Located in VIC" })]);
  });
});
