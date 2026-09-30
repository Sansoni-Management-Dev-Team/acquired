import { describe, expect, it } from "vitest";
import { criterion, emptyBrief, initialAssessment } from "./acquisition";
import { reviewMandateFit } from "./mandate-fit";
import type { SavedResearchFinding } from "./research";
import { seedTargets } from "@/test/fixtures/scoring-targets";

const target = { ...seedTargets[0], state: "Unknown", sector: { ...seedTargets[0].sector, value: null }, headcount: { ...seedTargets[0].headcount, value: null }, revenue: { ...seedTargets[0].revenue, value: null }, ebitda: { ...seedTargets[0].ebitda, value: null } };
function brief() {
  const b = emptyBrief();
  Object.assign(criterion(b, "headcount"), { value: "20–60", state: "specified", confirmed: true, importance: "requirement" });
  Object.assign(criterion(b, "revenue"), { value: "$1m–$5m", state: "specified", confirmed: true });
  return b;
}
function finding(kind: "headcount" | "revenue" | "location" | "product" | "person", value: string, currency: string | null = null): SavedResearchFinding {
  return { id: value, targetId: target.id, jobId: "job", observedAt: "2026-09-30T00:00:00Z", confidence: 90, sourceUrl: "https://example.com/profile", evidence: { kind, name: kind, value, quote: "Published company profile", website: "https://example.com", factMetadata: { sourceKind: "company_website", basis: "reported", scope: "unspecified", currency, identityNote: null, period: null } } };
}
describe("mandate fit review matrix", () => {
  it("weights all specified criteria and lowers fit for missing evidence", () => {
    const fit = reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "40 employees")]);
    expect(fit.score).toBe(67); expect(fit.completeness).toBe(67);
    expect(fit.reason).toContain("Missing evidence: Revenue range");
  });
  it("scores a full match at 100 and an evidenced mismatch at zero", () => {
    expect(reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "40 employees"), finding("revenue", "$3m", "AUD")]).score).toBe(100);
    const failed = reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "100 employees"), finding("revenue", "$8m", "AUD")]);
    expect(failed.score).toBe(0); expect(failed.completeness).toBe(100); expect(failed.reason).toContain("Outside mandate");
  });
  it("does not compare foreign or unknown currencies to AUD", () => {
    for (const currency of [null, "USD"]) expect(reviewMandateFit(brief(), target, initialAssessment, [finding("revenue", "$3m", currency)]).rows[1].status).toBe("unknown");
  });
  it("gives partial credit for conflicting sources without averaging them away", () => {
    const fit = reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "40 employees"), finding("headcount", "100 employees")]);
    expect(fit.score).toBe(33); expect(fit.rows.find(row => row.key === "headcount")!.reason).toContain("sources disagree");
  });
  it("keeps open bounds partial unless the whole interval satisfies the mandate", () => {
    expect(reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "40+ employees")]).rows.find(row => row.key === "headcount")!.status).toBe("potential");
    expect(reviewMandateFit(brief(), target, initialAssessment, [finding("headcount", "100+ employees")]).rows.find(row => row.key === "headcount")!.status).toBe("fails");
  });
  it("honours saved reviews without discarding other scraped criteria", () => {
    const fit = reviewMandateFit(brief(), target, { ...initialAssessment, evidence: [{ criterionKey: "headcount", assessment: "fails", kind: "document-verified", value: "100 employees", source: "Reviewed accounts", sourceUrl: "https://example.com/accounts", capturedAt: "2026-09-30T00:00:00Z", confidence: 100, nextStep: "" }] }, [finding("headcount", "40 employees"), finding("revenue", "$3m", "AUD")]);
    expect(fit.score).toBe(33); expect(fit.rows.find(row => row.key === "headcount")!.sources).toEqual(["https://example.com/accounts"]);
  });
  it("excludes unrestricted criteria but scores unconfirmed assumptions", () => {
    const b = brief(); criterion(b, "headcount").state = "unrestricted"; criterion(b, "revenue").confirmed = false; criterion(b, "revenue").origin = "assumed";
    const fit = reviewMandateFit(b, target, initialAssessment, [finding("revenue", "$3m", "AUD")]);
    expect(fit.score).toBe(100); expect(fit.rows.map(row => row.key)).toEqual(["revenue"]); expect(fit.provisional).toBe(true);
  });
  it("distinguishes state and city mandates", () => {
    const b = emptyBrief(); Object.assign(criterion(b, "geography"), { value: "Victoria", state: "specified", confirmed: true });
    expect(reviewMandateFit(b, { ...target, state: "VIC" }, initialAssessment).score).toBe(100);
    criterion(b, "geography").value = "Melbourne";
    expect(reviewMandateFit(b, { ...target, state: "VIC" }, initialAssessment).score).toBe(50);
    expect(reviewMandateFit(b, { ...target, state: "NSW" }, initialAssessment).score).toBe(0);
  });
  it("caps estimated matches at half credit", () => {
    const f = finding("headcount", "40 employees"); f.evidence.factMetadata!.basis = "third_party_estimate";
    expect(reviewMandateFit(brief(), target, initialAssessment, [f]).score).toBe(33);
  });
});


