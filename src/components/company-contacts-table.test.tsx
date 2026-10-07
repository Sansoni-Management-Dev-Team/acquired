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
it("gives available profiles one clear action without implying retrieval is running", () => {
  const html = renderToStaticMarkup(<CompanyContactsTable contacts={[]} availablePeopleCount={25} onLoadPeople={() => {}} />);
  expect(html).toContain("25 people ready to load");
  expect(html).toContain(">Load people</button>");
  expect(html).not.toContain("has not finished");
  expect(html).not.toContain("0 people");
});
it("only describes retrieval as running when a run is active and preserves saved people", () => {
  const html = renderToStaticMarkup(<CompanyContactsTable contacts={[contact]} availablePeopleCount={25} run={{id:"run", status:"running", profilesSaved:1}} onLoadPeople={() => {}} />);
  expect(html).toContain("Loading people…");
  expect(html).toContain("1 saved so far");
  expect(html).toContain("updates automatically");
  expect(html).toContain("You can close this panel");
  expect(html).toContain("Alex Owner");
  expect(html).not.toContain("<button");
});
it("offers retry after partial retrieval while retaining contacts", () => {
  const html = renderToStaticMarkup(<CompanyContactsTable contacts={[contact]} run={{id:"run",status:"partial"}} onLoadPeople={() => {}} />);
  expect(html).toContain("Some people couldn’t be loaded");
  expect(html).toContain(">Try again</button>");
  expect(html).toContain("Alex Owner");
});
it("distinguishes verified zero from unknown and avoids a futile load action", () => {
  const empty = renderToStaticMarkup(<CompanyContactsTable contacts={[]} availablePeopleCount={0} onLoadPeople={() => {}} />);
  expect(empty).toContain("No profiles available");
  expect(empty).not.toContain("<button");
  const unknown = renderToStaticMarkup(<CompanyContactsTable contacts={[]} onLoadPeople={() => {}} />);
  expect(unknown).toContain("Find people at this company");
  expect(unknown).toContain(">Load people</button>");
});
it("stops offering more retrieval when the run is complete", () => {
  const html = renderToStaticMarkup(<CompanyContactsTable contacts={[contact]} run={{id:"run",status:"complete"}} onLoadPeople={() => {}} />);
  expect(html).toContain("1 person loaded");
  expect(html).not.toContain("<button");
});
it("gives list-loading errors a retry action", () => {
  const html = renderToStaticMarkup(<CompanyContactsTable contacts={[]} error="Couldn’t load the list. Try again." onRetry={() => {}} />);
  expect(html).toContain('role="alert"');
  expect(html).toContain(">Try again</button>");
});

it("treats completed zero-profile retrieval as empty rather than failed", () => {
  const html = renderToStaticMarkup(<CompanyContactsTable contacts={[]} availablePeopleCount={0} run={{id:"run",status:"complete"}} onLoadPeople={() => {}} />);
  expect(html).toContain("No profiles available");
  expect(html).not.toContain("Try again");
});
