import { describe, expect, it } from "vitest";
import { campaignDefinition, campaignSendWindowOpen, nextAllowedCampaignSend, nextEmailAfter, renderCampaignTemplate } from "./campaign";

const first = { id: "b03dfa99-0b7c-47c5-9a76-a815e171b822", kind: "email" as const, title: "Introduction", subject: "Hello {{company_name}}", body: "Hi {{first_name}}" };
const wait = { id: "39fac3f9-096f-4c06-8922-201342564a45", kind: "wait" as const, title: "Wait", days: 3 };
const second = { id: "2b292e93-f244-470a-94e6-8ff43037425f", kind: "email" as const, title: "Follow-up", subject: "Following up", body: "Hi {{full_name}}" };

describe("campaign definitions", () => {
  it("requires an alternating email-first sequence with immutable step IDs", () => {
    expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [first, wait, second] }).success).toBe(true);
    expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [wait, first] }).success).toBe(false);
    expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [first, second] }).success).toBe(false);
    expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [first, wait, { ...second, id: first.id }] }).success).toBe(false);
  });
  it("renders only supported contact placeholders", () => {
    expect(renderCampaignTemplate("Hi {{first_name}} / {{full_name}} at {{company_name}}; {{unknown}}", { displayName: "Alex Chen", companyName: "Harbour" })).toBe("Hi Alex / Alex Chen at Harbour; {{unknown}}");
  });
  it("schedules the next email after the versioned wait", () => {
    expect(nextEmailAfter({ schemaVersion: 1, steps: [first, wait, second] }, 0, new Date("2026-09-25T00:00:00Z"))?.at.toISOString()).toBe("2026-09-28T00:00:00.000Z");
    expect(nextEmailAfter({ schemaVersion: 1, steps: [first, wait, second] }, 2, new Date())).toBeNull();
  });
  it("holds sends outside Melbourne business hours", () => {
    const next = nextAllowedCampaignSend(new Date("2026-09-26T00:00:00Z"));
    expect(next.toISOString()).toBe("2026-09-27T23:00:00.000Z");
    expect(campaignSendWindowOpen(new Date("2026-09-24T22:59:00Z"))).toBe(false);
    expect(campaignSendWindowOpen(new Date("2026-09-24T23:00:00Z"))).toBe(true);
    expect(campaignSendWindowOpen(new Date("2026-09-25T06:59:00Z"))).toBe(true);
    expect(campaignSendWindowOpen(new Date("2026-09-25T07:00:00Z"))).toBe(false);
    expect(nextAllowedCampaignSend(new Date("2026-10-03T00:00:00Z")).toISOString()).toBe("2026-10-04T22:00:00.000Z");
  });
});
