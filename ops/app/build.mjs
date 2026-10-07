// Build with synthetic configuration only. Runtime production secrets are separate.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const origin = process.env.NEXT_PUBLIC_APP_URL;
if (!origin || !/^https?:\/\//.test(origin)) throw new Error("Set NEXT_PUBLIC_APP_URL for this image");
if (new URL(origin).origin !== origin) throw new Error("Use an origin without a path or trailing slash");
const result = spawnSync("pnpm", ["build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    APP_STANDALONE: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    APP_URL: origin,
    DATABASE_DRIVER: "postgres",
    DATABASE_URL: "postgresql://build:build@127.0.0.1:1/build",
    DATABASE_SSL_CA: "",
    BETTER_AUTH_SECRET: "build-only-unused-auth-secret-32-characters",
    GOOGLE_GMAIL_CLIENT_ID: "build-only-unused-client",
    GOOGLE_GMAIL_CLIENT_SECRET: "build-only-unused-secret",
    RESEARCH_ENABLED: "false",
    CAMPAIGN_N8N_ENABLED: "false",
    TARGET_DATA_PROVIDER: "fixture",
    OUTREACH_DRAFTING_PROVIDER: "fixture",
  },
});
if (result.status === 0) writeFileSync(".next/standalone/app-build.json", JSON.stringify({ origin }));
process.exit(result.status ?? 1);
