import { expect, it } from "vitest";
import { reviewedOutreachSignals } from "./reviewed-outreach-evidence";
import type { MembershipView } from "./acquisition";
it("carries reviewed public capabilities forward without private screening answers", () => {
  const base = { assessment: "supported", kind: "website", sourceUrl: "https://instruments.example.com/products", value: "Manufactures calibration instruments", source: "Company website", capturedAt: "2026-09-08T00:00:00.000Z", confidence: 70 };
  const member = { target: { id: "example" }, assessment: { evidence: [{ ...base, criterionKey: "subsectors" }, { ...base, criterionKey: "revenue", value: "Private estimate" }, { ...base, criterionKey: "subsectors", assessment: "unknown" }, { ...base, criterionKey: "subsectors", kind: "owner-stated" }] } } as unknown as MembershipView;
  const signals = reviewedOutreachSignals(member);
  expect(signals).toHaveLength(1); expect(signals[0].value).toBe(base.value); expect(signals[0].provenance.sourceUrl).toBe(base.sourceUrl);
});
