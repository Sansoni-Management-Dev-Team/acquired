import { describe, expect, it, vi } from "vitest";
vi.mock("./client", () => ({ requireDb: vi.fn() }));
import { storedFirmableContactSummary } from "./firmable-read-model";

describe("stored Firmable contact projection", () => {
  it("uses a stored full profile and respects phone DND", () => {
    const summary = storedFirmableContactSummary({ companyId: "c1", personId: "p1", searchRecord: { position: "Owner" }, profile: { name: "Example Owner", emails: { work: [{ value: "owner@example.test" }] }, phones: [{ value: "+61400000000", is_dnd: true }] } }, "target-1");
    expect(summary).toEqual({ targetId: "target-1", name: "Example Owner", role: "Owner", reachable: false });
  });

  it("keeps a search-only candidate visible without claiming it is reachable", () => {
    expect(storedFirmableContactSummary({ companyId: "c1", personId: "p2", searchRecord: { position: "Director" } }, "target-1")).toEqual({ targetId: "target-1", name: "Firmable candidate", role: "Director", reachable: false });
  });
});
