import { expect, it } from "vitest";
import { containerDevConfig } from "../ops/local/config.mjs";

it("pins the main checkout to its own local origin, database and research worker", () => {
  const config = containerDevConfig({ OPENROUTER_API_KEY: "test-key", DATABASE_URL: "postgres://remote.invalid/db", APP_URL: "https://remote.invalid", CAMPAIGN_N8N_ENABLED: "true" }, "research-secret", "auth-secret");
  expect(config.app).toMatchObject({ APP_URL: "https://acquire.orb.local", NEXT_PUBLIC_APP_URL: "https://acquire.orb.local", DATABASE_URL: "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire", DATABASE_DRIVER: "postgres", RESEARCH_WORKER_URL: "http://127.0.0.1:8787", RESEARCH_SERVICE_SECRET: "research-secret", BETTER_AUTH_SECRET: "auth-secret" });
  expect(config.app.TARGET_DATA_PROVIDER).toBe("live");
  expect(config.origin).toBe("http://127.0.0.1:3000");
  expect(config.worker).toMatchObject({ SERVICE_SECRET: "research-secret", LOCAL_SEARCH_URL: "http://127.0.0.1:7000", LOCAL_CRAWL4AI_URL: "http://127.0.0.1:18083" });
});

it("does not activate sends or copy production/provider credentials into the local runtime", () => {
  const config = containerDevConfig({ OPENROUTER_API_KEY: "test-key", UNIPILE_API_KEY: "live-key", COMMUNICATIONS_RUNTIME_ENABLED: "true", COMMUNICATIONS_SERVICE_URL: "https://remote.invalid", RESEND_API_KEY: "live-email-key", CLOUDFLARE_API_TOKEN: "live-cloud-key", CAMPAIGN_N8N_API_KEY: "live-scheduler-key" }, "research-secret", "auth-secret");
  expect(config.app).toMatchObject({ COMMUNICATIONS_RUNTIME_ENABLED: "false", CAMPAIGN_N8N_ENABLED: "false", CAMPAIGN_LINKEDIN_ENABLED: "false" });
  for (const runtime of [config.app, config.worker]) {
    expect(Object.values(runtime)).not.toContain("live-key");
    expect(Object.values(runtime)).not.toContain("live-email-key");
    expect(Object.values(runtime)).not.toContain("live-cloud-key");
    expect(Object.values(runtime)).not.toContain("live-scheduler-key");
    expect(runtime).not.toHaveProperty("COMMUNICATIONS_SERVICE_URL");
  }
  expect(config.worker).not.toHaveProperty("DATABASE_URL");
});
