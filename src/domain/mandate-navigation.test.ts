import { expect, it } from "vitest";
import { mandateOutreachHref, mandateTabHref } from "./mandate-navigation";
it("keeps all navigation under its mandate and retains outreach deep links", () => {
  expect(mandateTabHref("mandate-1", "outreach")).toBe("/mandates/mandate-1/outreach");
  expect(mandateTabHref("mandate-1", "targets")).toBe("/mandates/mandate-1?tab=targets");
  expect(mandateOutreachHref("mandate-1", "target-2")).toBe("/mandates/mandate-1/outreach?targetId=target-2");
  expect(mandateOutreachHref("a/b", "x&tab=brief")).toBe("/mandates/a%2Fb/outreach?targetId=x%26tab%3Dbrief");
});
