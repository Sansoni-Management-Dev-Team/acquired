import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { containerDevConfig } from "../ops/local/config.mjs";
import { localWorkerConfig, LOCAL_DATABASE_URL } from "./dev-config.mjs";
import { checkLocalResearchSchema } from "./local-research-schema.mjs";
import { dockerContextArgs, orbstackAvailable } from "./docker-context.mjs";

process.chdir(fileURLToPath(new URL("..", import.meta.url)));
const action = process.argv[2] || "start";
if (!["start", "stop", "status", "logs"].includes(action)) throw new Error("Usage: node scripts/dev-orbstack.mjs [start|stop|status|logs]");
const orbstack = orbstackAvailable;
// Without OrbStack domains, the localhost transport is the app origin.
const appOrigin = orbstack ? "https://acquire.orb.local" : "http://localhost:3020";
const compose = [...dockerContextArgs, "compose", "-f", "compose.local.yml", "-f", "ops/local/compose.yml"];
function docker(args) {
  const result = spawnSync("docker", [...compose, ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Docker command failed (${result.status ?? result.error?.code})`);
}
const services = ["app", "research", "local-transports", "local-network"];
if (action !== "start") {
  docker(action === "stop" ? ["stop", ...services] : action === "logs" ? ["logs", "--tail", "100", "-f", "app", "research", "local-transports"] : ["ps", ...services]);
} else {
  const directory = ".local-data/orbstack";
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  function secret(name) {
    const path = `${directory}/${name}`;
    if (!existsSync(path)) writeFileSync(path, randomBytes(32).toString("hex"), { mode: 0o600 });
    return readFileSync(path, "utf8").trim();
  }
  const environment = parseEnv(readFileSync(".env.local", "utf8"));
  const config = containerDevConfig(environment, secret("research-secret"), secret("auth-secret"), appOrigin);
  // Read-only check; startup never creates or upgrades application tables.
  const db = new pg.Client({ connectionString: LOCAL_DATABASE_URL });
  await db.connect();
  try { await checkLocalResearchSchema(db); } finally { await db.end(); }
  function writePrivate(name, content) {
    const path = `${directory}/${name}`;
    writeFileSync(path, content, { mode: 0o600 });
    chmodSync(path, 0o600);
  }
  for (const [name, values] of [["app.env", config.app], ["worker.env", config.worker]]) {
    for (const value of Object.values(values)) if (/[\r\n\0]/.test(value)) throw new Error("Local runtime values must be single-line");
    writePrivate(name, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");
  }
  const worker = localWorkerConfig(JSON.parse(readFileSync("cloudflare/research/wrangler.jsonc", "utf8")), config.origin, "/workspace/cloudflare/research/index.ts", config.policy);
  writePrivate("wrangler.json", JSON.stringify(worker, null, 2));
  // Next updates this generated declaration without changing the host worktree.
  // The read-only checkout mount cannot create mount points; add empty ignored placeholders if absent.
  if (!existsSync(".env")) writeFileSync(".env", "", { mode: 0o600, flag: "wx" });
  mkdirSync(".next", { recursive: true });
  if (!existsSync(`${directory}/next-env.d.ts`)) writePrivate("next-env.d.ts", readFileSync("next-env.d.ts", "utf8"));
  docker(["build", "local-dependencies"]);
  docker(["up", "-d", "--no-build", "--wait", "--wait-timeout", "240", "app"]);
  console.info(orbstack ? "Acquire main: https://acquire.orb.local (localhost transport: http://localhost:3020)" : "Acquire main: http://localhost:3020");
}
