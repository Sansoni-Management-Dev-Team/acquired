import { describe, expect, it } from "vitest";
import { defaultMandate, seedTargets } from "@/data/seed-targets";
import { determineBand, rankTarget, rankTargets } from "./scoring";

describe("deterministic target scoring", () => {
  it("uses the documented band gates", () => {
    expect(determineBand(75, 70, 60)).toBe("hot");
    expect(determineBand(74, 70, 60)).toBe("warm");
    expect(determineBand(60, 45, 39)).toBe("cold");
    expect(determineBand(100, 100, 100, true)).toBe("excluded");
  });

  it("ranks the evidence-rich succession target as hot", () => {
    const ranked = rankTarget(seedTargets[0], defaultMandate);
    expect(ranked.scores).toMatchObject({ fit: 100, ripeness: 78, financeability: 100, band: "hot", qualification: "priority" });
    expect(ranked.scores.reasons.every((reason) => Boolean(reason.source))).toBe(true);
  });

  it("keeps financeability independent from owner ripeness", () => {
    const weakFinance = rankTarget(seedTargets[4], { ...defaultMandate, states: [...defaultMandate.states, "WA"] });
    expect(weakFinance.scores.ripeness).toBeGreaterThanOrEqual(40);
    expect(weakFinance.scores.financeability).toBe(0);
    expect(weakFinance.scores.qualification).not.toBe("priority");
  });

  it("marks missing lender evidence for research instead of inventing a score", () => {
    const sparse = rankTarget(seedTargets[2], defaultMandate);
    expect(sparse.scores.financeability).toBeNull();
    expect(sparse.scores.tensions).toContain("Financeability is unscored until operating and lender evidence is collected.");
  });

  it("does not impute missing financial values", () => {
    const sparse = rankTarget(seedTargets[2], defaultMandate);
    expect(sparse.revenue.value).toBeNull();
    expect(sparse.revenue.missingReason).toBe("UNKNOWN from register");
    expect(sparse.scores.fit).toBeLessThan(100);
  });

  it("hard-excludes a target outside the mandate", () => {
    const ranked = rankTarget(seedTargets[4], defaultMandate);
    expect(ranked.scores.band).toBe("excluded");
  });

  it("sorts excluded targets after eligible targets", () => {
    const ranked = rankTargets(seedTargets, defaultMandate);
    expect(ranked.at(-1)?.scores.band).toBe("excluded");
  });
});
