import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
vi.mock("@/lib/campaign-reply-providers", () => ({ readChannelReplies: vi.fn() }));
import { readChannelReplies } from "@/lib/campaign-reply-providers";
import { scanReplyChannel } from "@/lib/campaign-reply-monitor";
import { withCampaignDb } from "@/db/campaign-client";
import type { ReplyPage } from "@/domain/campaign-replies";

// Real pooled transactions and RLS; only the external inbox reader is replaced.
describe.skipIf(process.env.CAMPAIGN_AUDIT_LOCAL_DB !== "1")("local reply monitor lease and page integration", () => {
  const url = "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire";
  const db = new pg.Client({ connectionString: url });
  const org = `monitor-test-${randomUUID()}`, user = `monitor-test-${randomUUID()}`;
  const actor = { organizationId: org, userId: user };
  const reader = vi.mocked(readChannelReplies);
  const page = (overrides: Partial<ReplyPage> = {}): ReplyPage => ({ accountIdentity: "synthetic-account", events: [], nextCursor: "after", complete: true, checkedAt: new Date().toISOString(), ...overrides });
  const monitor = async () => (await db.query("SELECT * FROM campaign_reply_monitors WHERE organization_id=$1", [org])).rows[0];
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", url);
    vi.stubEnv("DATABASE_SSL_CA", "");
    vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce");
    await db.connect();
    const schema = await db.query("SELECT to_regclass('public.campaign_reply_monitors') AS name");
    if (!schema.rows[0].name) throw new Error("Reply schema is missing. Obtain explicit approval for drizzle/0016_campaign_reply_monitor.sql; this test never migrates.");
    await db.query("BEGIN");
    try {
      await db.query('INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,false,now(),now())', [user, `${user}@example.invalid`]);
      await db.query("INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)", [org]);
      await db.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), org, user]);
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  });
  beforeEach(async () => {
    reader.mockReset();
    await db.query("DELETE FROM campaign_reply_receipts WHERE organization_id=$1", [org]);
    await db.query("DELETE FROM campaign_reply_monitors WHERE organization_id=$1", [org]);
    await db.query("INSERT INTO campaign_reply_monitors (organization_id,owner_user_id,channel,cursor) VALUES ($1,$2,'linkedin','before')", [org, user]);
  });
  afterAll(async () => {
    try {
      await db.query("DELETE FROM campaign_reply_receipts WHERE organization_id=$1", [org]);
      await db.query("DELETE FROM campaign_reply_monitors WHERE organization_id=$1", [org]);
      await db.query("DELETE FROM member WHERE organization_id=$1", [org]);
      await db.query("DELETE FROM organization WHERE id=$1", [org]);
      await db.query('DELETE FROM "user" WHERE id=$1', [user]);
    } finally {
      await db.end();
      const globals = globalThis as typeof globalThis & { acquireCampaignPool?: pg.Pool };
      await globals.acquireCampaignPool?.end();
      delete globals.acquireCampaignPool;
      vi.unstubAllEnvs();
    }
  });
  it("commits receipt and cursor through real restricted roles, then releases its lease", async () => {
    reader.mockResolvedValue(page({ events: [{ id: "unmatched", fromIdentity: "urn:li:fsd_profile:synthetic", receivedAt: new Date().toISOString() }] }));
    expect(await scanReplyChannel(actor, "linkedin")).toEqual({ complete: true, cursor: "after" });
    expect(await monitor()).toMatchObject({ cursor: "after", account_identity: "synthetic-account", last_error: null, lease_token: null, lease_until: null });
    expect((await monitor()).last_success_at).toBeInstanceOf(Date);
    expect((await db.query("SELECT count(*)::int n FROM campaign_reply_receipts WHERE organization_id=$1", [org])).rows[0].n).toBe(1);
    expect(await withCampaignDb(actor, async client => (await client.query("SELECT current_user role")).rows[0].role)).toBe("acquire_campaign_user");
  });
  it("excludes a competing scanner while an inbox read is in flight", async () => {
    let finish!: (value: ReplyPage) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    reader.mockImplementationOnce(async () => { entered(); return new Promise(resolve => { finish = resolve; }); });
    const first = scanReplyChannel(actor, "linkedin");
    await started;
    try {
      expect(await scanReplyChannel(actor, "linkedin")).toEqual({ complete: false, skipped: true });
      expect(reader).toHaveBeenCalledTimes(1);
    } finally { finish(page()); await first; }
  });
  it("takes over an expired lease", async () => {
    await db.query("UPDATE campaign_reply_monitors SET lease_token=$2,lease_until=now()-interval '1 second' WHERE organization_id=$1", [org, randomUUID()]);
    reader.mockResolvedValue(page());
    expect((await scanReplyChannel(actor, "linkedin")).complete).toBe(true);
    expect((await monitor()).lease_token).toBeNull();
  });
  it("fences a stale scanner and does not clear its replacement's lease", async () => {
    const replacement = randomUUID();
    reader.mockImplementationOnce(async () => {
      await db.query("UPDATE campaign_reply_monitors SET lease_token=$2,lease_until=now()+interval '5 minutes' WHERE organization_id=$1", [org, replacement]);
      return page({ events: [{ id: "stale", fromIdentity: "urn:li:fsd_profile:synthetic", receivedAt: new Date().toISOString() }] });
    });
    expect(await scanReplyChannel(actor, "linkedin")).toEqual({ complete: false, cursor: "before" });
    expect(await monitor()).toMatchObject({ cursor: "before", lease_token: replacement, last_success_at: null });
    expect((await db.query("SELECT 1 FROM campaign_reply_receipts WHERE organization_id=$1", [org])).rowCount).toBe(0);
  });
  it("persists a partial checkpoint without asserting freshness", async () => {
    reader.mockResolvedValue(page({ complete: false, nextReadAt: new Date(Date.now() + 60_000).toISOString() }));
    expect((await scanReplyChannel(actor, "linkedin")).complete).toBe(false);
    expect(await monitor()).toMatchObject({ cursor: "after", last_success_at: null, lease_token: null });
    expect((await monitor()).last_error).toContain("incomplete");
  });
  it.each(["provider outage", "changed account", "future event"])("keeps the checkpoint on %s and releases the failed scan lease", async failure => {
    if (failure === "provider outage") reader.mockRejectedValue(new Error("Inbox offline"));
    if (failure === "changed account") {
      await db.query("UPDATE campaign_reply_monitors SET account_identity='original-account',last_success_at=now()-interval '1 minute' WHERE organization_id=$1", [org]);
      reader.mockResolvedValue(page());
    }
    if (failure === "future event") reader.mockResolvedValue(page({ events: [{ id: "future", fromIdentity: "urn:li:fsd_profile:synthetic", receivedAt: new Date(Date.now() + 60_000).toISOString() }] }));
    await expect(scanReplyChannel(actor, "linkedin")).rejects.toThrow();
    expect(await monitor()).toMatchObject({ cursor: "before", last_success_at: null, lease_token: null });
    expect((await monitor()).last_error).toBeTruthy();
    expect((await db.query("SELECT 1 FROM campaign_reply_receipts WHERE organization_id=$1", [org])).rowCount).toBe(0);
  });
  it("retains completed coverage through partial scans and transport timeouts", async () => {
    const coverage = new Date(Date.now() - 60_000);
    await db.query("UPDATE campaign_reply_monitors SET last_success_at=$2,account_identity='synthetic-account' WHERE organization_id=$1", [org, coverage]);
    reader.mockResolvedValueOnce(page({ complete: false, nextReadAt: new Date(Date.now() + 60_000).toISOString() }));
    await scanReplyChannel(actor, "linkedin");
    expect(await monitor()).toMatchObject({ last_success_at: coverage, cursor: "after", lease_until: null });
    reader.mockRejectedValueOnce(new DOMException("secret transport details", "TimeoutError"));
    await expect(scanReplyChannel(actor, "linkedin")).rejects.toMatchObject({ code: "timeout" });
    const current = await monitor();
    expect(current).toMatchObject({ last_success_at: coverage, cursor: "after", lease_until: null });
    expect(JSON.parse(current.last_error)).toMatchObject({ category: "retry", code: "timeout", channel: "linkedin", coverageAgeMs: expect.any(Number) });
    expect(current.last_error).not.toContain("secret");
  });

});
