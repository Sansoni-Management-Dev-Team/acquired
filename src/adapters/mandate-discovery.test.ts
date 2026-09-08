import { describe, expect, it, vi } from "vitest";
import { discoverMandate } from "./mandate-discovery";
import { searchManufacturingBusinesses } from "./manufacturing-directory-client";
import { defaultMandate } from "@/test/fixtures/scoring-targets";

describe("register-first enumeration", () => {
  it("retains records without websites, ABNs or a known location", async () => {
    const directory = { search: vi.fn().mockResolvedValue([{ id: "a", name: "Example packaging tools", formattedAddress: "Unknown", discoverySource: "manufacturing-directory", manufacturingDirectory: { recordId: "a", name: "Example packaging tools", categories: [], keywords: [], capabilities: [], sourceRecords: [] } }]) };
    const result = await discoverMandate({ directory, mandate: defaultMandate, organizationId: "org-a" });
    expect(directory.search).toHaveBeenCalledWith(defaultMandate, Number.MAX_SAFE_INTEGER);
    expect(result.targets).toHaveLength(1); expect(result.targets[0].state).toBe("Unknown"); expect(result.targets[0].sector.value).toBeNull(); expect(result.targets[0].revenue.value).toBeNull();
  });
  it("reports unavailable sources without claiming successful enumeration", async () => {
    const result = await discoverMandate({ directory: { search: vi.fn().mockRejectedValue(new Error("Unavailable")) }, mandate: defaultMandate, organizationId: "org-a" });
    expect(result.targets).toEqual([]); expect(result.sources[0].status).toBe("failed");
  });
  it("searches each alternative capability, even under a broad unrelated industry code", () => {
    const results = searchManufacturingBusinesses([{ id: "one", name: "Example Products", description: "Packaging equipment specialist", state: "VIC", categories: ["Wholesale"] }, { id: "two", name: "Example Materials", description: "Specialist distribution", categories: ["Plastics"] }], { ...defaultMandate, sectors: ["Packaging equipment", "Specialist distribution"] }, 100);
    expect(results.map(r => r.id).sort()).toEqual(["one","two"]);
  });
});

describe("Google Places mandate coverage", () => {
  it("merges directory overlap and repeated Places results while preserving both sources", async () => {
    const directory = { search: vi.fn().mockResolvedValue([{ id: "directory-a", name: "Example Packaging", website: "https://example.test", formattedAddress: "VIC", discoverySource: "manufacturing-directory", manufacturingDirectory: { recordId: "directory-a", name: "Example Packaging", categories: [], keywords: [], capabilities: [], sourceRecords: [] } }]) };
    const places = { isConfigured: () => true, searchText: vi.fn().mockResolvedValue([{ id: "place-a", name: "Example Packaging", website: "https://example.test", formattedAddress: "VIC" }, { id: "place-b", name: "Example Tools", formattedAddress: "Unknown" }]) };
    const result = await discoverMandate({ directory, places, mandate: { ...defaultMandate, sectors: ["Packaging", "Tools"] }, organizationId: "org-a" });
    expect(places.searchText).toHaveBeenCalledTimes(2);
    expect(result.targets).toHaveLength(2);
    expect(result.targets[0].sourceData?.googlePlaces?.placeId).toBe("place-a");
    expect(result.targets[0].sourceData?.manufacturingDirectory?.recordId).toBe("directory-a");
    expect(result.sources.find(s => s.name === "Google Places")).toMatchObject({ discovered: 2, unique: 1, overlap: 1, status: "partial" });
  });
  it("retains successful queries if another query or the directory fails", async () => {
    const places = { isConfigured: () => true, searchText: vi.fn().mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce([{ id: "one", name: "Example Tools", formattedAddress: "Unknown" }]) };
    const result = await discoverMandate({ directory: { search: vi.fn().mockRejectedValue(new Error("Missing index")) }, places, mandate: { ...defaultMandate, sectors: ["Packaging", "Tools"] }, organizationId: "org-a" });
    expect(result.targets).toHaveLength(1);
    expect(result.sources.find(s => s.name === "Google Places")?.note).toContain("1/2");
  });
  it("does not call unconfigured Places and bounds configured query counts", async () => {
    const directory = { search: vi.fn().mockResolvedValue([]) };
    const places = { isConfigured: () => false, searchText: vi.fn().mockResolvedValue([]) };
    await discoverMandate({ directory, places, mandate: defaultMandate, organizationId: "org-a" });
    expect(places.searchText).not.toHaveBeenCalled();
    places.isConfigured = () => true;
    const result = await discoverMandate({ directory, places, mandate: { ...defaultMandate, sectors: Array.from({length: 14}, (_, i) => `Example capability ${i}`) }, organizationId: "org-a" });
    expect(places.searchText).toHaveBeenCalledTimes(12);
    expect(result.sources.find(s => s.name === "Google Places")?.note).toContain("2 sub-sectors not searched");
  });
});
