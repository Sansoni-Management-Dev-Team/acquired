import { localCampaignDatabase } from "../../scripts/campaign-integration-support.mjs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg, { type PoolClient } from "pg";
import { randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
vi.mock("@vercel/functions", () => ({ attachDatabasePool: vi.fn() }));
import { assertReplyMonitorMember, applyCampaignReply } from "@/lib/campaign-reply-store";
import { readCampaignReplyAlerts } from "@/lib/campaign-reply-alerts";

// Dedicated loopback database only. All synthetic fixtures and events roll back.
describe.skipIf(process.env.CAMPAIGN_AUDIT_LOCAL_DB !== "1")("local reply monitor transactions", () => {
  const client = new pg.Client({ connectionString: localCampaignDatabase, connectionTimeoutMillis: 5000 });
  const sqlClient = client as unknown as PoolClient;
  const org = `reply-test-${randomUUID()}`, user = `reply-test-${randomUUID()}`;
  const other = `reply-test-${randomUUID()}`;
  const actor = { organizationId: org, userId: user };
  const mandate = randomUUID(), target = randomUUID(), mailbox = randomUUID();
  const contacts = Array.from({ length: 3 }, () => randomUUID());
  const channels = ["email", "whatsapp", "linkedin"] as const;
  const identities = ["reply@example.invalid", "61412345678@s.whatsapp.net", "urn:li:fsd_profile:synthetic"];
  beforeAll(async () => {
    vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce");
    await client.connect(); await client.query("BEGIN");
    if (!(await client.query("SELECT to_regclass('public.campaign_reply_identities') name")).rows[0].name) throw new Error("Reply schema missing; this test never applies migrations. Approve drizzle/0016_campaign_reply_monitor.sql first.");
    await client.query('INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,false,now(),now())', [user, `${user}@example.invalid`]);
    await client.query('INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,false,now(),now())', [other, `${other}@example.invalid`]);
    await client.query("INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)", [org]);
    await client.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), org, user]);
    await client.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'member')", [randomUUID(), org, other]);
    await client.query("INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,'Synthetic reply test','{}','{}',$3)", [mandate, org, user]);
    await client.query("INSERT INTO targets (id,organization_id,mandate_id,company_name,firmographics) VALUES ($1,$2,$3,'Synthetic','{}')", [target, org, mandate]);
    await client.query("INSERT INTO mailbox_connections (id,organization_id,user_id,provider,address) VALUES ($1,$2,$3,'gmail','sender@example.invalid')", [mailbox, org, user]);
    for (const [i, contact] of contacts.entries()) {
      const sequence = randomUUID(), version = randomUUID(), email = `reply-${i}@example.invalid`;
      await client.query("INSERT INTO contacts (id,organization_id,target_id,display_name,provenance) VALUES ($1,$2,$3,'Synthetic','{}')", [contact, org, target]);
      await client.query("INSERT INTO campaign_contact_assignments (organization_id,contact_id,owner_user_id,email) VALUES ($1,$2,$3,$4)", [org, contact, user, email]);
      await client.query("INSERT INTO campaign_sequences (id,organization_id,owner_user_id,mandate_id,name,draft) VALUES ($1,$2,$3,$4,'Synthetic','{}')", [sequence, org, user, mandate]);
      await client.query("INSERT INTO campaign_sequence_versions (id,organization_id,owner_user_id,sequence_id,version,definition) VALUES ($1,$2,$3,$4,1,$5)", [version, org, user, sequence, JSON.stringify({ nextAction: channels[i] })]);
      await client.query("INSERT INTO campaign_enrolments (organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,mailbox_connection_id,recipient_email,next_step_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())", [org, user, sequence, version, mandate, contact, mailbox, email]);
      await client.query("INSERT INTO campaign_reply_identities (organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES ($1,$2,$3,$4,$5,$5,$6,'2026-01-01')", [org, user, contact, channels[i], identities[i], email]);
    }
    await client.query("SET LOCAL ROLE acquire_campaign_worker");
  });
  afterAll(async () => { try { await client.query("ROLLBACK"); } finally { await client.end(); vi.unstubAllEnvs(); } });
  it("can authorize the recorded owner under RLS before processing replies", async () => {
    await expect(assertReplyMonitorMember(sqlClient, actor)).resolves.toBeUndefined();
    expect((await client.query("SELECT current_user AS role")).rows[0].role).toBe("acquire_campaign_worker");
    await expect(assertReplyMonitorMember(sqlClient, { ...actor, userId: "unrelated-owner" })).rejects.toThrow("member");
  });
  it.each(channels)("a %s reply stops enrolments and creates one durable receipt, hold and audit on replay", async channel => {
    const i = channels.indexOf(channel), event = { id: `synthetic-${channel}`, fromIdentity: identities[i], receivedAt: "2026-10-06T00:00:00Z" };
    expect(await applyCampaignReply(sqlClient, actor, channel, "synthetic-account", event)).toBe("stop");
    await applyCampaignReply(sqlClient, actor, channel, "synthetic-account", event);
    const enrolment = (await client.query("SELECT state,stop_reason,next_step_at FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=$2", [org, contacts[i]])).rows[0];
    expect(enrolment).toEqual({ state: "stopped", stop_reason: "reply_received", next_step_at: null });
    await client.query("RESET ROLE");
    for (const table of ["campaign_reply_receipts", "campaign_reply_holds", "campaign_inbound_events"]) expect((await client.query(`SELECT count(*)::int n FROM ${table} WHERE organization_id=$1 AND channel=$2`, [org, channel])).rows[0].n).toBe(1);
    expect((await client.query("SELECT count(*)::int n FROM audit_events WHERE organization_id=$1 AND action='campaign.reply_received' AND metadata->>'channel'=$2", [org, channel])).rows[0].n).toBe(1);
    await client.query("SET LOCAL ROLE acquire_campaign_worker");
  });
  it("shows durable alerts for all reply channels only to the subscribed owner", async () => {
    await client.query("SET LOCAL ROLE acquire_campaign_user");
    await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [org, user]);
    const alerts = await readCampaignReplyAlerts(sqlClient, actor);
    expect(alerts).toHaveLength(3);
    expect(alerts.map(alert => alert.channel).sort()).toEqual([...channels].sort());
    for (const alert of alerts) expect(alert).toMatchObject({ contactName: "Synthetic", mandateId: mandate, needsReview: false, receivedAt: "2026-10-06T00:00:00.000Z" });
    await client.query("SELECT set_config('app.acquire_user',$1,true)", [other]);
    expect(await readCampaignReplyAlerts(sqlClient, { ...actor, userId: other })).toEqual([]);
    await client.query("SELECT set_config('app.acquire_org','unrelated-org',true)");
    expect(await readCampaignReplyAlerts(sqlClient, { organizationId: "unrelated-org", userId: other })).toEqual([]);
    await client.query("SET LOCAL ROLE acquire_campaign_worker");
  });
  it("rolls receipt, stop and checkpoint back together when a page transaction fails", async () => {
    await client.query("SAVEPOINT rollback_fixture");
    await client.query("UPDATE campaign_enrolments SET state='active',stop_reason=NULL,next_step_at=now() WHERE organization_id=$1 AND contact_id=$2", [org, contacts[0]]);
    await client.query("INSERT INTO campaign_reply_monitors (organization_id,owner_user_id,channel,cursor) VALUES ($1,$2,'email','before')", [org, user]);
    await client.query("SAVEPOINT failed_page");
    await applyCampaignReply(sqlClient, actor, "email", "synthetic-account", { id: "rolled-back", fromIdentity: identities[0], receivedAt: "2026-10-06T00:00:00Z" });
    await client.query("UPDATE campaign_reply_monitors SET cursor='after',last_success_at=now() WHERE organization_id=$1 AND owner_user_id=$2", [org, user]);
    await expect(client.query("SELECT 1/0")).rejects.toMatchObject({ code: "22012" });
    await client.query("ROLLBACK TO SAVEPOINT failed_page");
    expect((await client.query("SELECT 1 FROM campaign_reply_receipts WHERE organization_id=$1 AND provider_event_id='rolled-back'", [org])).rowCount).toBe(0);
    expect((await client.query("SELECT state FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=$2", [org, contacts[0]])).rows[0].state).toBe("active");
    expect((await client.query("SELECT cursor,last_success_at FROM campaign_reply_monitors WHERE organization_id=$1 AND owner_user_id=$2", [org, user])).rows[0]).toEqual({ cursor: "before", last_success_at: null });
    await client.query("ROLLBACK TO SAVEPOINT rollback_fixture");
  });
  it("user scope cannot read another organization's holds or another owner's receipts", async () => {
    await client.query("SET LOCAL ROLE acquire_campaign_user");
    await client.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [org, "unrelated-owner"]);
    expect((await client.query("SELECT 1 FROM campaign_reply_receipts WHERE organization_id=$1", [org])).rowCount).toBe(0);
    await client.query("SELECT set_config('app.acquire_org','unrelated-org',true)");
    expect((await client.query("SELECT 1 FROM campaign_reply_holds WHERE organization_id=$1", [org])).rowCount).toBe(0);
    await client.query("SET LOCAL ROLE acquire_campaign_worker");
  });
  async function isolated(callback: () => Promise<void>) {
    await client.query("SAVEPOINT scenario");
    try {
      await client.query("UPDATE campaign_enrolments SET state='active',stop_reason=NULL,next_step_at=now() WHERE organization_id=$1", [org]);
      await client.query("RESET ROLE");
      await client.query("DELETE FROM campaign_reply_holds WHERE organization_id=$1", [org]);
      await client.query("DELETE FROM campaign_contact_holds WHERE organization_id=$1", [org]);
      await client.query("SET LOCAL ROLE acquire_campaign_worker");
      await callback();
    } finally { vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce"); await client.query("ROLLBACK TO SAVEPOINT scenario"); }
  }
  async function assignOtherOwner(contactId: string) {
    // Ownership is protected by several composite foreign keys. Build a valid
    // second-owner subscription rather than bypassing those constraints.
    await client.query("RESET ROLE");
    const previous = (await client.query("SELECT recipient_email FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=$2", [org, contactId])).rows[0];
    await client.query("DELETE FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=$2", [org, contactId]);
    await client.query("UPDATE campaign_contact_assignments SET owner_user_id=$3 WHERE organization_id=$1 AND contact_id=$2", [org, contactId, other]);
    const sequence = randomUUID(), version = randomUUID(), otherMailbox = randomUUID();
    await client.query("INSERT INTO mailbox_connections (id,organization_id,user_id,provider,address) VALUES ($1,$2,$3,'gmail','other@example.invalid')", [otherMailbox, org, other]);
    await client.query("INSERT INTO campaign_sequences (id,organization_id,owner_user_id,mandate_id,name,draft) VALUES ($1,$2,$3,$4,'Other owner','{}')", [sequence, org, other, mandate]);
    await client.query("INSERT INTO campaign_sequence_versions (id,organization_id,owner_user_id,sequence_id,version,definition) VALUES ($1,$2,$3,$4,1,'{}')", [version, org, other, sequence]);
    await client.query("INSERT INTO campaign_enrolments (organization_id,owner_user_id,sequence_id,version_id,mandate_id,contact_id,mailbox_connection_id,recipient_email,next_step_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())", [org, other, sequence, version, mandate, contactId, otherMailbox, previous.recipient_email]);
    await client.query("SET LOCAL ROLE acquire_campaign_worker");
  }
  it.each(channels)("%s ambiguous identities across owners hold both contacts for review", async channel => isolated(async () => {
    const i = channels.indexOf(channel), duplicate = contacts[(i + 1) % contacts.length];
    await assignOtherOwner(duplicate);
    await client.query("INSERT INTO campaign_reply_identities (organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES ($1,$2,$3,$4,$5,$5,'different@example.invalid','2026-01-01')", [org, other, duplicate, channel, identities[i]]);
    expect(await applyCampaignReply(sqlClient, actor, channel, "shared-account", { id: `ambiguous-${channel}`, fromIdentity: identities[i], receivedAt: "2026-10-06T00:00:00Z" })).toBe("review");
    const rows = (await client.query("SELECT state,stop_reason FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=ANY($2::uuid[])", [org, [contacts[i], duplicate]])).rows;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row).toEqual({ state: "needs_review", stop_reason: "reply_identity_ambiguous" });
    expect((await client.query("SELECT count(*)::int n FROM campaign_reply_holds WHERE organization_id=$1", [org])).rows[0].n).toBe(2);
  }));
  it.each(channels)("%s duplicate contacts sharing an email stop across owners", async channel => isolated(async () => {
    const i = channels.indexOf(channel), duplicate = contacts[(i + 1) % contacts.length];
    await assignOtherOwner(duplicate);
    await client.query("INSERT INTO campaign_reply_identities (organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES ($1,$2,$3,$4,$5,$5,$6,'2026-01-01')", [org, other, duplicate, channel, identities[i], `reply-${i}@example.invalid`]);
    expect(await applyCampaignReply(sqlClient, actor, channel, "shared-account", { id: `duplicate-${channel}`, fromIdentity: identities[i], receivedAt: "2026-10-06T00:00:00Z" })).toBe("stop");
    const rows = (await client.query("SELECT state FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=ANY($2::uuid[])", [org, [contacts[i], duplicate]])).rows;
    expect(rows.map(row => row.state)).toEqual(["stopped", "stopped"]);
  }));
  it.each(channels)("%s observed events enforce on replay without duplicating inbound history", async channel => isolated(async () => {
    const i = channels.indexOf(channel);
    const event = { id: `rollout-${channel}`, fromIdentity: identities[i], receivedAt: "2026-10-06T00:00:00Z" };
    vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "observe");
    await applyCampaignReply(sqlClient, actor, channel, "rollout-account", event);
    expect((await client.query("SELECT state FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=$2", [org, contacts[i]])).rows[0].state).toBe("active");
    expect((await client.query("SELECT 1 FROM campaign_reply_holds WHERE organization_id=$1", [org])).rowCount).toBe(0);
    vi.stubEnv("CAMPAIGN_REPLY_MONITOR_MODE", "enforce");
    await applyCampaignReply(sqlClient, actor, channel, "rollout-account", event);
    await applyCampaignReply(sqlClient, actor, channel, "rollout-account", event);
    expect((await client.query("SELECT state FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=$2", [org, contacts[i]])).rows[0].state).toBe("stopped");
    expect((await client.query("SELECT count(*)::int n FROM campaign_reply_receipts WHERE organization_id=$1 AND provider_event_id=$2", [org, event.id])).rows[0].n).toBe(1);
  }));
});
