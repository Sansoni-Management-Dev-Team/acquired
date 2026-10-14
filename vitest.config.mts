import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  test: {
    environment: "node",
    // Keep the CPU-heavy discovery regressions within their timeout on local runs.
    maxWorkers: 4,
    exclude: [
      "**/node_modules/**",
      "**/.git/**",
      "services/whatsapp/**",
      ".local-data/**",
      "cloudflare/research/workflow-tests/**",
      "cloudflare/research/provider-coordinator.integration.test.ts",
      // These use node:test and are run by test:node after Vitest.
      "scripts/app-deploy-host.test.mjs",
      "scripts/app-public-smoke.test.mjs",
      "scripts/communications-standalone-lifecycle-runner.test.mjs",
    ],
  },
});
