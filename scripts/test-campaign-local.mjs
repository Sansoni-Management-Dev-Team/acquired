import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import pg from "pg";

const databaseUrl = "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire";
const app = "http://localhost:3010";
const sink = "http://127.0.0.1:18094";
const workerSecret = process.env.OUTREACH_WORKER_SECRET || "local-campaign-test-only";
if (process.env.CAMPAIGN_E2E_LOCAL !== "1") throw new Error("Set CAMPAIGN_E2E_LOCAL=1 to run the synthetic local test");
const db = new pg.Client({ connectionString: databaseUrl });
const run = randomUUID().slice(0, 8);
const organizationId = `campaign-e2e-${run}`;
const mandateId = randomUUID();
const targetId = randomUUID();
const mailboxIds = [randomUUID(), randomUUID()];
const contactIds = Array.from({ length: 13 }, () => randomUUID());
const contacts = ["safe", "prior", "manual", "reply", "ambiguous", "concurrent", "browser", "scheduled", "preflight", "stale-scan", "restart", "spacing", "daily-cap"].map(name => `${name}-${run}@example.invalid`);
const userIds = [];
const cookies = [];
const signups = [];
const report = [];

async function call(url, { method = "GET", cookie, value, bearer, expectStatus } = {}) {
  const response = await fetch(`${app}${url}`, { method, headers: { ...(value ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), Origin: app }, body: value ? JSON.stringify(value) : undefined, signal: AbortSignal.timeout(30_000) });
  const payload = await response.json().catch(() => ({}));
  if (expectStatus !== undefined) assert.equal(response.status, expectStatus, `${method} ${url}: ${JSON.stringify(payload)}`);
  else assert.ok(response.ok, `${method} ${url}: ${response.status} ${JSON.stringify(payload)}`);
  return { payload, response };
}

async function sinkCall(path, method = "GET", value) {
  const response = await fetch(`${sink}${path}`, { method, headers: { "Content-Type": "application/json" }, body: value ? JSON.stringify(value) : undefined, signal: AbortSignal.timeout(5_000) });
  assert.ok(response.ok, `Local sink ${path}: ${response.status}`);
  return response.json();
}

async function signup(index) {
  const email = `campaign-e2e-${run}-${index}@example.invalid`;
  const password = `Campaign-test-${randomUUID()}!`;
  const { payload, response } = await call("/api/auth/sign-up/email", { method: "POST", value: { name: `Campaign E2E ${index}`, email, password }, expectStatus: 200 });
  assert.ok(payload.user?.id, "Better Auth signup must create a user");
  const cookie = response.headers.getSetCookie().map(item => item.split(";")[0]).find(item => item.includes("session_token="));
  assert.ok(cookie, "Better Auth signup must issue a session cookie");
  userIds.push(payload.user.id);
  cookies.push(cookie);
  signups.push({ email, password });
}

async function fixture() {
  await db.query("INSERT INTO organization (id,name,slug) VALUES ($1,$2,$3)", [organizationId, `Campaign E2E ${run}`, organizationId]);
  for (let index = 0; index < userIds.length; index++) {
    await db.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), organizationId, userIds[index]]);
    await db.query("UPDATE session SET active_organization_id=$1 WHERE user_id=$2", [organizationId, userIds[index]]);
    await db.query("INSERT INTO mailbox_connections (id,organization_id,user_id,provider,address,encrypted_refresh_token,scopes,daily_cap) VALUES ($1,$2,$3,'gmail',$4,'local-test-token',$5,100)", [mailboxIds[index], organizationId, userIds[index], `sender-${index}-${run}@example.invalid`, ["https://www.googleapis.com/auth/gmail.compose", "https://www.googleapis.com/auth/gmail.readonly"]]);
  }
  await db.query("INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,$3,'{}','{}',$4)", [mandateId, organizationId, "Campaign E2E mandate", userIds[0]]);
  await db.query("INSERT INTO targets (id,organization_id,mandate_id,company_name,firmographics) VALUES ($1,$2,$3,'Synthetic Co','{}')", [targetId, organizationId, mandateId]);
  await db.query("INSERT INTO mandate_targets (organization_id,mandate_id,target_id,assessment) VALUES ($1,$2,$3,'{}')", [organizationId, mandateId, targetId]);
  for (let index = 0; index < contactIds.length; index++) {
    await db.query("INSERT INTO contacts (id,organization_id,target_id,display_name,personal_data,provenance,fictionalised) VALUES ($1,$2,$3,$4,$5,'{}',false)", [contactIds[index], organizationId, targetId, `Contact ${index}`, JSON.stringify({ email: contacts[index] })]);
  }
}

