import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { disabledCommunicationsEnvironment } from "./communications-fixture-env.mjs";

it("prevents Next from reviving Unipile/service credentials from local env files in a fixture child", () => {
  const directory = mkdtempSync(join(tmpdir(), "communications-fixture-env-"));
  const local = { UNIPILE_API_KEY: "synthetic-private-token", UNIPILE_FUTURE_SECRET: "synthetic-future-token", COMMUNICATIONS_SERVICE_SECRET: "synthetic-service-token", COMMUNICATIONS_SERVICE_URL: "https://service.example.invalid" };
  try {
    writeFileSync(join(directory, ".env.local"), Object.entries(local).map(([key, value]) => `${key}=${value}`).join("\n"));
    const require = createRequire(import.meta.url);
    const loader = require.resolve("@next/env");
    const source = `const {loadEnvConfig}=require(${JSON.stringify(loader)});loadEnvConfig(${JSON.stringify(directory)},true,{info(){},error(){}});process.stdout.write(JSON.stringify({providerDisabled:!process.env.UNIPILE_API_KEY&&!process.env.UNIPILE_FUTURE_SECRET,serviceDisabled:!process.env.COMMUNICATIONS_SERVICE_SECRET&&!process.env.COMMUNICATIONS_SERVICE_URL,marker:process.env.FIXTURE_MARKER}));`;
    const result = spawnSync(process.execPath, ["-e", source], { env: { ...process.env, NODE_ENV: "development", FIXTURE_MARKER: "kept", ...disabledCommunicationsEnvironment([process.env], join(directory, ".env.local")) }, encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ providerDisabled: true, serviceDisabled: true, marker: "kept" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
