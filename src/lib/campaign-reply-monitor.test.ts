import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), read: vi.fn(), inbound: vi.fn(), connected: vi.fn(), linkedin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({ query: mock.query }), withCampaignWorker: (fn: (client: unknown) => unknown) => fn({ query: mock.query }) }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignMailboxForConnection: () => ({ inboundFrom: mock.inbound }) }));
vi.mock("@/lib/campaign-reply-providers", () => ({ readChannelReplies: mock.read }));
vi.mock("@/lib/campaign-whatsapp", async original => ({ ...await original<typeof import("./campaign-whatsapp")>(), whatsappCampaignEnabled: () => true, assertCampaignWhatsappConnected: mock.connected }));
vi.mock("@/lib/campaign-linkedin", () => ({ linkedinCampaignEnabled: () => true, campaignLinkedinAccountStatus: async () => "connected", linkedinProfileFor: (data: Record<string, unknown>) => { if (!data.linkedinUrl) throw new Error("missing"); return data.linkedinUrl; }, campaignLinkedin: mock.linkedin }));
import { checkContactReplyMonitors, scanReplyChannel, assertContactReplyFresh } from "./campaign-reply-monitor";
const actor = { organizationId: "org", userId: "owner" };
const contact = { id: "contact", email: "alex@example.test", data: {}, since: new Date(0), requiredChannels: ["email" as const] };
let lease: boolean, account: string | null, success: Date | null, error: string | null, cursor: string | null;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce"); lease = true; account = null; success = new Date(); error = null; cursor = null;
  mock.inbound.mockResolvedValue([]); mock.connected.mockResolvedValue(undefined); mock.linkedin.mockResolvedValue({ recipient: "urn:li:fsd_profile:alex" });
  mock.read.mockResolvedValue({ accountIdentity: "wa-account", events: [], nextCursor: "1", complete: true, checkedAt: new Date().toISOString() });
  mock.query.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes("SET account_identity")) { account = values[4] as string; cursor = values[5] as string | null; success = values[6] ? values[7] as Date : null; error = values[6] ? null : "incomplete"; }
    if (sql.includes("SET last_error")) error = values[4] as string;
    return { rowCount: 1, rows: [] };
  });
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.includes("FROM member")) return [{ id: "member" }];
    if (sql.includes("FROM campaign_reply_identities") && !sql.includes("JOIN")) return [{ channel: "email", identity: contact.email, email: contact.email, contact_id: contact.id, since: contact.since }];
    if (sql.includes("FROM mailbox_connections")) return [{ id: "mailbox", address: "me@example.test" }];
    if (sql.startsWith("UPDATE campaign_reply_monitors")) return [{ channel: "email", account_identity: account, cursor, last_success_at: success, last_error: error }];
    if (sql.startsWith("SELECT channel FROM campaign_reply_monitors")) return lease ? [{ channel: "email" }] : [];
    if (sql.includes("FROM campaign_reply_monitors")) return [{ channel: "email", account_identity: account, last_success_at: success, last_error: error }];
    return [];
  });
});
afterEach(() => vi.unstubAllEnvs());
it("checks again before sending even if a previous email scan was fresh", async () => {
  await checkContactReplyMonitors(actor, contact);
  expect(mock.inbound).toHaveBeenCalledWith(contact.email, contact.since);
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("last_success_at = CASE WHEN $7"))).toBe(true);
});
it("does not commit events or checkpoints from a worker whose lease was taken over", async () => {
  lease = false;
  expect(await scanReplyChannel(actor, "whatsapp")).toMatchObject({ complete: false });
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("SET account_identity") || sql.startsWith("INSERT INTO campaign_reply_receipts"))).toBe(false);
});
it("pins the account identity and records failures without advancing the cursor", async () => {
  account = "old-account";
  await expect(scanReplyChannel(actor, "whatsapp")).rejects.toThrow("account changed");
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("SET account_identity"))).toBe(false);
  expect(error).toContain("account changed");
});
it("holds a failed or missing monitor but leaves existing sends alone in observation mode", async () => {
  success = null; error = "disconnected";
  await expect(assertContactReplyFresh(actor, contact.id)).rejects.toThrow("stale or disconnected");
  vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "observe");
  await assertContactReplyFresh(actor, contact.id);
});
it("does not authorize an unresolved LinkedIn identity", async () => {
  mock.linkedin.mockResolvedValue({ status: "retry" });
  await expect(checkContactReplyMonitors(actor, { ...contact, data: { linkedinUrl: "https://linkedin.com/in/alex" }, requiredChannels: ["email", "linkedin"] })).rejects.toThrow("could not be verified");
  expect(mock.read).not.toHaveBeenCalled();
});
it("does not treat a failed optional account lookup as proof that there are no WhatsApp replies", async () => {
  mock.connected.mockRejectedValue(new Error("service offline"));
  await expect(checkContactReplyMonitors(actor, { ...contact, data: { phone: "+61412345678" } })).rejects.toThrow("service offline");
});
it("resumes Gmail from a durable watermark with overlap rather than rereading the contact's entire history", async () => {
  await scanReplyChannel(actor,"email");
  expect(mock.inbound.mock.calls[0][1]).toEqual(new Date(0));
  await scanReplyChannel(actor,"email");
  expect(mock.inbound.mock.calls[1][1].getTime()).toBeGreaterThan(Date.now()-125000);
  expect(cursor).not.toBeNull();
});
