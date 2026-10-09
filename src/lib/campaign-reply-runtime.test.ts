import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), check: vi.fn(), fresh: vi.fn(), email: vi.fn(), whatsapp: vi.fn(), linkedin: vi.fn(), gmail: { inboundFrom: vi.fn(), hasConversation: vi.fn(), outboundToSince: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({ query: mock.query }), withCampaignWorker: (fn: (client: unknown) => unknown) => fn({ query: mock.query }) }));
vi.mock("@/lib/campaign-reply-monitor", () => ({ checkContactReplyMonitors: mock.check, assertContactReplyFresh: mock.fresh, prepareReplyContact: vi.fn(), runReplyMonitorTick: vi.fn() }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignTestSendAnytime: () => true, campaignMailboxForConnection: () => ({ ...mock.gmail, send: mock.email }) }));
vi.mock("@/lib/campaign-whatsapp", async original => ({ ...await original<typeof import("./campaign-whatsapp")>(), campaignWhatsapp: mock.whatsapp, assertCampaignWhatsappConnected: vi.fn() }));
vi.mock("@/lib/campaign-linkedin", async original => ({ ...await original<typeof import("./campaign-linkedin")>(), campaignLinkedin: mock.linkedin, assertLinkedinDeliveryReady: vi.fn() }));
import { ingestCampaignReply } from "./campaign-reply-store";
import { processCampaignEnrolment } from "./campaign-service";
import { ReplyCheckPending } from "./campaign-reply-status";
const actor = { organizationId: "org", userId: "owner" };
const contactId = randomUUID(), id = randomUUID();
let state: string, hold: boolean, kind: "email" | "whatsapp" | "linkedin", incoming: "email" | "whatsapp" | "linkedin";
const identities = { email: "alex@example.test", whatsapp: "61412345678@s.whatsapp.net", linkedin: "urn:li:fsd_profile:alex" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce"); state = "active"; hold = false; kind = "email"; incoming = "email";
  mock.fresh.mockResolvedValue(undefined); mock.gmail.inboundFrom.mockResolvedValue([]); mock.gmail.hasConversation.mockResolvedValue(false); mock.gmail.outboundToSince.mockResolvedValue([]);
  mock.query.mockImplementation(async (sql: string) => { if (sql.includes("WITH stopped AS")) state = "stopped"; if (sql.startsWith("INSERT INTO campaign_reply_holds")) hold = true; return { rowCount: 1, rows: [] }; });
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.includes("FROM member")) return [{ id: "member" }];
    if (sql.includes("FROM campaign_reply_identities")) return [{ contact_id: contactId, email: "alex@example.test", identity: identities[incoming], since: new Date(0) }];
    if (sql.includes("FROM campaign_reply_holds")) return hold ? [{ reason: "reply_received" }] : [];
    if (sql.startsWith("SELECT * FROM campaign_enrolments")) return [{ id, contact_id: contactId, state, organization_id: "org", owner_user_id: "owner", step_index: 0, next_step_at: new Date(0), recipient_email: "alex@example.test", started_at: new Date(0), initial_conversation_reviewed: true }];
    if (sql.includes("FROM campaign_sequence_versions")) return [{ definition: { schemaVersion: 1, steps: [{ id: randomUUID(), kind, title: "Next action", ...(kind === "email" ? { subject: "Hi" } : {}), body: "Hello", ...(kind === "linkedin" ? { action: "message" } : {}) }] } }];
    if (sql.includes("FROM mailbox_connections")) return [{ id: "mailbox", daily_cap: 100 }];
    if (sql.includes("FROM contacts")) return [{ id: contactId, display_name: "Alex", personal_data: { email: "alex@example.test", phone: "+61412345678", linkedinUrl: "https://linkedin.com/in/alex" }, fictionalised: false }];
    return [];
  });
  mock.check.mockImplementation(() => ingestCampaignReply(actor, incoming, "account", { id: "inbound", fromIdentity: identities[incoming], receivedAt: new Date().toISOString() }));
});
afterEach(() => vi.unstubAllEnvs());
for (const reply of ["email", "whatsapp", "linkedin"] as const) for (const action of ["email", "whatsapp", "linkedin"] as const) {
  it(`${reply} reply stops the next ${action} action`, async () => {
    incoming = reply; kind = action;
    await processCampaignEnrolment(actor, id);
    expect(state).toBe("stopped"); expect(hold).toBe(true);
    expect(mock.email).not.toHaveBeenCalled(); expect(mock.whatsapp).not.toHaveBeenCalled(); expect(mock.linkedin).not.toHaveBeenCalled();
  });
}
it("does not send when a required reply monitor failed", async () => {
  mock.check.mockRejectedValue(new Error("linkedin reply monitoring is stale"));
  expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review" });
  expect(mock.email).not.toHaveBeenCalled();
  expect(mock.query.mock.calls.some(([sql, values]) => sql.includes("state = 'needs_review'") && values.includes("linkedin reply monitoring is stale"))).toBe(true);
});

it("retries pending coverage without claiming a send or removing its scheduled step", async () => {
  mock.check.mockRejectedValue(new ReplyCheckPending("incomplete", "linkedin"));
  expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "retry", nextStepAt: expect.any(Date) });
  expect(state).toBe("active");
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("state = 'needs_review'") || sql.includes("next_step_at = NULL"))).toBe(false);
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("campaign.reply_check_waiting"))).toBe(true);
  expect(mock.email).not.toHaveBeenCalled(); expect(mock.whatsapp).not.toHaveBeenCalled(); expect(mock.linkedin).not.toHaveBeenCalled();
});
