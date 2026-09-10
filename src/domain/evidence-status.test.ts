import { expect, it } from "vitest";
import { evidenceLabel, summariseEvidence } from "./evidence-status";
import type { ResearchFinding } from "./research";
const f = (kind: ResearchFinding["kind"], value: string) => ({ evidence: { kind, name: kind, value, quote: `quote ${value}`, website: "" } as ResearchFinding });
it("separates found-awaiting-review from unknown, and shows how much was searched", () => {
  expect(evidenceLabel(0, { searches: 0, researching: false })).toBe("Unknown — not yet researched");
  expect(evidenceLabel(0, { searches: 3, researching: false })).toBe("Unknown — 3 web searches run");
  expect(evidenceLabel(0, { searches: 1, researching: true })).toBe("Researching");
  expect(evidenceLabel(1, { searches: 1, researching: false })).toBe("Found — awaiting review");
  expect(evidenceLabel(2, { searches: 1, researching: false }, true)).toBe("Found — awaiting review (sources disagree)");
});
it("preserves conflicting observations instead of choosing one", () => {
  const summary = summariseEvidence([f("headcount", "98"), f("headcount", "27-33 employees"), f("person", "Managing Director")], { searches: 2 });
  expect(summary).toMatchObject({ headcount: 2, person: 1, revenue: 0, searches: 2, conflicts: ["headcount"] });
});
