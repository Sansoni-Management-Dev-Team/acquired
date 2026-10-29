import { expect, it } from "vitest";
import { mandateCompaniesHref, mandatePeopleHref, mandateTabHref } from "./mandate-navigation";

it("keeps the company, people and sequence flow under its mandate", () => {
  expect(mandateTabHref("mandate-1", "targets")).toBe("/mandates/mandate-1/companies");
  expect(mandateTabHref("mandate-1", "people")).toBe("/mandates/mandate-1/people");
  expect(mandateTabHref("mandate-1", "sequences")).toBe("/mandates/mandate-1/outreach/sequences");
  expect(mandatePeopleHref("a/b")).toBe("/mandates/a%2Fb/people");
});

it("sends legacy outreach navigation to people", () => {
  expect(mandateTabHref("mandate-1", "outreach")).toBe("/mandates/mandate-1/people");
});

it.each(['targets','companies','coverage','discover','pipeline'])('uses the canonical company path for %s navigation',tab=>{
 expect(mandateTabHref('a/b',tab)).toBe('/mandates/a%2Fb/companies');
});

it('keeps filters and selected company context on the canonical company path',()=>{
 const query=new URLSearchParams('tab=targets&targetId=company&page=2&search=water+pumps');
 expect(mandateCompaniesHref('a/b',query)).toBe('/mandates/a%2Fb/companies?targetId=company&page=2&search=water+pumps');
 expect(query.get('tab')).toBe('targets');
});
