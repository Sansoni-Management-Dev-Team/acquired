import { describe, expect, it } from "vitest";
import { mandateConfirmation, parseMandate } from "./legacy-mandate-parser";

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

  it("recognises common manufacturing search phrases", () => {
    expect(parseMandate("I'm looking for manufacturing businesses in Victoria").sectors).toEqual(["manufacturing"]);
    expect(parseMandate("Find food manufacturers in NSW").sectors).toEqual(["food manufacturing"]);
    expect(parseMandate("Manufacturers in Queensland").sectors).toEqual(["Manufacturing"]);
  });

  it("drops size, location and ownership descriptors from sectors", () => {
    const result = parseMandate("To acquire a small to medium sized Australian specialty food manufacturing business, established and profitable");
    expect(result.sectors).toEqual(["specialty food manufacturing"]);
  });

  it("keeps the noun for each alternative in a list", () => {
    const result = parseMandate("We are looking to acquire a craft beverage producer or artisan confectioner and a small bakery");
    expect(result.sectors).toEqual(["craft beverage producer", "artisan confectioner", "bakery"]);
  });

  it("drops city and state names from sector lists", () => {
    expect(parseMandate("Seeking to acquire a boutique artisan bakery business in Sydney").sectors).toEqual(["artisan bakery"]);
    expect(parseMandate("Looking for a food manufacturer or craft brewery in Melbourne").sectors).toEqual(["food manufacturing", "craft brewery"]);
  });

  it("extracts mixed role variants from a full brief", () => {
    const result = parseMandate("Looking to acquire a small to medium sized sustainable packaging manufacturer or eco-friendly packaging supplier, revenue $10m+");
    expect(result.sectors).toEqual(["sustainable packaging manufacturing", "eco friendly packaging supplier"]);
    expect(result.revenue).toEqual({ min: 10_000_000, max: null });
  });
});
