import { describe, expect, it } from "vitest";
import { assertMaySend, draftSequence, readOutreachMetadata, scheduleSequence, writeOutreachMetadata } from "./outreach";
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
    expect(drafts[0].channels.email.body).toBe(drafts[0].body);
    expect(drafts[0].channels.linkedin.body).toContain("Open to a brief, private chat?");
    expect(drafts[0].channels.whatsapp.body).toContain("quick introductory call");
  });

  it("reads legacy evidence arrays and round-trips multi-channel metadata", () => {
    expect(readOutreachMetadata(["s1", 2])).toEqual({ signalIds: ["s1"], channels: {} });
    const stored = writeOutreachMetadata(["s1"], { linkedin: { body: "LinkedIn copy" }, whatsapp: { body: "WhatsApp copy" } });
    expect(readOutreachMetadata(stored)).toEqual({ signalIds: ["s1"], channels: { linkedin: { body: "LinkedIn copy" }, whatsapp: { body: "WhatsApp copy" } } });
  });

  it.each([
    [{ approved: false, suppressed: false, replied: false, stopped: false, sentToday: 0, dailyCap: 100 }, "approval"],
    [{ approved: true, suppressed: true, replied: false, stopped: false, sentToday: 0, dailyCap: 100 }, "suppressed"],
    [{ approved: true, suppressed: false, replied: true, stopped: false, sentToday: 0, dailyCap: 100 }, "reply"],
    [{ approved: true, suppressed: false, replied: false, stopped: false, sentToday: 100, dailyCap: 100 }, "cap"],
  ])("blocks unsafe sends", (context, reason) => expect(() => assertMaySend(context)).toThrow(reason));
});
