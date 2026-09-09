import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";

let local = {};
try { local = parseEnv(readFileSync(".env.local", "utf8")); } catch { /* An exported key also works. */ }
const key = process.env.OPENROUTER_API_KEY || local.OPENROUTER_API_KEY;
if (!key) throw new Error("Set OPENROUTER_API_KEY in .env.local or the shell before running the live test");
// Only the AI key is loaded from disk. No database, crawler or Cloudflare calls.
const result = spawnSync("pnpm", ["exec", "vitest", "run", "src/adapters/ai/free-openrouter.live.test.ts", "src/adapters/ai/free-provider.live.test.ts", "--no-file-parallelism"], {
  stdio: "inherit", env: { ...process.env, OPENROUTER_API_KEY: key, OPENROUTER_RESEARCH_LIVE: "1" },
});
process.exitCode = result.status ?? 1;
