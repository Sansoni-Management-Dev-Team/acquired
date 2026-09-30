import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { criterion, emptyBrief, initialAssessment } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import { defaultMandate, seedTargets } from "@/test/fixtures/scoring-targets";
import { MandateFitCells } from "./mandate-fit-cells";

it("renders the fit percentage and reason without a matrix disclosure", () => {
  const brief = emptyBrief();
  Object.assign(criterion(brief, "management"), { state: "specified", confirmed: true, value: "General manager in place", importance: "requirement" });
  const html = renderToStaticMarkup(<table><tbody><tr><MandateFitCells brief={brief} member={{ target: rankTarget(seedTargets[0], defaultMandate), assessment: { ...initialAssessment, evidence: [{ criterionKey: "management", assessment: "supported", kind: "document-verified", value: "Experienced general manager", source: "Company report", sourceUrl: "https://example.com/report", capturedAt: "2026-09-30T00:00:00Z", confidence: 90, nextStep: "" }] }, accreditations: [], version: 1 }} /></tr></tbody></table>);
  expect(html).toContain("100%");
  expect(html).toContain("Matches: Management in place");
  expect(html).not.toContain("View fit matrix");
  expect(html).not.toContain("<details");
  expect(html).toContain('<button type="button"');
});


it("shows Not assessed rather than zero fit when there are no criteria", () => {
  const html = renderToStaticMarkup(<table><tbody><tr><MandateFitCells brief={emptyBrief()} member={{ target: rankTarget(seedTargets[0], defaultMandate), assessment: initialAssessment, accreditations: [], version: 1 }} /></tr></tbody></table>);
  expect(html).toContain("Not assessed"); expect(html).toContain("Criteria need review"); expect(html).not.toContain("0%");
});
