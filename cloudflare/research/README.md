# Public website research

The Next.js application owns authentication, approved research configuration, Postgres writes and evidence validation. A Cloudflare Workflow executes each job and calls the app for discovery, targeted searches, cancellation checks and progress. Production reads pages through Browser Run's synchronous markdown endpoint. AI extraction uses OpenRouter free models with the existing Mercury fallback; see `FREE-AI.md`. Local development uses Crawl4AI and OpenSERP.

## Discovery

New automatic runs accept a public research scope, geography and an effort budget, with up to six optional starting terms. The worker generates one discovery query at a time, adapting to recent results, duplicates and candidate research outcomes. Sector relevance is assessed semantically against the original scope on company pages; literal evidence and identity checks still apply. Search snippets and generated queries are leads, not qualification evidence.

Focused, standard and thorough budgets allow 12/24/48 web discovery attempts and 30/60/120 minutes. Retries count toward the search allowance, and planner calls count toward the existing batch model allowance. Company and owner follow-ups have separate bounded searches. The deployed search reader supports DuckDuckGo page one; other engines and later pages return explicit `unsupported_search` errors.

Each callback executes one query, with at most six discovery rounds per batch. Automatic continuations carry attempts, reasons and bounded result excerpts in existing job JSON. Failed queries get one retry. Attempt indices and a database lease prevent concurrent callbacks or workflow replays from repeating committed searches. An unavailable or invalid planner falls back to untried scope-based queries. Existing non-adaptive jobs keep the predefined search plan.

## Independent enrichment objectives

Company jobs track headcount and revenue separately; people jobs track a named decision-maker and published work email separately. A sourced headcount does not finish revenue research. A named director without an email does not finish email research. The predefined search limits are five headcount queries, three revenue queries, two people queries and two email queries, within the existing page, model and time ceilings. Every failed query can be retried once; successful empty searches are not repeated.

The company follow-up planner chooses only from discovered URLs and predefined search actions. Pages already visited within a job are not fetched again for another field. The production Cache API also reuses successful public page reads within the same authenticated research run, best-effort for one hour; failed reads are not cached. Original retrieval timestamps are retained. Cache keys include the run ID, preventing reuse between organisations. Cache availability and simultaneous first reads can still cause duplicate requests.

Company and people findings found on the same page are retained. Quotes, company identity, financial currency and named-person/email association are validated again in the application. Email is accepted only when published alongside the person's name and role at the company domain; addresses are never guessed. Search snippets remain explicitly unverified estimates and do not complete a sourced financial objective.

## Provider reliability

The `ProviderCoordinator` Durable Object coordinates browser and model requests across jobs without writing admission state to Postgres. Paid-plan Workers use four concurrent page-read slots, one reserved search slot and eight model slots. Slots release on completion, with leases for abandoned requests. Browser starts remain spaced by one second, same-domain reads cannot overlap and start at least three seconds apart, and HTTP 429 responses apply a shared Retry-After cooldown. The application callback remains as a rolling-deployment fallback when the Durable Object binding is absent. This requires no database schema change. Requests without a research job ID cannot use production search.

Automatic discovery ranks leads using the mandate scope and search-result context before it spends page and model calls. It runs at most eight candidate workflows concurrently in slots independent from enrichment, schedules at most 30 candidates for a run, and cancels surplus active candidates once the target count is reached. The local Crawl4AI container exposes five reader slots so parity tests match the paid coordinator's four page slots plus reserved search slot.

Provider error classifications survive to search/page outcomes: daily quota, request rate, concurrency, authentication/policy, credits, transport and timeout. Bounded admission waits avoid immediate bursts. A 120-second workflow step covers composed control/read/extraction calls; control and admission callbacks have shorter timeouts. Account quotas still apply and a successful test read does not establish capacity for a full mandate.

## Deployment

Production is already configured. Deploy the application callback before the worker when changing their shared contract.

The Worker and Workflow are hosted in MLAI (`53019d98ec6f1d1d93112558076ee677`),
at `https://acquire-research.mlai-530.workers.dev`. The Wrangler configuration pins
that account. Browser Rendering credentials and the Crawl4AI fallback also use
MLAI. Deployment credentials must have access to this account; Browser Rendering
requires its own Edit permission. Vercel production uses the new Worker URL and
a matching `RESEARCH_SERVICE_SECRET`; account management tokens are not needed
in Vercel. The original account's Worker and completed Workflow history are
retained for rollback, with no active runs at cutover. Rolling back requires
restoring both the prior Vercel deployment and its environment settings.

- Vercel: `RESEARCH_ENABLED`, `RESEARCH_WORKER_URL`, `RESEARCH_SERVICE_SECRET`, database and existing app settings.
- Worker secrets: `SERVICE_SECRET`, `CF_ACCOUNT_ID`, `CF_BROWSER_TOKEN`, `OPENROUTER_API_KEY`.
- Worker variable: `APP_ORIGIN`, set to the production application origin.
- Optional authenticated Crawl4AI fallback: `CRAWL4AI_URL` and `CRAWL4AI_SECRET`.
- Worker deployment: `pnpm exec wrangler deploy --config cloudflare/research/wrangler.jsonc`.

This change uses existing job JSON and needs no database migration. The Wrangler configuration declares the new SQLite-backed `ProviderCoordinator` Durable Object. Never run any database migration without explicit approval for that specific migration.

## Validation

Run `pnpm test`, `pnpm test:workflows`, `pnpm test:coordinator`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm exec tsc -p cloudflare/research/tsconfig.json`, and the Wrangler deployment dry run. Tests cover separate objectives, supported search capabilities, provider admission, Durable Object RPC, failure classification, retries, page reuse, original retrieval timestamps and continuation of discovery without initial seeds.

For an explicitly requested live reader check:

```sh
RUN_RESEARCH_BENCHMARK=1 node --env-file=.env --env-file=.env.local node_modules/vitest/vitest.mjs run scripts/benchmark-research.test.ts
```

This makes exactly three public homepage reads, with no AI, search or database writes. It writes `.local-data/stu-206-reader-benchmark.json`. It does not measure full enrichment coverage or actual billing. The September 14 check read all three sample homepages successfully; headcount, revenue and named-person/email evidence were absent from those homepage extractions. A full user-triggered mandate run is still needed to measure final coverage, time and provider cost.

The Worker uses Durable Object coordination when its binding exists and the `paid-v1` callback protocol during rolling deployment. Paid instances have a 512-request internal budget; saved page, model, time and cancellation budgets still apply. AI admission uses eight completion-released slots and the fallback container stays at three reader slots. The deterministic throughput test models the observed 133 model calls at 12 seconds each: the old four fixed 47-second lanes take about 26 minutes, while the new pool takes about 3 minutes 24 seconds. This measures scheduler overhead, not live provider latency or end-to-end mandate time.
