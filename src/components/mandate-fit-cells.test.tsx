import {mapFirmableProfile} from '@/adapters/firmable-company-mapper';
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { criterion, emptyBrief, initialAssessment, briefToMandate } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import { defaultMandate, seedTargets } from "@/test/fixtures/scoring-targets";
import { MandateFitCells } from "./mandate-fit-cells";

it("renders the fit percentage and reason without a matrix disclosure", () => {
  const brief = emptyBrief();
  Object.assign(criterion(brief, "management"), { state: "specified", confirmed: true, value: "General manager in place", importance: "requirement" });
  const html = renderToStaticMarkup(<table><tbody><tr><MandateFitCells brief={brief} member={{ target: rankTarget(seedTargets[0], defaultMandate), assessment: { ...initialAssessment, evidence: [{ criterionKey: "management", assessment: "supported", kind: "document-verified", value: "Experienced general manager", source: "Company report", sourceUrl: "https://example.com/report", capturedAt: "2026-09-30T00:00:00Z", confidence: 90, nextStep: "" }] }, accreditations: [], version: 1 }} /></tr></tbody></table>);
  expect(html).toContain("100%");
  expect(html).toContain("Matches:");
  expect(html).toContain("Management in place");
  expect(html).not.toContain("View fit matrix");
  expect(html).not.toContain("<details");
  expect(html).toContain('<button type="button"');
});


it("shows Not assessed rather than zero fit when there are no criteria", () => {
  const html = renderToStaticMarkup(<table><tbody><tr><MandateFitCells brief={emptyBrief()} member={{ target: rankTarget(seedTargets[0], defaultMandate), assessment: initialAssessment, accreditations: [], version: 1 }} /></tr></tbody></table>);
  expect(html).toContain("Not assessed"); expect(html).toContain("Criteria need review"); expect(html).not.toContain("0%");
});

it("shows Not assessed and missing evidence for specified criteria without company data", () => {
  const brief = emptyBrief();
  Object.assign(criterion(brief, "management"), { state: "specified", origin: "assumed", value: "General manager in place", confirmed: false });
  const html = renderToStaticMarkup(<table><tbody><tr><MandateFitCells brief={brief} member={{ target: rankTarget(seedTargets[0], defaultMandate), assessment: initialAssessment, accreditations: [], version: 1 }} /></tr></tbody></table>);
  expect(html).not.toContain("0% assessed"); expect(html).toContain("Missing evidence:"); expect(html).toContain("Management in place");
  expect(html).toContain("Not assessed"); expect(html).not.toContain("Criteria need review");
});

it('labels half-credit-only provider evidence as a provisional match and shows company-specific facts',()=>{
 const brief=emptyBrief();for(const [key,value]of [['geography','QLD'],['headcount','25–100'],['revenue','AUD 5000000–18000000']]as const)Object.assign(criterion(brief,key),{state:'specified',value,importance:'requirement'});
 const candidate=mapFirmableProfile({name:'Synthetic Pump Services',website:'https://pump.example.test',hq_country:'AU',revenue:'$5M - $10M',region:{AU:{employee_count:60,address:{state:'Victoria'},locations:[{name:'Queensland, QLD'}]}}},briefToMandate(brief),'synthetic-org');
 const html=renderToStaticMarkup(<table><tbody><tr><MandateFitCells brief={brief} member={{target:rankTarget(candidate,briefToMandate(brief)),assessment:initialAssessment,accreditations:[],version:1}}/></tr></tbody></table>);
 expect(html).toContain('Provisional match');expect(html).not.toContain('>50%</p>');expect(html).toContain('100% of criteria assessed');expect(html).toContain('60 Australian employees');expect(html).toContain('Reported operating states:');expect(html).toContain('$5M - $10M');expect(html).not.toContain('sector: comparable sourced evidence');
});
