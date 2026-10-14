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

it.each(['/\\evil.example', '/path\\evil', '/\tevil', '/\nevil', '/\revil', '/\u0000evil', '///evil.example'])('rejects ambiguous redirect %j', path => {
  expect(safeRedirectPath(path)).toBe('/targets');
});
it('normalizes accepted redirects as a path with query and fragment on the same origin', () => {
  expect(safeRedirectPath('/settings/../targets?q=hello%20world#company')).toBe('/targets?q=hello%20world#company');
});