async function tick() { return (await call("/api/internal/campaigns/tick", { method: "POST", bearer: workerSecret })).payload; }
function n8nTick() {
  const output = execFileSync("docker", ["--context", "orbstack", "exec", "-e", "N8N_RUNNERS_BROKER_PORT=5680", "project-acquire-n8n", "n8n", "execute", "--id=acquireCampaignLocal", "--rawOutput"], { encoding: "utf8", timeout: 30_000 });
  const jsonStart = output.indexOf("\n{");
  const jsonEnd = output.lastIndexOf("\n}");
  assert.ok(jsonStart >= 0 && jsonEnd > jsonStart, `n8n did not return execution JSON: ${output.slice(0, 500)}`);
  const execution = JSON.parse(output.slice(jsonStart + 1, jsonEnd + 2));
  const worker = execution.data?.resultData?.runData?.["Run local Acquire worker"]?.[0];
  assert.equal(worker?.executionStatus, "success", "n8n must invoke the local Acquire worker successfully");
  return worker.data.main[0][0].json;
}
async function enrol(sequenceId, contactId, cookie = cookies[0]) { return (await call(`/api/campaigns/${sequenceId}/enrolments`, { method: "POST", cookie, value: { contactIds: [contactId], confirmation: true }, expectStatus: 201 })).payload.enrolments[0]; }
async function action(id, name, cookie = cookies[0]) { return (await call(`/api/campaign-enrolments/${id}/action`, { method: "POST", cookie, value: { action: name } })).payload; }
async function state(id) { return (await db.query("SELECT state, stop_reason, step_index, version_id FROM campaign_enrolments WHERE id=$1", [id])).rows[0]; }
async function ageClaims() { await db.query("UPDATE campaign_send_attempts SET claimed_at=now()-interval '2 minutes' WHERE organization_id=$1", [organizationId]); }
async function due(id) { await db.query("UPDATE campaign_enrolments SET next_step_at=now()-interval '1 second' WHERE id=$1", [id]); }
async function deliveries() { return sinkCall("/__test/deliveries"); }

async function cleanup() {
  // Every deletion is constrained to the unique synthetic organisation and users.
  if (db._connected) {
    await db.query("ROLLBACK");
    await db.query("BEGIN");
    try {
      for (const table of ["campaign_send_attempts", "campaign_inbound_events", "campaign_enrolments", "campaign_contact_assignments", "campaign_contact_holds", "campaign_sequence_versions", "campaign_sequences", "audit_events", "contacts", "mandate_targets", "targets", "mandates", "mailbox_connections", "member"]) {
        await db.query(`DELETE FROM ${table} WHERE organization_id=$1`, [organizationId]);
      }
      await db.query("DELETE FROM organization WHERE id=$1", [organizationId]);
      for (const id of userIds) {
        await db.query("DELETE FROM session WHERE user_id=$1", [id]);
        await db.query("DELETE FROM account WHERE user_id=$1", [id]);
        await db.query("DELETE FROM \"user\" WHERE id=$1", [id]);
      }
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; }
  }
}