it("scores supplied criteria provisionally before review", () => {
  const b = brief(); criterion(b, "headcount").confirmed = false;
  const fit = reviewMandateFit(b, target, initialAssessment, [finding("headcount", "40 employees")]);
  expect(fit.provisional).toBe(true); expect(fit.assessed).toBe(true); expect(fit.score).toBe(67);
});
it("leaves a supplied mandate unassessed when evidence is absent", () => {
  const fit = reviewMandateFit(brief(), target, initialAssessment);
  expect(fit.score).toBe(0); expect(fit.reason).toContain("Missing evidence:");
  expect(fit.assessed).toBe(false); expect(fit.completeness).toBe(0);
});
it("scores inferred and assumed criteria from sparse data before review", () => {
  const b = brief();
  Object.assign(criterion(b, "headcount"), { origin: "inferred", confirmed: false });
  Object.assign(criterion(b, "revenue"), { origin: "assumed", confirmed: false });
  const sparse = reviewMandateFit(b, target, initialAssessment, [finding("revenue", "$3m", "AUD")]);
  expect(sparse.score).toBe(33); expect(sparse.completeness).toBe(33);
  expect(sparse.provisional).toBe(true); expect(sparse.reason).toContain("Missing evidence: Headcount range");
  expect(reviewMandateFit(b, target, initialAssessment, [finding("revenue", "$3m", "AUD"), finding("headcount", "40 employees")]).score).toBe(100);
});
it("uses waste services and named managers as partial evidence", () => {
  const b = emptyBrief();
  Object.assign(criterion(b, "subsectors"), { value: "Waste management and recycling services", state: "specified", confirmed: false });
  Object.assign(criterion(b, "management"), { value: "Key management already in place to ensure continuity", state: "specified", confirmed: false });
  const fit = reviewMandateFit(b, target, initialAssessment, [finding("product", "Hazardous waste collection"), finding("product", "Office supplies"), finding("person", "National Operations Manager")]);
  expect(fit.rows.map(row => row.status)).toEqual(["potential", "potential"]);
  expect(fit.score).toBe(50); expect(fit.reason).toContain("Hazardous waste collection"); expect(fit.reason).toContain("continuity");
});
it("normalises revenue punctuation while preserving currency uncertainty", () => {
  const fit = reviewMandateFit(brief(), target, initialAssessment, [finding("revenue", "$3,000,000.", "AUD")]);
  expect(fit.rows.find(row => row.key === "revenue")!.status).toBe("supported");
  expect(reviewMandateFit(brief(), target, initialAssessment, [finding("revenue", "$3,000,000.")]).assessed).toBe(false);
});
it("does not score findings flagged as ambiguous company identities", () => {
  const f = finding("headcount", "40 employees"); f.evidence.factMetadata!.identityNote = "Could be another company";
  expect(reviewMandateFit(brief(), target, initialAssessment, [f]).assessed).toBe(false);
});
