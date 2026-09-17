import { describe, expect, it } from "vitest";
import { assertMaySend, draftSequence, scheduleSequence } from "./outreach";
import type { Signal } from "./models";

const signal: Signal = { id: "s1", kind: "tenure", value: "Founder tenure of 31 years", weight: "high", direction: "positive", provenance: { source: "Synthetic ASIC", capturedAt: "2026-08-26T00:00:00Z", confidence: 90 } };

describe("outreach", () => {
  it("schedules all seven messages on business days", () => {
    const scheduled = scheduleSequence(new Date("2026-08-28T09:00:00Z"));
    expect(scheduled).toHaveLength(7);
    expect(scheduled.every(({ scheduledFor }) => ![0, 6].includes(scheduledFor.getUTCDay()))).toBe(true);
  });

  it("grounds every draft in a signal", () => {
    const drafts = draftSequence("Northstar", "Alex", [signal], new Date("2026-08-26T09:00:00Z"));
    expect(drafts).toHaveLength(7);
    expect(drafts.every((draft) => draft.signalIds.includes("s1"))).toBe(true);
  });

  it("creates generic editable drafts when no evidence signal exists", () => {
    const drafts = draftSequence("Northstar", "Alex", [], new Date("2026-08-26T09:00:00Z"));
    expect(drafts).toHaveLength(7);
    expect(drafts.every((draft) => draft.signalIds.length === 0)).toBe(true);
    expect(drafts[0].body).toContain("wanted to introduce myself");
  });

  it.each([
    [{ approved: false, suppressed: false, replied: false, stopped: false, sentToday: 0, dailyCap: 100 }, "approval"],
    [{ approved: true, suppressed: true, replied: false, stopped: false, sentToday: 0, dailyCap: 100 }, "suppressed"],
    [{ approved: true, suppressed: false, replied: true, stopped: false, sentToday: 0, dailyCap: 100 }, "reply"],
    [{ approved: true, suppressed: false, replied: false, stopped: false, sentToday: 100, dailyCap: 100 }, "cap"],
  ])("blocks unsafe sends", (context, reason) => expect(() => assertMaySend(context)).toThrow(reason));
});
