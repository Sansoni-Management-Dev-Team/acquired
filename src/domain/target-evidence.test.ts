import { describe, expect, it } from "vitest";
import { targetEvidence } from "./target-evidence";
import type { RankedTarget } from "./models";

describe("targetEvidence", () => {
  it("creates only factual Firmable-backed outreach signals", () => {
    const capturedAt = "2026-08-31T00:00:00.000Z";
    const missing = { value: null, missingReason: "Missing", provenance: { source: "Firmable", capturedAt, confidence: 100 } };
    const target = {
      id: "target-1", organisationId: "org-1", companyName: "Example Co", domain: "example.com", suburb: "Melbourne", state: "VIC",
      sector: { value: "Building services", provenance: { source: "Firmable", capturedAt, confidence: 75 } }, revenue: missing, ebitda: missing,
      headcount: { value: 42, provenance: { source: "Firmable", capturedAt, confidence: 75 } }, establishedYear: { value: 1984, provenance: { source: "Firmable", capturedAt, confidence: 75 } },
      signals: [], status: "enriched", scores: { fit: 40, ripeness: 0, financeability: null, confidence: 50, band: "cold", qualification: "research", tensions: [], reasons: [] },
      sourceData: { googlePlaces: { placeId: "place-1", types: [] }, firmable: { firmableId: "firm-1", industries: ["Building services"], keywords: [], states: ["VIC"], locations: ["Melbourne"], employeeCount: 42, yearFounded: 1984, headquarters: "Melbourne, Victoria", tagline: "Built to last", website: "https://example.com" } },
    } satisfies RankedTarget;

    const evidence = targetEvidence(target);
    expect(evidence.map(({ kind }) => kind)).toEqual(["company_longevity", "industry_focus", "operating_scale", "headquarters", "company_positioning"]);
    expect(JSON.stringify(evidence).toLowerCase()).not.toMatch(/owner|sale|succession|revenue|ebitda/);
    expect(evidence.every((item) => item.source === "Firmable" && item.sourceUrl === "https://example.com")).toBe(true);
  });
});
