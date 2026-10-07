import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { initialAssessment, type MembershipView } from "@/domain/acquisition";
import { rankTarget } from "@/domain/scoring";
import { defaultMandate, seedTargets } from "@/test/fixtures/scoring-targets";
import { CompanyInfoSummary } from "./company-info-summary";

function member(): MembershipView {
  return { target: rankTarget(seedTargets[0], defaultMandate), assessment: initialAssessment, accreditations: [], version: 1 };
}
it("preserves obtained company facts without workflow or contact data", () => {
  const html = renderToStaticMarkup(<CompanyInfoSummary member={member()} />);
  for (const value of ["74", "$24,800,000", "Mechanical services", "Dandenong South", "1989"]) expect(html).toContain(value);
  for (const removed of ["Stage", "Status", "criteria tested", "Key decision-makers", "Unknown"]) expect(html).not.toContain(removed);
});
it("omits missing financials and unavailable estimates instead of inventing data", () => {
  const initial = member();
  initial.target.headcount = { value: null, provenance: { ...initial.target.headcount.provenance, source: "Firmable" } };
  initial.target.revenue = { ...initial.target.revenue, value: null };
  initial.target.ebitda = { ...initial.target.ebitda, value: null };
  const html = renderToStaticMarkup(<CompanyInfoSummary member={initial} />);
  for (const removed of ["Headcount", "Revenue", "EBITDA", "No data available", "Unknown", "$0"]) expect(html).not.toContain(removed);
});
it("shows a clear empty state when no company facts have been obtained", () => {
  const initial = member();
  initial.target.headcount.value = null;
  initial.target.revenue.value = null;
  initial.target.ebitda.value = null;
  initial.target.establishedYear.value = null;
  initial.target.sector.value = null;
  initial.target.state = "Unknown";
  initial.target.suburb = "";
  const html = renderToStaticMarkup(<CompanyInfoSummary member={initial} />);
  expect(html).toContain("No company details found yet.");
  expect(html).not.toContain("Unknown");
});
it("renders expanded persisted company facts independently of employee and contact counts", () => {
  const initial = member();
  initial.target.sourceData = { firmable: {firmableId: "f1", industries: [], states: [], locations: [], keywords: ["water treatment"], acn: "609047878", companySize: "11 - 50", companyEmails: ["info@example.com"], companyPhones: ["07 3608 7889"], availablePeopleCount: 0, companyDetails: {address: {full_address: "29 Lathe Street"}, locations: [{name: "Virginia, QLD"}]}, rawResponse: {industry_codes: {naics: "5416", sic: "8711"}}} };
  const html = renderToStaticMarkup(<CompanyInfoSummary member={initial} />);
  for (const value of ["609047878", "info@example.com", "07 3608 7889", "11 - 50", "29 Lathe Street", "Virginia, QLD", "5416", "8711", "water treatment", "Available people profiles"]) expect(html).toContain(value);
  expect(html).toContain('>0</dd>');
});
