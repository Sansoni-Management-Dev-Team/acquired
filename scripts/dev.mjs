import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import pg from "pg";
import { localDevConfig, enableLocalFirmableDesign, localDevEnvironment, localWorkerConfig, disabledCloudflareEnvironment } from "./dev-config.mjs";
import { checkLocalResearchSchema } from "./local-research-schema.mjs";
import { stopPreviousDevServers } from "./dev-processes.mjs";
import { startDevLog } from "./dev-log.mjs";

const logPath = resolve(".local-data/dev-start.log");
const log = startDevLog(logPath);
process.on("uncaughtExceptionMonitor", error => log.record(`${error.stack || error.message}\n`));

const parity = process.argv.includes("--parity");
const args = process.argv.slice(2).filter(a => a !== "--" && a !== "--parity");
const designIndex = args.indexOf("--design");
const design = designIndex >= 0 ? args[designIndex + 1] : null;
if (designIndex >= 0) { if (!["D","E","F"].includes(design)) throw new Error("Local design must be D, E or F"); args.splice(designIndex, 2); }
const portIndex = args.findIndex(a => a === "--port" || a === "-p");
const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 3010);
if (args.length && (portIndex !== 0 || args.length !== 2)) throw new Error("Usage: pnpm dev [--parity] [--design D|E|F] [--port 3010]");
const workerPort = Number(process.env.LOCAL_RESEARCH_PORT || 8787);
let fileEnv = {};
try { fileEnv = parseEnv(readFileSync(".env.local", "utf8")); } catch { /* Shell values also work. */ }
const directory = resolve(".local-data/dev");
mkdirSync(directory, { recursive: true, mode: 0o700 });
const secretFile = resolve(directory, "service-secret");
const secret = existsSync(secretFile) ? readFileSync(secretFile, "utf8") : randomBytes(32).toString("hex");
writeFileSync(secretFile, secret, { mode: 0o600 });
const config = localDevConfig(localDevEnvironment(fileEnv, process.env), secret, port, workerPort, parity);
if (["D","E","F"].includes(design)) {
  const credentialPath = resolve(".local-data/firmable-D-credentials.json");
  if (!existsSync(credentialPath)) throw new Error("Local D credentials are missing; configure the Firmable session first");
  enableLocalFirmableDesign(config, JSON.parse(readFileSync(credentialPath, "utf8")), workerPort, design);
}
config.app.WHATSAPP_SERVICE_URL = "";
config.app.WHATSAPP_SERVICE_SECRET = "";
const whatsappEnvFile = resolve(".local-data/whatsapp/service.env");
if (existsSync(whatsappEnvFile)) {
  const whatsappEnv = parseEnv(readFileSync(whatsappEnvFile, "utf8"));
  config.app.WHATSAPP_SERVICE_URL = "http://127.0.0.1:18095";
  config.app.WHATSAPP_SERVICE_SECRET = whatsappEnv.WHATSAPP_SERVICE_SECRET;
}
config.app.LINKEDIN_SERVICE_URL = "";
config.app.LINKEDIN_SERVICE_SECRET = "";
const linkedinRemoteTestFile = resolve(".local-data/linkedin/remote-test.env");
const linkedinEnvFile = existsSync(linkedinRemoteTestFile) ? linkedinRemoteTestFile : resolve(".local-data/linkedin/service.env");
if (existsSync(linkedinEnvFile)) {
  const linkedinEnv = parseEnv(readFileSync(linkedinEnvFile, "utf8"));
  const linkedinUrl = linkedinEnv.LINKEDIN_SERVICE_URL || "http://127.0.0.1:18096";
  if (!/^http:\/\/127\.0\.0\.1:(18096|18097)$/.test(linkedinUrl)) throw new Error("LinkedIn testing must use the local service or private SSH tunnel");
  config.app.LINKEDIN_SERVICE_URL = linkedinUrl;
  config.app.LINKEDIN_SERVICE_SECRET = linkedinEnv.LINKEDIN_SERVICE_SECRET;
}
await stopPreviousDevServers([port, workerPort]);
// Old processes may have written shutdown output while we were stopping them.
log.reset();
console.info(`Development log: ${logPath} (cleared on each pnpm dev start)`);
for (const p of [port, workerPort]) await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", () => reject(new Error(`Port ${p} is occupied. Stop the existing development server first.`)));
  server.listen(p, "127.0.0.1", () => server.close(resolve));
});
const docker = spawnSync("docker", ["--context", "orbstack", "compose", "-f", "compose.local.yml", "up", "-d", "--build", "--wait", "postgres", "crawl4ai", ...(!parity ? ["openserp"] : [])], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
if (docker.stdout) process.stdout.write(docker.stdout);
if (docker.stderr) process.stderr.write(docker.stderr);
if (docker.status !== 0) throw new Error("Start OrbStack and retry pnpm dev");
const db = new pg.Client({ connectionString: config.app.DATABASE_URL });
await db.connect();
try {
  await checkLocalResearchSchema(db);
} finally { await db.end(); }

// Ignored configuration/state: never remotely run production configuration.
const workerConfig = localWorkerConfig(JSON.parse(readFileSync("cloudflare/research/wrangler.jsonc", "utf8")), config.origin, resolve("cloudflare/research/index.ts"), config.policy);
writeFileSync(resolve(directory, "wrangler.json"), JSON.stringify(workerConfig, null, 2));
writeFileSync(resolve(directory, ".dev.vars"), Object.entries(config.worker).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join("\n"), { mode: 0o600 });
const children = [];
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already stopped. */ }
  }
  process.exitCode = code;
}
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
function start(command, arguments_, env) {
  const child = spawn(command, arguments_, { env, stdio: ["inherit", "pipe", "pipe"], detached: true });
  log.attach(child);
  children.push(child);
  child.on("error", error => { console.error(error.message); stop(1); });
  child.on("exit", code => stop(code ?? 1));
  return child;
}
console.info(`Local app: http://localhost:${port} · OrbStack Postgres :5434 · research worker :${workerPort} · Crawl4AI :18083 · ${parity ? "production policies, DuckDuckGo page 1" : "OpenSERP :7000"} · zero Cloudflare API calls · OpenRouter free models → Mercury fallback`);
start(process.execPath, [resolve("node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--config", resolve(directory, "wrangler.json"), "--ip", "127.0.0.1", "--port", String(workerPort), "--inspector-port", "0", "--persist-to", resolve(directory, "state"), "--show-interactive-dev-session=false"], { ...process.env, ...disabledCloudflareEnvironment(process.env), WRANGLER_SEND_METRICS: "false", CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: "false", CLOUDFLARE_INCLUDE_PROCESS_ENV: "false" });
if (["D","E","F"].includes(design)) console.info(`Pipeline ${design} enabled: ${design === "F" ? "parallel Firmable + A web discovery" : design === "E" ? "A web discovery → Firmable name/domain matching" : "Firmable company search"}, company profiles and ABN identity resolution; ${design === 'F' ? 'people and emails included, manual phone lookup only' : 'company-only'}, 100 candidates, 10-minute deadline.`);
let ready = false;
for (let i = 0; i < 60 && !stopping; i++) {
  try { const response = await fetch(`http://127.0.0.1:${workerPort}/`, { signal: AbortSignal.timeout(500) }); if (response.status === 401) { ready = true; break; } } catch { /* Wait for local Worker startup. */ }
  await new Promise(r => setTimeout(r, 500));
}
if (!ready) { stop(1); throw new Error("Local research worker did not become ready"); }
start(process.execPath, [resolve("node_modules/next/dist/bin/next"), "dev", "--port", String(port)], config.app);
