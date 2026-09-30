import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { SavedResearchFinding } from "@/domain/research";
import { CompanyContactsTable, companyContactRows } from "./company-contacts-table";
const finding: SavedResearchFinding = { id: "finding", jobId: "job", targetId: "target", sourceUrl: "https://example.com/team", observedAt: "2026-09-30", confidence: 0.5, evidence: { kind: "person", name: "Alex Owner", value: "Managing Director", quote: "Alex is our managing director", website: "https://example.com", email: "alex@example.com" } };
const contact = { id: "contact", displayName: "Alex Owner", role: "Owner", email: "alex@example.com", phone: "+61 400 000 000", fictionalised: false, doNotContact: true };
it("merges matching saved and researched people without losing details or contact restrictions", () => {
  const rows = companyContactRows([contact], [finding, { ...finding, id: "other-source", sourceUrl: "https://example.com/about" }]);
  expect(rows).toHaveLength(1);
  expect(rows[0].roles).toEqual(["Owner", "Managing Director"]);
  expect(rows[0].sources).toHaveLength(2);
  expect(rows[0].phone).toBe(contact.phone);
  expect(rows[0].status).toBe("Do not contact");
});
it("retains distinct people with the same name and different emails", () => {
  expect(companyContactRows([contact], [{ ...finding, evidence: { ...finding.evidence, email: "another@example.com" } }])).toHaveLength(2);
});
it("shows research leads even before they are saved as contacts", () => {
  const html = renderToStaticMarkup(<CompanyContactsTable contacts={[]} findings={[finding]} />);
  for (const value of ["Alex Owner", "Managing Director", "alex@example.com", "Research lead · unverified", 'href="https://example.com/team"']) expect(html).toContain(value);
  for (const removed of ["Generate", "Preview", "Saved business", "Find a decision-maker"]) expect(html).not.toContain(removed);
});
