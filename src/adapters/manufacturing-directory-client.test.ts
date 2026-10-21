import { describe, expect, it } from "vitest";
import { parseMandate } from "@/test/fixtures/legacy-mandate-parser";
import { isManufacturingMandate, ManufacturingDirectoryClient, searchManufacturingBusinesses, type DirectoryBusiness } from "./manufacturing-directory-client";

const businesses: DirectoryBusiness[] = [
  {
    id: "manufacturer-one",
    name: "Precision Food Systems",
    website: "https://precision.example.com/about",
    address: "1 Example Road, Dandenong South, VIC 3175",
    state: "VIC",
    postcode: "3175",
    categories: ["Manufacturing & Supply"],
    keywords: ["food processing equipment"],
    capabilities: { "Process Equipment": ["Stainless fabrication"] },
    sourceRecords: [{ source: "amtil", sourceId: "one", sourceUrl: "https://directory.example/one" }],
  },
  {
    id: "manufacturer-two",
    name: "Queensland Food Systems",
    website: "https://queensland.example.com",
    state: "QLD",
    categories: ["Manufacturing & Supply"],
    keywords: ["food processing equipment"],
  },
  { id: "no-website", name: "No Website Fabricator", state: "VIC", categories: ["Manufacturing & Supply"] },
  { id: "abn-only", name: "ABN Only Fabricator", state: "VIC", categories: ["Manufacturing & Supply"] },
  { id: "property-service", name: "Commercial Property Advice", website: "https://property.example", state: "VIC", categories: ["Property Services"], description: "Commercial property consultants." },
];

describe("manufacturing directory search", () => {
  it("activates only for an explicit manufacturing sector", () => {
    expect(isManufacturingMandate(parseMandate("Find manufacturing businesses in Victoria with $2m-$20m revenue"))).toBe(true);
    expect(isManufacturingMandate(parseMandate("Find CNC machining businesses in Victoria"))).toBe(true);
    expect(isManufacturingMandate(parseMandate("Find injection molding companies in NSW"))).toBe(true);
    expect(isManufacturingMandate(parseMandate("Find plumbing businesses in Victoria with $2m-$20m revenue"))).toBe(false);
  });

  it("does not return unrelated directory advertisers for a generic manufacturing search", () => {
    const results = searchManufacturingBusinesses(businesses, parseMandate("Find manufacturing businesses in Victoria"), 20);
    expect(results.some((candidate) => candidate.id === "property-service")).toBe(false);
  });

  it("returns a directory business that has a researched ABN but no website", () => {
    const results = searchManufacturingBusinesses(
      businesses,
      parseMandate("Find manufacturing businesses in Victoria"),
      20,
      { "abn-only": { abn: "12 345 678 901", evidenceUrl: "https://abr.example/12345678901", confidence: 100 } },
    );
    const result = results.find((candidate) => candidate.id === "abn-only");
    expect(result).toMatchObject({
      website: undefined,
      manufacturingDirectory: {
        abn: "12 345 678 901",
        identifierEvidence: { sourceUrl: "https://abr.example/12345678901", confidence: 100 },
      },
    });
  });

  it("returns relevant website-backed businesses in the mandate states", () => {
    const mandate = parseMandate("Find food manufacturing businesses in Victoria with $2m-$20m revenue");
    const results = searchManufacturingBusinesses(businesses, mandate, 20);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "manufacturer-one",
      website: "https://precision.example.com/about",
      locality: "Dandenong South",
      state: "VIC",
      discoverySource: "manufacturing-directory",
      manufacturingDirectory: { recordId: "manufacturer-one", keywords: ["food processing equipment"] },
    });
  });

  it("loads the production dataset and retains unresolved candidates for review", async () => {
    const results = await new ManufacturingDirectoryClient().search(
      parseMandate("Find manufacturing businesses in Victoria"),
      20,
    );
    expect(results).toHaveLength(20);
    expect(results.every((candidate) => candidate.manufacturingDirectory)).toBe(true);
    expect(results.every((candidate) => !candidate.state || candidate.state === "VIC")).toBe(true);
  });

  it("returns web-discovery businesses for taxonomy-specific searches", async () => {
    const results = await new ManufacturingDirectoryClient().search(
      parseMandate("Find CNC machining businesses in Victoria"),
      20,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((candidate) => candidate.manufacturingDirectory?.sourceRecords.some((record) => record.source === "web-serp"))).toBe(true);
  });
});
