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
