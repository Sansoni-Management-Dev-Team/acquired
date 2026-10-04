import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
  test: { environment: "node", exclude: ["**/node_modules/**", "**/.git/**", "services/whatsapp/**", ".local-data/**", "cloudflare/research/workflow-tests/**", "cloudflare/research/provider-coordinator.integration.test.ts"] },
});
