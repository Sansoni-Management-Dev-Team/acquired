import { expect, it } from "vitest";
import { ebitdaBenchmarks, estimateEbitda, matchEbitdaBenchmark } from "./estimated-ebitda";
import type { SavedResearchFinding } from "./research";
const findings = (headcount = "20–40 employees", industry = "Manufacturing"): SavedResearchFinding[] => [
  { id: "count", jobId: "job", targetId: "target", sourceUrl: "https://example.com/team", observedAt: "2026-09-15T00:00:00Z", confidence: 0.5, evidence: { kind: "headcount", name: "Headcount", value: headcount, quote: `We employ ${headcount}`, website: "https://example.com/" } },
  { id: "industry", jobId: "job", targetId: "target", sourceUrl: "https://example.com/about", observedAt: "2026-09-15T00:00:00Z", confidence: 0.5, evidence: { kind: "industry", name: "Industry", value: industry, quote: `We work in ${industry}`, website: "https://example.com/" } },
];
it("includes 79 subsectors, 72 size cohorts, 18 divisions and a broad fallback with traceable data", () => {
  expect(ebitdaBenchmarks.filter(b => b.level === "subdivision")).toHaveLength(79);
  expect(ebitdaBenchmarks.filter(b => b.level === "size")).toHaveLength(72);
  expect(new Set(ebitdaBenchmarks.map(b => b.id)).size).toBe(170);
  for (const b of ebitdaBenchmarks) {
    expect(b.observations.at(-1)?.period).toBe("2024-25");
    for (const observation of b.observations) {
      expect(observation.employmentThousands).toBeGreaterThan(0);
      expect(Number.isFinite(observation.ebitdaMillions)).toBe(true);
      expect(observation.cells).toMatch(/^[A-Z]+\d+, [A-Z]+\d+$/);
    }
  }
});
it("matches exact industries, vocabulary differences and misspellings, and flags uncertain matches", () => {
  expect(matchEbitdaBenchmark(["Machinery and equipment manufacturing"])).toMatchObject({ id: "anzsic-24", method: "exact" });
  expect(matchEbitdaBenchmark(["Plastics manufacturing"])).toMatchObject({ id: "anzsic-19", method: "alias", needsReview: true });
  expect(matchEbitdaBenchmark(["plastics manufacturer"])).toMatchObject({ id: "anzsic-19", method: "fuzzy", needsReview: true });
  expect(matchEbitdaBenchmark(["metal fabricaton"])).toMatchObject({ id: "anzsic-22", method: "fuzzy" });
  for (const descriptions of [[], ["unknown"], ["miscellaneous"], ["Manufacturing", "Construction"]]) {
    expect(matchEbitdaBenchmark(descriptions)).toMatchObject({ id: "all-industries", method: "fallback", needsReview: true });
  }
});
it("uses historical ratios for a range even with a single reported headcount", () => {
  const result = estimateEbitda(findings("30 employees"));
  expect(result.low).toBe(Math.round(30 * 47977 * 1000 / 899.3));
  expect(result.high).toBe(Math.round(30 * 49581 * 1000 / 892.9));
  expect(result.benchmark?.periods).toEqual(["2022-23", "2023-24", "2024-25"]);
});
it("keeps size comparisons separate and clips headcount to each overlapping size band", () => {
  const result = estimateEbitda(findings("11–50 employees", "Plastics manufacturing"));
  expect(result.benchmark?.id).toBe("anzsic-19");
  expect(result.sizeComparisons.map(s => [s.headcountLow, s.headcountHigh])).toEqual([[11, 19], [20, 50]]);
  expect(result.sizeComparisons.every(s => s.label.startsWith("Manufacturing"))).toBe(true);
  expect(result.benchmark?.perPerson).toBe(1611 * 1000 / 40.9);
});
it("orders negative and sign-changing EBITDA bounds correctly", () => {
  const negative = estimateEbitda(findings(), "anzsic-95");
  expect(negative.low).toBeLessThan(negative.high!);
  expect(negative.high).toBeLessThan(0);
  const mixed = estimateEbitda(findings(), "anzsic-89");
  expect(mixed.low).toBeLessThan(0);
  expect(mixed.high).toBeGreaterThan(0);
});
it("supports explicit selection and refuses to invent headcount", () => {
  expect(estimateEbitda(findings("30 employees", "Unknown"), "machinery")).toMatchObject({ status: "estimated", match: { method: "manual" }, benchmark: { id: "anzsic-24" } });
  expect(estimateEbitda(findings("30 employees", "Unknown"))).toMatchObject({ status: "estimated", match: { method: "fallback", needsReview: true } });
  expect(estimateEbitda(findings("30+ employees"))).toMatchObject({ status: "unavailable" });
  expect(estimateEbitda(findings("30 employees"), "size-manufacturing-5-19")).toMatchObject({ status: "unavailable" });
  expect(estimateEbitda([], "anzsic-24")).toMatchObject({ status: "unavailable" });
});

it("automatically estimates from directory and search headcount while retaining provenance", () => {
  for (const basis of ["third_party_estimate", "search_snippet"] as const) {
    const input = findings();
    input[0].evidence.factMetadata = { basis, sourceKind: "third_party_directory", identityNote: null, scope: "unspecified", period: null, currency: null };
    const result = estimateEbitda(input);
    expect(result).toMatchObject({status:"estimated",headcountBasis:"estimated",headcountFindingIds:["count"],modelVersion:"abs-headcount-v3"});
    expect(result.low).toBe(estimateEbitda(findings()).low);
    expect(result.limitations.join(" ")).toContain("Based on estimated headcount");
  }
  expect(estimateEbitda(findings()).headcountBasis).toBe("reported");
});
