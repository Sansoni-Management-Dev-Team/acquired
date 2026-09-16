import { describe, expect, it } from "vitest";
import { publicResearchTermVariants } from "./discovery-queries";

describe("publicResearchTermVariants", () => {
  it("turns a manufacturing sector into public-facing search terms", () => {
    expect(publicResearchTermVariants(["specialty food manufacturing"])).toEqual([
      "specialty food manufacturer",
      "specialty food producers",
    ]);
  });

  it("keeps role nouns as-is", () => {
    expect(publicResearchTermVariants(["eco friendly packaging supplier"])).toEqual([
      "eco friendly packaging supplier",
    ]);
  });

  it("strips parenthetical detail and caps the total", () => {
    const terms = publicResearchTermVariants([
      "specialty food manufacturing (artisan)",
      "craft beverage manufacturing",
      "sustainable packaging manufacturing",
      "industrial cleaning services",
    ]);
    expect(terms.length).toBeLessThanOrEqual(6);
    expect(terms).not.toContain(expect.stringContaining("("));
  });

  it("uses service phrasings for service-style sectors", () => {
    expect(publicResearchTermVariants(["industrial cleaning"])).toEqual([
      "industrial cleaning businesses",
      "industrial cleaning service providers",
    ]);
  });
});