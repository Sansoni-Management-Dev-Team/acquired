import { describe, expect, it } from "vitest";
import { mapFirmableRevenue } from "./firmable-mapper";

describe("Firmable mapping", () => {
  it("preserves vendor revenue as a band, never an invented number", () => {
    expect(mapFirmableRevenue(">$1B+", "2026-08-26T00:00:00Z")).toEqual(expect.objectContaining({ value: { kind: "band", label: ">$1B+" } }));
  });
  it("keeps missing revenue missing", () => expect(mapFirmableRevenue(null).value).toBeNull());
});
