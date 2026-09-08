import { describe, expect, it } from "vitest";
import { peopleFollowUpLinks, validatePeopleFindings } from "./people-research";
import type { ResearchConfig } from "./research";
const config = { companyName: "Example Instruments", companyDomain: "instruments.example.com" } as ResearchConfig;
const source = "https://instruments.example.com/team";
const candidate = { kind: "person", name: "Alex Example", value: "Managing Director", quote: "Alex Example is Managing Director of Example Instruments.", website: source };
describe("public business contact evidence", () => {
  it("requires literal support for both name and role", () => {
    expect(validatePeopleFindings([candidate], candidate.quote, source, config)).toHaveLength(1);
    expect(validatePeopleFindings([{ ...candidate, name: "Sam Invented" }], candidate.quote, source, config)).toEqual([]);
    expect(validatePeopleFindings([{ ...candidate, value: "Founder" }], candidate.quote, source, config)).toEqual([]);
    expect(validatePeopleFindings([candidate], "No people here", source, config)).toEqual([]);
  });
  it("requires company association in external profiles", () => {
    const quote = "Alex Example is Managing Director.";
    expect(validatePeopleFindings([{ ...candidate, quote }], quote, "https://directory.example.com/profile", config)).toEqual([]);
    expect(validatePeopleFindings([candidate], candidate.quote, "https://directory.example.com/profile", config)).toHaveLength(1);
  });
  it("does not invent email patterns or attach a general inbox to a person", () => {
    for (const email of ["alex@instruments.example.com", "info@instruments.example.com", "alex@personal.example.com"]) {
      const f = { ...candidate, email };
      expect(validatePeopleFindings([f], f.quote, source, config)[0].email).toBeUndefined();
    }
    const quote = candidate.quote + " Contact Alex Example: alex@instruments.example.com";
    expect(validatePeopleFindings([{ ...candidate, quote, email: "alex@instruments.example.com" }], quote, source, config)[0].email).toBe("alex@instruments.example.com");
    const general = candidate.quote + " General email info@instruments.example.com";
    expect(validatePeopleFindings([{ ...candidate, quote: general, email: "info@instruments.example.com" }], general, source, config)[0].email).toBeUndefined();
  });
  it("follows team and contact links but never login links or already visited pages", () => {
    expect(peopleFollowUpLinks("[Team](/team) [Contact](/contact) [Management login](/login) [Shop](/shop)", source, [source])).toEqual(["https://instruments.example.com/contact"]);
  });
});
