import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

process.env.WRANGLER_SEND_METRICS = "false";
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
process.env.CLOUDFLARE_INCLUDE_PROCESS_ENV = "false";

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: new URL("./wrangler.jsonc", import.meta.url).pathname },
    miniflare: { outboundService: () => new Response("Network disabled in coordinator tests", { status: 503 }) },
  })],
  test: { include: ["cloudflare/research/provider-coordinator.integration.test.ts"], testTimeout: 20000 },
});
