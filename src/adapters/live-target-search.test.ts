import { describe, expect, it, vi } from "vitest";
import { FirmableClient } from "./firmable-client";
import { GooglePlacesClient } from "./google-places-client";
import { placesQueryForMandate, searchAndEnrichTargets } from "./live-target-search";
import { parseMandate } from "@/domain/mandate";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("live target search", () => {
  it("turns natural language into a geospatial business query", () => {
    const mandate = parseMandate("I'm looking to buy an industrials or building-services business in Melbourne doing $2–20m revenue with at least $1m EBITDA.");
    expect(placesQueryForMandate(mandate)).toBe("industrials or building services businesses in Melbourne, Australia");
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
});
