import { beforeEach, describe, expect, it, vi } from "vitest";
import { campaignPathFor, type CampaignDefinition } from "@/domain/campaign";
const mocks = vi.hoisted(() => ({ rows: vi.fn(), worker: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mocks.rows, withCampaignWorker: mocks.worker, withCampaignDb: vi.fn() }));
vi.mock("@/lib/gmail-connection", () => ({ connectionCanMonitorReplies: vi.fn() }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignTestSendAnytime: () => false, campaignMailboxForConnection: vi.fn() }));
import { processN8nCampaignStep, publishCampaign } from "./campaign-service";
import { withCampaignDb } from "@/db/campaign-client";

const definition: CampaignDefinition = { schemaVersion: 1, steps: [
  { id: "30bde832-8119-482a-bd3d-f3ebec223a49", kind: "email", title: "First", subject: "Hello", body: "Hi" },
  { id: "bb439447-a638-4ce7-82ad-785678c65f47", kind: "wait", title: "Wait", days: 3 },
  { id: "157015e0-e84e-48b2-842b-d57430613fa0", kind: "email", title: "Rejoined", subject: "Hi", body: "Hi" },
], splits: [{ id: "57cff001-6c6b-46c1-bd2e-594b3216f116", afterStepId: "30bde832-8119-482a-bd3d-f3ebec223a49", title: "A/B", percentage: 50,
  pathA: [{ id: "65caf381-c46a-42ea-88f1-4b2dc5a007ee", kind: "wait", title: "A wait", days: 1 }, { id: "4fd7f1b2-7367-4a94-8129-cb1cf4954ad0", kind: "email", title: "A", subject: "Hello", body: "Hi" }],
  pathB: [{ id: "e928b197-2cc0-4d6a-80ed-77b1b6622ef3", kind: "wait", title: "B wait", days: 5 }, { id: "fb27389c-b213-4323-ab03-decc48ecb3b0", kind: "email", title: "B", subject: "Hello", body: "Hi" }],
}] };
const versionId = "b74733ca-71e0-4595-afc4-559a3758f9ee";
const sentAt = new Date("2026-10-01T00:00:00Z");

beforeEach(() => { vi.clearAllMocks(); mocks.worker.mockImplementation(callback => callback({})); });
describe("n8n split replay handling", () => {
  it.each(["pathA", "pathB"] as const)("replays the original %s choice even after the enrolment has rejoined", async path => {
    const enrolmentId = Array.from({ length: 100 }, (_, i) => `contact-${i}`).find(key => campaignPathFor(definition.splits![0], key) === path)!;
    mocks.rows.mockResolvedValueOnce([{ id: enrolmentId, state: "active", step_index: 6, next_step_at: new Date("2026-10-15T00:00:00Z") }])
      .mockResolvedValueOnce([{ sent_at: sentAt }]).mockResolvedValueOnce([{ definition }]);
    const response = await processN8nCampaignStep(enrolmentId, versionId, 0);
    expect(response.outcome).toBe("sent");
    expect(response).toMatchObject({ nextStepIndex: path === "pathA" ? 2 : 4 });
    expect(response.nextStepAt).not.toEqual(new Date("2026-10-15T00:00:00Z"));
    expect(response.nextStepAt).toEqual(new Date(path === "pathA" ? "2026-10-02T00:00:00Z" : "2026-10-06T00:00:00Z"));
  });
  it("does not acknowledge a skipped node from the other branch as sent", async () => {
    mocks.rows.mockResolvedValueOnce([{ state: "active", step_index: 6 }]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ definition }]);
    expect(await processN8nCampaignStep("contact", versionId, 4)).toEqual({ outcome: "finished", nextStepAt: null });
  });
  it("preserves the current scheduled time when retrying the split response", async () => {
    const enrolmentId = Array.from({ length: 100 }, (_, i) => `contact-${i}`).find(key => campaignPathFor(definition.splits![0], key) === "pathA")!;
    const nextAt = new Date("2026-10-08T00:00:00Z");
    mocks.rows.mockResolvedValueOnce([{ state: "active", step_index: 2, next_step_at: nextAt }]).mockResolvedValueOnce([{ sent_at: sentAt }]).mockResolvedValueOnce([{ definition }]);
    expect(await processN8nCampaignStep(enrolmentId, versionId, 0)).toEqual({ outcome: "sent", nextStepIndex: 2, nextStepAt: nextAt });
  });
  it.each(["stopped", "completed"])("ends a %s enrolment without entering either branch", async state => {
    mocks.rows.mockResolvedValueOnce([{ state, step_index: 6 }]);
    expect(await processN8nCampaignStep("contact", versionId, 0)).toEqual({ outcome: "finished", nextStepAt: null });
    expect(mocks.rows).toHaveBeenCalledTimes(1);
  });
  it("blocks publishing manual channels anywhere in a split", async () => {
    const split = definition.splits![0];
    const manual = { ...definition, splits: [{ ...split, pathB: [split.pathB[0], { id: split.pathB[1].id, kind: "whatsapp", title: "Manual", body: "Hi" }] }] };
    vi.mocked(withCampaignDb).mockResolvedValueOnce({ definition: manual, name: "Manual split", version: 1, updatedAt: new Date() });
    await expect(publishCampaign({ organizationId: "org", userId: "user" }, "sequence")).rejects.toThrow("channel delivery support");
  });
});

