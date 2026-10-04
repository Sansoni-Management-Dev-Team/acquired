export const LOCAL_DATABASE_URL = "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire";
export function localDevConfig(environment, secret, port = 3010, workerPort = 8787, parity = false) {
  for (const p of [port, workerPort]) if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error("Development ports must be integers between 1024 and 65535");
  if (port === workerPort) throw new Error("App and worker ports must differ");
  if (!environment.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY in .env.local before starting local development");
  return {
    app: { ...environment, ...disabledCloudflareEnvironment(environment), NODE_ENV: "development", LOCAL_DEVELOPMENT: "true", LOCAL_RESEARCH_POLICY: parity ? "production" : "development", DATABASE_DRIVER: "postgres", DATABASE_URL: LOCAL_DATABASE_URL,
      DATABASE_SSL_CA: "",
      AI_PROVIDER: "openrouter-free", OUTREACH_DRAFTING_PROVIDER: "ai", AI_VERBOSE_LOGGING: "true", RESEARCH_ENABLED: "true",
      RESEARCH_WORKER_URL: `http://127.0.0.1:${workerPort}`, RESEARCH_SERVICE_SECRET: secret,
      APP_URL: `http://localhost:${port}`, NEXT_PUBLIC_APP_URL: `http://localhost:${port}` },
    worker: { OPENROUTER_API_KEY: environment.OPENROUTER_API_KEY, LOCAL_CRAWL4AI_URL: "http://127.0.0.1:18083", ...(!parity ? { LOCAL_SEARCH_URL: "http://127.0.0.1:7000" } : {}), SERVICE_SECRET: secret },
    policy: parity ? "production" : "development",
    origin: `http://127.0.0.1:${port}`,
  };
}

// Empty values also prevent Next.js from reloading credentials from .env files.
export function disabledCloudflareEnvironment(environment) {
  return Object.fromEntries([...new Set([
    ...Object.keys(environment).filter(key => /^(CF_|CLOUDFLARE_|WRANGLER_)/.test(key)),
    "CF_ACCOUNT_ID", "CF_BROWSER_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL",
    "CRAWL4AI_URL", "CRAWL4AI_SECRET",
  ])].map(key => [key, ""]));
}

export function localWorkerConfig(production, origin, main, policy) {
  return {
    name: "acquire-research-local", main,
    compatibility_date: production.compatibility_date,
    ...(production.compatibility_flags ? { compatibility_flags: production.compatibility_flags } : {}),
    workflows: [
      { name: "acquire-research-local", binding: "RESEARCH", class_name: "AcquireResearch" },
      { name: "acquire-firmable-local", binding: "FIRMABLE", class_name: "FirmableRefresh" },
    ],
    durable_objects: { bindings: [{ name: "PROVIDER_COORDINATOR", class_name: "ProviderCoordinator" }] },
    exports: { ProviderCoordinator: { type: "durable-object", storage: "sqlite" } },
    vars: { APP_ORIGIN: origin, LOCAL_DEVELOPMENT: "true", LOCAL_RESEARCH_POLICY: policy },
  };
}

// Project credentials take precedence over unrelated keys inherited from the shell.
export function localDevEnvironment(fileEnv, shellEnv) {
  return { ...fileEnv, ...shellEnv, OPENROUTER_API_KEY: fileEnv.OPENROUTER_API_KEY || shellEnv.OPENROUTER_API_KEY };
}

// Explicit local D mode; only Firmable credentials reach the session worker.
export function enableLocalFirmableDesign(config, credentials, workerPort, design = "D") {
  if (!['D','E','F'].includes(design)) throw new Error('Local Firmable design must be D or E');
  const required = ['FIRMABLE_CLIENT_COOKIE', 'FIRMABLE_SESSION_ID', 'FIRMABLE_ORGANIZATION_ID', 'FIRMABLE_CREDENTIAL_KEY', 'FIRMABLE_SERVICE_SECRET'];
  for (const key of required) if (typeof credentials[key] !== 'string' || !credentials[key]) throw new Error(`Local D requires ${key}`);
  for (const key of [...required, 'FIRMABLE_SESSION_TOKEN']) if (credentials[key]) config.worker[key] = credentials[key];
  config.app.RESEARCH_PIPELINE_DESIGN = design === 'F' ? 'hybrid-firmable-v1' : design === 'E' ? 'web-firmable-v1' : 'firmable-v1';
  config.worker.RESEARCH_PIPELINE_DESIGN = design === 'F' ? 'hybrid-firmable-v1' : design === 'E' ? 'web-firmable-v1' : 'firmable-v1';
  config.app.FIRMABLE_TRANSPORT = 'cloudflare-session';
  config.app.FIRMABLE_SERVICE_URL = `http://127.0.0.1:${workerPort}/firmable`;
  config.app.FIRMABLE_SERVICE_SECRET = credentials.FIRMABLE_SERVICE_SECRET;
  config.app.FIRMABLE_BENCHMARK_COHORT = '';
  config.app.LOCAL_RESEARCH_BENCHMARK = '';
  return config;
}
