// Explicit, one-off service-origin cutover. No migrations, test enrolments or sends.
import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import pg from "pg";
import { serializeAppEnvironment } from "./app-environment.mjs";

if (process.argv[2] !== "--apply" || process.argv.length !== 3) throw Error("Use --apply for the authorised service cutover");
const origin = "https://acquire.mlai.au", oldOrigin = "https://project-acquire.vercel.app";
const directory = ".local-data/app/";
const runtime = parseEnv(readFileSync(directory + "public.env", "utf8"));
const originalRuntime = readFileSync(directory + "public.env", "utf8");
const cloudflare = parseEnv(readFileSync(".env", "utf8"));
const account = "53019d98ec6f1d1d93112558076ee677";
const workerURL = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/acquire-research/settings`;
const ssh = ["-i", resolve(directory + "deploy_ed25519"), "-o", `UserKnownHostsFile=${resolve(directory + "known_hosts")}`, "-o", "StrictHostKeyChecking=yes", "-o", "HostKeyAlgorithms=ssh-ed25519", "-o", "ConnectTimeout=15"];
const host = "acquire@134.199.155.67";
const record = JSON.parse(readFileSync(directory + "digitalocean-deployment.json", "utf8"));
if (record.id !== 606721098 || record.address !== "134.199.155.67" || runtime.APP_URL !== origin) throw Error("Unexpected app target");
function save(name, value) { writeFileSync(directory + name, typeof value === "string" ? value : JSON.stringify(value, null, 2), { mode: 0o600 }); }
function run(command, args, options = {}) {
  const r = spawnSync(command, args, { stdio: "inherit", ...options });
  if (r.status !== 0) throw Error(`${command} failed`);
  return r;
}
async function n8n(path, method = "GET", body) {
  const r = await fetch(`${runtime.CAMPAIGN_N8N_URL}/api/v1${path}`, { method, headers: { "X-N8N-API-KEY": runtime.CAMPAIGN_N8N_API_KEY, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Error(`n8n ${method} ${path} failed (${r.status})`);
  return r.json();
}
async function cf(method = "GET", bindings) {
  const form = bindings ? new FormData() : undefined;
  // Retain the provisioned class declaration. This does not add a migration or
  // create/rename/delete a namespace; the existing SQLite class stays unchanged.
  if (form) form.append("settings", new Blob([JSON.stringify({ bindings, exports: { ProviderCoordinator: { type: "durable-object", storage: "sqlite" } } })], { type: "application/json" }));
  const r = await fetch(workerURL, { method, headers: { Authorization: `Bearer ${cloudflare.CLOUDFLARE_API_TOKEN}` }, ...(form ? { body: form } : {}), signal: AbortSignal.timeout(25000) });
  const b = await r.json();
  if (!r.ok || !b.success) throw Error(`Worker settings ${method} failed (${r.status}); codes ${(b.errors || []).map(x => x.code).join(",")}`);
  return b.result;
}
function replacementBindings(settings, destination) {
  return settings.bindings.map(b => b.name === "APP_ORIGIN" ? { name: b.name, type: "plain_text", text: destination } : { name: b.name, type: "inherit" });
}
function writableWorkflow(w) {
  const settings = { ...w.settings };
  // Editor-only property; absent has the same false/default behaviour.
  if (settings.availableInMCP === false) delete settings.availableInMCP;
  else if (settings.availableInMCP) throw Error("Unexpected enabled MCP workflow setting");
  return { name: w.name, nodes: w.nodes, connections: w.connections, settings };
}
function caddy(file) {
  run("scp", [...ssh, directory + file, `${host}:/opt/acquire-app/Caddyfile.cutover`]);
  run("ssh", [...ssh, host, "set -eu\nsudo caddy validate --config /opt/acquire-app/Caddyfile.cutover --adapter caddyfile\nsudo install -m 644 /opt/acquire-app/Caddyfile.cutover /etc/caddy/Caddyfile\nsudo systemctl reload caddy"]);
}

const db = new pg.Client({ connectionString: runtime.DATABASE_URL, ssl: { ca: Buffer.from(runtime.DATABASE_SSL_CA_BASE64, "base64").toString("utf8"), rejectUnauthorized: true }, connectionTimeoutMillis: 10000 });
await db.connect();
let sampleJob;
try {
  await db.query("BEGIN READ ONLY");
  for (const table of ["research_jobs", "firmable_sync_runs"]) {
    const { rows } = await db.query(`SELECT count(*)::int AS count FROM ${table} WHERE status NOT IN ('complete','partial','failed','cancelled')`);
    if (rows[0].count) throw Error(`Active ${table} exist; defer cutover`);
  }
  if ((await db.query("SELECT count(*)::int AS count FROM campaign_enrolments")).rows[0].count) throw Error("Campaign enrolments exist; defer cutover");
  sampleJob = (await db.query("SELECT id FROM research_jobs WHERE status='complete' ORDER BY created_at DESC LIMIT 1")).rows[0]?.id;
  await db.query("ROLLBACK");
} finally { await db.end(); }
for (const status of ["running", "waiting"]) {
  const b = await n8n(`/executions?status=${status}&limit=100`);
  if (b.data.length || b.nextCursor) throw Error(`n8n ${status} executions exist; defer cutover`);
}
const all = await n8n("/workflows?limit=100");
if (all.nextCursor) throw Error("Incomplete workflow inventory");
const expected = new Map([["kBiaIm7v9cK9Eoe6", "Acquire campaign scheduler"], ["0IQl0zTZ8GFXykNk", "Acquire · First Sequence · v1"]]);
const workflows = all.data.filter(w => expected.has(w.id));
if (workflows.length !== 2 || workflows.some(w => w.name !== expected.get(w.id) || !w.active)) throw Error("Unexpected Acquire workflow state");
const beforeWorker = await cf();
if (beforeWorker.bindings.find(b => b.name === "APP_ORIGIN")?.text !== oldOrigin) throw Error("Unexpected current Worker origin");
if (beforeWorker.bindings.find(b => b.name === "PROVIDER_COORDINATOR")?.class_name !== "ProviderCoordinator") throw Error("Unexpected existing Durable Object class");
const beforeCaddy = run("ssh", [...ssh, host, "cat /etc/caddy/Caddyfile"], { stdio: "pipe", encoding: "utf8" }).stdout;
save("Caddyfile.pre-cutover", beforeCaddy);
save("Caddyfile.maintenance", 'acquire.mlai.au {\n respond "Deployment in progress. Please retry shortly." 503\n}\n');
save("public-pre-cutover.env", originalRuntime);
save("n8n-cutover-before.json", workflows);
save("research-worker-cutover-before.json", beforeWorker);
let maintenance = false, runtimeChanged = false, workerChanged = false;
const deactivated = [], updated = [];
try {
  caddy("Caddyfile.maintenance"); maintenance = true;
  for (const w of workflows) { deactivated.push(w); await n8n(`/workflows/${w.id}/deactivate`, "POST"); }
  // Check again after stopping the schedule; do not race a saved execution.
  for (const status of ["running", "waiting"]) {
    const b = await n8n(`/executions?status=${status}&limit=100`);
    if (b.data.length || b.nextCursor) throw Error("Execution started during pause; rollback cutover");
  }
  Object.assign(runtime, { RESEARCH_ENABLED: "true", RESEARCH_PIPELINE_DESIGN: "hybrid-firmable-v1", CAMPAIGN_N8N_ENABLED: "true", CAMPAIGN_REPLY_MONITOR_MODE: "observe" });
  save("public.env", serializeAppEnvironment(runtime)); runtimeChanged = true;
  run("node", ["scripts/app-deploy.mjs", "acquire-app:5725d59-20261007-public", directory + "public.env"]);
  const check = `const paths=[['/api/health/ready',process.env.APP_READINESS_SECRET,200],['/api/research/internal/${sampleJob}',process.env.RESEARCH_SERVICE_SECRET,200]];(async()=>{for(const[p,s,expected]of paths){const r=await fetch('http://127.0.0.1:3000'+p,{headers:{Authorization:'Bearer '+s}});if(r.status!==expected)throw Error('Callback readiness failed');console.log(p+': '+r.status);}})().catch(()=>process.exit(1));`;
  run("ssh", [...ssh, host, "cd /opt/acquire-app/ops/app && docker compose -f compose.hosted.yml exec -T app node"], { input: check, encoding: "utf8", stdio: ["pipe", "inherit", "inherit"] });
  workerChanged = true; await cf("PATCH", replacementBindings(beforeWorker, origin));
  const afterWorker = await cf();
  const names = b => b.bindings.map(x => `${x.name}:${x.type}`).sort().join("|");
  if (names(afterWorker) !== names(beforeWorker) || afterWorker.bindings.find(b => b.name === "APP_ORIGIN")?.text !== origin) throw Error("Worker binding verification failed");
  save("research-worker-cutover-after.json", afterWorker);
  for (const w of workflows) {
    const proposal = writableWorkflow(structuredClone(w)); let count = 0;
    for (const node of proposal.nodes) {
      if (node.type !== "n8n-nodes-base.httpRequest") continue;
      if (typeof node.parameters.url !== "string" || !node.parameters.url.startsWith(oldOrigin + "/api/internal/campaigns/")) throw Error("Unexpected Acquire callback node");
      if (node.credentials?.httpHeaderAuth?.id !== "SLEV9qdDG6POrNwP") throw Error("Unexpected worker credential");
      node.parameters.url = node.parameters.url.replace(oldOrigin, origin); count++;
    }
    if (count !== (w.id === "kBiaIm7v9cK9Eoe6" ? 1 : 2)) throw Error("Unexpected callback count");
    updated.push(w); await n8n(`/workflows/${w.id}`, "PUT", proposal);
    console.log(`Updated ${w.name}: ${count} callback URLs; original workflow IDs retained`);
  }
  caddy("Caddyfile.pre-cutover"); maintenance = false;
  const ready = await fetch(origin + "/api/health/ready", { headers: { Authorization: "Bearer " + runtime.APP_READINESS_SECRET }, signal: AbortSignal.timeout(15000) });
  if (!ready.ok) throw Error("Public readiness failed");
  const control = await fetch(origin + `/api/research/internal/${sampleJob}?control=1`, { headers: { Authorization: "Bearer " + runtime.RESEARCH_SERVICE_SECRET }, signal: AbortSignal.timeout(15000) });
  if (!control.ok) throw Error("Public research control failed");
  for (const w of workflows) await n8n(`/workflows/${w.id}/activate`, "POST");
  const after = await n8n("/workflows?limit=100");
  for (const w of workflows) {
    const actual = after.data.find(x => x.id === w.id);
    if (!actual?.active || actual.nodes.some(n => n.type === "n8n-nodes-base.httpRequest" && !n.parameters.url.startsWith(origin + "/api/internal/campaigns/"))) throw Error("n8n activation verification failed");
  }
  save("n8n-cutover-after.json", after);
  save("service-cutover-result.json", { completedAt: new Date().toISOString(), origin, researchEnabled: true, researchPipeline: runtime.RESEARCH_PIPELINE_DESIGN, campaignN8nEnabled: true, workflows: workflows.map(w => ({ id: w.id, name: w.name, active: true })), noMigration: true, noForcedSend: true });
  const wrangler = "cloudflare/research/wrangler.jsonc";
  const source = readFileSync(wrangler, "utf8");
  writeFileSync(wrangler, source.replace(`"APP_ORIGIN": "${oldOrigin}"`, `"APP_ORIGIN": "${origin}"`));
  console.log("Research and n8n cutover verified; no live job or send forced");
} catch (error) {
  console.error(error.message); console.error("Restoring pre-cutover service configuration");
  let restored = true;
  try {
    if (!maintenance) { caddy("Caddyfile.maintenance"); maintenance = true; }
    for (const w of deactivated) await n8n(`/workflows/${w.id}/deactivate`, "POST");
    for (const w of updated) await n8n(`/workflows/${w.id}`, "PUT", writableWorkflow(w));
    if (workerChanged) await cf("PATCH", replacementBindings(beforeWorker, oldOrigin));
    if (runtimeChanged) { save("public.env", originalRuntime); run("node", ["scripts/app-deploy.mjs", "acquire-app:5725d59-20261007-public", directory + "public.env"]); }
    for (const w of deactivated) await n8n(`/workflows/${w.id}/activate`, "POST");
  } catch (rollbackError) { restored = false; console.error("Rollback incomplete: " + rollbackError.message); }
  if (restored && maintenance) caddy("Caddyfile.pre-cutover");
  save("service-cutover-result.json", { failedAt: new Date().toISOString(), error: error.message, rollbackComplete: restored });
  process.exitCode = 1;
}
