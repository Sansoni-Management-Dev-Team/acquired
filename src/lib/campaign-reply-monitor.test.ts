import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), read: vi.fn(), inbound: vi.fn(), connected: vi.fn(), linkedin: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({ query: mock.query }), withCampaignWorker: (fn: (client: unknown) => unknown) => fn({ query: mock.query }) }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignMailboxForConnection: () => ({ inboundFrom: mock.inbound }) }));
vi.mock("@/lib/campaign-reply-providers", () => ({ readChannelReplies: mock.read }));
vi.mock("@/lib/campaign-whatsapp", async original => ({ ...await original<typeof import("./campaign-whatsapp")>(), whatsappCampaignEnabled: () => true, assertCampaignWhatsappConnected: mock.connected }));
vi.mock("@/lib/campaign-linkedin", () => ({ linkedinCampaignEnabled: () => true, campaignLinkedinAccountStatus: async () => "connected", linkedinProfileFor: (data: Record<string, unknown>) => { if (!data.linkedinUrl) throw new Error("missing"); return data.linkedinUrl; }, campaignLinkedin: mock.linkedin }));
import { checkContactReplyMonitors, scanReplyChannel, assertContactReplyFresh, prepareReplyContact, checkScheduledReplyContact, runReplyMonitorTick } from "./campaign-reply-monitor";
import { withCampaignWorkBudget, CampaignWorkDeferred } from "./campaign-work-budget";
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

it("registers LinkedIn-only reply monitoring without an email identity", async () => {
  await prepareReplyContact(actor, { ...contact, email: null, data: { linkedinUrl: "https://www.linkedin.com/in/alex" }, requiredChannels: ["linkedin"] });
  const inserts = mock.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO campaign_reply_identities"));
  expect(inserts).toHaveLength(1);
  expect(inserts[0][1][3]).toBe("linkedin");
  expect(inserts[0][1][6]).toBe("");
  expect(mock.inbound).not.toHaveBeenCalled();
});
it("monitors replies on connected Gmail even when the sequence only sends LinkedIn", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => {
    if (sql.includes("FROM campaign_reply_identities")) return [];
    if (sql.includes("FROM mailbox_connections")) return [{ encrypted_refresh_token: "encrypted", reconnect_required: false, scopes: ["https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose"] }];
    return original(client, sql);
  });
  await prepareReplyContact(actor, { ...contact, data: { linkedinUrl: "https://www.linkedin.com/in/alex" }, requiredChannels: ["linkedin"] });
  const channels = mock.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO campaign_reply_identities")).map(([, values]) => values[3]);
  expect(channels).toEqual(["email", "linkedin"]);
});
it("keeps social-only campaigns usable without an optional Gmail connection", async () => {
  mock.rows.mockResolvedValue([]);
  await prepareReplyContact(actor, { ...contact, data: { linkedinUrl: "https://www.linkedin.com/in/alex" }, requiredChannels: ["linkedin"] });
  const channels = mock.query.mock.calls.filter(([sql]) => sql.startsWith("INSERT INTO campaign_reply_identities")).map(([, values]) => values[3]);
  expect(channels).toEqual(["linkedin"]);
});
it("does not require an email monitor for a fresh LinkedIn-only contact", async () => {
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.includes("FROM campaign_reply_identities") && !sql.includes("JOIN")) return [{ channel: "linkedin", identity: "urn:li:fsd_profile:alex" }];
    if (sql.includes("FROM campaign_reply_monitors")) return [{ channel: "linkedin", last_success_at: new Date(), last_error: null }];
    return [];
  });
  await expect(assertContactReplyFresh(actor, "contact", ["linkedin"])).resolves.toBeUndefined();
});

it("scheduled contact evaluation checks durable health without another provider scan", async () => {
  await checkScheduledReplyContact(actor, contact);
  expect(mock.inbound).not.toHaveBeenCalled(); expect(mock.read).not.toHaveBeenCalled(); expect(mock.linkedin).not.toHaveBeenCalled();
  expect(mock.rows.mock.calls.some(([, sql]) => sql.includes("FROM campaign_reply_monitors"))).toBe(true);
});

it("scheduled evaluation still rejects incomplete monitoring and shared contact holds", async () => {
  success = null; error = "incomplete";
  await expect(checkScheduledReplyContact(actor, contact)).rejects.toThrow("stale or disconnected");
  expect(mock.inbound).not.toHaveBeenCalled();
  success = new Date(); error = null;
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => sql.includes("JOIN campaign_reply_holds") ? [{ reason: "reply_received" }] : original(client, sql));
  await expect(checkScheduledReplyContact(actor, contact)).rejects.toThrow("shares a replied identity");
});

it("reports a partial scheduled scan and commits just one resumable page", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => sql.startsWith("SELECT DISTINCT i.organization_id") ? [{ organization_id: "org", owner_user_id: "owner", channel: "linkedin" }] : original(client, sql));
  mock.read.mockResolvedValue({ accountIdentity: "account", events: [], nextCursor: "partial", complete: false, checkedAt: new Date().toISOString() });
  expect(await runReplyMonitorTick()).toEqual({ scanned: 1, complete: 0, incomplete: 1, failed: 0, skipped: 0, deferred: 0 });
  expect(mock.read).toHaveBeenCalledOnce(); expect(cursor).toBe("partial"); expect(success).toBeNull();
});

it("reports lease contention as skipped rather than a completed scan", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => {
    if (sql.startsWith("SELECT DISTINCT i.organization_id")) return [{ organization_id: "org", owner_user_id: "owner", channel: "linkedin" }];
    if (sql.startsWith("UPDATE campaign_reply_monitors")) return [];
    return original(client, sql);
  });
  expect(await runReplyMonitorTick()).toEqual({ scanned: 0, complete: 0, incomplete: 0, failed: 0, skipped: 1, deferred: 0 });
  expect(mock.read).not.toHaveBeenCalled();
});

it("reports provider failures separately and defers accounts it has not started", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => sql.startsWith("SELECT DISTINCT i.organization_id") ? [{ organization_id: "org", owner_user_id: "owner", channel: "linkedin" }] : original(client, sql));
  mock.read.mockRejectedValue(new Error("provider offline"));
  expect(await runReplyMonitorTick()).toMatchObject({ scanned: 1, failed: 1, incomplete: 0 });
  mock.read.mockClear();
  expect(await withCampaignWorkBudget(0, () => runReplyMonitorTick())).toMatchObject({ scanned: 0, failed: 0, deferred: 1 });
  expect(mock.read).not.toHaveBeenCalled();
});

it("scheduled checks defer an in-flight inbox lease while delivery preflight remains strict", async () => {
  success = null;
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => {
    if (sql === "SELECT * FROM campaign_reply_monitors WHERE organization_id = $1 AND owner_user_id = $2") return [{ channel: "email", last_success_at: null, last_error: null, lease_until: new Date(Date.now() + 60_000) }];
    return original(client, sql);
  });
  await expect(checkScheduledReplyContact(actor, contact)).rejects.toBeInstanceOf(CampaignWorkDeferred);
  await expect(assertContactReplyFresh(actor, contact.id, ["email"])).rejects.toThrow("stale or disconnected");
});
