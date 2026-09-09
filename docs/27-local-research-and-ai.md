# Local app, local research and free inference

Run `pnpm dev` and open http://localhost:3010. The launcher:

1. Builds/starts the OrbStack Crawl4AI reader on port 18083 and checks the existing
   `project-acquire-postgres` container. The first build downloads Chromium and
   Python dependencies; subsequent builds reuse Docker's cache.
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
the database and Crawl4AI containers running.

App, worker and launcher output is shown in the terminal and saved automatically
to `.local-data/dev-start.log`. Each `pnpm dev` start clears the previous log.
The file is ignored by Git. Follow it from another terminal with:

```sh
tail -F .local-data/dev-start.log
```

Required inference credential in `.env.local`: `OPENROUTER_API_KEY`. Cloudflare
browser credentials are not required or passed to the local Worker. Keys are
never passed in command-line arguments. Other local authentication and optional
source-provider keys retain their existing settings. The launcher does not copy
production records.

All local research web searches and page reads use Crawl4AI/Chromium in OrbStack,
including business discovery, people research and company details. Search reads
the same public search engine used in production. Requests never fall back to
Cloudflare when local browsing fails. The browser still accesses public websites;
those sites can restrict or rate-limit requests from your network.

**Model inference remains external, using the free OpenRouter waterfall, with no
Workers AI neurons or paid-model fallback.** Optional data-source APIs such as
Google Places and Firmable remain external when invoked. Workflow execution,
database, app and browser run locally. The same workflow, validation, extraction,
scoring and callback code runs in both environments. The page reader differs:
local uses direct Crawl4AI reads; production uses Cloudflare crawl/poll and Markdown
APIs. Chromium/IP differences mean page coverage and latency can differ.

The generated Worker config, secrets and Workflow state live under ignored
`.local-data/dev/`. Neither the local Worker nor the local app connects to the
production database or production research callbacks. The launcher overrides any
inherited production DB/worker settings. It checks for existing research tables
and never applies migrations.

Production uses `pnpm build`/`pnpm start`, not this launcher. Vercel keeps its
production database and `RESEARCH_WORKER_URL`; research continues on the deployed
Cloudflare Worker. Production's shared Worker config has no local-development flag.
No Vercel environment changes are required for this local setup.

The local reader uses the existing pinned Crawl4AI container (`linux/amd64`, also
on Apple Silicon through OrbStack), with up to three simultaneous reads. It binds
only to `127.0.0.1:18083`, checks public HTTPS targets/redirects, and respects
robots.txt. Local provider logs identify it as `local-crawl4ai`.

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

## Provider observability

The dev log now includes JSON events prefixed `research-provider`. Each request
has a request ID, provider, operation, start/finish time and elapsed milliseconds.
Research requests carry their job ID; app-to-worker search requests share the
same request ID so a worker failure can be traced back to the originating job.
Operations distinguish business/people extraction, headcount, planning, drafting,
web search, crawling and Markdown reads. `research-progress` records saved
progress counts and remaining URLs without logging page content.

Failures record HTTP status, numeric provider error codes, allowlisted request
IDs (including Cloudflare Ray IDs), and available Retry-After/limit/remaining/reset
headers. OpenRouter error-metadata headers are also inspected. Header names and
original numeric values are preserved; reset values retain the provider's units.
Message patterns classify daily quota, request rate, concurrency, upstream
capacity and credit errors. These are diagnostic interpretations of provider
messages, not a claim that every 429 identifies its limit. Unspecified rate
limits stay `rate_limit_unspecified`. Raw messages, prompts, queries, page text,
request URLs, authorization headers and arbitrary metadata are never logged.

Transport/timeouts, malformed bodies, HTTP-200 provider errors, output token
limits and schema validation failures produce separate failure events. Error
logging stays enabled even when success logging is disabled by an adapter.
No retries or extra provider requests are performed by the logging layer.

```sh
tail -F .local-data/dev-start.log | rg --line-buffered 'research-provider|research-progress|research-ai|research-runtime'
```

Provider references: [OpenRouter routing metadata](https://openrouter.ai/docs/guides/features/router-metadata)
and [Cloudflare Browser Run limits](https://developers.cloudflare.com/browser-run/limits/).
