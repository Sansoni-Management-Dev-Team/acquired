import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rows: vi.fn(), query: vi.fn(), read: vi.fn(), inbound: vi.fn(), connected: vi.fn(), linkedin: vi.fn(), configuredRefresh:vi.fn(),configuredScan:vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/gmail-connection", () => ({ connectionCanMonitorReplies: (grant: {encryptedRefreshToken: string|null;reconnectRequired: boolean;scopes: string[]|null}) => !!grant.encryptedRefreshToken && !grant.reconnectRequired && !!grant.scopes?.includes("https://www.googleapis.com/auth/gmail.readonly") }));
vi.mock("@/db/campaign-client", () => ({ rows: mock.rows, withCampaignDb: (_actor: unknown, fn: (client: unknown) => unknown) => fn({ query: mock.query }), withCampaignWorker: (fn: (client: unknown) => unknown) => fn({ query: mock.query }) }));
vi.mock("@/lib/campaign-mailbox", () => ({ campaignMailboxForConnection: () => ({ inboundFrom: mock.inbound }) }));
vi.mock("@/lib/campaign-reply-providers", () => ({ readChannelReplies: mock.read }));
vi.mock("@/lib/campaign-whatsapp", async original => ({ ...await original<typeof import("./campaign-whatsapp")>(), whatsappCampaignEnabled: () => true, assertCampaignWhatsappConnected: mock.connected }));
vi.mock("@/lib/campaign-linkedin", () => ({ linkedinCampaignEnabled: () => true, campaignLinkedinAccountStatus: async () => "connected", linkedinProfileFor: (data: Record<string, unknown>) => { if (!data.linkedinUrl) throw new Error("missing"); return data.linkedinUrl; }, campaignLinkedin: mock.linkedin }));
vi.mock('./communications-configured-monitor',()=>({refreshConfiguredContact:mock.configuredRefresh,scanConfiguredChannel:mock.configuredScan}));
import { checkContactReplyMonitors, scanReplyChannel, assertContactReplyFresh, prepareReplyContact, checkScheduledReplyContact, runReplyMonitorTick } from "./campaign-reply-monitor";
import { withCampaignWorkBudget } from "./campaign-work-budget";
import { ReplyCheckPending, ReplyCheckReview } from "./campaign-reply-status";
import { monitorFresh } from "@/domain/campaign-replies";
const actor = { organizationId: "org", userId: "owner" };
const contact = { id: "contact", email: "alex@example.test", data: {}, since: new Date(0), requiredChannels: ["email" as const] };
let lease: boolean, account: string | null, success: Date | null, error: string | null, cursor: string | null;
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce"); lease = true; account = null; success = new Date(); error = null; cursor = null;
  mock.inbound.mockResolvedValue([]); mock.connected.mockResolvedValue(undefined); mock.linkedin.mockResolvedValue({ recipient: "urn:li:fsd_profile:alex" });
  mock.read.mockResolvedValue({ accountIdentity: "wa-account", events: [], nextCursor: "1", complete: true, checkedAt: new Date().toISOString() });
  mock.query.mockImplementation(async (sql: string, values: unknown[]) => {
    if (sql.includes("SET account_identity")) { account = values[4] as string; cursor = values[5] as string | null; success = values[6] ? values[7] as Date : values[10] ? null : sql.includes("ELSE last_success_at") ? success : null; error = values[6] && !values[9] ? null : values[8] as string; }
    if (sql.includes("SET last_error")) { error = values[4] as string; if (values[5]) success = null; }
    return { rowCount: 1, rows: [] };
  });
  mock.rows.mockImplementation(async (_client, sql: string) => {
    if (sql.includes("FROM member")) return [{ id: "member" }];
    if (sql.includes("FROM campaign_reply_identities") && !sql.includes("JOIN")) return [{ channel: "email", identity: contact.email, email: contact.email, contact_id: contact.id, since: contact.since }];
    if (sql.includes("FROM mailbox_connections")) return [{ id: "mailbox", address: "me@example.test" }];
    if (sql.startsWith("UPDATE campaign_reply_monitors")) { if (sql.includes("last_success_at = NULL")) success = null; return [{ channel: "email", account_identity: account, cursor, last_success_at: success, last_error: error }]; }
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
  await expect(scanReplyChannel(actor, "whatsapp")).rejects.toMatchObject({ code: "account_changed" });
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("SET account_identity"))).toBe(false);
  expect(JSON.parse(error!)).toMatchObject({ category: "review", code: "account_changed" });
  expect(success).toBeNull();
});
it("holds a failed or missing monitor but leaves existing sends alone in observation mode", async () => {
  success = null; error = "disconnected";
  await expect(assertContactReplyFresh(actor, contact.id)).rejects.toBeInstanceOf(ReplyCheckReview);
  vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "observe");
  await assertContactReplyFresh(actor, contact.id);
});
it("does not authorize an unresolved LinkedIn identity", async () => {
  mock.linkedin.mockResolvedValue({ status: "retry" });
  await expect(checkContactReplyMonitors(actor, { ...contact, data: { linkedinUrl: "https://linkedin.com/in/alex" }, requiredChannels: ["email", "linkedin"] })).rejects.toMatchObject({ code: "identity_pending" });
  expect(mock.read).not.toHaveBeenCalled();
});
it("does not treat a failed optional account lookup as proof that there are no WhatsApp replies", async () => {
  mock.connected.mockRejectedValue(new Error("service offline"));
  await expect(checkContactReplyMonitors(actor, { ...contact, data: { phone: "+61412345678" } })).rejects.toMatchObject({ code: "unexpected" });
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
  await expect(checkScheduledReplyContact(actor, contact)).rejects.toBeInstanceOf(ReplyCheckPending);
  expect(mock.inbound).not.toHaveBeenCalled();
  success = new Date(); error = null;
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => sql.includes("JOIN campaign_reply_holds") ? [{ reason: "reply_received" }] : original(client, sql));
  await expect(checkScheduledReplyContact(actor, contact)).rejects.toThrow("shares a replied identity");
});

