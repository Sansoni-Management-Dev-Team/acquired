# Local app, local research and free inference

Run `pnpm dev` and open http://localhost:3010. The launcher:

1. Starts/checks the existing OrbStack `project-acquire-postgres` container.
2. Uses `project_acquire` on `127.0.0.1:5434`, with the `postgres` driver.
3. Starts the research Worker and Workflows locally with Wrangler on port 8787.
4. Starts Next.js with a local callback origin and a separate local service secret.
5. Forces `AI_PROVIDER=openrouter-free` for drafting; the Worker uses the same
   free-only OpenRouter adapter for all research inference.

`pnpm dev --port 3011` changes the app and callback port together. Override
`LOCAL_RESEARCH_PORT` to change the worker port. Running `pnpm dev` again automatically
stops this project's existing app and worker on those ports, including orphaned
development processes. Unrelated processes are left running and reported as port
conflicts. Restarting interrupts any active local research run. Ctrl+C stops both child processes and leaves
the database container running.

Required `.env.local` values: `OPENROUTER_API_KEY`, `CF_ACCOUNT_ID`,
`CF_BROWSER_TOKEN` (Cloudflare Browser Rendering access). The corresponding
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` aliases also work. Keys are never
passed in command-line arguments. Other local authentication and source-provider
keys retain their existing settings. The launcher does not copy production records.

Cloudflare's website reading/search API is still remote and its usage can incur
charges. **All model inference uses the free OpenRouter waterfall, with no
Workers AI neurons or paid-model fallback.** Local execution is suitable for
comparing model/search quality; its latency is not identical to deployed Workflows.

The generated Worker config, secrets and Workflow state live under ignored
`.local-data/dev/`. Neither the local Worker nor the local app connects to the
production database or production research callbacks. The launcher overrides any
inherited production DB/worker settings. It checks for existing research tables
and never applies migrations.

Production uses `pnpm build`/`pnpm start`, not this launcher. Vercel keeps its
production database and `RESEARCH_WORKER_URL`; research continues on the deployed
Cloudflare Worker. Production's shared Worker config has no local-development flag.
No Vercel environment changes are required for this local setup.

For opt-in live extraction, planning and seven-draft checks using fictional data:

```sh
node scripts/test-free-research.mjs
```

See [free research AI](../cloudflare/research/FREE-AI.md) for model routing and limits.

Local workflows do not use the deployed Worker's conservative 32-request guard.
They still obey the saved page, model-call and time budgets and cancellation.
`research-runtime` logs report total requests so local runs can be measured.
For crawl HTTP 422 navigation failures, the worker tries the direct Markdown
reader once; disallowed pages and access denials do not take this fallback.
Cancellation HTTP 400 is accepted only after confirming the crawl already ended.
