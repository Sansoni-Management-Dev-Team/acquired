import { defineConfig } from "vitest/config";
import {discoverNodeTestFiles} from "./scripts/test-runner-files.mjs";

export default defineConfig({
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      // Next resolves this marker internally. Node unit tests use the same
      // empty server implementation; application/client build guards stay intact.
      "server-only": new URL("./node_modules/next/dist/compiled/server-only/empty.js", import.meta.url).pathname,
    },
  },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      reporter: ["text-summary", "json-summary", "html", "lcov"],
      reportsDirectory: "coverage/unit",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/**/*.spec.{ts,tsx}", "src/test/**", "src/**/*.d.ts"],
    },
    // Keep the CPU-heavy discovery regressions within their timeout on local runs.
    maxWorkers: 4,
    exclude: [
      "**/node_modules/**",
      "tests/routes/**",
      "**/.git/**",
      ".local-data/**",
      "cloudflare/research/workflow-tests/**",
      "cloudflare/research/provider-coordinator.integration.test.ts",
      // Shared syntax-based discovery prevents Node suites from drifting out of test:node.
      ...discoverNodeTestFiles(),
    ],
  },
});
