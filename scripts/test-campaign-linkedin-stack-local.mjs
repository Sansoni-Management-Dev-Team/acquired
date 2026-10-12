// Real local app -> n8n -> Chromium-backed LinkedIn service, fictional account only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, openSync, closeSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { disabledCommunicationsEnvironment } from "./communications-fixture-env.mjs";
import { createServer } from "node:net";
import pg from "pg";
import { assertIdleCampaignDatabase, assertLocalIntegrationSchema, localCampaignDatabase, localCampaignN8n, localCampaignSink, removeCampaignFixtures, isolatedChannelStack, localCampaignAppPort, localN8nKey, generatedNextFileOnly } from "./campaign-integration-support.mjs";

const source = isolatedChannelStack ? {CAMPAIGN_N8N_API_KEY:await localN8nKey(),OUTREACH_WORKER_SECRET:"isolated-channel-worker-secret-32chars"} : parseEnv(readFileSync(".env.local", "utf8"));
const linkedin = isolatedChannelStack ? {LINKEDIN_SERVICE_SECRET:"isolated-channel-fixture-secret-32chars"} : parseEnv(readFileSync(".local-data/linkedin/service.env", "utf8"));
const containerId=isolatedChannelStack ? execFileSync("docker",["--context","orbstack","compose","-f","ops/channel-services.compose.yml","ps","-q","linkedin-fixture"],{encoding:"utf8"}).trim() : "project-acquire-linkedin";
const container = JSON.parse(execFileSync("docker", ["--context","orbstack","inspect",containerId], { encoding: "utf8" }))[0];
if(isolatedChannelStack) assert.equal(container.Config.Labels["com.docker.compose.project"],"acquire-channel-services");
const switches = Object.fromEntries(container.Config.Env.map(item => item.split(/=(.*)/s).slice(0, 2)));
assert.equal(switches.LINKEDIN_ALLOW_LIVE_SENDS, "false");
assert.equal(switches.LINKEDIN_ALLOW_CAMPAIGNS, "false");
assert.equal(switches.LINKEDIN_ENABLE_FIXTURES, "true");
assert.equal(switches.LINKEDIN_REPLY_MONITOR_ENABLED, "true");
assert.ok(switches.LINKEDIN_SERVICE_SECRET === linkedin.LINKEDIN_SERVICE_SECRET, "Local LinkedIn service credentials differ from app configuration");
const db = new pg.Client({ connectionString: localCampaignDatabase });
const app = `http://localhost:${localCampaignAppPort}`;
const reader = isolatedChannelStack ? "http://127.0.0.1:18126" : "http://127.0.0.1:18096";
const secret = source.OUTREACH_WORKER_SECRET || "local-campaign-test-only";
const n8nHeaders = { "X-N8N-API-KEY": source.CAMPAIGN_N8N_API_KEY, "Content-Type": "application/json" };
const suffix = randomUUID().slice(0, 8), org = `campaign-e2e-${suffix}`;
const mandateId = randomUUID(), targetId = randomUUID(), contactId = randomUUID(), stepId = randomUUID();
let userId, cookie, workflowId, server, log, pausedTick, report;
const generated = new Map(["next-env.d.ts", "tsconfig.json"].map(path => [path, readFileSync(path, "utf8")]));
async function until(check, label, seconds = 300) {
  const start = Date.now();
  while (Date.now() - start < seconds * 1000) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
async function api(path, method = "GET", body, auth = cookie) {
  const response = await fetch(app + path, { method, headers: { Origin: app, ...(auth ? { Cookie: auth } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const value = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(value)}`);
  return { value, response };
}
async function n8n(path, method = "GET") {
  const response = await fetch(localCampaignN8n + "/api/v1" + path, { method, headers: n8nHeaders, ...(method === "POST" ? { body: "{}" } : {}), signal: AbortSignal.timeout(10_000) });
  assert.ok(response.ok, `n8n ${path}: ${response.status}`);
  return response.json();
}
async function worker(path, body) {
  const response = await fetch(app + path, { method: "POST", headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25_000) });
  assert.ok(response.ok, `Worker ${path}: ${response.status} ${await response.clone().text()}`);
  return response.json();
}

try {
  await db.connect(); await assertLocalIntegrationSchema(db); await assertIdleCampaignDatabase(db);
  await new Promise((resolve, reject) => { const probe = createServer(); probe.once("error", reject); probe.listen(localCampaignAppPort, "0.0.0.0", () => probe.close(resolve)); });
  // Pause only the known local scheduler: its normal-hours app would move the
  // test's due time. Restore it even when an assertion fails.
  if(!isolatedChannelStack){
  const tick = await n8n("/workflows/acquireCampaignLocal");
  for (const node of tick.nodes.filter(node => node.type === "n8n-nodes-base.httpRequest"))
    assert.equal(node.parameters.url, "http://host.docker.internal:3010/api/internal/campaigns/tick");
  if (tick.active) { await n8n("/workflows/acquireCampaignLocal/deactivate", "POST"); pausedTick = true; }
  }
  log = openSync(isolatedChannelStack ? ".local-data/channel-services/linkedin-stack-app.log" : ".local-data/campaign-reply-fix/linkedin-stack-app.log", "w", 0o600);
  const env = { ...process.env, NODE_ENV: "development", CAMPAIGN_INTEGRATION_APP: "1", LOCAL_DEVELOPMENT: "true", DATABASE_DRIVER: "postgres", DATABASE_URL: localCampaignDatabase, DATABASE_SSL_CA: "", APP_URL: app, BETTER_AUTH_SECRET: "campaign-integration-local-only-secret-32chars", CAMPAIGN_TEST_SINK_URL: localCampaignSink, CAMPAIGN_TEST_SEND_ANYTIME: "true", CAMPAIGN_REPLY_MONITOR_MODE: "enforce", CAMPAIGN_N8N_ENABLED: "true", CAMPAIGN_N8N_URL: localCampaignN8n, CAMPAIGN_N8N_API_KEY: source.CAMPAIGN_N8N_API_KEY, CAMPAIGN_APP_URL: `http://host.docker.internal:${localCampaignAppPort}`, OUTREACH_WORKER_SECRET: secret, CAMPAIGN_N8N_WORKER_CREDENTIAL_ID: "", CAMPAIGN_LINKEDIN_ENABLED: "true", LINKEDIN_SERVICE_URL: reader, LINKEDIN_SERVICE_SECRET: linkedin.LINKEDIN_SERVICE_SECRET, WHATSAPP_SERVICE_URL: "", WHATSAPP_SERVICE_SECRET: "", RESEARCH_ENABLED: "false", GOOGLE_GMAIL_CLIENT_ID: "", GOOGLE_GMAIL_CLIENT_SECRET: "" };
  Object.assign(env, disabledCommunicationsEnvironment([process.env, source]));
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port",String(localCampaignAppPort)], { env, stdio: ["ignore", log, log], detached: true });
  await until(async () => { if (server.exitCode !== null) throw new Error("Owned test app exited; inspect linkedin-stack-app.log"); try { return (await fetch(app + "/api/auth/get-session", { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } }, "test app startup", 60);
  const signup = await api("/api/auth/sign-up/email", "POST", { name: "LinkedIn stack fixture", email: `stack-${suffix}@example.invalid`, password: `Test-${randomUUID()}!` }, null);
  userId = signup.value.user.id;
  cookie = signup.response.headers.getSetCookie().map(item => item.split(";")[0]).find(item => item.includes("session_token=")); assert.ok(cookie);
  await db.query("INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)", [org]);
  await db.query("INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')", [randomUUID(), org, userId]);
  await db.query("UPDATE session SET active_organization_id=$1 WHERE user_id=$2", [org, userId]);
  await db.query("INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,'LinkedIn fixture stack','{}','{}',$3)", [mandateId, org, userId]);
  await db.query("INSERT INTO targets (id,organization_id,mandate_id,company_name,firmographics) VALUES ($1,$2,$3,'Fictional company','{}')", [targetId, org, mandateId]);
  await db.query("INSERT INTO mandate_targets (organization_id,mandate_id,target_id,assessment) VALUES ($1,$2,$3,'{}')", [org, mandateId, targetId]);
  await db.query("INSERT INTO contacts (id,organization_id,target_id,display_name,personal_data,provenance,fictionalised) VALUES ($1,$2,$3,'Fictional Alex',$4,'{}',false)", [contactId, org, targetId, JSON.stringify({ linkedinUrl: "https://www.linkedin.com/in/fictional-alex" })]);
  const connection = (await api("/api/channels/linkedin?op=connection", "POST", { fixture: true })).value;
  assert.equal(connection.fixture, true); assert.equal(connection.status, "login_required");
  // Use the service's existing Chromium/Playwright harness. Select only the new
  // fictional login page; never interact with a real LinkedIn origin/account.
  execFileSync("docker", ["--context","orbstack","exec",containerId,"python","-c", `
import asyncio
from playwright.async_api import async_playwright
async def login():
    async with async_playwright() as pw:
        candidates=[]
        for slot in range(2):
            try: browser=await pw.chromium.connect_over_cdp('http://127.0.0.1:'+str(9200+slot),timeout=1500)
            except Exception: continue
            candidates.extend(p for c in browser.contexts for p in c.pages if p.url=='http://127.0.0.1:8080/fixture')
        assert len(candidates)==1,'Expected exactly one new fictional login page'
        page=candidates[0]
        await page.get_by_role('button',name='Sign in as Test User').click()
        await page.wait_for_url('**/fixture/inbox')
        await page.wait_for_timeout(1000)
asyncio.run(login())
`], { stdio: "pipe", timeout: 30_000 });
  assert.equal((await api("/api/channels/linkedin?op=connection")).value.status, "connected");
  await api("/api/channels/linkedin?op=settings", "POST", { operation: "recover" });
  await api("/api/channels/linkedin?op=settings", "POST", { timezone: "UTC", activeDays: [0, 1, 2, 3, 4, 5, 6], startHour: 0, endHour: 24, minSpacingSeconds: 1, maxSpacingSeconds: 1 });
  console.log("PASS app proxy, fictional Chromium login and owner-scoped reader");
  const definition = { schemaVersion: 1, steps: [{ id: stepId, kind: "linkedin", action: "connect", title: "Connection request", body: "" }] };
  const sequence = (await api(`/api/mandates/${mandateId}/campaigns`, "POST", { mandateId, name: `LinkedIn CR stack ${suffix}`, definition })).value;
  const version = (await api(`/api/campaigns/${sequence.id}/publish`, "POST")).value;
  workflowId = (await db.query("SELECT n8n_workflow_id FROM campaign_sequence_versions WHERE id=$1", [version.id])).rows[0].n8n_workflow_id; assert.ok(workflowId);
  const flow = await n8n(`/workflows/${workflowId}`);
  assert.equal(flow.active, true);
  assert.equal(flow.nodes.find(node => node.type === "n8n-nodes-base.httpRequest").parameters.options.timeout, 120000);
  const enrolment = (await api(`/api/campaigns/${sequence.id}/enrolments`, "POST", { contactIds: [contactId], confirmation: true })).value.enrolments[0];
  const initial = (await db.query("SELECT state,stop_reason,next_step_at FROM campaign_enrolments WHERE id=$1", [enrolment.id])).rows[0];
  assert.equal(initial.state, "active"); assert.equal(initial.stop_reason, "reply_monitor_wait"); assert.ok(initial.next_step_at);
  console.log("PASS publish single CR, provision n8n workflow, enrol profile and retain waiting schedule");
  let lastTick = 0;
  await until(async () => {
    if (Date.now() - lastTick > 10_000) { await worker("/api/internal/campaigns/tick"); lastTick = Date.now(); }
    const row = (await db.query("SELECT state,stop_reason FROM campaign_enrolments WHERE id=$1", [enrolment.id])).rows[0];
    assert.notEqual(row.state, "needs_review", `Unexpected review: ${row.stop_reason}`);
    assert.notEqual(row.state, "stopped", `Unexpected stop: ${row.stop_reason}`);
    return row.state === "completed";
  }, "fresh scoped coverage and n8n-driven fictional invitation");
  const attempts = (await db.query("SELECT state,provider_message_id FROM campaign_send_attempts WHERE enrolment_id=$1", [enrolment.id])).rows;
  assert.equal(attempts.length, 1); assert.equal(attempts[0].state, "sent"); assert.match(attempts[0].provider_message_id, /^linkedin:/);
  const monitor = (await db.query("SELECT last_success_at,last_error FROM campaign_reply_monitors WHERE organization_id=$1 AND owner_user_id=$2 AND channel='linkedin'", [org, userId])).rows[0];
  assert.ok(monitor.last_success_at); assert.ok(Date.now() - monitor.last_success_at.getTime() < 300_000);
  const replay = await worker("/api/internal/campaigns/step", { enrolmentId: enrolment.id, versionId: version.id, stepIndex: 0 }); assert.equal(replay.outcome, "finished");
  const serviceUrl = new URL("/campaign", reader); serviceUrl.searchParams.set("organizationId", org); serviceUrl.searchParams.set("userId", userId);
  const replayResponse = await fetch(serviceUrl, { method: "POST", headers: { Authorization: `Bearer ${linkedin.LINKEDIN_SERVICE_SECRET}`, "Content-Type": "application/json" }, body: JSON.stringify({ operation: "connect", profile: "https://www.linkedin.com/in/fictional-alex", key: `campaign:${enrolment.id}:${stepId}`, text: "" }) });
  assert.equal(replayResponse.status, 200); const action = (await replayResponse.json()).action;
  assert.equal(action.fixture, true); assert.equal(action.status, "submitted"); assert.equal(`linkedin:${action.id}`, attempts[0].provider_message_id);
  const settings = (await api("/api/channels/linkedin?op=settings")).value;
  assert.equal(settings.fixture, true); assert.equal(settings.usage.invitationsDaily.used, 1); assert.equal(settings.protection.liveSendsEnabled, false); assert.equal(settings.protection.campaignsEnabled, false);
  await until(async () => (await n8n(`/executions?workflowId=${workflowId}&limit=10`)).data.some(execution => execution.status === "success"), "successful n8n execution", 30);
  report = { checkedAt: new Date().toISOString(), app, n8n: localCampaignN8n, reader, fixture: true, sequence: "One connection request, empty note", freshCoverage: true, completed: true, invitations: 1, duplicateCallbackBlocked: true, serviceReplayIdempotent: true, n8nExecution: "success", realSends: 0 };
  console.log("PASS fresh coverage, real n8n dispatch, fixture invitation, completion and duplicate protection");
} finally {
  const errors = [];
  if (userId) try {
    const url = new URL("/connection", reader); url.searchParams.set("organizationId", org); url.searchParams.set("userId", userId);
    const response = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${linkedin.LINKEDIN_SERVICE_SECRET}` } }); assert.ok(response.ok);
  } catch (error) { errors.push(error); }
  if (workflowId) try { await n8n(`/workflows/${workflowId}/deactivate`, "POST"); await n8n(`/workflows/${workflowId}`, "DELETE"); } catch (error) { errors.push(error); }
  if (db._connected) try { await removeCampaignFixtures(db, org, userId ? [userId] : []); } catch (error) { errors.push(error); } finally { await db.end(); }
  if (server) {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* Already stopped. */ }
    if (server.exitCode === null) await new Promise(resolve => server.once("exit", resolve));
  }
  if (log !== undefined) closeSync(log);
  for (const [path, before] of generated) {
    const current = readFileSync(path, "utf8");
    const onlyGenerated = generatedNextFileOnly(path, before, current);
    if (onlyGenerated) writeFileSync(path, before);
  }
  if (pausedTick) try { await n8n("/workflows/acquireCampaignLocal/activate", "POST"); } catch (error) { errors.push(error); }
  if (errors.length) throw new AggregateError(errors, "Local stack fixture cleanup failed");
}
writeFileSync(isolatedChannelStack ? ".local-data/channel-services/linkedin-stack-validation.json" : ".local-data/campaign-reply-fix/local-stack-validation.json", JSON.stringify({ ...report, fixtureCleaned: true, schedulerRestored: true }, null, 2) + "\n", { mode: 0o600 });
