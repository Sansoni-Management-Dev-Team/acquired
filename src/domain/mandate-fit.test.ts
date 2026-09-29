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
function finding(kind: "headcount" | "revenue" | "location", value: string, currency: string | null = null): SavedResearchFinding {
  return { id: value, targetId: target.id, jobId: "job", observedAt: "2026-09-30T00:00:00Z", confidence: 90, sourceUrl: "https://example.com/profile", evidence: { kind, name: kind, value, quote: "Published company profile", website: "https://example.com", factMetadata: { sourceKind: "company_website", basis: "reported", scope: "unspecified", currency, identityNote: null, period: null } } };
}
describe("mandate fit review matrix", () => {
  it("weights requirements twice and leaves missing evidence at zero", () => {
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
  it("excludes unrestricted and unconfirmed criteria", () => {
    const b = brief(); criterion(b, "headcount").state = "unrestricted"; criterion(b, "revenue").confirmed = false;
    const fit = reviewMandateFit(b, target, initialAssessment);
    expect(fit.score).toBe(0); expect(fit.rows).toEqual([]); expect(fit.reason).toContain("Confirm mandate");
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
