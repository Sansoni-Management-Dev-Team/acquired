import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), linkedin: vi.fn(), gmail: { inboundFrom: vi.fn(), hasConversation: vi.fn(), outboundToSince: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({ query: mock.query }), withCampaignWorker: (fn: (client: unknown) => unknown) => fn({ query: mock.query }) }));
vi.mock("@/lib/gmail-connection", () => ({ connectionCanMonitorReplies: () => true }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignTestSendAnytime: () => true, campaignMailboxForConnection: () => mock.gmail }));
vi.mock("@/lib/campaign-linkedin", () => ({ campaignLinkedin: mock.linkedin, linkedinCampaignEnabled: () => true, linkedinProfileFor: () => "https://www.linkedin.com/in/alex" }));
import { processCampaignEnrolment } from "./campaign-service";
const actor = { organizationId: "org", userId: "owner" };
const id = randomUUID();
const anchor = { id: randomUUID(), kind: "linkedin", action: "connect", title: "Connect", body: "" };
const path = () => [{ id: randomUUID(), kind: "wait", title: "Wait", days: 1 }, { id: randomUUID(), kind: "email", title: "Followup", subject: "Hi", body: "Hello" }];
const split = { id: randomUUID(), afterStepId: anchor.id, title: "Accepted?", percentage: 50, condition: { kind: "linkedin_connected", timeoutDays: 7 }, pathA: path(), pathB: path() };
const definition = { schemaVersion: 1, steps: [anchor], splits: [split] };
let sentAt: Date;
let state: string;
beforeEach(() => {
  vi.clearAllMocks(); sentAt = new Date(Date.now() - 86400_000); state = "active";
  mock.gmail.inboundFrom.mockResolvedValue([]); mock.gmail.hasConversation.mockResolvedValue(false); mock.gmail.outboundToSince.mockResolvedValue([]);
  mock.query.mockResolvedValue({ rows: [], rowCount: 1 });
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.startsWith("SELECT * FROM campaign_enrolments")) return [{ id, state, organization_id: "org", owner_user_id: "owner", step_index: 0, next_step_at: new Date(0), recipient_email: "alex@example.test", started_at: sentAt, initial_conversation_reviewed: true }];
    if (sql.includes("FROM campaign_sequence_versions")) return [{ definition }];
    if (sql.includes("FROM mailbox_connections")) return [{ id: "mailbox" }];
    if (sql.includes("FROM contacts")) return [{ id: "contact", display_name: "Alex", personal_data: { email: "alex@example.test", linkedinUrl: "https://www.linkedin.com/in/alex" }, fictionalised: false }];
    if (sql.startsWith("SELECT state, sent_at")) return [{ state: "sent", sent_at: sentAt }];
    return [];
  });
});
it("polls a sent request without resending while acceptance is pending", async () => {
  mock.linkedin.mockResolvedValue({ connected: false });
  expect(await processCampaignEnrolment(actor, id)).toEqual({ outcome: "waiting_for_acceptance" });
  expect(mock.linkedin).toHaveBeenCalledExactlyOnceWith(actor, { operation: "status", profile: "https://www.linkedin.com/in/alex" });
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("state = 'claimed'"))).toBe(false);
});
it.each([true, false])("persists the observed %s branch before advancing", async connected => {
  sentAt = new Date(Date.now() - 8 * 86400_000); mock.linkedin.mockResolvedValue({ connected });
  expect(await processCampaignEnrolment(actor, id)).toEqual({ outcome: "sent" });
  const event = mock.query.mock.calls.find(([sql]) => sql.includes("'campaign.branch_decided'"));
  expect(JSON.parse(event![1][3])).toMatchObject({ splitId: split.id, path: connected ? "pathA" : "pathB" });
  const update = mock.query.mock.calls.find(([sql]) => sql.includes("step_index = $3"));
  expect(update![1][2]).toBe(connected ? 2 : 4);
});
it("holds unknown status instead of routing down the timeout path", async () => {
  sentAt = new Date(0); mock.linkedin.mockResolvedValue({ connected: null });
  expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review" });
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("'campaign.branch_decided'"))).toBe(false);
});
it("does no provider work for a paused enrolment", async () => {
  state = "paused";
  expect(await processCampaignEnrolment(actor, id)).toEqual({ outcome: "not_due" });
  expect(mock.linkedin).not.toHaveBeenCalled();
});
