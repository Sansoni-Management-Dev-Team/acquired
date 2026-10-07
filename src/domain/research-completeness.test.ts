import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { emptyBrief, initialAssessment, criterionDefinitions, type MembershipView } from "./acquisition";
import { mapFirmableProfile } from "@/adapters/firmable-company-mapper";
import { rankTarget } from "./scoring";
import { companyCompleteness, completenessFields } from "./research-completeness";
const brief = emptyBrief();
const filters = { sectors: ["Industrial cleaning"], states: ["VIC"], revenue: { min: 0, max: null }, ebitda: { min: 0, max: null } };
function member(): MembershipView {
  return { target: rankTarget(mapFirmableProfile({ id: "synthetic", name: "Synthetic", website: "https://example.test", employee_count: 114, revenue: "$10M", region: { AU: { employee_count: 0, address: { state: "VIC", suburb: "Melbourne" }, revenue: { 10: "No data available" } } } }, filters, "org"), filters), assessment: initialAssessment, accreditations: [], version: 1 };
}
it("RC-05/06 reporting integration: every incident catalogue field and future criterion has exactly one cell", () => {
  const catalogue = JSON.parse(readFileSync("docs/research-correctness/completeness-catalogue.json", "utf8"));
  expect([...completenessFields].sort()).toEqual(catalogue.fields.map((f: { field: string }) => f.field).sort());
  const report = companyCompleteness(member(), brief);
  expect(new Set(report.cells.map(c => c.field)).size).toBe(53);
  for (const [key] of criterionDefinitions) expect(report.cells.some(c => c.field === `Mandate criterion: ${key}`)).toBe(true);
  expect(report.cells.find(c => c.field === "AU headcount")).toMatchObject({ value: 0, status: "reported", scope: "AU" });
  expect(report.cells.find(c => c.field === "AU revenue band")).toMatchObject({ value: null, status: "unavailable" });
  expect(report.cells.find(c => c.field === "Bankability: DSCR at stress")).toMatchObject({ value: null, status: "unattempted" });
  expect(report.cells.find(c => c.field === "Saved EBITDA")).toMatchObject({ value: null, status: "unavailable" });
  expect(Object.values(report.counts).reduce((n, count) => n + count, 0)).toBe(53);
});
it("RC-13/14 report reconciles actual values without exposing personal contact values", () => {
  const report = companyCompleteness(member(), brief, { contacts: [{ email: "private@example.test", phoneAvailable: true, phoneLookupStatus: "not_requested" }, { emailLookupStatus: "unavailable", phone: "private-number" }] });
  expect(report.cells.find(c => c.field === "Contact email")?.value).toEqual({ saved: 1, sourceUnavailable: 1, unknown: 0 });
  expect(report.cells.find(c => c.field === "Contact saved phone")?.value).toBe(1);
  expect(report.cells.find(c => c.field === "Contact phone availability")?.value).toEqual({ advertised: 2, manualLookupRequired: 1 });
  expect(JSON.stringify(report)).not.toContain("private@example.test");
  expect(JSON.stringify(report)).not.toContain("private-number");
});
it("RC-15 reporting: a reported ABN candidate does not count as registry verified", () => {
  const m = member(); m.target.abn = "12345678901";
  expect(companyCompleteness(m, brief).cells.find(c => c.field === "ABN")?.status).toBe("reported");
  m.target.sourceData = { ...m.target.sourceData, abnVerification: { status: "matched", operationalStatus: "complete", missingReason: null } };
  expect(companyCompleteness(m, brief).cells.find(c => c.field === "ABN")?.status).toBe("verified");
});
it("RC-07 reporting separates incomplete website reads from successfully read undisclosed fields", () => {
  const m = member();
  const provider = m.target.sourceData!.firmable!;
  provider.description = undefined;
  provider.rawResponse = { ...provider.rawResponse, websiteResearch: { status: "failed", fields: { description: "research_incomplete", revenue: "research_incomplete" } } };
  const failed = companyCompleteness(m, brief);
  expect(failed.cells.find(c => c.field === "Description")).toMatchObject({ status: "failed", value: null, reason: "Website research failed; no retained evidence for this field" });
  expect(failed.cells.find(c => c.field === "AU revenue band")?.status).toBe("failed");
  expect(failed.cells.find(c => c.field === "AU headcount")).toMatchObject({ status: "reported", value: 0 });
  provider.rawResponse.websiteResearch = { status: "complete", fields: { description: "not_disclosed", revenue: "not_disclosed" } };
  expect(companyCompleteness(m, brief).cells.find(c => c.field === "Description")?.status).toBe("unavailable");
});
