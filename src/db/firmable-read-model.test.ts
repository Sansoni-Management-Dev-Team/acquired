import { describe, expect, it, vi } from "vitest";
vi.mock("./client", () => ({ requireDb: vi.fn() }));
import { storedFirmableContactData, storedFirmableContactSummary } from "./firmable-read-model";

describe("stored Firmable contact projection", () => {
  it("uses a stored full profile and respects phone DND", () => {
    const summary = storedFirmableContactSummary({ companyId: "c1", personId: "p1", searchRecord: { position: "Owner" }, profile: { name: "Example Owner", emails: { work: [{ value: "owner@example.test" }] }, phones: [{ value: "+61400000000", is_dnd: true }] } }, "target-1");
    expect(summary).toEqual({ targetId: "target-1", name: "Example Owner", role: "Owner", reachable: false });
  });

  it("keeps a search-only candidate visible without claiming it is reachable", () => {
    expect(storedFirmableContactSummary({ companyId: "c1", personId: "p2", searchRecord: { position: "Director" } }, "target-1")).toEqual({ targetId: "target-1", name: "Decision-maker candidate", role: "Director", reachable: false });
  });
});

it("RC-14-integration: shared read model uses the same validated personal-email fallback as ingestion", () => {
  const person = { companyId: "c", personId: "p", searchRecord: {}, profile: { emails: { work: [{ value: "invalid" }], personal: [{ email: "owner@example.test" }] } } };
  expect(storedFirmableContactData(person).email).toBe("owner@example.test");
  expect(storedFirmableContactSummary(person, "t").reachable).toBe(true);
});
it("RC-13-integration: a no-phone request cannot reveal an unexpected raw phone through shared history", () => {
  const person = { companyId: "c", personId: "p", searchRecord: { has_phone: true }, profile: { phone: "+61400000000" }, profileRequest: { query: { includePhones: "false" } } };
  expect(storedFirmableContactData(person).phone).toBeUndefined();
  expect(storedFirmableContactData({ ...person, profileRequest: { query: {} } }).phone).toBe("+61400000000");
});
