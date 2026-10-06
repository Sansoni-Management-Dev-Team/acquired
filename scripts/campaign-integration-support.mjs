import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

export const localCampaignDatabase = "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire";
export const localCampaignSink = "http://127.0.0.1:18094";
export const localCampaignN8n = "http://127.0.0.1:5679";

export async function localN8nKey() {
  return process.env.CAMPAIGN_N8N_API_KEY || JSON.parse(await readFile(".local-data/n8n-test-api-key.json", "utf8")).key;
}

export function assertOwnedTestApp(env = process.env) {
  assert.equal(env.CAMPAIGN_INTEGRATION_APP, "1", "Run via pnpm test:campaign:integration --e2e so the harness owns the app configuration");
  assert.equal(env.NODE_ENV, "development");
  assert.equal(env.LOCAL_DEVELOPMENT, "true");
  assert.equal(env.DATABASE_URL, localCampaignDatabase);
  assert.equal(env.CAMPAIGN_TEST_SINK_URL, localCampaignSink);
  assert.equal(env.APP_URL, "http://localhost:3013");
  assert.equal(env.CAMPAIGN_N8N_URL, localCampaignN8n);
  assert.equal(env.CAMPAIGN_APP_URL, "http://host.docker.internal:3013");
  assert.equal(env.CAMPAIGN_REPLY_MONITOR_MODE, "enforce");
  assert.equal(env.CAMPAIGN_LINKEDIN_ENABLED, "false");
  for (const key of ["LINKEDIN_SERVICE_URL", "LINKEDIN_SERVICE_SECRET", "WHATSAPP_SERVICE_URL", "WHATSAPP_SERVICE_SECRET"]) assert.equal(env[key], "", `${key} must be disabled`);
}

export async function assertLocalIntegrationSchema(db) {
  const identity = (await db.query("SELECT current_database() name")).rows[0];
  assert.equal(identity.name, "project_acquire");
  for (const table of ["campaign_reply_identities", "campaign_reply_holds", "campaign_reply_monitors", "campaign_reply_receipts", "whatsapp_reply_events"]) {
    const exists = (await db.query("SELECT to_regclass($1) name", [`public.${table}`])).rows[0].name;
    assert.ok(exists, `${table} is missing. Approve drizzle/0016_campaign_reply_monitor.sql before applying it; the harness never migrates.`);
  }
}

export async function assertIdleCampaignDatabase(db) {
  // Tick is a global worker endpoint. Do not let a synthetic test advance or
  // change another local user's open subscriptions.
  const { rows } = await db.query("SELECT count(*)::int n FROM campaign_enrolments WHERE state IN ('active','paused','needs_review')");
  assert.equal(rows[0].n, 0, "Full app integration requires an idle local campaign database; other open subscriptions would be processed by tick");
}

export async function removeCampaignFixtures(db, org, userIds) {
  assert.match(org, /^(campaign-n8n-e2e|campaign-e2e)-[a-f0-9]{8}$/);
  await db.query("BEGIN");
  try {
    for (const table of ["campaign_reply_receipts", "campaign_reply_monitors", "campaign_reply_holds", "campaign_reply_identities", "campaign_send_attempts", "campaign_inbound_events", "campaign_enrolments", "campaign_contact_assignments", "campaign_contact_holds", "campaign_sequence_versions", "campaign_sequences", "audit_events", "contacts", "mandate_targets", "targets", "mandates", "mailbox_connections", "member"]) await db.query(`DELETE FROM ${table} WHERE organization_id=$1`, [org]);
    await db.query("DELETE FROM organization WHERE id=$1", [org]);
    for (const id of userIds) {
      await db.query("DELETE FROM session WHERE user_id=$1", [id]);
      await db.query("DELETE FROM account WHERE user_id=$1", [id]);
      await db.query('DELETE FROM "user" WHERE id=$1', [id]);
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
}
