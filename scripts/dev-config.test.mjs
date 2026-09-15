import { expect, it } from "vitest";
import { LOCAL_DATABASE_URL, localDevConfig, localDevEnvironment, localWorkerConfig } from "./dev-config.mjs";
const env = { OPENROUTER_API_KEY: "fake", CF_ACCOUNT_ID: "fake", CF_BROWSER_TOKEN: "fake" };
it("overrides production database, worker, auth origin and paid AI settings for development", () => {
  const config = localDevConfig({ ...env, DATABASE_URL: "postgres://prod.example.com/db", DATABASE_DRIVER: "neon", AI_PROVIDER: "openrouter", RESEARCH_WORKER_URL: "https://production.example.com", APP_URL: "https://production.example.com" }, "local-secret");
  expect(config.app).toMatchObject({ DATABASE_URL: LOCAL_DATABASE_URL, DATABASE_DRIVER: "postgres", AI_PROVIDER: "openrouter-free", OUTREACH_DRAFTING_PROVIDER: "ai", RESEARCH_WORKER_URL: "http://127.0.0.1:8787", RESEARCH_SERVICE_SECRET: "local-secret", APP_URL: "http://localhost:3010" });
  expect(config.worker).not.toHaveProperty("DATABASE_URL");
  expect(config.worker).not.toHaveProperty("CF_ACCOUNT_ID");
  expect(config.worker).not.toHaveProperty("CF_BROWSER_TOKEN");
  expect(config.worker.LOCAL_CRAWL4AI_URL).toBe("http://127.0.0.1:18083");
  expect(config.origin).toBe("http://127.0.0.1:3010");
});

it("enables parity without forwarding CF credentials, remote bindings or OpenSERP", () => {
  const config = localDevConfig({ ...env, CLOUDFLARE_API_TOKEN: "do-not-use", CRAWL4AI_URL: "https://reader.workers.dev" }, "s", 3010, 8787, true);
  expect(config.policy).toBe("production");
  expect(config.worker).not.toHaveProperty("LOCAL_SEARCH_URL");
  expect(config.app.CF_BROWSER_TOKEN).toBe("");
  expect(config.app.CLOUDFLARE_API_TOKEN).toBe("");
  expect(config.app.CRAWL4AI_URL).toBe("");
  const worker = localWorkerConfig({ compatibility_date: "2026-09-08", vars: { APP_ORIGIN: "https://production.example" }, browser: { binding: "BROWSER", remote: true } }, config.origin, "/local/index.ts", config.policy);
  expect(worker).not.toHaveProperty("browser");
  expect(worker.vars).toEqual({ APP_ORIGIN: "http://127.0.0.1:3010", LOCAL_DEVELOPMENT: "true", LOCAL_RESEARCH_POLICY: "production" });
});
it("rejects missing credentials or conflicting ports instead of using production", () => {
  expect(() => localDevConfig({}, "s")).toThrow(/OPENROUTER/);
  expect(localDevConfig({ OPENROUTER_API_KEY: "fake" }, "s").worker.LOCAL_CRAWL4AI_URL).toBe("http://127.0.0.1:18083");
  expect(() => localDevConfig(env, "s", 3010, 3010)).toThrow(/differ/);
});

it("uses the project's OpenRouter key before an unrelated inherited shell key", () => {
  expect(localDevEnvironment({ OPENROUTER_API_KEY: "project-key" }, { OPENROUTER_API_KEY: "shell-key" }).OPENROUTER_API_KEY).toBe("project-key");
  expect(localDevEnvironment({}, { OPENROUTER_API_KEY: "shell-key" }).OPENROUTER_API_KEY).toBe("shell-key");
});
