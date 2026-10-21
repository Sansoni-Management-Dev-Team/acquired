import { describe, expect, it } from "vitest";
import { assessmentSchema, briefSchema, briefToMandate, criterion, emptyBrief, initialAssessment, searchReadiness, transitionErrors, worksheet, indicativeMultiple, type AcquisitionBrief, type CriterionEvidence } from "./acquisition";
import { parseMandate } from "@/test/fixtures/legacy-mandate-parser";
import { publicBuyerProfile } from "./buyer-profile";
import { rankTarget } from "./scoring";
import { assessMembership } from "./mandate-assessment";
import { defaultMandate, seedTargets } from "@/test/fixtures/scoring-targets";
function brief(): AcquisitionBrief {
  const b = emptyBrief();
  for (const c of b.criteria) { c.state = "unrestricted"; c.confirmed = true; }
  Object.assign(criterion(b, "subsectors"), { state: "specified", value: "Packaging equipment; specialist distribution", importance: "requirement" });
  Object.assign(criterion(b, "geography"), { state: "specified", value: "National", importance: "requirement" });
  return b;
}
const evidence: CriterionEvidence = { criterionKey: "subsectors", assessment: "supported", kind: "register", value: "Packaging equipment capability confirmed", source: "Fictional capability register", sourceUrl: "https://register.example/entry", capturedAt: "2026-09-01T00:00:00.000Z", confidence: 90, nextStep: "" };

