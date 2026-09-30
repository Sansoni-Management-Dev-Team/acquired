import { expect, it } from "vitest";
import { mandatePeopleHref, mandateTabHref } from "./mandate-navigation";

it("keeps the company, people and sequence flow under its mandate", () => {
  expect(mandateTabHref("mandate-1", "targets")).toBe("/mandates/mandate-1?tab=targets");
  expect(mandateTabHref("mandate-1", "people")).toBe("/mandates/mandate-1/people");
  expect(mandateTabHref("mandate-1", "sequences")).toBe("/mandates/mandate-1/outreach/sequences");
  expect(mandatePeopleHref("a/b")).toBe("/mandates/a%2Fb/people");
});

it("sends legacy outreach navigation to people", () => {
  expect(mandateTabHref("mandate-1", "outreach")).toBe("/mandates/mandate-1/people");
});
