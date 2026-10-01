import { describe, expect, it } from "vitest";
import { campaignPathFor, type CampaignDefinition } from "./campaign";
import { campaignRunStatuses, type CampaignRun } from "./campaign-run";
const definition: CampaignDefinition = { schemaVersion: 1, steps: [
  { id: "first", kind: "email", title: "First", subject: "Hi", body: "Hello" },
  { id: "wait", kind: "wait", title: "Wait", days: 3 },
  { id: "last", kind: "email", title: "Last", subject: "Hi", body: "Hello" },
], splits: [{ id: "split", afterStepId: "first", title: "Variants", percentage: 50,
  pathA: [{ id: "a-wait", kind: "wait", title: "A wait", days: 1 }, { id: "a", kind: "email", title: "A", subject: "Hi", body: "Hello" }],
  pathB: [{ id: "b-wait", kind: "wait", title: "B wait", days: 5 }, { id: "b", kind: "email", title: "B", subject: "Hi", body: "Hello" }],
}] };
const routingKey = Array.from({ length: 100 }, (_, i) => `contact-${i}`).find(key => campaignPathFor(definition.splits![0], key) === "pathA")!;
const run: CampaignRun = { id: routingKey, label: "Contact", version: 1, definition, state: "active", stopReason: null, stepIndex: 2, nextStepAt: "2026-10-03T00:00:00Z", attempts: [{ stepId: "first", state: "sent", sentAt: "2026-10-01T00:00:00Z" }] };
const now = new Date("2026-10-02T00:00:00Z").getTime();
describe("published node status", () => {
  it("shows actual sent nodes, scheduled waits and the correct skipped branch", () => {
    const statuses = campaignRunStatuses(run, now);
    expect(statuses.get("first")).toBe("Sent"); expect(statuses.get("a-wait")).toBe("Waiting");
    expect(statuses.get("a")).toBe("Scheduled"); expect(statuses.get("b")).toBe("Skipped");
    expect(statuses.get("split")).toBe("Path A"); expect(statuses.get("last")).toBe("Pending");
  });
  it.each([["paused", "Paused"], ["stopped", "Stopped"], ["needs_review", "Needs review"]])("shows %s without changing already sent nodes", (state, label) => {
    const statuses = campaignRunStatuses({ ...run, state }, now);
    expect(statuses.get("a")).toBe(label); expect(statuses.get("first")).toBe("Sent");
  });
  it("distinguishes ready, claimed, uncertain and scheduled retries using stored evidence", () => {
    expect(campaignRunStatuses({ ...run, nextStepAt: "2026-10-01T00:00:00Z" }, now).get("a")).toBe("Ready");
    expect(campaignRunStatuses({ ...run, retryStepIndex: 2 }, now).get("a")).toBe("Retry scheduled");
    for (const [state, label] of [["claimed", "Sending"], ["unknown", "Needs review"]]) expect(campaignRunStatuses({ ...run, attempts: [...run.attempts, { stepId: "a", state, sentAt: null }] }, now).get("a")).toBe(label);
  });
  it("shows completed runs and elapsed waits without marking the other branch as sent", () => {
    const statuses = campaignRunStatuses({ ...run, state: "completed", stepIndex: 7, attempts: [...run.attempts, { stepId: "a", state: "sent", sentAt: "2026-10-03T00:00:00Z" }, { stepId: "last", state: "sent", sentAt: "2026-10-06T00:00:00Z" }] }, now);
    expect(statuses.get("end")).toBe("Completed"); expect(statuses.get("wait")).toBe("Elapsed"); expect(statuses.get("b")).toBe("Skipped");
  });
});
