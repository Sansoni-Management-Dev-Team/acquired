import { describe, expect, it, vi } from "vitest";
import { FirmableClient } from "./firmable-client";
import { GooglePlacesClient } from "./google-places-client";
import { mergeDiscoveryCandidates, placesQueryForMandate, searchAndEnrichTargets } from "./live-target-search";
import { parseMandate } from "@/test/fixtures/legacy-mandate-parser";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("live target search", () => {
  it("turns natural language into a geospatial business query", () => {
    const mandate = parseMandate("I'm looking to buy an industrials or building-services business in Melbourne doing $2–20m revenue with at least $1m EBITDA.");
    expect(placesQueryForMandate(mandate)).toBe("industrials or building services businesses in Melbourne, Australia");
  });

  it("interleaves directory candidates and merges exact domain duplicates into Places results", () => {
    const merged = mergeDiscoveryCandidates(
      [
        { id: "google-1", name: "Shared", website: "https://shared.example", formattedAddress: "VIC", state: "VIC" },
        { id: "google-2", name: "Google only", website: "https://google.example", formattedAddress: "VIC", state: "VIC" },
      ],
      [
        { id: "directory-1", name: "Shared Pty Ltd", website: "https://www.shared.example/about", formattedAddress: "VIC", state: "VIC", discoverySource: "manufacturing-directory", manufacturingDirectory: { recordId: "directory-1", name: "Shared", categories: [], keywords: [], capabilities: [], sourceRecords: [] } },
        { id: "directory-2", name: "Directory only", website: "https://directory.example", formattedAddress: "VIC", state: "VIC", discoverySource: "manufacturing-directory", manufacturingDirectory: { recordId: "directory-2", name: "Directory only", categories: [], keywords: [], capabilities: [], sourceRecords: [] } },
      ],
    );
    expect(merged.map((candidate) => candidate.id)).toEqual(["google-1", "directory-2", "google-2"]);
    expect(merged[0].manufacturingDirectory?.recordId).toBe("directory-1");
  });

  it("enriches only Places results that provide a website", async () => {
    const placesFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input; void _init;
      return response({ places: [
        { id: "p1", displayName: { text: "One" }, formattedAddress: "Scoresby VIC 3179, Australia", websiteUri: "https://one.example" },
        { id: "p2", displayName: { text: "Two" }, formattedAddress: "Melbourne VIC 3000, Australia" },
      ] });
    });
    const firmableFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input; void _init;
      return response({ id: "f1", name: "One", fqdn: "one.example", industries: ["Building services"], revenue: "$5M-$10M" });
    });
    const result = await searchAndEnrichTargets({
      places: new GooglePlacesClient({ apiKey: "test", fetch: placesFetch }),
      firmable: new FirmableClient({ apiKey: "test", fetch: firmableFetch }),
      mandate: parseMandate("Find building services businesses in Melbourne with revenue $2m-$20m and at least $1m EBITDA"),
      limit: 3,
      organisationId: "org-1",
    });
    expect(firmableFetch).toHaveBeenCalledOnce();
    expect(String(firmableFetch.mock.calls[0][0])).toContain("fqdn=one.example");
    expect(result.summary).toEqual(expect.objectContaining({ discovered: 2, enriched: 1, withoutWebsite: 1 }));
    expect(result.targets.map((target) => target.status)).toEqual(["enriched"]);
  });

  it("over-fetches one Places page but caps Firmable calls and returned targets", async () => {
    const placesFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      void _input;
      expect(JSON.parse(String(init?.body)).pageSize).toBe(20);
      return response({ places: [
        { id: "p1", displayName: { text: "No Website" }, formattedAddress: "Melbourne VIC 3000, Australia" },
        { id: "p2", displayName: { text: "First Website" }, formattedAddress: "Richmond VIC 3121, Australia", websiteUri: "https://first.example" },
        { id: "p3", displayName: { text: "Second Website" }, formattedAddress: "Carlton VIC 3053, Australia", websiteUri: "https://second.example" },
      ] });
    });
    const firmableFetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input; void _init;
      return response({ id: "f1", name: "First Website", fqdn: "first.example", industries: ["Building services"] });
    });
    const result = await searchAndEnrichTargets({
      places: new GooglePlacesClient({ apiKey: "test", fetch: placesFetch }),
      firmable: new FirmableClient({ apiKey: "test", fetch: firmableFetch }),
      mandate: parseMandate("Find building services businesses in Melbourne with revenue $2m-$20m and at least $1m EBITDA"),
      limit: 1,
      organisationId: "org-1",
    });
    expect(firmableFetch).toHaveBeenCalledOnce();
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].domain).toBe("first.example");
    expect(result.summary.withoutWebsite).toBe(1);
  });

  it("adds directory candidates only for manufacturing mandates", async () => {
    const placesFetch = vi.fn(async () => response({ places: [
      { id: "p1", displayName: { text: "Google Manufacturer" }, formattedAddress: "Melbourne VIC 3000, Australia", websiteUri: "https://google-manufacturer.example" },
    ] }));
    const firmableFetch = vi.fn(async (input: string | URL | Request) => {
      const domain = new URL(String(input)).searchParams.get("fqdn") || "unknown.example";
      return response({ id: domain, name: domain, fqdn: domain, industries: ["Manufacturing"] });
    });
    const directorySearch = vi.fn(async () => [{
      id: "manufacturer-1",
      name: "Directory Manufacturer",
      formattedAddress: "Dandenong South VIC 3175",
      website: "https://directory-manufacturer.example",
      state: "VIC",
      discoverySource: "manufacturing-directory" as const,
      manufacturingDirectory: { recordId: "manufacturer-1", name: "Directory Manufacturer", categories: ["Manufacturing & Supply"], keywords: [], capabilities: [], sourceRecords: [] },
    }]);
    const result = await searchAndEnrichTargets({
      places: new GooglePlacesClient({ apiKey: "test", fetch: placesFetch }),
      firmable: new FirmableClient({ apiKey: "test", fetch: firmableFetch }),
      manufacturingDirectory: { search: directorySearch },
      mandate: parseMandate("I'm looking for manufacturing businesses in Victoria"),
      limit: 3,
      organisationId: "org-1",
    });
    expect(directorySearch).toHaveBeenCalledOnce();
    expect(firmableFetch).toHaveBeenCalledTimes(2);
    expect(result.targets).toHaveLength(2);
    expect(result.targets[1].sourceData?.manufacturingDirectory?.recordId).toBe("manufacturer-1");
    expect(result.summary).toMatchObject({ googlePlacesDiscovered: 1, manufacturingDirectoryDiscovered: 1, discovered: 2 });
  });

  it("uses an ABN to enrich a directory candidate without a website", async () => {
    const firmableFetch = vi.fn(async (input: string | URL | Request) => {
      void input;
      return response({ id: "firmable-abn", name: "ABN Manufacturer", industries: ["Manufacturing"] });
    });
    const result = await searchAndEnrichTargets({
      places: new GooglePlacesClient({ apiKey: "test", fetch: vi.fn(async () => response({ places: [] })) }),
      firmable: new FirmableClient({ apiKey: "test", fetch: firmableFetch }),
      manufacturingDirectory: { search: vi.fn(async () => [{
        id: "manufacturer-abn",
        name: "ABN Manufacturer",
        formattedAddress: "Dandenong VIC 3175",
        state: "VIC",
        discoverySource: "manufacturing-directory" as const,
        manufacturingDirectory: { recordId: "manufacturer-abn", name: "ABN Manufacturer", abn: "87 661 285 409", categories: [], keywords: [], capabilities: [], sourceRecords: [] },
      }]) },
      mandate: parseMandate("Find manufacturing businesses in Victoria"),
      limit: 1,
      organisationId: "org-1",
    });
    expect(String(firmableFetch.mock.calls[0][0])).toContain("abn=87661285409");
    expect(result.targets).toHaveLength(1);
    expect(result.targets[0].status).toBe("enriched");
    expect(result.summary.withoutWebsite).toBe(0);
  });
});
