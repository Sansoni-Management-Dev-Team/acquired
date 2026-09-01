import { describe, expect, it } from "vitest";
import { createTargetDataProvider, resolveTargetDataProviderMode } from "./provider-mode";

describe("target data provider mode", () => {
  it("fails closed unless fixture or live is explicit", () => {
    expect(() => resolveTargetDataProviderMode(undefined)).toThrow(/explicitly set/);
    expect(() => resolveTargetDataProviderMode("test")).toThrow(/explicitly set/);
  });

  it("runs Places and Firmable fixture response shapes without network credentials", async () => {
    const provider = createTargetDataProvider("fixture");
    const places = await provider.places.searchText("building services in Melbourne", 3);
    const websitePlace = places.find((place) => place.website);
    expect(websitePlace).toBeTruthy();
    const company = await provider.firmable.enrichCompany({ fqdn: new URL(websitePlace!.website!).hostname });
    expect(company).toMatchObject({ id: expect.stringMatching(/^fixture-company-/), states: ["VIC"] });
    const candidates = await provider.firmable.searchPeople(String(company.id), { max: 5 });
    expect(candidates).toHaveLength(2);
    const person = await provider.firmable.enrichPerson({ id: candidates[0].id });
    expect(person).toMatchObject({ fictionalised: true, doNotContact: false });
    expect(person.email).toMatch(/example\.invalid$/);
  });
});
