import { describe, expect, it } from "vitest";
import { organizationSlug } from "./organization-slug";

describe("organizationSlug", () => {
  it("normalises an organisation name and adds a collision-resistant suffix", () => {
    expect(organizationSlug("Callum's Acquisitions & Co.", "A1B2-C3D4")).toBe("callum-s-acquisitions-co-a1b2c3d4");
  });

  it("uses a safe fallback when the name has no URL-safe characters", () => {
    expect(organizationSlug("企業", "ABC12345")).toBe("workspace-abc12345");
  });
});
