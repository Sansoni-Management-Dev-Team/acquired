export const LOCAL_DATABASE_URL = "postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire";
export function localDevConfig(environment, secret, port = 3010, workerPort = 8787) {
  for (const p of [port, workerPort]) if (!Number.isInteger(p) || p < 1024 || p > 65535) throw new Error("Development ports must be integers between 1024 and 65535");
  if (port === workerPort) throw new Error("App and worker ports must differ");
  if (!environment.OPENROUTER_API_KEY) throw new Error("Set OPENROUTER_API_KEY in .env.local before starting local development");
  const account = environment.CF_ACCOUNT_ID || environment.CLOUDFLARE_ACCOUNT_ID;
  const browserToken = environment.CF_BROWSER_TOKEN || environment.CLOUDFLARE_API_TOKEN;
  if (!account || !browserToken) throw new Error("Set CF_ACCOUNT_ID and CF_BROWSER_TOKEN in .env.local for website reading/search (inference uses OpenRouter)");
  return {
    app: { ...environment, NODE_ENV: "development", DATABASE_DRIVER: "postgres", DATABASE_URL: LOCAL_DATABASE_URL,
      AI_PROVIDER: "openrouter-free", OUTREACH_DRAFTING_PROVIDER: "ai", AI_VERBOSE_LOGGING: "true", RESEARCH_ENABLED: "true",
      RESEARCH_WORKER_URL: `http://127.0.0.1:${workerPort}`, RESEARCH_SERVICE_SECRET: secret,
      APP_URL: `http://localhost:${port}`, NEXT_PUBLIC_APP_URL: `http://localhost:${port}` },
    worker: { OPENROUTER_API_KEY: environment.OPENROUTER_API_KEY, CF_ACCOUNT_ID: account, CF_BROWSER_TOKEN: browserToken, SERVICE_SECRET: secret },
    origin: `http://127.0.0.1:${port}`,
  };
}