it("reports a partial scheduled scan and commits just one resumable page", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => sql.startsWith("SELECT i.organization_id") ? [{ organization_id: "org", owner_user_id: "owner", channel: "linkedin" }] : original(client, sql));
  mock.read.mockResolvedValue({ accountIdentity: "account", events: [], nextCursor: "partial", complete: false, checkedAt: new Date().toISOString() });
  expect(await runReplyMonitorTick()).toEqual({ scanned: 1, complete: 0, incomplete: 1, failed: 0, skipped: 0, deferred: 0 });
  expect(mock.read).toHaveBeenCalledOnce(); expect(cursor).toBe("partial"); expect(success).toBeInstanceOf(Date);
});

it("reports lease contention as skipped rather than a completed scan", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => {
    if (sql.startsWith("SELECT i.organization_id")) return [{ organization_id: "org", owner_user_id: "owner", channel: "linkedin" }];
    if (sql.startsWith("UPDATE campaign_reply_monitors")) return [];
    return original(client, sql);
  });
  expect(await runReplyMonitorTick()).toEqual({ scanned: 0, complete: 0, incomplete: 0, failed: 0, skipped: 1, deferred: 0 });
  expect(mock.read).not.toHaveBeenCalled();
});

it("reports provider failures separately and defers accounts it has not started", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => sql.startsWith("SELECT i.organization_id") ? [{ organization_id: "org", owner_user_id: "owner", channel: "linkedin" }] : original(client, sql));
  mock.read.mockRejectedValue(new Error("provider offline"));
  expect(await runReplyMonitorTick()).toMatchObject({ scanned: 1, failed: 1, incomplete: 0 });
  mock.read.mockClear();
  expect(await withCampaignWorkBudget(0, () => runReplyMonitorTick())).toMatchObject({ scanned: 0, failed: 0, deferred: 1 });
  expect(mock.read).not.toHaveBeenCalled();
});

it("scheduled and delivery checks retry an in-flight inbox lease without permitting a send", async () => {
  success = null;
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => {
    if (sql === "SELECT * FROM campaign_reply_monitors WHERE organization_id = $1 AND owner_user_id = $2") return [{ channel: "email", last_success_at: null, last_error: null, lease_until: new Date(Date.now() + 60_000) }];
    return original(client, sql);
  });
  await expect(checkScheduledReplyContact(actor, contact)).rejects.toBeInstanceOf(ReplyCheckPending);
  await expect(assertContactReplyFresh(actor, contact.id, ["email"])).rejects.toBeInstanceOf(ReplyCheckPending);
});

