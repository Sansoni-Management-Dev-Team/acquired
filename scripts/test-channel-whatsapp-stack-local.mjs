// Owned local app -> real n8n -> real WhatsApp HTTP/session/store -> synthetic socket.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { openSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import pg from "pg";
import {
  isolatedChannelStack,
  localCampaignDatabase,
  localCampaignSink,
  localCampaignN8n,
  localN8nKey,
  assertLocalIntegrationSchema,
  assertIdleCampaignDatabase,
  removeCampaignFixtures,
  generatedNextFileOnly,
} from "./campaign-integration-support.mjs";
assert.ok(isolatedChannelStack, "Requires CAMPAIGN_ISOLATED_CHANNEL_STACK=1");
const app = "http://localhost:3025",
  reader = "http://127.0.0.1:18125";
const secret = "isolated-channel-worker-secret-32chars",
  serviceSecret = "isolated-channel-fixture-secret-32chars";
const key = await localN8nKey();
const ownedId = execFileSync(
  "docker",
  [
    "--context",
    "orbstack",
    "compose",
    "-f",
    "ops/channel-services.compose.yml",
    "ps",
    "-q",
    "whatsapp-fixture",
  ],
  { encoding: "utf8" },
).trim();
const owned = JSON.parse(
  execFileSync("docker", ["--context", "orbstack", "inspect", ownedId], {
    encoding: "utf8",
  }),
)[0];
assert.equal(
  owned.Config.Labels["com.docker.compose.project"],
  "acquire-channel-services",
);
assert.ok(owned.Config.Env.includes("WHATSAPP_ISOLATED_FIXTURE=true"));
const db = new pg.Client({ connectionString: localCampaignDatabase });
const suffix = randomUUID().slice(0, 8),
  org = `campaign-e2e-${suffix}`,
  mandate = randomUUID();
