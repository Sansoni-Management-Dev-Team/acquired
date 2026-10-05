import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { acceptancePath, campaignDefinition, campaignPathFor, nextCampaignStepAfter, type CampaignDefinition, type CampaignStep } from "./campaign";
import { campaignRunStatuses } from "./campaign-run";
import { buildSequenceWorkflow } from "@/lib/campaign-n8n";
const wait = (): CampaignStep => ({ id: randomUUID(), kind: "wait", title: "Wait", days: 1 });
const connect = (): CampaignStep => ({ id: randomUUID(), kind: "linkedin", action: "connect", title: "Connect", body: "" });
const message = (): CampaignStep => ({ id: randomUUID(), kind: "linkedin", title: "Message", body: "Hi" });
export function acceptanceSequence(): CampaignDefinition {
  const anchor = connect();
  return { schemaVersion: 1, steps: [anchor], splits: [{ id: randomUUID(), afterStepId: anchor.id, title: "Accepted?", percentage: 50, condition: { kind: "linkedin_connected", timeoutDays: 7 }, pathA: [wait(), message()], pathB: [wait(), { id: randomUUID(), kind: "email", title: "Email fallback", subject: "Hi", body: "Hello" }] }] };
}
describe("LinkedIn sequence semantics", () => {
  it("accepts blank notes, keeps legacy DMs, and rejects empty messages/long notes", () => {
    for (const step of [connect(), message()]) expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [step] }).success).toBe(true);
    for (const step of [{ ...connect(), body: "x".repeat(201) }, { ...message(), body: "" }]) expect(campaignDefinition.safeParse({ schemaVersion: 1, steps: [step] }).success).toBe(false);
  });
  it("requires an invitation anchor and a bounded timeout", () => {
    const draft = acceptanceSequence();
    expect(campaignDefinition.safeParse(draft).success).toBe(true);
    expect(campaignDefinition.safeParse({ ...draft, steps: [{ ...draft.steps[0], action: "message", body: "Hello" }] }).success).toBe(false);
    draft.splits![0].condition!.timeoutDays = 0;
    expect(campaignDefinition.safeParse(draft).success).toBe(false);
  });
  it("never treats missing status as rejection or makes a random condition choice", () => {
    const sent = new Date("2026-10-01T00:00:00Z");
    expect(acceptancePath(true, sent, 7, sent)).toBe("pathA");
    expect(acceptancePath(false, sent, 7, new Date("2026-10-07T23:59:59Z"))).toBeNull();
    expect(acceptancePath(false, sent, 7, new Date("2026-10-08T00:00:00Z"))).toBe("pathB");
    expect(acceptancePath(null, sent, 7, new Date("2026-11-01T00:00:00Z"))).toBeNull();
    expect(() => campaignPathFor(acceptanceSequence().splits![0], "contact")).toThrow("observed outcome");
  });
  it("schedules either path from its recorded decision time and compiles all channels", () => {
    const draft = acceptanceSequence();
    const decided = new Date("2026-10-08T00:00:00Z");
    expect(nextCampaignStepAfter(draft, 0, decided, "contact", "pathA")).toEqual({ index: 2, at: new Date("2026-10-09T00:00:00Z") });
    expect(nextCampaignStepAfter(draft, 0, decided, "contact", "pathB")?.index).toBe(4);
    expect(() => nextCampaignStepAfter(draft, 0, decided, "contact")).toThrow("not been resolved");
    const workflow = buildSequenceWorkflow({ versionId: randomUUID(), sequenceName: "Mixed", version: 1, definition: draft, appUrl: "https://example.test" });
    expect(workflow.nodes.filter(node => node.type === "n8n-nodes-base.httpRequest")).toHaveLength(3);
    expect(workflow.connections["Start contact"].main[0][0].node).toBe("Send: Connect");
  });
  it("shows unresolved branches as pending and only skips after a durable decision", () => {
    const definition = acceptanceSequence();
    const run = { id: "contact", label: "Alex", version: 1, definition, state: "active", stopReason: null, stepIndex: 0, nextStepAt: null, attempts: [{ stepId: definition.steps[0].id, state: "sent", sentAt: new Date().toISOString() }] };
    expect(campaignRunStatuses(run).get(definition.splits![0].id)).toBe("Waiting for acceptance");
    const statuses = campaignRunStatuses({ ...run, branchDecisions: { [definition.splits![0].id]: "pathB" } });
    expect(statuses.get(definition.splits![0].id)).toBe("Acceptance timed out");
    expect(statuses.get(definition.splits![0].pathA[1].id)).toBe("Skipped");
  });
});