it("keeps completed coverage while committing partial progress and still enforces expiry", async () => {
  const completed = success;
  mock.read.mockResolvedValue({ accountIdentity: "wa-account", events: [], nextCursor: "partial", complete: false, checkedAt: new Date().toISOString(), nextReadAt: new Date(Date.now() + 60_000).toISOString() });
  expect(await scanReplyChannel(actor, "whatsapp")).toMatchObject({ complete: false });
  expect(success).toBe(completed);
  expect(monitorFresh({ lastSuccessAt: success, lastError: error })).toBe(true);
  expect(mock.rows.mock.calls.find(([,sql]) => sql.startsWith("UPDATE campaign_reply_monitors"))![1]).not.toContain("last_success_at = NULL");
});

it("preserves coverage and cursor after a retryable transport failure", async () => {
  const completed = success; cursor = "saved";
  mock.read.mockRejectedValue(new DOMException("private details", "TimeoutError"));
  await expect(scanReplyChannel(actor, "linkedin")).rejects.toBeInstanceOf(ReplyCheckPending);
  expect(success).toBe(completed); expect(cursor).toBe("saved");
  expect(error).not.toContain("private details");
});

it("uses the provider's rate-limit wait even when its completed coverage has expired", async () => {
  success = new Date(Date.now() - 600_000);
  const retryAt = new Date(Date.now() + 3_600_000).toISOString();
  mock.read.mockResolvedValue({ accountIdentity: "account", events: [], nextCursor: "rate-wait", complete: true, checkedAt: success.toISOString(), nextReadAt: retryAt, waitReason: "rate_limited" });
  await scanReplyChannel(actor, "whatsapp");
  await expect(assertContactReplyFresh(actor, contact.id)).rejects.toMatchObject({ code: "rate_limited", retryAt: new Date(retryAt) });
});

it("explicitly invalidates the old completed watermark when provider scope changes", async () => {
  mock.read.mockResolvedValue({ accountIdentity: "account", events: [], nextCursor: "scope-change", complete: false, checkedAt: new Date().toISOString(), nextReadAt: new Date(Date.now() + 60_000).toISOString(), coverageInvalidated: true });
  await scanReplyChannel(actor, "whatsapp");
  expect(success).toBeNull();
});

it("extends an existing verified LinkedIn identity to cover an earlier enrolment scope", async () => {
  const original = mock.rows.getMockImplementation()!;
  mock.rows.mockImplementation(async (client, sql: string) => {
    if (sql.includes("FROM campaign_reply_identities") && !sql.includes("JOIN")) return [{ channel: "linkedin", identity: "urn:li:fsd_profile:alex", source_identity: "https://linkedin.com/in/alex", since: new Date(contact.since.getTime() + 60_000) }];
    return original(client, sql);
  });
  await prepareReplyContact(actor, { ...contact, data: { linkedinUrl: "https://linkedin.com/in/alex" }, requiredChannels: ["linkedin"] });
  expect(mock.linkedin).not.toHaveBeenCalled();
  expect(mock.query.mock.calls.some(([sql]) => sql.includes("UPDATE campaign_reply_identities SET since"))).toBe(true);
});

it('configured contact checks use service history and never enter legacy provider readers',async()=>{vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');mock.configuredRefresh.mockResolvedValue({complete:true});await checkContactReplyMonitors(actor,contact);expect(mock.configuredRefresh).toHaveBeenCalledWith(actor,contact);expect(mock.inbound).not.toHaveBeenCalled();expect(mock.connected).not.toHaveBeenCalled();expect(mock.linkedin).not.toHaveBeenCalled();});
it('configured channel ticks use concrete service scan without acquiring old monitor leases',async()=>{vi.stubEnv('COMMUNICATIONS_RUNTIME_ENABLED','true');mock.configuredScan.mockResolvedValue({complete:true});expect(await scanReplyChannel(actor,'whatsapp',{refresh:true})).toEqual({complete:true});expect(mock.configuredScan).toHaveBeenCalledWith(actor,'whatsapp',{refresh:true});expect(mock.query.mock.calls.some(([sql])=>sql.includes('campaign_reply_monitors'))).toBe(false);expect(mock.read).not.toHaveBeenCalled();});