it("projects live attempts using each enrolment's immutable published definition", async () => {
  const { listCampaignStudio } = await import("./campaign-service");
  const query = vi.fn().mockResolvedValue({ rows: [] });
  vi.mocked(withCampaignDb).mockImplementation(async (_actor, callback) => callback({ query } as never));
  mocks.rows.mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ id: "enrolment", contact_id: "contact", version: 1, version_definition: definition, state: "active", step_index: 2, next_step_at: sentAt, started_at: sentAt, last_sent_at: sentAt, recipient_email: "alex@example.test", stop_reason: null }])
    .mockResolvedValueOnce([{ id: "contact", target_id: "target", display_name: "Alex", company_name: "Company", personal_data: { email: "alex@example.test" }, fictionalised: false }])
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([{ entity_id: "enrolment", action: "campaign.retry_scheduled", created_at: sentAt, metadata: { stepIndex: 2 } }])
    .mockResolvedValueOnce([{ enrolment_id: "enrolment", step_index: 0, state: "sent", sent_at: sentAt }]);
  const studio = await listCampaignStudio({ organizationId: "org", userId: "user" }, "mandate");
  expect(studio.enrolments[0].run).toMatchObject({ label: "Alex", version: 1, definition, stepIndex: 2, retryStepIndex: 2, attempts: [{ stepId: definition.steps[0].id, state: "sent", sentAt: sentAt.toISOString() }] });
  expect(studio.enrolments[0].nextStepTitle).toBe("A");
});

it("records a scheduled n8n retry for live node status without sending early", async () => {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  vi.mocked(withCampaignDb).mockImplementation(async (_actor, callback) => callback({ query } as never));
  const nextAt = new Date(Date.now() + 86400_000);
  const job = { id: "enrolment", organization_id: "org", owner_user_id: "user", state: "active", step_index: 2, next_step_at: nextAt };
  mocks.rows.mockResolvedValueOnce([job]).mockResolvedValueOnce([job]).mockResolvedValueOnce([job]);
  expect(await processN8nCampaignStep("enrolment", versionId, 2)).toEqual({ outcome: "retry", nextStepAt: nextAt });
  expect(query).toHaveBeenCalledWith(expect.stringContaining("campaign.retry_scheduled"), ["org", "user", "enrolment", JSON.stringify({ stepIndex: 2, nextStepAt: nextAt.toISOString() })]);
  expect(query.mock.calls.every(call => !call[0].includes("campaign_send_attempts"))).toBe(true);
});