describe("mandate journey", () => {
  it("does not supply a missing geography or financial criterion", () => {
    const parsed = parseMandate("Find packaging businesses with sustainable EBITDA and revenue");
    expect(parsed.states).toEqual([]);
    expect(parsed.unknownFields).toEqual(expect.arrayContaining(["geography", "revenue", "ebitda"]));
    expect(searchReadiness(emptyBrief())).toHaveLength(2);
  });
  it("extracts a minimum with no invented ceiling", () => {
    const parsed = parseMandate("Find packaging businesses nationally with revenue $4m+ and headcount 25-60");
    expect(parsed.revenue).toEqual({ min: 4e6, max: null });
    expect(parsed.states).toHaveLength(8);
  });
  it("requires review of inferred or testing geography before searching", () => {
    const b = brief(); criterion(b,"geography").origin = "assumed"; criterion(b,"geography").confirmed = false;
    expect(searchReadiness(b)).toHaveLength(1);
    criterion(b,"geography").confirmed = true;
    expect(searchReadiness(b)).toEqual([]);
  });
  it("keeps alternative sub-sectors and unrestricted criteria distinct from unknown", () => {
    const b = brief(); criterion(b,"revenue").state = "unknown";
    const m = briefToMandate(b);
    expect(m.sectors).toEqual(["Packaging equipment", "specialist distribution"]);
    expect(m.unknownFields).toContain("revenue");
    expect(m.unknownFields).not.toContain("ebitda");
  });
  it("validates every criterion and rejects reversed money ranges", () => {
    const b = brief(); Object.assign(criterion(b,"revenue"), { state: "specified", value: "$12m to $3m" });
    expect(briefSchema.safeParse(b).success).toBe(false);
    b.criteria[0] = b.criteria[1];
    expect(briefSchema.safeParse(b).success).toBe(false);
  });
  it("allows shortlisting while owner questions remain unknown", () => {
    expect(transitionErrors(emptyBrief(), { ...initialAssessment, stage: "shortlisted" })).toEqual([]);
    expect(transitionErrors(emptyBrief(), { ...initialAssessment, stage: "qualified", qualificationConfirmed: true })).not.toEqual([]);
  });
  it("requires supported hard criteria for qualification", () => {
    const b = brief(); criterion(b,"geography").state = "unrestricted";
    expect(transitionErrors(b,{ ...initialAssessment, stage: "qualified", qualificationConfirmed: true, evidence: [evidence] })).toEqual([]);
    expect(transitionErrors(b,{ ...initialAssessment, stage: "qualified", qualificationConfirmed: true, evidence: [{...evidence, kind: "modelled"}] })).not.toEqual([]);
  });
  it("requires a reason for parking or exclusion", () => {
    expect(transitionErrors(brief(), { ...initialAssessment, stage: "parked" })).toHaveLength(1);
    expect(transitionErrors(brief(), { ...initialAssessment, stage: "excluded", reason: "Verified capability mismatch" })).toEqual([]);
  });
  it("rejects evidence without a source or duplicate current assessments", () => {
    expect(assessmentSchema.safeParse({ ...initialAssessment, evidence: [{ ...evidence, source: "" }] }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...initialAssessment, evidence: [evidence,evidence] }).success).toBe(false);
  });
  it("keeps missing company evidence unknown instead of passing it", () => {
    const rows = worksheet(brief(), rankTarget(seedTargets[2], defaultMandate), initialAssessment);
    expect(rows.find(r => r.criterionKey === "management")?.assessment).toBe("unknown");
    expect(rows.find(r => r.criterionKey === "revenue")?.assessment).toBe("unknown");
  });
  it("does not hard-exclude estimated sector mismatches", () => {
    const b = brief();
    const result = assessMembership(rankTarget(seedTargets[0],defaultMandate), b, { ...initialAssessment, evidence: [{ ...evidence, assessment: "fails", kind: "inferred" }] }, null);
    expect(result.scores.qualification).not.toBe("excluded");
    const supported = assessMembership(rankTarget(seedTargets[0],defaultMandate), b, { ...initialAssessment, evidence: [{ ...evidence, assessment: "fails" }] }, null);
    expect(supported.scores.qualification).toBe("excluded");
  });
  it("keeps pipeline state and assessments independent for the same company", () => {
    const target = rankTarget(seedTargets[0],defaultMandate);
    const a = assessMembership(target,brief(), { ...initialAssessment, stage: "shortlisted", evidence: [evidence] },null);
    const b = assessMembership(target,brief(), { ...initialAssessment, stage: "excluded", reason: "Not adjacent", evidence: [{...evidence, assessment: "fails"}] },null);
    expect(a.scores.qualification).toBe("develop"); expect(b.scores.qualification).toBe("excluded"); expect(target.scores.qualification).toBe("priority");
  });
  it("does not claim bankability without buyer and structure evidence", () => {
    expect(assessMembership(rankTarget(seedTargets[0],defaultMandate),brief(),initialAssessment,null).scores.financeability).toBeNull();
    const sparse = rankTarget({ ...seedTargets[0], financeability: { gmInPlace: seedTargets[0].financeability!.gmInPlace } },defaultMandate);
    expect(sparse.scores.financeability).toBeNull(); expect(sparse.scores.completeness?.bankability).toBe(15);
  });
  it("allows only approved public fields into the drafting payload", () => {
    const profile = { senderName: "Alex", signature: "Alex", background: "Operator", investmentThesis: "Public introduction", operatingIntent: "Long-term operation", callToAction: "Talk?", capitalAvailable: "PRIVATE AMOUNT", fundingForm: "PRIVATE FUNDING", buyerType: "trade" as const };
    const output = publicBuyerProfile(profile, "Approved adjacency");
    expect(JSON.stringify(output)).not.toContain("PRIVATE"); expect(output.about).toContain("Approved adjacency");
  });
  it("calculates indicative multiples without conflating earnings bases", () => {
    expect(indicativeMultiple({ price: 9e6, earnings: 1.5e6 } as Parameters<typeof indicativeMultiple>[0])).toBe(6);
  });
});

it("does not infer seller ripeness from general company facts", () => {
  const target = { ...rankTarget(seedTargets[0],defaultMandate), signals: [{ id: "industry", kind: "industry_focus", value: "Packaging equipment", weight: "high" as const, direction: "positive" as const, provenance: { source: "Fictional provider", capturedAt: "2026-09-01T00:00:00.000Z", confidence: 90 } }] };
  const result = assessMembership(target,brief(),initialAssessment,null);
  expect(result.scores.ripeness).toBe(0);
  expect(result.scores.completeness?.ripeness).toBe(0);
  expect(result.signals).toHaveLength(1);
});
