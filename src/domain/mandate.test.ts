import { describe, expect, it } from "vitest";
import { mandateConfirmation, parseMandate } from "./mandate";

describe("parseMandate", () => {
  it("extracts states and financial ranges", () => {
    const result = parseMandate("Find industrial maintenance businesses in Victoria and NSW with revenue $10m to $50m and EBITDA $1m-$5m, headcount 20-180");
    expect(result.states).toEqual(expect.arrayContaining(["VIC", "NSW"]));
    expect(result.revenue).toEqual({ min: 10_000_000, max: 50_000_000 });
    expect(result.ebitda).toEqual({ min: 1_000_000, max: 5_000_000 });
    expect(result.headcount).toEqual({ min: 20, max: 180 });
    expect(mandateConfirmation(result)).toContain("$10m–$50m");
  });

  it("understands a natural-language acquisition query with city and minimum EBITDA", () => {
    const result = parseMandate("I'm looking to buy an industrials or building-services business in Melbourne doing $2–20m revenue with at least $1m EBITDA.");
    expect(result.sectors).toEqual(["industrials", "building services"]);
    expect(result.locations).toEqual(["Melbourne"]);
    expect(result.states).toEqual(["VIC"]);
    expect(result.revenue).toEqual({ min: 2_000_000, max: 20_000_000 });
    expect(result.ebitda).toEqual({ min: 1_000_000, max: null });
  });
});
