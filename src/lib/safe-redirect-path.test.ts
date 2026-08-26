import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect-path";

describe("safeRedirectPath", () => {
  it("allows internal application paths", () => {
    expect(safeRedirectPath("/settings?connected=1")).toBe("/settings?connected=1");
  });

  it("rejects external and protocol-relative redirects", () => {
    expect(safeRedirectPath("https://example.com")).toBe("/targets");
    expect(safeRedirectPath("//example.com")).toBe("/targets");
  });
});
