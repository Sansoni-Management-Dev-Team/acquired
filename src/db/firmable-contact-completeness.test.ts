import { describe, expect, it, vi } from "vitest";
vi.mock("./client", () => ({ requireDb: vi.fn() }));
import { mapFirmablePerson } from "@/adapters/firmable-client";
import { firmableContactValues } from "./firmable-contacts";

describe("RC-13/RC-14 contact values and source coverage", () => {
  it("RC-13-regression: provider phone availability is separate from a saved phone", () => {
    const person = mapFirmablePerson({ id: "p", emails: { work: [], personal: [] }, phones: [] }, { id: "p" }, false);
    const saved = firmableContactValues(person, { id: "p", phoneAvailable: true, emailAvailable: true }, "c");
    expect(saved.personalData).toMatchObject({ phonePotentiallyAvailable: true, phoneSaved: false, emailSaved: false, emailLookupStatus: "unavailable" });
    expect(saved.personalData.phone).toBeUndefined();
  });
  it.each([
    [{ work: [], personal: [] }, undefined, "unavailable"],
    [{ work: [{ value: "person@example.test" }] }, "person@example.test", "reported"],
    [{ personal: ["personal@example.test"] }, "personal@example.test", "reported"],
    [{ work: ["malformed"], personal: ["valid@example.test"] }, "valid@example.test", "reported"],
    [undefined, undefined, "not_reported"],
  ])("RC-14-generalization: classify actual upstream email evidence %j", (emails, email, status) => {
    const person = mapFirmablePerson({ id: "p", emails }, { id: "p" }, false);
    expect(person.email || undefined).toBe(email);
    expect(person).toMatchObject({ emailLookupStatus: status });
    expect(firmableContactValues(person, undefined, "c").personalData).toMatchObject({ emailLookupStatus: status, emailSaved: Boolean(email) });
  });
});
