import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
vi.mock("@/lib/campaign-reply-providers", () => ({ readChannelReplies: vi.fn() }));
import { readChannelReplies } from "@/lib/campaign-reply-providers";
import { runCampaignTick, changeEnrolment } from "@/lib/campaign-service";
import { runReplyMonitorTick, scanReplyChannel } from "@/lib/campaign-reply-monitor";
import { withCampaignTickLock, withCampaignWorker } from "./campaign-client";
import { campaignReadSignal, withCampaignWorkBudget, CampaignWorkDeferred } from "@/lib/campaign-work-budget";
import type { ReplyPage } from "@/domain/campaign-replies";

// The external inbox reader is replaced. Real pooled transactions, advisory
// locks, RLS, durable checkpoints and the full tick run on loopback OrbStack.
describe.skipIf(process.env.CAMPAIGN_AUDIT_LOCAL_DB !== "1")("local campaign scheduler integration", () => {
  const db = new pg.Client({ connectionString: "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire" });
  const org = `scheduler-test-${randomUUID()}`, user = `scheduler-test-${randomUUID()}`;
  const actor = { organizationId: org, userId: user };
  const mandate = randomUUID(), sequence = randomUUID(), version = randomUUID();
  const contacts = Array.from({ length: 5 }, () => randomUUID());
  const reader = vi.mocked(readChannelReplies);
  const page = (cursor: string, complete = false): ReplyPage => ({ accountIdentity: "synthetic-account", events: [], nextCursor: cursor, complete, checkedAt: new Date().toISOString() });
  const monitor = async () => (await db.query("SELECT * FROM campaign_reply_monitors WHERE organization_id=$1", [org])).rows[0];
  let fixtures = false;
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire");
    vi.stubEnv("DATABASE_SSL_CA", ""); vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce");
    vi.stubEnv("CAMPAIGN_LINKEDIN_ENABLED", "true"); vi.stubEnv("LINKEDIN_SERVICE_URL", "http://127.0.0.1:18096"); vi.stubEnv("LINKEDIN_SERVICE_SECRET", "synthetic-unused");
    await db.connect();
    if ((await db.query("SELECT count(*)::int n FROM campaign_enrolments WHERE state IN ('active','paused','needs_review')")).rows[0].n) throw new Error("Scheduler integration requires an idle local campaign database; it never processes other subscriptions");
    await db.query("BEGIN");
    try {
      await db.query('INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,false,now(),now())', [user, `${user}@example.invalid`]);
      await db.query("INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)", [org]);
      await db.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), org, user]);
      await db.query("INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,'Synthetic scheduler','{}','{}',$3)", [mandate, org, user]);
      await db.query("INSERT INTO campaign_sequences (id,organization_id,owner_user_id,mandate_id,name,draft) VALUES ($1,$2,$3,$4,'Synthetic scheduler','{}')", [sequence, org, user, mandate]);
      const definition = { schemaVersion: 1, steps: [{ id: randomUUID(), kind: "linkedin", action: "message", title: "Hello", body: "Synthetic" }] };
      await db.query("INSERT INTO campaign_sequence_versions (id,organization_id,owner_user_id,sequence_id,version,definition) VALUES ($1,$2,$3,$4,1,$5)", [version, org, user, sequence, JSON.stringify(definition)]);
      for (const [i, contact] of contacts.entries()) {
        const profile = `https://www.linkedin.com/in/scheduler-synthetic-${i}`;
        await db.query("INSERT INTO contacts (id,organization_id,mandate_id,display_name,personal_data,provenance,fictionalised) VALUES ($1,$2,$3,'Synthetic',$4,'{}',false)", [contact, org, mandate, JSON.stringify({ linkedinUrl: profile })]);
        await db.query("INSERT INTO campaign_contact_assignments (organization_id,contact_id,owner_user_id,email) VALUES ($1,$2,$3,NULL)", [org, contact, user]);
        await db.query("INSERT INTO campaign_enrolments (organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,recipient_linkedin,state,stop_reason,runtime,n8n_started_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'needs_review','reply_check_failed','n8n',now())", [org, user, sequence, version, mandate, contact, profile]);
        await db.query("INSERT INTO campaign_reply_identities (organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES ($1,$2,$3,'linkedin',$4,$5,'',now())", [org, user, contact, `urn:li:fsd_profile:scheduler${i}`, profile]);
      }
      await db.query("COMMIT"); fixtures = true;
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  });
  beforeEach(async () => {
    reader.mockReset();
    await db.query("UPDATE campaign_enrolments SET last_reply_checked_at=NULL,state='needs_review',stop_reason='reply_check_failed',next_step_at=NULL WHERE organization_id=$1", [org]);
    await db.query("DELETE FROM campaign_reply_monitors WHERE organization_id=$1", [org]);
  });
  afterAll(async () => {
    try {
      if (fixtures) {
        await db.query("BEGIN");
        for (const table of ["campaign_reply_receipts", "campaign_reply_holds", "campaign_send_attempts", "campaign_reply_monitors", "campaign_reply_identities", "campaign_enrolments", "campaign_contact_assignments", "campaign_sequence_versions", "campaign_sequences", "contacts", "mandates", "audit_events", "member"]) await db.query(`DELETE FROM ${table} WHERE organization_id=$1`, [org]);
        await db.query("DELETE FROM organization WHERE id=$1", [org]); await db.query('DELETE FROM "user" WHERE id=$1', [user]);
        await db.query("COMMIT");
      }
    } finally {
      await db.end();
      const globals = globalThis as typeof globalThis & { acquireCampaignPool?: pg.Pool };
      await globals.acquireCampaignPool?.end(); delete globals.acquireCampaignPool;
      vi.unstubAllEnvs();
    }
  });
  it("scans one shared account per tick, rotates five contacts and preserves review holds", async () => {
    let cursor = 0; reader.mockImplementation(async () => page(`cursor-${++cursor}`));
    for (let i = 0; i < 5; i++) {
      await db.query("UPDATE campaign_reply_monitors SET last_attempt_at=now()-interval '1 minute' WHERE organization_id=$1", [org]);
      const result = await runCampaignTick();
      expect(result).toMatchObject({ processed: 0, replyScans: 1, n8nDispatches: 0, replyMonitoring: { scanned: 1, incomplete: 1, failed: 0 } });
      expect(result.scheduler.deferred).toBe(false);
      expect(reader).toHaveBeenCalledTimes(i + 1);
      expect((await monitor()).cursor).toBe(`cursor-${i + 1}`);
    }
    const checked = (await db.query("SELECT state,stop_reason,last_reply_checked_at FROM campaign_enrolments WHERE organization_id=$1", [org])).rows;
    expect(checked).toHaveLength(5);
    for (const item of checked) expect(item).toMatchObject({ state: "needs_review", stop_reason: "reply_check_failed", last_reply_checked_at: expect.any(Date) });
    expect((await monitor()).last_success_at).toBeNull();
  });
  it("resumes scheduled pagination from committed cursors and marks only completion fresh", async () => {
    reader.mockResolvedValueOnce(page("partial"));
    expect(await runReplyMonitorTick()).toMatchObject({ scanned: 1, incomplete: 1, complete: 0 });
    expect((await monitor()).last_success_at).toBeNull();
    await db.query("UPDATE campaign_reply_monitors SET last_attempt_at=now()-interval '1 minute' WHERE organization_id=$1", [org]);
    reader.mockResolvedValueOnce(page("complete", true));
    expect(await runReplyMonitorTick()).toMatchObject({ scanned: 1, complete: 1, incomplete: 0 });
    expect(reader.mock.calls[1][2]).toBe("partial");
    expect((await monitor()).last_success_at).toBeInstanceOf(Date);
  });
  it("excludes overlapping ticks and releases the advisory lock after failure", async () => {
    await withCampaignTickLock(async () => expect(await withCampaignTickLock(async () => "unreachable")).toEqual({ acquired: false }));
    await expect(withCampaignTickLock(async () => { throw new Error("synthetic failure"); })).rejects.toThrow("synthetic failure");
    expect(await withCampaignTickLock(async () => "next tick")).toEqual({ acquired: true, result: "next tick" });
  });
  it("cancels a scheduled database statement and rolls the transaction back", async () => {
    await expect(withCampaignWorkBudget(50, () => withCampaignWorker(client => client.query("SELECT pg_sleep(1)")))).rejects.toBeInstanceOf(CampaignWorkDeferred);
    expect(await withCampaignWorker(async client => (await client.query("SELECT current_setting('statement_timeout') timeout")).rows[0].timeout)).toBe("0");
  });
  it("releases a scan lease after a deadline-aborted inbox read without advancing its cursor", async () => {
    reader.mockImplementationOnce(async () => {
      const signal = campaignReadSignal();
      return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    });
    await expect(withCampaignWorkBudget(100, () => scanReplyChannel(actor, "linkedin", { maxPages: 1 }))).rejects.toThrow();
    expect(await monitor()).toMatchObject({ cursor: null, lease_token: null, lease_until: null, last_success_at: null });
    expect((await monitor()).last_error).toContain("timeout");
  });
  it("finishes an admitted page commit and lease cleanup after the work budget expires", async () => {
    reader.mockImplementationOnce(async () => { await new Promise(resolve => setTimeout(resolve, 100)); return page("saved-after-deadline"); });
    expect(await withCampaignWorkBudget(50, () => scanReplyChannel(actor, "linkedin", { maxPages: 1 }))).toMatchObject({ complete: false, cursor: "saved-after-deadline" });
    expect(await monitor()).toMatchObject({ cursor: "saved-after-deadline", last_success_at: null, lease_token: null, lease_until: null });
  });
  it("keeps an active scheduled step during incomplete coverage and audits the retry", async () => {
    const scheduled = new Date(Date.now() + 3_600_000);
    await db.query("UPDATE campaign_enrolments SET state='active',stop_reason=NULL,next_step_at=$2 WHERE organization_id=$1", [org, scheduled]);
    reader.mockResolvedValue({ ...page("pending"), nextReadAt: new Date(Date.now() + 120_000).toISOString() });
    await runCampaignTick();
    const waiting = (await db.query("SELECT * FROM campaign_enrolments WHERE organization_id=$1 AND last_reply_checked_at IS NOT NULL", [org])).rows;
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ state: "active", stop_reason: "reply_monitor_wait", next_step_at: scheduled, step_index: 0 });
    const audit = (await db.query("SELECT metadata FROM audit_events WHERE organization_id=$1 AND action='campaign.reply_check_waiting' ORDER BY created_at DESC LIMIT 1", [org])).rows[0].metadata;
    expect(audit).toMatchObject({ category: "retry", channel: "linkedin", phase: "maintenance", retryAt: expect.any(String), transition: { from: "active", to: "active" } });
    expect((await db.query("SELECT * FROM campaign_send_attempts WHERE organization_id=$1", [org])).rowCount).toBe(0);
  });
  it("does not restore any of the five holds until fresh scoped coverage and delivery gates pass", async () => {
    reader.mockResolvedValue({ ...page("verified", true), checkedAt: new Date().toISOString() });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Response.json({ fixture: false, protection: { liveSendsEnabled: false, campaignsEnabled: false } })));
    const jobs = (await db.query("SELECT id FROM campaign_enrolments WHERE organization_id=$1 ORDER BY id", [org])).rows;
    try {
      for (const job of jobs) await expect(changeEnrolment(actor, job.id, "retry_preflight")).rejects.toMatchObject({ code: "delivery_disabled" });
      expect((await db.query("SELECT count(*)::int n FROM campaign_enrolments WHERE organization_id=$1 AND state='needs_review' AND next_step_at IS NULL", [org])).rows[0].n).toBe(5);
      vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Response.json({ fixture: false, protection: { liveSendsEnabled: true, campaignsEnabled: true } })));
      for (const job of jobs) expect(await changeEnrolment(actor, job.id, "retry_preflight")).toMatchObject({ state: "active", nextStepAt: expect.any(Date) });
      expect((await db.query("SELECT count(*)::int n FROM campaign_enrolments WHERE organization_id=$1 AND state='active' AND next_step_at IS NOT NULL", [org])).rows[0].n).toBe(5);
      expect((await db.query("SELECT * FROM campaign_send_attempts WHERE organization_id=$1", [org])).rowCount).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });

});
