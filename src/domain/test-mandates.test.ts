import { describe, expect, it } from "vitest";
import { testMandates } from "./test-mandates";

describe("saved test mandate pool", () => {
  it("contains the saved and 15 new valid, distinct briefs", () => {
    expect(testMandates).toHaveLength(30);
    expect(new Set(testMandates.map(brief => brief.name)).size).toBe(30);
    expect(testMandates.every(brief => brief.name.startsWith("Test mandate"))).toBe(true);
  });
});
