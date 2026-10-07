import { expect, it } from "vitest";
import { contactCompleteness } from "./contact-completeness";

it.each([true, false, undefined])("RC-13-generalization: legacy availability %s cannot establish saved coverage", flag => {
  const data = contactCompleteness({ phoneAvailable: flag, phoneSaved: true });
  expect(data.phone.saved).toBe(false);
  expect(data.phone.status).toBe("not_reported");
  expect(data.phone.potentiallyAvailable).toBe(flag === true);
});
it("RC-14-regression: an empty provider email differs from unattempted source research", () => {
  expect(contactCompleteness({ emailLookupStatus: "unavailable", emailAvailable: true }).email).toMatchObject({ saved: false, status: "unavailable", reason: "Not supplied by the source" });
  expect(contactCompleteness({}).email).toMatchObject({ saved: false, status: "not_reported", reason: "Source coverage unknown" });
});
it("saved values override stale flags and missing-value statuses", () => {
  expect(contactCompleteness({ email: " owner@example.test ", phone: "123", emailLookupStatus: "unavailable", phoneLookupStatus: "not_requested" })).toMatchObject({ email: { saved: true, status: "reported" }, phone: { saved: true, status: "reported" } });
});