const fixturePhone = ordinal => `614${(parseInt(suffix,16)%10000000).toString().padStart(7,"0")}${ordinal}@s.whatsapp.net`;
let user, cookie, server, log;
const generated = new Map(["next-env.d.ts", "tsconfig.json"].map(path => [path, readFileSync(path, "utf8")]));
const workflows = [];
const checks = [];
async function until(check, label, seconds = 90) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error(`Timed out: ${label}`);
}
async function api(path, method = "GET", body, auth = cookie) {
  const response = await fetch(app + path, {
    method,
    headers: {
      Origin: app,
      ...(auth ? { Cookie: auth } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(60000),
  });
  const value = await response.json();
  assert.ok(
    response.ok,
    `${path}: ${response.status} ${JSON.stringify(value)}`,
  );
  return { value, response };
}
async function worker(path, body) {
  const response = await fetch(app + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(120000),
  });
  assert.ok(
    response.ok,
    `worker ${response.status} ${await response.clone().text()}`,
  );
  return response.json();
}
async function provider(path, method = "GET", body) {
  const url = new URL(path, reader);
  if (user) {
    url.searchParams.set("organizationId", org);
    url.searchParams.set("userId", user);
  }
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${serviceSecret}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.ok(response.ok, `provider ${response.status}`);
  return response.json();
}
const receipts = async () => {
  const response = await fetch(reader + "/__test/receipts", {
    headers: { Authorization: `Bearer ${serviceSecret}` },
  });
  assert.ok(response.ok);
  return response.json();
};
async function sequence(recipient, followup = true) {
  const contact = (
    await api(`/api/mandates/${mandate}/contacts`, "POST", {
      fullName: "Fixture Person",
      phone: `+${recipient.split("@")[0]}`,
    })
  ).value;
  const first = {
    id: randomUUID(),
    kind: "whatsapp",
    title: "Introduction",
    body: "Hello {{first_name}}",
  };
  const definition = {
    schemaVersion: 1,
    steps: [
      first,
      ...(followup
        ? [
            { id: randomUUID(), kind: "wait", title: "Wait", days: 1 },
            {
              id: randomUUID(),
              kind: "whatsapp",
              title: "Follow-up",
              body: "Follow-up fixture",
            },
          ]
        : []),
    ],
  };
  const created = (
    await api(`/api/mandates/${mandate}/campaigns`, "POST", {
      mandateId: mandate,
      name: `WA fixture ${suffix}`,
      definition,
    })
  ).value;
  const version = (await api(`/api/campaigns/${created.id}/publish`, "POST"))
    .value;
  const workflow = (
    await db.query(
      "SELECT n8n_workflow_id FROM campaign_sequence_versions WHERE id=$1",
      [version.id],
    )
  ).rows[0].n8n_workflow_id;
  workflows.push(workflow);
  assert.ok(workflow);
  const enrolment = (
    await api(`/api/campaigns/${created.id}/enrolments`, "POST", {
      contactIds: [contact.id],
      confirmation: true,
    })
  ).value.enrolments[0];
  return { enrolment, version, first, recipient };
}
async function state(test) {
  return (
    await db.query(
      "SELECT state,stop_reason,step_index FROM campaign_enrolments WHERE id=$1",
      [test.enrolment.id],
    )
  ).rows[0];
}
async function callback(test, index = 0) {
  return worker("/api/internal/campaigns/step", {
    enrolmentId: test.enrolment.id,
    versionId: test.version.id,
    stepIndex: index,
  });
}
try {
  await db.connect();
  await assertLocalIntegrationSchema(db);
  await assertIdleCampaignDatabase(db);
  assert.equal(
    (await (await fetch(localCampaignSink + "/health")).json()).mode,
    "no-external-delivery",
  );
  log = openSync(
    ".local-data/channel-services/whatsapp-stack-app.log",
    "w",
    0o600,
  );
  const env = {
    ...process.env,
    NODE_ENV: "development",
    CAMPAIGN_INTEGRATION_APP: "1",
    LOCAL_DEVELOPMENT: "true",
    DATABASE_DRIVER: "postgres",
    DATABASE_URL: localCampaignDatabase,
    DATABASE_SSL_CA: "",
    APP_URL: app,
    BETTER_AUTH_SECRET: "isolated-channel-auth-secret-32chars",
    CAMPAIGN_TEST_SINK_URL: localCampaignSink,
    CAMPAIGN_TEST_SEND_ANYTIME: "true",
    CAMPAIGN_TEST_FAST_WAITS: "true",
    CAMPAIGN_REPLY_MONITOR_MODE: "enforce",
    CAMPAIGN_N8N_ENABLED: "true",
    CAMPAIGN_N8N_URL: localCampaignN8n,
    CAMPAIGN_N8N_API_KEY: key,
    CAMPAIGN_APP_URL: "http://host.docker.internal:3025",
    OUTREACH_WORKER_SECRET: secret,
    CAMPAIGN_N8N_WORKER_CREDENTIAL_ID: "",
    CAMPAIGN_LINKEDIN_ENABLED: "false",
    LINKEDIN_SERVICE_URL: "",
    LINKEDIN_SERVICE_SECRET: "",
    WHATSAPP_SERVICE_URL: reader,
    WHATSAPP_SERVICE_SECRET: serviceSecret,
    RESEARCH_ENABLED: "false",
    GOOGLE_GMAIL_CLIENT_ID: "",
    GOOGLE_GMAIL_CLIENT_SECRET: "",
  };
  server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "dev", "--port", "3025"],
    { env, stdio: ["ignore", log, log], detached: true },
  );
  await until(async () => {
    assert.equal(server.exitCode, null, "Owned app exited");
    try {
      return (
        await fetch(app + "/api/auth/get-session", {
          signal: AbortSignal.timeout(2000),
        })
      ).ok;
    } catch {
      return false;
    }
  }, "app startup");
  const signup = await api(
    "/api/auth/sign-up/email",
    "POST",
    {
      name: "WhatsApp fixture",
      email: `wa-${suffix}@example.invalid`,
      password: `Test-${randomUUID()}!`,
    },
    null,
  );
  user = signup.value.user.id;
  cookie = signup.response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .find((v) => v.includes("session_token="));
  assert.ok(cookie);
  await db.query("INSERT INTO organization (id,name,slug) VALUES ($1,$1,$1)", [
    org,
  ]);
  await db.query(
    "INSERT INTO member (id,organization_id,user_id,role) VALUES ($1,$2,$3,'owner')",
    [randomUUID(), org, user],
  );
  await db.query(
    "UPDATE session SET active_organization_id=$1 WHERE user_id=$2",
    [org, user],
  );
  await db.query(
    "INSERT INTO mandates (id,organization_id,natural_language,filters,provenance,created_by) VALUES ($1,$2,'WhatsApp local fixture','{}','{}',$3)",
    [mandate, org, user],
  );
  await api("/api/channels/whatsapp", "POST");
  await until(
    async () =>
      (await api("/api/channels/whatsapp")).value.status === "connected",
    "synthetic socket connected",
  );
  const completed = await sequence(fixturePhone(1));
  await worker("/api/internal/campaigns/tick");
  await until(async () => {
    await worker("/api/internal/campaigns/tick");
    const row = await state(completed);
    assert.notEqual(row.state, "needs_review", row.stop_reason);
    return row.state === "completed";
  }, "two n8n-driven messages");
  assert.equal(
    (await receipts()).filter((r) => r.recipient === completed.recipient)
      .length,
    2,
  );
  const stableKey = `campaign:${completed.enrolment.id}:${completed.first.id}`;
  const before = (await receipts()).length;
  assert.equal(
    (await provider(`/campaign?key=${encodeURIComponent(stableKey)}`)).status,
    "submitted",
  );
  assert.equal(
    (
      await provider("/campaign", "POST", {
        key: stableKey,
        recipient: completed.recipient,
        text: "Hello Fixture",
      })
    ).status,
    "submitted",
  );
  assert.equal((await callback(completed)).outcome, "finished");
  assert.equal((await receipts()).length, before);
  execFileSync(
    "docker",
    [
      "--context",
      "orbstack",
      "compose",
      "-f",
      "ops/channel-services.compose.yml",
      "restart",
      "whatsapp-fixture",
    ],
    { stdio: "ignore", timeout: 30000 },
  );
  await until(async () => {
    try {
      return (await provider("/health")).ok;
    } catch {
      return false;
    }
  }, "fixture restart");
  assert.equal(
    (await provider(`/campaign?key=${encodeURIComponent(stableKey)}`)).status,
    "submitted",
  );
  assert.equal((await receipts()).length, before);
  checks.push(
    "n8n send/wait/follow-up, callback replay, service replay and restart receipt",
  );
  await until(async () => (await provider('/connection')).status === 'connected', 'restored session');
  const replying = await sequence(fixturePhone(2));
  await worker("/api/internal/campaigns/tick");
  await until(
    async () =>
      (await receipts()).some((r) => r.recipient === replying.recipient),
    "reply case first message",
  );
  await provider("/__test/inbound", "POST", { recipient: replying.recipient });
  await worker("/api/internal/campaigns/tick");
  await until(async () => {
    await worker("/api/internal/campaigns/tick");
    return (await state(replying)).state === "stopped";
  }, "reply reader stops follow-up");
  assert.equal((await callback(replying, 2)).outcome, "finished");
  assert.equal(
    (await receipts()).filter((r) => r.recipient === replying.recipient).length,
    1,
  );
  checks.push("actual WhatsApp event persistence/reader stops n8n follow-up");
  const recovered = await sequence(fixturePhone(3), false);
  await db.query(
    "UPDATE campaign_enrolments SET n8n_started_at=now() WHERE id=$1",
    [recovered.enrolment.id],
  );
  const recoveryKey = `campaign:${recovered.enrolment.id}:${recovered.first.id}`;
  const receipt = await provider("/campaign", "POST", {
    key: recoveryKey,
    recipient: recovered.recipient,
    text: "Hello Fixture",
  });
  assert.equal(receipt.status, "submitted");
  await db.query(
    "INSERT INTO campaign_send_attempts (organization_id,owner_user_id,enrolment_id,step_index,rfc_message_id,state) VALUES($1,$2,$3,0,$4,'unknown')",
    [org, user, recovered.enrolment.id, `<${randomUUID()}@example.invalid>`],
  );
  await db.query(
    "UPDATE campaign_enrolments SET state='needs_review',stop_reason='whatsapp_result_unknown',next_step_at=NULL WHERE id=$1",
    [recovered.enrolment.id],
  );
  const beforeRecovery = (await receipts()).length;
  await worker("/api/internal/campaigns/tick");
  await until(async () => {
    await worker("/api/internal/campaigns/tick");
    return (await state(recovered)).state === "completed";
  }, "receipt recovery with fresh coverage");
  assert.equal((await receipts()).length, beforeRecovery);
  checks.push(
    "lost application receipt recovered through GET, fresh coverage, no resubmission",
  );
  writeFileSync(
    ".local-data/channel-services/whatsapp-stack-validation.json",
    JSON.stringify(
      { checkedAt: new Date().toISOString(), checks, realSends: 0 },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.log("WhatsApp full-stack checks passed:", checks);
} finally {
  const errors = [];
  if (user)
    try {
      await provider("/connection", "DELETE");
    } catch (e) {
      errors.push(e);
    }
  for (const id of workflows)
    try {
      for (const [suffix, method] of [
        ["/deactivate", "POST"],
        ["", "DELETE"],
      ]) {
        const response = await fetch(
          `${localCampaignN8n}/api/v1/workflows/${id}${suffix}`,
          {
            method,
            headers: {
              "X-N8N-API-KEY": key,
              "content-type": "application/json",
            },
            ...(method === "POST" ? { body: "{}" } : {}),
          },
        );
        assert.ok(response.ok || response.status === 404);
      }
    } catch (e) {
      errors.push(e);
    }
  if (db._connected)
    try {
      await removeCampaignFixtures(db, org, user ? [user] : []);
    } catch (e) {
      errors.push(e);
    } finally {
      await db.end();
    }
  if (server) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {}
    if (server.exitCode === null)
      await new Promise((r) => server.once("exit", r));
  }
  if (log !== undefined) closeSync(log);
  for (const [path, before] of generated) {
    if (generatedNextFileOnly(path, before, readFileSync(path, "utf8"))) writeFileSync(path, before);
  }
  if (errors.length)
    throw new AggregateError(errors, "Owned fixture cleanup failed");
}
