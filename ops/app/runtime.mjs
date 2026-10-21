import { readFileSync } from "node:fs";

const required = ["DATABASE_DRIVER", "DATABASE_URL", "BETTER_AUTH_SECRET", "APP_URL", "NEXT_PUBLIC_APP_URL", "APP_READINESS_SECRET"];
for (const name of required) if (!process.env[name]?.trim()) throw new Error(`Missing ${name}`);
for (const name of ["LOCAL_DEVELOPMENT", "CAMPAIGN_E2E_LOCAL", "CAMPAIGN_TEST_SINK_URL", "CAMPAIGN_TEST_SEND_ANYTIME", "CAMPAIGN_TEST_FAST_WAITS", "VERCEL_URL", "VERCEL_REGION"])
  if (process.env[name]) throw new Error(`Do not configure ${name} in the hosted app`);
const build = JSON.parse(readFileSync(new URL("./app-build.json", import.meta.url), "utf8"));
if (process.env.APP_URL !== build.origin || process.env.NEXT_PUBLIC_APP_URL !== build.origin)
  throw new Error("App origin differs from image origin; build a matching image");
if (process.env.DATABASE_DRIVER !== "postgres") throw new Error("Hosted app requires DATABASE_DRIVER=postgres");
if (process.env.DATABASE_SSL_CA_BASE64) {
  if (process.env.DATABASE_SSL_CA) throw new Error("Set only DATABASE_SSL_CA_BASE64 for encoded certificates");
  process.env.DATABASE_SSL_CA = Buffer.from(process.env.DATABASE_SSL_CA_BASE64, "base64").toString("utf8");
}
await import("./server.js");
const { startAgentBackgroundWorker } = await import('./agent-background-worker.mjs');
await startAgentBackgroundWorker(process.env);
