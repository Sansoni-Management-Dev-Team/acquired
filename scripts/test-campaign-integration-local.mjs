import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import { assertLocalIntegrationSchema, localCampaignDatabase, localCampaignN8n, localCampaignSink, localN8nKey } from "./campaign-integration-support.mjs";

const args = process.argv.slice(2).filter(arg => arg !== "--");
if (args.some(arg => !["--e2e", "--browser", "--persist-wait"].includes(arg))) throw new Error("Usage: pnpm test:campaign:integration [--e2e] [--browser] [--persist-wait]");
let fileEnv = {};
try { fileEnv = parseEnv(readFileSync(".env.local", "utf8")); } catch { /* Optional with exported test API key. */ }
if (!process.env.CAMPAIGN_N8N_API_KEY && fileEnv.CAMPAIGN_N8N_API_KEY) process.env.CAMPAIGN_N8N_API_KEY = fileEnv.CAMPAIGN_N8N_API_KEY;
const key = await localN8nKey();
const db = new pg.Client({ connectionString: localCampaignDatabase, connectionTimeoutMillis: 5000 });
try { await db.connect(); await assertLocalIntegrationSchema(db); } finally { await db.end(); }
const health = await fetch(`${localCampaignN8n}/healthz`, { signal: AbortSignal.timeout(5000) });
if (!health.ok) throw new Error("Existing local n8n must be healthy; this harness does not start or migrate services");
const authenticated = await fetch(`${localCampaignN8n}/api/v1/workflows?limit=1`, { headers: { "X-N8N-API-KEY": key }, signal: AbortSignal.timeout(5000) });
if (!authenticated.ok) throw new Error(`Local n8n API key preflight failed (${authenticated.status})`);

function run(command, arguments_, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
await run("pnpm", ["exec", "vitest", "run", "scripts/campaign-integration-support.test.mjs", "src/lib/campaign-provider-http.integration.test.ts", "src/db/campaign-local.integration.test.ts", "src/db/campaign-replies-local.integration.test.ts", "src/db/campaign-monitor-local.integration.test.ts"], { ...process.env, CAMPAIGN_AUDIT_LOCAL_DB: "1" });
for (const script of ["test-campaign-n8n-workflow-local.mjs", "test-campaign-n8n-adversarial-local.mjs"]) await run(process.execPath, ["--experimental-strip-types", `scripts/${script}`], { ...process.env, CAMPAIGN_N8N_API_KEY: key, CAMPAIGN_N8N_PERSIST_WAIT: args.includes("--persist-wait") && script === "test-campaign-n8n-workflow-local.mjs" ? "1" : "0" });

if (args.includes("--e2e") || args.includes("--browser")) {
  const sinkHealth = await (await fetch(`${localCampaignSink}/health`, { signal: AbortSignal.timeout(5000) })).json();
  if (sinkHealth.mode !== "no-external-delivery") throw new Error("Dedicated local sink is unavailable");
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(3013, "0.0.0.0", () => probe.close(resolve));
  });
  // Pin every delivery switch. Existing .env.local service credentials cannot
  // re-enable providers because Next preserves explicit process variables.
  const env = { ...process.env, NODE_ENV: "development", CAMPAIGN_INTEGRATION_APP: "1", LOCAL_DEVELOPMENT: "true", DATABASE_DRIVER: "postgres", DATABASE_URL: localCampaignDatabase, DATABASE_SSL_CA: "", APP_URL: "http://localhost:3013", BETTER_AUTH_SECRET: "campaign-integration-local-only-secret-32chars", CAMPAIGN_E2E_LOCAL: "1", CAMPAIGN_TEST_SINK_URL: localCampaignSink, CAMPAIGN_TEST_SEND_ANYTIME: "true", CAMPAIGN_TEST_FAST_WAITS: "true", CAMPAIGN_REPLY_MONITOR_MODE: "enforce", CAMPAIGN_N8N_ENABLED: "true", CAMPAIGN_N8N_URL: localCampaignN8n, CAMPAIGN_N8N_API_KEY: key, CAMPAIGN_APP_URL: "http://host.docker.internal:3013", OUTREACH_WORKER_SECRET: process.env.OUTREACH_WORKER_SECRET || fileEnv.OUTREACH_WORKER_SECRET || "local-campaign-test-only", CAMPAIGN_N8N_WORKER_CREDENTIAL_ID: "", CAMPAIGN_LINKEDIN_ENABLED: "false", LINKEDIN_SERVICE_URL: "", LINKEDIN_SERVICE_SECRET: "", WHATSAPP_SERVICE_URL: "", WHATSAPP_SERVICE_SECRET: "", RESEARCH_ENABLED: "false", GOOGLE_GMAIL_CLIENT_ID: "", GOOGLE_GMAIL_CLIENT_SECRET: "" };
  mkdirSync(".local-data", { recursive: true });
  const log = openSync(".local-data/campaign-integration-app.log", "w", 0o600);
  const generatedBefore = new Map(["next-env.d.ts", "tsconfig.json"].map(path => [path, readFileSync(path, "utf8")]));
  const app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--port", "3013"], { env, stdio: ["ignore", log, log], detached: true });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      if (app.exitCode !== null) throw new Error("Test app exited; inspect .local-data/campaign-integration-app.log");
      try { ready = (await fetch(`${env.APP_URL}/api/auth/get-session`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* Compiling. */ }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error("Test app did not become ready; inspect .local-data/campaign-integration-app.log");
    await run(process.execPath, ["scripts/test-campaign-n8n-e2e-local.mjs"], { ...env, CAMPAIGN_E2E_BROWSER: args.includes("--browser") ? "1" : "0" });
  } finally {
    try { process.kill(-app.pid, "SIGTERM"); } catch { /* Already stopped. */ }
    if (app.exitCode === null) await new Promise(resolve => app.once("exit", resolve));
    closeSync(log);
    // Next updates these files for the temporary distDir. Restore only those
    // known generated changes, preserving any unrelated edit during the run.
    for (const [path, before] of generatedBefore) {
      const current = readFileSync(path, "utf8");
      let generatedOnly = current.replaceAll(".next-campaign-integration/", ".next/") === before;
      if (path === "tsconfig.json") {
        const parsed = JSON.parse(current);
        parsed.include = parsed.include.filter(item => !item.startsWith(".next-campaign-integration/"));
        generatedOnly = JSON.stringify(parsed) === JSON.stringify(JSON.parse(before));
      }
      if (generatedOnly) writeFileSync(path, before);
    }
  }
}
console.log("Campaign local integration suite passed; no migrations or live provider sends performed.");
