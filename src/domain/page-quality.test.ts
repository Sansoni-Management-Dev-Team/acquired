import { expect, it } from "vitest";
import { unusablePage } from "./page-quality";
it("rejects empty and HTTP-200 access-denied content, without rejecting real company pages", () => {
  expect(unusablePage("")).toBeTruthy();
  expect(unusablePage('---\ntitle: "Access to this page has been denied"\nmeta:\n description: px-captcha\n---')).toBeTruthy();
  expect(unusablePage("Example Instruments manufactures sensors. Contact our team for catalogue details.")).toBeNull();
});
