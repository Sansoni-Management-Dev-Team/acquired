import { describe, expect, it } from "vitest";
import { mapFirmableCompany, mapFirmableRevenue } from "./firmable-mapper";
import { parseMandate } from "@/domain/mandate";

describe("Firmable mapping", () => {
  it("preserves vendor revenue as a band, never an invented number", () => {
    expect(mapFirmableRevenue(">$1B+", "2026-08-26T00:00:00Z")).toEqual(expect.objectContaining({ value: { kind: "band", label: ">$1B+" } }));
  });
  it("keeps missing revenue missing", () => expect(mapFirmableRevenue(null).value).toBeNull());

  it("maps an enriched company without inventing EBITDA", () => {
    const mandate = parseMandate("Find building services businesses in Melbourne with revenue $2m-$20m and at least $1m EBITDA");
    const response = {
      id: "f1", name: "Example Building Services", fqdn: "example.com", industries: ["Building services"],
      revenue: "$5M-$10M", au_employee_count: 42, year_founded: 1998, states: ["Victoria"], hq_location: "Scoresby VIC 3179",
      provider_only_field: { nested: ["retained", 7] },
    };
    const target = mapFirmableCompany(response, { id: "p1", name: "Example", formattedAddress: "Scoresby VIC 3179, Australia", website: "https://example.com" }, mandate, "org-1");
    expect(target.status).toBe("enriched");
    expect(target.revenue.value).toEqual({ kind: "band", label: "$5M-$10M" });
    expect(target.headcount.value).toBe(42);
    expect(target.ebitda.value).toBeNull();
    expect(target.ebitda.missingReason).toContain("does not provide EBITDA");
    expect(target.sourceData?.googlePlaces?.placeId).toBe("p1");
    expect(target.sourceData?.firmable).toEqual(expect.objectContaining({
      firmableId: "f1",
      domain: "example.com",
      industries: ["Building services"],
      capturedAt: expect.any(String),
      rawResponse: response,
    }));
  });

  it("uses structured Google locality and query evidence when Firmable returns a broad sector", () => {
    const mandate = parseMandate("I'm looking to buy an industrials or building-services business in Melbourne");
    const target = mapFirmableCompany({ id: "f2", name: "Industrial Building Specialists", industries: ["Construction"] }, {
      id: "p2", name: "Industrial Building Specialists", formattedAddress: "11-13 Tottenham Parade, West Footscray VIC 3012",
      website: "https://industrialbuilders.com.au", locality: "West Footscray", state: "VIC", primaryType: "general_contractor", types: ["general_contractor"],
    }, mandate, "org-1");
    expect(target.suburb).toBe("West Footscray");
    expect(target.sector).toEqual(expect.objectContaining({ value: "industrials", provenance: expect.objectContaining({ source: "Google Places query match" }) }));
  });

  it("uses Firmable headquarters when an imported target only has a state placeholder", () => {
    const mandate = parseMandate("Find businesses in Victoria");
    const target = mapFirmableCompany({ id: "f3", name: "Example", hq_location: "Melbourne, Victoria, Australia", states: null }, {
      id: "imported-1", name: "Example", formattedAddress: "VIC", state: "VIC",
    }, mandate, "org-1");

    expect(target.suburb).toBe("Melbourne");
    expect(target.state).toBe("VIC");
  });

  it("marks a missing Firmable headcount as checked but unavailable", () => {
    const mandate = parseMandate("Find businesses in Victoria");
    const target = mapFirmableCompany({ id: "f4", name: "No Count Example", employee_count: null, company_size: "No data available" }, {
      id: "p4", name: "No Count Example", formattedAddress: "VIC", state: "VIC",
    }, mandate, "org-1");

    expect(target.headcount).toEqual(expect.objectContaining({
      value: null,
      missingReason: "Not provided by Firmable",
      provenance: expect.objectContaining({ source: "Firmable" }),
    }));
  });
});
