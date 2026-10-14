import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), send: vi.fn(), connected: vi.fn(), gmail: { inboundFrom: vi.fn(), hasConversation: vi.fn(), outboundToSince: vi.fn() } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/campaign-reply-monitor",()=>({checkContactReplyMonitors:vi.fn(),assertContactReplyFresh:vi.fn()}));
vi.mock("@/lib/channels/delivery-registry", async () => {
  const { campaignDeliveryFixture } = await import("@/test/campaign-delivery-fixture");
  return { deliveryProvider: campaignDeliveryFixture({ whatsappReady: mock.connected, whatsappSend: mock.send }) };
});
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({ query: mock.query }), withCampaignWorker: (fn: (client: unknown) => unknown) => fn({ query: mock.query }) }));
vi.mock("@/test/fixtures/gmail-connection", () => ({ connectionCanMonitorReplies: () => true }));
vi.mock("@/test/fixtures/campaign-mailbox", () => ({ campaignTestSendAnytime: () => true, campaignMailboxForConnection: () => mock.gmail }));
vi.mock("@/test/fixtures/campaign-whatsapp", async importOriginal => ({ ...await importOriginal<typeof import("@/test/fixtures/campaign-whatsapp")>(), campaignWhatsapp: mock.send, assertCampaignWhatsappConnected: mock.connected }));
vi.mock("@/lib/communications-bindings",()=>({resolveRecordedApplicationConnection:async(actor:{organizationId:string;userId:string},channel:string)=>({bindingId:'original',binding:{applicationId:'acquire',tenantId:actor.organizationId,ownerId:actor.userId,connectionId:'original',accountId:'account',generation:1,channel,platform:channel,backend:'unipile'},recoveryOnly:false})}));
vi.mock("@/lib/communications-client",()=>({actorCommunicationsClient:async()=>({ready:async()=>{await mock.connected();return {status:'ready'};}})}));
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
import { processCampaignEnrolment } from "./campaign-service";
const actor = { organizationId: "org", userId: "owner" };
const id = randomUUID();
const message = { id: randomUUID(), kind: "whatsapp", title: "WhatsApp introduction", body: "Hi {{first_name}} at {{company_name}}" };
const definition = { schemaVersion: 1, steps: [message, { id: randomUUID(), kind: "wait", title: "Wait", days: 3 }, { id: randomUUID(), kind: "email", title: "Follow-up", subject: "Hi", body: "Hello" }] };
let state: string, previous: string | undefined, phoneChanged: boolean, held: boolean;
beforeEach(() => {
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-06T01:00:00Z"));vi.stubEnv("COMMUNICATIONS_RUNTIME_ENABLED","true");vi.clearAllMocks(); state = "active"; previous = undefined; phoneChanged = false; held = false;
  mock.gmail.inboundFrom.mockResolvedValue([]); mock.gmail.hasConversation.mockResolvedValue(false); mock.gmail.outboundToSince.mockResolvedValue([]);
  mock.query.mockResolvedValue({ rows: [], rowCount: 1 }); mock.connected.mockResolvedValue(undefined); mock.send.mockResolvedValue({ id: "provider-id", recipient: "+61412345678", status: "submitted",sentAt:new Date().toISOString() });
  let contactReads = 0;
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.startsWith("SELECT * FROM campaign_enrolments")) return [{ id, state, organization_id: "org", owner_user_id: "owner", step_index: 0, next_step_at: new Date(0), recipient_email: "alex@example.test", started_at: new Date(0), initial_conversation_reviewed: true }];
    if (sql.includes("FROM campaign_sequence_versions")) return [{ definition }];
    if (sql.includes("FROM mailbox_connections")) return [{ id: "mailbox", daily_cap: 100 }];
    if (sql.includes("FROM contacts")) return [{ id: "contact", display_name: "Alex Smith", company_name: "Example", personal_data: { email: "alex@example.test", phone: phoneChanged && contactReads++ > 0 ? "+61499999999" : "+61412345678" }, fictionalised: false }];
    if (sql.startsWith("SELECT state, sent_at")) return previous ? [{ state: previous, sent_at: new Date(0) }] : [];
    if (sql.includes("FROM campaign_contact_holds")) return held ? [{ id: "hold", reason: "do_not_contact" }] : [];
    if (sql.includes("FROM campaign_contact_assignments")) return [{ id: "assignment" }];
    if (sql.startsWith("SELECT count(*)")) return [{ used: "0" }];
    if (sql.startsWith("INSERT INTO campaign_send_attempts")) return [{ id: "attempt" }];
    return [];
  });
});
it("sends the personalized message once and records the provider result before advancing", async () => {
  expect(await processCampaignEnrolment(actor, id)).toEqual({ outcome: "sent" });
  expect(mock.send).toHaveBeenCalledExactlyOnceWith(actor, { key:`campaign:${id}:${message.id}`,recipient: "+61412345678", text: "Hi Alex at Example" });
  expect(mock.query.mock.calls.find(([sql]) => sql.includes("provider_message_id = $2"))![1][1]).toBe("whatsapp:provider-id");
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO audit_events") && mock.query.mock.calls.some(([,values])=>values.includes("campaign.whatsapp_submitted")))).toBe(true);
  expect(mock.query.mock.calls.find(([sql]) => sql.includes("step_index = $3"))![1][2]).toBe(2);
});
it("advances a recorded send after a crash without submitting again", async () => {
  previous = "sent";
  expect(await processCampaignEnrolment(actor, id)).toEqual({ outcome: "sent" });
  expect(mock.send).not.toHaveBeenCalled(); expect(mock.connected).not.toHaveBeenCalled();
});
it.each(["claimed", "unknown"])("holds an unresolved %s attempt without resending", async status => {
  previous = status;
  expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review" });
  expect(mock.send).not.toHaveBeenCalled();
});
it("records an uncertain response for review instead of retrying the provider", async () => {
  mock.send.mockRejectedValue(new Error("timeout after acceptance"));
  expect(await processCampaignEnrolment(actor, id)).toEqual({ outcome: "needs_review" });
  expect(mock.send).toHaveBeenCalledOnce();
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("state = 'unknown'"))).toBe(true);
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("whatsapp_result_unknown"))).toBe(true);
});
it("holds a disconnected account before claiming a send", async () => {
  mock.connected.mockRejectedValue(new Error("Reconnect WhatsApp"));
  expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review" });
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.rows.mock.calls.some(([,sql]) => sql.startsWith("INSERT INTO campaign_send_attempts"))).toBe(false);
});
it("cancels a claim if the phone changed during preflight", async () => {
  phoneChanged = true;
  expect(await processCampaignEnrolment(actor, id)).toMatchObject({ outcome: "needs_review" });
  expect(mock.send).not.toHaveBeenCalled();
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("state = 'cancelled'"))).toBe(true);
});
it.each(["paused", "held"])("does no provider work for a %s contact", async mode => {
  if (mode === "paused") state = "paused"; else held = true;
  if (mode === "held") await expect(processCampaignEnrolment(actor, id)).rejects.toThrow("Contact is held");
  else await processCampaignEnrolment(actor, id);
  expect(mock.send).not.toHaveBeenCalled(); expect(mock.connected).not.toHaveBeenCalled();
});