try {
  await db.connect();
  const identity = await db.query("SELECT current_database() AS name, inet_server_port() AS port");
  assert.equal(identity.rows[0].name, "project_acquire");
  assert.equal(identity.rows[0].port, 5432); // Container-side server port; host is pinned above.
  assert.equal((await sinkCall("/health")).mode, "no-external-delivery");
  await sinkCall("/__test/reset", "POST");
  await call("/api/internal/campaigns/tick", { method: "POST", bearer: "wrong", expectStatus: 401 });
  await signup(0);
  await signup(1);
  await fixture();
  const definition = { schemaVersion: 1, steps: [
    { id: randomUUID(), kind: "email", title: "Initial", subject: "Hello {{first_name}}", body: "Hi {{first_name}} at {{company_name}}" },
    { id: randomUUID(), kind: "wait", title: "Wait", days: 1 },
    { id: randomUUID(), kind: "email", title: "Follow up", subject: "Following up", body: "Hello again" },
  ] };
  const sequenceId = (await call(`/api/mandates/${mandateId}/campaigns`, { method: "POST", cookie: cookies[0], value: { mandateId, name: "Synthetic sequence", definition }, expectStatus: 201 })).payload.id;
  assert.ok(sequenceId);
  await call(`/api/campaigns/${sequenceId}/publish`, { method: "POST", cookie: cookies[0] });
  const otherView = (await call(`/api/mandates/${mandateId}/campaigns`, { cookie: cookies[1] })).payload;
  assert.equal(otherView.sequences.length, 0, "Other member must not see this user's sequence");
  await call(`/api/campaigns/${sequenceId}`, { method: "PUT", cookie: cookies[1], value: { name: "Hijacked", definition }, expectStatus: 404 });
  report.push("authenticated owner-only sequence access");

  await sinkCall("/__test/event", "POST", { mailboxId: mailboxIds[0], email: contacts[1], direction: "inbound" });
  const prior = await enrol(sequenceId, contactIds[1]);
  assert.equal(prior.state, "needs_review");
  assert.equal((await state(prior.id)).stop_reason, "existing_conversation");
  report.push("existing conversation held before enrolment sends");

  const safe = await enrol(sequenceId, contactIds[0]);
  assert.equal(safe.state, "active");
  assert.match(safe.firstAction, /Send email: Initial/);
  await action(safe.id, "pause");
  await tick();
  assert.equal((await deliveries()).length, 0);
  await action(safe.id, "resume");
  await due(safe.id);
  n8nTick();
  assert.equal((await deliveries()).length, 1);
  assert.equal((await state(safe.id)).step_index, 2);
  report.push("subscription confirmation, pause/resume, n8n-triggered no-send delivery");

  const revised = structuredClone(definition);
  revised.steps[0].subject = "Version two";
  await call(`/api/campaigns/${sequenceId}`, { method: "PUT", cookie: cookies[0], value: { name: "Synthetic sequence", definition: revised } });
  await call(`/api/campaigns/${sequenceId}/publish`, { method: "POST", cookie: cookies[0] });
  assert.equal((await db.query("SELECT v.version FROM campaign_enrolments e JOIN campaign_sequence_versions v ON v.id=e.version_id WHERE e.id=$1", [safe.id])).rows[0].version, 1);
  report.push("published version remains pinned for existing enrolments");

  await ageClaims();
  const manual = await enrol(sequenceId, contactIds[2]);
  await due(manual.id);
  await tick();
  assert.equal((await deliveries()).length, 2);
  await sinkCall("/__test/event", "POST", { mailboxId: mailboxIds[0], email: contacts[2], direction: "outbound" });
  await due(manual.id);
  await tick();
  assert.equal((await state(manual.id)).stop_reason, "manual_outbound_detected");
  assert.equal((await deliveries()).length, 2);
  report.push("unrecorded manual outbound blocks send");

  await ageClaims();
  const reply = await enrol(sequenceId, contactIds[3]);
  await due(reply.id);
  await tick();
  assert.equal((await deliveries()).length, 3);
  await sinkCall("/__test/event", "POST", { mailboxId: mailboxIds[0], email: contacts[3], direction: "inbound" });
  await db.query("UPDATE campaign_enrolments SET last_reply_checked_at=now()-interval '6 minutes', next_step_at=now()-interval '1 second' WHERE id=$1", [reply.id]);
  await ageClaims();
  await tick();
  assert.equal((await state(reply.id)).stop_reason, "reply_received");
  assert.equal((await deliveries()).length, 3);
  report.push("reply stops every future step");

  await ageClaims();
  const ambiguous = await enrol(sequenceId, contactIds[4]);
  await sinkCall("/__test/fail-next-send", "POST", { mailboxId: mailboxIds[0], email: contacts[4] });
  await due(ambiguous.id);
  await tick();
  assert.equal((await deliveries()).length, 4);
  await tick();
  assert.equal((await deliveries()).length, 4, "Ambiguous result must never double-send");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM campaign_send_attempts WHERE enrolment_id=$1", [ambiguous.id])).rows[0].n, 1);
  report.push("ambiguous accepted send reconciles without duplicate");

  await ageClaims();
  const concurrent = await enrol(sequenceId, contactIds[5]);
  await due(concurrent.id);
  await Promise.all([tick(), tick()]);
  assert.equal((await deliveries()).length, 5, "Simultaneous workers must produce one delivery");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM campaign_send_attempts WHERE enrolment_id=$1", [concurrent.id])).rows[0].n, 1);
  report.push("simultaneous worker calls send once");

  const bSequence = (await call(`/api/mandates/${mandateId}/campaigns`, { method: "POST", cookie: cookies[1], value: { mandateId, name: "Other sender", definition }, expectStatus: 201 })).payload.id;
  await call(`/api/campaigns/${bSequence}/publish`, { method: "POST", cookie: cookies[1] });
  await call(`/api/campaigns/${bSequence}/enrolments`, { method: "POST", cookie: cookies[1], value: { contactIds: [contactIds[0]], confirmation: true }, expectStatus: 409 });
  await call(`/api/campaign-enrolments/${safe.id}/action`, { method: "POST", cookie: cookies[1], value: { action: "pause" }, expectStatus: 404 });
  await db.query("BEGIN");
  await db.query("SET LOCAL ROLE acquire_campaign_user");
  await db.query("SELECT set_config('app.acquire_org',$1,true),set_config('app.acquire_user',$2,true)", [organizationId, userIds[1]]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM campaign_sequences WHERE id=$1", [sequenceId])).rows[0].n, 0);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM mailbox_connections WHERE id=$1", [mailboxIds[0]])).rows[0].n, 0);
  await db.query("ROLLBACK");
  report.push("cross-user API, assignment and RLS isolation");

  if (process.env.CAMPAIGN_E2E_EXTENDED === "1") {
    await ageClaims();
    const preflight = await enrol(sequenceId, contactIds[8]);
    await due(preflight.id);
    await sinkCall("/__test/fail-next-check", "POST", { mailboxId: mailboxIds[0], email: contacts[8], kind: "inbound" });
    const beforePreflight = (await deliveries()).length;
    await tick();
    assert.equal((await state(preflight.id)).state, "needs_review");
    assert.equal((await deliveries()).length, beforePreflight, "A failed pre-send mailbox check must not deliver");
    await action(preflight.id, "retry_preflight");
    await ageClaims();
    await due(preflight.id);
    await tick();
    assert.equal((await deliveries()).length, beforePreflight + 1);
    report.push("pre-send mailbox outage holds, then recovers without duplicate");

    const stale = await enrol(sequenceId, contactIds[9]);
    await db.query("UPDATE campaign_enrolments SET last_reply_checked_at=now() WHERE organization_id=$1 AND id<>$2", [organizationId, stale.id]);
    await db.query("UPDATE campaign_enrolments SET last_reply_checked_at=now()-interval '6 minutes', next_step_at=now()+interval '1 hour' WHERE id=$1", [stale.id]);
    await sinkCall("/__test/fail-next-check", "POST", { mailboxId: mailboxIds[0], email: contacts[9], kind: "inbound" });
    const beforeScan = (await deliveries()).length;
    await tick();
    assert.equal((await state(stale.id)).stop_reason, "reply_check_failed");
    assert.equal((await deliveries()).length, beforeScan);
    report.push("stale reply scan failure holds automation without delivery");

    await ageClaims();
    const restart = await enrol(sequenceId, contactIds[10]);
    await due(restart.id);
    await sinkCall("/__test/fail-next-send", "POST", { mailboxId: mailboxIds[0], email: contacts[10] });
    await sinkCall("/__test/hide-next-message", "POST", { mailboxId: mailboxIds[0], email: contacts[10] });
    const beforeRestart = (await deliveries()).length;
    await tick();
    assert.equal((await state(restart.id)).stop_reason, "send_result_unknown");
    assert.equal((await deliveries()).length, beforeRestart + 1);
    if (process.env.CAMPAIGN_E2E_RESTART === "1") {
      console.log(JSON.stringify({ restartEnrolmentId: restart.id, recipient: contacts[10], sinkDeliveriesBeforeRestart: beforeRestart + 1 }));
      console.log("Restart local Acquire with the same sink-only settings, then press Enter to reconcile.");
      await new Promise(resolve => process.stdin.once("data", resolve));
      process.stdin.pause();
    }
    await sinkCall("/__test/release-messages", "POST");
    await tick();
    assert.equal((await deliveries()).length, beforeRestart + 1, "Reconciliation must not send again");
    assert.equal((await db.query("SELECT state FROM campaign_send_attempts WHERE enrolment_id=$1", [restart.id])).rows[0].state, "sent");
    report.push(process.env.CAMPAIGN_E2E_RESTART === "1" ? "unknown send reconciles after worker restart without duplicate" : "unknown send reconciles without duplicate");

    await db.query("UPDATE campaign_send_attempts SET claimed_at=now() WHERE id=(SELECT a.id FROM campaign_send_attempts a JOIN campaign_enrolments e ON e.id=a.enrolment_id WHERE e.mailbox_connection_id=$1 ORDER BY a.claimed_at DESC LIMIT 1)", [mailboxIds[0]]);
    const spaced = await enrol(sequenceId, contactIds[11]);
    await due(spaced.id);
    const beforeSpacing = (await deliveries()).length;
    await tick();
    assert.equal((await deliveries()).length, beforeSpacing, "Mailbox spacing must hold a second immediate send");
    const [spacedRow] = (await db.query("SELECT next_step_at FROM campaign_enrolments WHERE id=$1", [spaced.id])).rows;
    assert.ok(spacedRow.next_step_at > new Date(Date.now() + 45_000), `Spacing should defer the send by about a minute; next=${spacedRow.next_step_at?.toISOString()}`);
    await ageClaims();
    await due(spaced.id);
    await tick();
    assert.equal((await deliveries()).length, beforeSpacing + 1);
    report.push("per-mailbox 60-second spacing defers then permits a send");

    const used = (await db.query("SELECT count(*)::int AS n FROM campaign_send_attempts WHERE organization_id=$1 AND state IN ('claimed','sent','unknown') AND claimed_at >= now()-interval '24 hours'", [organizationId])).rows[0].n;
    await db.query("UPDATE mailbox_connections SET daily_cap=$2 WHERE id=$1", [mailboxIds[0], used]);
    const capped = await enrol(sequenceId, contactIds[12]);
    await due(capped.id);
    const beforeCap = (await deliveries()).length;
    await tick();
    assert.equal((await deliveries()).length, beforeCap, "The rolling daily cap must hold a send");
    assert.ok((await db.query("SELECT next_step_at FROM campaign_enrolments WHERE id=$1", [capped.id])).rows[0].next_step_at > new Date(Date.now() + 45 * 60_000));
    await db.query("UPDATE mailbox_connections SET daily_cap=$2 WHERE id=$1", [mailboxIds[0], used + 1]);
    await ageClaims();
    await due(capped.id);
    await tick();
    assert.equal((await deliveries()).length, beforeCap + 1);
    report.push("rolling 24-hour cap defers then permits a send");
  }

  console.log(JSON.stringify({ ok: true, checks: report, sinkDeliveries: (await deliveries()).length }, null, 2));
  if (process.env.CAMPAIGN_E2E_SCHEDULE === "1") {
    await ageClaims();
    const scheduled = await enrol(sequenceId, contactIds[7]);
    await due(scheduled.id);
    console.log(JSON.stringify({ scheduledEnrolmentId: scheduled.id, scheduledRecipient: contacts[7], sinkDeliveriesBeforeSchedule: (await deliveries()).length }));
  }
  if (process.env.CAMPAIGN_E2E_BROWSER === "1") {
    console.log(JSON.stringify({ browserUrl: `${app}/mandates/${mandateId}/outreach/campaigns`, signup: signups[0] }));
    console.log("Press Enter after the browser check to remove the synthetic fixtures.");
    await new Promise(resolve => process.stdin.once("data", resolve));
    process.stdin.pause();
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { console.error("Fixture cleanup failed:", error); process.exitCode = 1; }
  await db.end().catch(() => {});
}
