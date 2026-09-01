import { describe, expect, it, vi } from "vitest";
import { GooglePlacesClient, GooglePlacesError, resolveBusinessResultLimit } from "./google-places-client";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("GooglePlacesClient", () => {
  it("sends a bounded AU text search with only the required fields", async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => {
      void _input; void _init;
      return response({ places: [{ id: "p1", displayName: { text: "Example HVAC" }, formattedAddress: "1 Example Rd, Scoresby VIC 3179, Australia", websiteUri: "https://example.com", primaryType: "hvac_contractor", types: ["hvac_contractor"], addressComponents: [{ longText: "Scoresby", shortText: "Scoresby", types: ["locality"] }, { longText: "Victoria", shortText: "VIC", types: ["administrative_area_level_1"] }] }] });
    });
    const places = await new GooglePlacesClient({ apiKey: "test", fetch: fetcher }).searchText("HVAC businesses in Melbourne, Australia", 3);
    expect(places).toEqual([expect.objectContaining({ id: "p1", name: "Example HVAC", locality: "Scoresby", state: "VIC", primaryType: "hvac_contractor", website: "https://example.com" })]);
    const [, init] = fetcher.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({ pageSize: 3, regionCode: "AU" }));
    expect(new Headers(init?.headers).get("X-Goog-FieldMask")).toContain("places.websiteUri");
  });

  it("maps max to the hard application cap", () => expect(resolveBusinessResultLimit("max")).toBe(20));

  it("fails before a request when no key is configured", async () => {
    const fetcher = vi.fn();
    await expect(new GooglePlacesClient({ apiKey: "", fetch: fetcher }).searchText("businesses in Melbourne", 1)).rejects.toBeInstanceOf(GooglePlacesError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
