import { describe, expect, it } from "vitest";
import { fictionalisePersonalData } from "./fictionalise";

describe("fictionalisePersonalData", () => {
  it("is stable and removes source personal values", () => {
    const source = { name: "Real Person", email: "real@example.com", mobile: "0400000000", linkedinUrl: "https://linkedin.com/in/real" };
    expect(fictionalisePersonalData(source)).toEqual(fictionalisePersonalData(source));
    expect(JSON.stringify(fictionalisePersonalData(source))).not.toContain("Real Person");
    expect(fictionalisePersonalData(source).email).toMatch(/example\.invalid$/);
  });
});
