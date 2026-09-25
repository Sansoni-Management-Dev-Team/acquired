import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

if (process.env.CAMPAIGN_E2E_LOCAL !== "1") throw new Error("Set CAMPAIGN_E2E_LOCAL=1");
const db = new pg.Client({ connectionString: "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire" });
const app = "http://localhost:3010";
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
let workflowId;

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
  assert.equal((await db.query("SELECT current_database() AS name")).rows[0].name, "project_acquire");
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
  workflowId = version.n8n_workflow_id;
  assert.ok(workflowId, "publishing must provision n8n workflow");
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
  console.log("Published workflow, webhook dispatch, Gmail sink sends, Wait, and completion passed");
} finally {
  if (workflowId) {
    // The n8n test workflow is left active only until its execution completes.
    const key = JSON.parse(await (await import("node:fs/promises")).readFile(".local-data/n8n-test-api-key.json", "utf8")).key;
    const headers = { "X-N8N-API-KEY": key, "Content-Type": "application/json" };
    await fetch(`http://127.0.0.1:5679/api/v1/workflows/${workflowId}/deactivate`, { method: "POST", headers, body: "{}" }).catch(() => undefined);
    await fetch(`http://127.0.0.1:5679/api/v1/workflows/${workflowId}`, { method: "DELETE", headers }).catch(() => undefined);
  }
  if (db._connected) {
    for (const table of ["campaign_send_attempts", "campaign_inbound_events", "campaign_enrolments", "campaign_contact_assignments", "campaign_contact_holds", "campaign_sequence_versions", "campaign_sequences", "audit_events", "contacts", "mandate_targets", "targets", "mandates", "mailbox_connections", "member"]) await db.query(`DELETE FROM ${table} WHERE organization_id=$1`, [org]);
    await db.query("DELETE FROM organization WHERE id=$1", [org]);
    if (userId) {
      await db.query("DELETE FROM session WHERE user_id=$1", [userId]);
      await db.query("DELETE FROM account WHERE user_id=$1", [userId]);
      await db.query('DELETE FROM "user" WHERE id=$1', [userId]);
    }
    await db.end();
  }
}
