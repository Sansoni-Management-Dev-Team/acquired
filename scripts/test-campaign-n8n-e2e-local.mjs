import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { assertOwnedTestApp, assertLocalIntegrationSchema, assertIdleCampaignDatabase, localN8nKey, removeCampaignFixtures } from "./campaign-integration-support.mjs";

assertOwnedTestApp();
const apiKey = await localN8nKey();

if (process.env.CAMPAIGN_E2E_LOCAL !== "1") throw new Error("Set CAMPAIGN_E2E_LOCAL=1");
const db = new pg.Client({ connectionString: "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire" });
const app = "http://localhost:3013";
const sink = "http://127.0.0.1:18094";
const secret = process.env.OUTREACH_WORKER_SECRET || "local-campaign-test-only";
const run = randomUUID().slice(0, 8);
const org = `campaign-n8n-e2e-${run}`;
let userId;
const mandateId = randomUUID();
const targetId = randomUUID();
const mailboxId = randomUUID();
const contactId = randomUUID();
const email = `n8n-${run}@example.invalid`;
let cookie;
const workflowIds = [];

async function api(path, method = "GET", value, auth = cookie) {
  const response = await fetch(`${app}${path}`, { method, headers: { Origin: app, ...(value ? { "Content-Type": "application/json" } : {}), ...(auth ? { Cookie: auth } : {}) }, ...(value ? { body: JSON.stringify(value) } : {}) });
  const payload = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(payload)}`);
  return { payload, response };
}
async function tick() {
  const result = await fetch(`${app}/api/internal/campaigns/tick`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
  if (!result.ok) throw new Error(`tick: ${result.status} ${await result.text()}`);
  return result.json();
}
async function deliveries() { return (await (await fetch(`${sink}/__test/deliveries`)).json()).filter(item => item.message.to === email); }
async function until(check, label) {
  for (let n = 0; n < 45; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 1000)); }
  throw new Error(`Timed out waiting for ${label}`);
}

try {
  await db.connect();
  await assertLocalIntegrationSchema(db);
  await assertIdleCampaignDatabase(db);
  assert.equal((await (await fetch(`${sink}/health`)).json()).mode, "no-external-delivery");
  const signup = await api("/api/auth/sign-up/email", "POST", { name: "n8n E2E", email: `sender-${run}@example.invalid`, password: `Test-${randomUUID()}!` }, null);
  assert.equal(signup.payload.user.id.length > 0, true);
  userId = signup.payload.user.id;
  cookie = signup.response.headers.getSetCookie().map(item => item.split(";")[0]).find(item => item.includes("session_token="));
  assert.ok(cookie);
  await db.query("INSERT INTO organization (id,name,slug) VALUES ($1,$2,$3)", [org, org, org]);
  await db.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), org, signup.payload.user.id]);
  await db.query("UPDATE session SET active_organization_id=$1 WHERE user_id=$2", [org, signup.payload.user.id]);
  await db.query("INSERT INTO mailbox_connections (id,organization_id,user_id,provider,address,encrypted_refresh_token,scopes,daily_cap) VALUES ($1,$2,$3,'gmail',$4,'local-test-token',$5,100)", [mailboxId, org, signup.payload.user.id, `sender-${run}@example.invalid`, ["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.readonly"]]);
  await db.query("INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,'n8n E2E','{}','{}',$3)", [mandateId, org, signup.payload.user.id]);
  await db.query("INSERT INTO targets (id,organization_id,mandate_id,company_name,firmographics) VALUES ($1,$2,$3,'Synthetic Co','{}')", [targetId, org, mandateId]);
  await db.query("INSERT INTO mandate_targets (organization_id,mandate_id,target_id,assessment) VALUES ($1,$2,$3,'{}')", [org, mandateId, targetId]);
  await db.query("INSERT INTO contacts (id,organization_id,target_id,display_name,personal_data,provenance,fictionalised) VALUES ($1,$2,$3,'Example Person',$4,'{}',false)", [contactId, org, targetId, JSON.stringify({ email })]);
  const definition = { schemaVersion: 1, steps: [
    { id: randomUUID(), kind: "email", title: "Introduction", subject: "Hello", body: "Hi {{first_name}}" },
    { id: randomUUID(), kind: "wait", title: "Three days", days: 3 },
    { id: randomUUID(), kind: "email", title: "Follow up", subject: "Following up", body: "Hi again" },
  ] };
  const sequence = (await api(`/api/mandates/${mandateId}/campaigns`, "POST", { mandateId, name: `n8n E2E ${run}`, definition })).payload;
  const published = (await api(`/api/campaigns/${sequence.id}/publish`, "POST")).payload;
  const version = (await db.query("SELECT n8n_workflow_id FROM campaign_sequence_versions WHERE id=$1", [published.id])).rows[0];
  workflowIds.push(version.n8n_workflow_id);
  assert.ok(version.n8n_workflow_id, "publishing must provision n8n workflow");
  const enrolment = (await api(`/api/campaigns/${sequence.id}/enrolments`, "POST", { contactIds: [contactId], confirmation: true })).payload.enrolments[0];
  assert.equal((await db.query("SELECT runtime FROM campaign_enrolments WHERE id=$1", [enrolment.id])).rows[0].runtime, "n8n");
  await tick();
  await until(async () => (await deliveries()).length === 1, "first n8n-driven sink delivery");
  assert.equal((await db.query("SELECT step_index FROM campaign_enrolments WHERE id=$1", [enrolment.id])).rows[0].step_index, 2);
  // Compress the mailbox spacing as well as the sequence Wait in this isolated test.
  await db.query("UPDATE campaign_send_attempts SET claimed_at=now()-interval '2 minutes' WHERE enrolment_id=$1", [enrolment.id]);
  await until(async () => (await deliveries()).length === 2, "follow-up after n8n Wait");
  assert.equal((await db.query("SELECT state FROM campaign_enrolments WHERE id=$1", [enrolment.id])).rows[0].state, "completed");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM campaign_send_attempts WHERE enrolment_id=$1", [enrolment.id])).rows[0].n, 2);
  // Exercise each reply ingress against real API, RLS and committed fixtures.
  // Callback requests are explicit here so no follow-up can race test setup.
  for (const channel of ["email", "linkedin", "whatsapp"]) {
    const replyContact = randomUUID();
    const recipient = `${channel}-${run}@example.invalid`;
    const identity = channel === "email" ? recipient : channel === "linkedin" ? `urn:li:fsd_profile:test_${run}` : "61412345678@s.whatsapp.net";
    await db.query("INSERT INTO contacts (id,organization_id,target_id,display_name,personal_data,provenance,fictionalised) VALUES ($1,$2,$3,'Reply fixture',$4,'{}',false)", [replyContact, org, targetId, JSON.stringify({ email: recipient })]);
    const replying = (await api(`/api/campaigns/${sequence.id}/enrolments`, "POST", { contactIds: [replyContact], confirmation: true })).payload.enrolments[0];
    await db.query("UPDATE campaign_send_attempts SET claimed_at=now()-interval '2 minutes' WHERE organization_id=$1", [org]);
    await db.query("UPDATE campaign_enrolments SET next_step_at=now()-interval '1 second' WHERE id=$1", [replying.id]);
    const callback = async stepIndex => {
      const response = await fetch(`${app}/api/internal/campaigns/step`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ enrolmentId: replying.id, versionId: published.id, stepIndex }) });
      assert.ok(response.ok, `callback: ${response.status} ${await response.clone().text()}`);
      return response.json();
    };
    assert.equal((await callback(0)).outcome, "sent");
    const beforeReply = (await (await fetch(`${sink}/__test/deliveries`)).json()).filter(item => item.message.to === recipient).length;
    assert.equal(beforeReply, 1);
    if (channel === "email") {
      const eventResponse = await fetch(`${sink}/__test/event`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mailboxId, email: recipient, direction: "inbound" }) });
      assert.ok(eventResponse.ok);
      // A direct step callback runs the actual email reader and enforces its reply.
      await db.query("UPDATE campaign_enrolments SET next_step_at=now()-interval '1 second' WHERE id=$1", [replying.id]);
      await callback(2);
    } else {
      await db.query("INSERT INTO campaign_reply_identities (organization_id,owner_user_id,contact_id,channel,identity,source_identity,email,since) VALUES ($1,$2,$3,$4,$5,$5,$6,now()-interval '1 hour')", [org, userId, replyContact, channel, identity, recipient]);
      const event = { organizationId: org, userId, channel, accountIdentity: "synthetic-account", event: { id: `reply-${channel}-${run}`, fromIdentity: identity, receivedAt: new Date().toISOString() } };
      for (let replay = 0; replay < 2; replay++) {
        const response = await fetch(`${app}/api/internal/campaigns/replies`, { method: "POST", headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" }, body: JSON.stringify(event) });
        assert.equal(response.status, 200, await response.clone().text());
        assert.equal((await response.json()).outcome, "stop");
      }
    }
    assert.equal((await db.query("SELECT state FROM campaign_enrolments WHERE id=$1", [replying.id])).rows[0].state, "stopped");
    assert.equal((await callback(2)).outcome, "finished", "Duplicate/late n8n callback must stop");
    assert.equal((await (await fetch(`${sink}/__test/deliveries`)).json()).filter(item => item.message.to === recipient).length, beforeReply);
    assert.equal((await db.query("SELECT count(*)::int n FROM campaign_reply_holds WHERE organization_id=$1 AND contact_id=$2", [org, replyContact])).rows[0].n, 1);
    console.log(`${channel} reply blocks follow-up and callback replay`);
  }
  console.log("Published workflow, webhook dispatch, sink delivery, accelerated Wait, completion and all-channel reply enforcement passed");
  if (process.env.CAMPAIGN_E2E_BROWSER === "1") {
    const browserContact = randomUUID();
    await db.query("INSERT INTO contacts (id,organization_id,target_id,display_name,personal_data,provenance,fictionalised) VALUES ($1,$2,$3,'Browser Person',$4,'{}',false)", [browserContact, org, targetId, JSON.stringify({ email: `browser-${run}@example.invalid` })]);
    const { checkCampaignBrowser } = await import("./campaign-browser-integration.mjs");
    await checkCampaignBrowser({ app, mandateId, cookie, sequenceName: `n8n E2E ${run}`, run });
    const row = (await db.query("SELECT state FROM campaign_enrolments WHERE organization_id=$1 AND contact_id=$2", [org, browserContact])).rows[0];
    assert.equal(row.state, "stopped");
    assert.equal((await (await fetch(`${sink}/__test/deliveries`)).json()).filter(item => item.message.to === `browser-${run}@example.invalid`).length, 0);
  }
} finally {
  if (db._connected) workflowIds.push(...(await db.query("SELECT n8n_workflow_id FROM campaign_sequence_versions WHERE organization_id=$1", [org])).rows.map(row => row.n8n_workflow_id));
  const headers = { "X-N8N-API-KEY": apiKey, "Content-Type": "application/json" };
  const cleanupErrors = [];
  for (const id of new Set(workflowIds.filter(Boolean))) {
    try {
      for (const [suffix, method] of [["/deactivate", "POST"], ["", "DELETE"]]) {
        const response = await fetch(`http://127.0.0.1:5679/api/v1/workflows/${id}${suffix}`, { method, headers, ...(method === "POST" ? { body: "{}" } : {}) });
        if (!response.ok && response.status !== 404) throw new Error(`Workflow cleanup ${id}: ${response.status}`);
      }
    } catch (error) { cleanupErrors.push(error); }
  }
  if (db._connected) {
    try { await removeCampaignFixtures(db, org, userId ? [userId] : []); }
    catch (error) { cleanupErrors.push(error); }
    finally { await db.end(); }
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, "Integration fixture cleanup failed");
}
