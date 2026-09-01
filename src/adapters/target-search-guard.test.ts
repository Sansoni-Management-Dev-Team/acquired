import { beforeEach, describe, expect, it } from "vitest";
import { acquireTargetSearch, clearTargetSearchGuardForTests, TargetSearchRateLimitError } from "./target-search-guard";

describe("target search guard", () => {
  beforeEach(clearTargetSearchGuardForTests);

  it("allows only one concurrent provider search per organisation", () => {
    const release = acquireTargetSearch("org-1", { now: 1_000, cooldownMs: 3_000 });
    expect(() => acquireTargetSearch("org-1", { now: 1_001, cooldownMs: 3_000 })).toThrow(TargetSearchRateLimitError);
    expect(() => acquireTargetSearch("org-2", { now: 1_001, cooldownMs: 3_000 })).not.toThrow();
    release();
  });

  it("enforces a cooldown after completion", () => {
    acquireTargetSearch("org-1", { now: 1_000, cooldownMs: 3_000 })();
    expect(() => acquireTargetSearch("org-1", { now: 2_000, cooldownMs: 3_000 })).toThrow(expect.objectContaining({ retryAfterSeconds: 2 }));
    expect(() => acquireTargetSearch("org-1", { now: 4_000, cooldownMs: 3_000 })).not.toThrow();
  });
});
