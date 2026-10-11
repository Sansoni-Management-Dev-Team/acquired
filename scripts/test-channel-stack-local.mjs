import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import {
  isolatedChannelStack,
  localCampaignDatabase,
  localN8nKey,
  assertLocalIntegrationSchema,
  assertIdleCampaignDatabase,
} from "./campaign-integration-support.mjs";
assert.ok(
  isolatedChannelStack,
  "Set CAMPAIGN_ISOLATED_CHANNEL_STACK=1; this harness never uses the shared stack",
);
const db = new pg.Client({ connectionString: localCampaignDatabase });
try {
  await db.connect();
  await assertLocalIntegrationSchema(db);
  await assertIdleCampaignDatabase(db);
} finally {
  await db.end();
}
const key = await localN8nKey();
const env = {
  ...process.env,
  CAMPAIGN_N8N_API_KEY: key,
  OUTREACH_WORKER_SECRET: "isolated-channel-worker-secret-32chars",
};
function run(command, args, variables = env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: variables, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error(`${command} exited ${code}`)),
    );
  });
}
await run(
  process.execPath,
  [
    "--test",
    "services/whatsapp/delivery-store.integration.test.mjs",
    "services/whatsapp/store.integration.test.mjs",
    "services/whatsapp/reply-store.integration.test.mjs",
  ],
  {
    ...env,
    DATABASE_URL: localCampaignDatabase,
    WHATSAPP_DB_TEST: "true",
    WHATSAPP_DELIVERY_DB_TEST: "true",
  },
);
await run(process.execPath, [
  "scripts/test-campaign-integration-local.mjs",
  "--e2e",
  "--persist-wait",
]);
await run(process.execPath, ["scripts/test-channel-whatsapp-stack-local.mjs"]);
await run(process.execPath, ["scripts/test-campaign-linkedin-stack-local.mjs"]);
mkdirSync(".local-data/channel-services", { recursive: true });
writeFileSync(
  ".local-data/channel-services/stack-validation.json",
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      database: localCampaignDatabase.split("@")[1],
      passed: [
        "database/RLS/leases/journal",
        "email/n8n/waits/restart",
        "WhatsApp/n8n/replies/receipt recovery",
        "LinkedIn/Chromium/n8n/CR",
      ],
      realSends: 0,
    },
    null,
    2,
  ) + "\n",
  { mode: 0o600 },
);
console.log(
  "All isolated channel stack checks passed. No migrations were run by this harness.",
);
