import { defineConfig } from "vitest/config";
import {discoverNodeTestFiles} from "./scripts/test-runner-files.mjs";

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
      ".local-data/**",
      "cloudflare/research/workflow-tests/**",
      "cloudflare/research/provider-coordinator.integration.test.ts",
      // Shared syntax-based discovery prevents Node suites from drifting out of test:node.
      ...discoverNodeTestFiles(),
    ],
  },
});
