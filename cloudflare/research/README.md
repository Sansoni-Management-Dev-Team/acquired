# Public website research

The Next.js application owns authentication, approved research configuration, Postgres writes and evidence validation. A Cloudflare Workflow executes each job and calls the app for discovery, targeted searches, cancellation checks and progress. Production reads pages through Browser Run's synchronous markdown endpoint. AI extraction uses OpenRouter free models with the existing Mercury fallback; see `FREE-AI.md`. Local development uses Crawl4AI and OpenSERP.

## Discovery

New automatic runs accept a public research scope, geography and an effort budget, with up to six optional starting terms. The worker generates one discovery query at a time, adapting to recent results, duplicates and candidate research outcomes. Sector relevance is assessed semantically against the original scope on company pages; literal evidence and identity checks still apply. Search snippets and generated queries are leads, not qualification evidence.

Focused, standard and thorough budgets allow 12/24/48 web discovery attempts and 30/60/120 minutes. Retries count toward the search allowance, and planner calls count toward the existing batch model allowance. Company and owner follow-ups have separate bounded searches. The deployed search reader supports DuckDuckGo page one; other engines and later pages return explicit `unsupported_search` errors.

Each callback executes one query, with at most six discovery rounds per batch. Automatic continuations carry attempts, reasons and bounded result excerpts in existing job JSON. Failed queries get one retry. Attempt indices and a database lease prevent concurrent callbacks or workflow replays from repeating committed searches. An unavailable or invalid planner falls back to untried scope-based queries. Existing non-adaptive jobs keep the predefined search plan.

## Independent enrichment objectives

Company jobs track headcount and revenue separately; people jobs track a named decision-maker and published work email separately. A sourced headcount does not finish revenue research. A named director without an email does not finish email research. The predefined search limits are five headcount queries, three revenue queries, two people queries and two email queries, within the existing page, model and time ceilings. Every failed query can be retried once; successful empty searches are not repeated.

The company follow-up planner chooses only from discovered URLs and predefined search actions. Pages already visited within a job are not fetched again for another field. Public page reads are cached best-effort for one hour, retaining original retrieval timestamps; cache availability can still cause duplicate requests. Cache entries contain public page content, not mandate-specific prompts or extracted findings.

New automatic runs use independent business branches. Discovery generates batches of queries and runs their searches concurrently. Each unique business domain (including imported directory businesses) receives a website/sitemap job and separate ABN, headcount and revenue jobs; owner/director and email jobs are included when people research is enabled. No branch waits for mandate-relevance findings before starting. Each field has its own query ladder and stops when its objective is supported or its budget is exhausted. Headcount and revenue resolution distinguishes missing, estimated, conflicting and observed evidence. Estimates and unresolved conflicts do not complete those objectives. Accepted findings reconcile into company fields with their original ranges, scope, reporting period and provenance; stronger existing values are preserved, and concurrent updates use bounded compare-and-swap retries.

ABN research starts with `"Company Name" abn`, then an ABR-restricted query and a trading-name/domain query. The registry record's numeric `abn` URL parameter is retained. Registry findings require legal-name matching and matching known state/postcode; legal-suffix differences need location corroboration. ABN jobs also follow first-party legal/privacy PDFs. A PDF identifier must be directly associated with the target company, preventing hosted customer or supplier documents from becoming company identifiers. Identifiers require a valid ABN checksum and literal source text, and are validated again when persisted, including candidates produced by AI. Verified identifiers are saved with source provenance.

The website job reads robots.txt and sitemap documents and registers unique same-site sitemap and navigation pages. Company, team/board, contact, legal and PDF pages precede articles. Registration preserves deterministic deduplication order and retains pending URLs rather than discarding everything beyond the execution cap. Each dispatched page receives an independent one-page Workflow and does not recursively repeat sitemap discovery. A 32-job pool refills on completion, with deterministic job IDs, unique execution slots, cancellation checks, deadline checks and the existing provider coordinator. Up to eight core-page jobs can source evidence while capacity remains available for website and field jobs; article jobs wait for unscheduled primary jobs. Page allocation compares each business's persisted page-job count, reserves initial coverage for late sitemap arrivals, and releases unused reservation after discovery and website registration finish. In the regression scenario, 90 businesses sharing a 300-page allowance each receive three or four page jobs. The global effort allowance and 100-page per-business cap still apply: finite budgets cannot guarantee every sitemap page is read, and unscheduled work is reported separately. Old runs keep their snapshotted scheduling behaviour; start a new run to use the parallel pipeline. No database migration is required.

Company and people findings found on the same page are retained. Quotes, company identity, financial currency and named-person/email association are validated again in the application. A person requires an explicit relationship to the target company even on its own website; customer case-study speakers are not company staff. Email is accepted only when published alongside the person's name and role at the company domain; addresses are never guessed. A sourced owner/director candidate is reported separately from published email availability and still requires review of role currency, ownership and sale authority. Search snippets remain explicitly unverified estimates and do not complete a sourced financial objective.

Extraction recovery reuses already-read content and allows at most two extraction attempts, within the existing model and time budgets. Recoverable token, schema and timeout failures receive a smaller recovery request; rejection and unknown failures do not retry automatically. Page attempts report read and extraction outcomes separately, and directly observed findings survive AI failures. Revenue validation rejects competitor comparisons and per-employee amounts as company revenue.

## Provider reliability

The `ProviderCoordinator` Durable Object coordinates browser and model requests across jobs without writing admission state to Postgres. Paid-plan Workers use 32 concurrent page-read slots, four reserved search slots and 32 model slots (Browser Rendering allows 200 concurrent sessions; a run needs at most about 24 page reads). Slots release on completion, with leases for abandoned requests. Browser starts are staggered 350 ms apart (Browser Rendering allows three new browsers a second); up to four same-domain page reads may overlap and start at least three seconds apart, while searches may overlap on their shared host with one second between starts. HTTP 429 responses apply a shared Retry-After cooldown. The application callback remains as a rolling-deployment fallback when the Durable Object binding is absent. This requires no database schema change. Requests without a research job ID cannot use production search.

Automatic discovery ranks leads using the mandate scope and search-result context before it spends page and model calls. It runs at most eight candidate workflows concurrently in slots independent from enrichment, schedules at most 90 candidates for a run, and cancels surplus active candidates once the target count is reached. Local reads use a separate three-slot pool.

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

## Firmable session validation

`POST /firmable/validate` is a read-only cloud-hosted probe protected by `FIRMABLE_VALIDATION_SECRET` bearer authentication (falls back to the existing `SERVICE_SECRET` when no dedicated secret is configured). The dedicated credential grants access only to this probe. Configure Worker secrets `FIRMABLE_CLIENT_COOKIE` (the bare `__client` value), `FIRMABLE_SESSION_ID`, and `FIRMABLE_ORGANIZATION_ID`. Never put these values in Wrangler variables, source control, application responses or logs.

Each invocation requests a new organization-scoped JWT from Clerk without an old JWT, reads the known Successful Endeavours company and one ten-person page, then discards the token. The response contains HTTP outcomes, company identity, people counts, token issue/expiry times, a SHA-256 fingerprint prefix, and timing. Personal profiles and credentials are not returned. No database write, contact unlock, workflow dispatch or migration is performed.

Invoke the endpoint again after the first reported token expiry to test independent cloud requests. A different fingerprint and later expiry demonstrate fresh renewal. A 429 reports the phase and Retry-After, if supplied, without retrying; 401/403 reports an authentication or policy failure without returning upstream bodies. Redirects are rejected to prevent credential forwarding.

This is a validation endpoint, not the production enrichment adapter. It has no account-wide pacing or durable credential storage. `renewal.cookieReplaced` reports a replacement `__client` cookie without persisting it; reconnect/update the secret if the original credential stops working. The production adapter needs coordinated renewal, cookie rotation, rate-limit cooldowns, normalized provider responses and reconnect status before it can replace the existing API-key provider.

The October 2, 2026 cloud check passed twice from the deployed Worker: Clerk renewal, company retrieval and the six-person page each returned 200. The first token expired at `2026-10-01T22:47:32Z`; the second invocation obtained a distinct token issued at `22:47:43Z`, eleven seconds after that expiry. Unauthenticated requests returned 401, and neither renewal replaced the client cookie. This establishes direct Cloudflare compatibility for the tested session and endpoints, not permanent session validity or bulk throughput. Sanitized local evidence is in `.local-data/firmable-cloud-validation.json` (gitignored).

This change uses existing job JSON and needs no database migration. The Wrangler configuration declares the new SQLite-backed `ProviderCoordinator` Durable Object. Never run any database migration without explicit approval for that specific migration.

## Validation

Run `pnpm test`, `pnpm test:workflows`, `pnpm test:coordinator`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm exec tsc -p cloudflare/research/tsconfig.json`, and the Wrangler deployment dry run. Tests cover separate objectives, supported search capabilities, provider admission, Durable Object RPC, failure classification, retries, page reuse, original retrieval timestamps and continuation of discovery without initial seeds.

For an explicitly requested live reader check:

```sh
RUN_RESEARCH_BENCHMARK=1 node --env-file=.env --env-file=.env.local node_modules/vitest/vitest.mjs run scripts/benchmark-research.test.ts
```

This makes exactly three public homepage reads, with no AI, search or database writes. It writes `.local-data/stu-206-reader-benchmark.json`. It does not measure full enrichment coverage or actual billing. The September 14 check read all three sample homepages successfully; headcount, revenue and named-person/email evidence were absent from those homepage extractions. A full user-triggered mandate run is still needed to measure final coverage, time and provider cost.

The Worker uses Durable Object coordination when its binding exists and the `paid-v1` callback protocol during rolling deployment. Paid instances have a 512-request internal budget; saved page, model, time and cancellation budgets still apply. AI admission uses 32 completion-released slots and the fallback container stays at three reader slots. The deterministic throughput test models 133 model calls at 12 seconds each: the old four fixed 47-second lanes take about 26 minutes, while a continuously supplied 32-slot pool takes one minute. This measures scheduler capacity, not live provider latency or end-to-end mandate time.

### Modular Firmable session service

`firmable/account.ts` manages one serialized account through the existing
ProviderCoordinator namespace, using the dedicated `firmable-account` object.
`firmable/credentials.ts` encrypts persisted rotated credentials with AES-GCM;
`firmable/transport.ts` handles upstream errors and response normalization.
No new namespace, container, SQL schema change, or migration is required.

Set Worker secrets `FIRMABLE_SERVICE_SECRET` and `FIRMABLE_CREDENTIAL_KEY` (at
least 32 characters), plus the bootstrap client cookie, session and organization
secrets described above. Keep the encryption key stable across deployments.
The dedicated service secret cannot invoke research or diagnostic endpoints.

Private API (Bearer service secret):
- `GET /firmable/company?id=f...`, or `fqdn=example.com&name=Company`: domains
  must match exactly; ambiguous or absent matches fail explicitly.
- `POST /firmable/people/search`: `{companyId,from,size,position?}`. Maximum
  page size 100. Department and seniority filters are explicitly unsupported.
- `GET /firmable/people?id=fp...`: full existing profile, without contact unlock.
- `GET /firmable/status`: configuration, reconnect and cooldown state only.
- `POST /firmable/reconnect`: `{cookie,sessionId,organizationId}` from a fresh
  authorized login. Renewal is validated before replacing credentials. Cookie
  is the bare `__client` value. Organization must match configured organization.

Token renewal occurs on demand, cached until ten seconds before expiry. One
second pacing is conservative, not a claimed provider quota. HTTP 429 sets a
persistent account cooldown, honoring Retry-After (default 30 seconds). Requests
in cooldown fail promptly; failed authentication persists reconnect-required
state. Pending requests are bounded at ten. A restarted object restores rotated
credentials and cooldown, then renews its in-memory JWT. Raw browser records are
preserved alongside normalized taxonomy labels for acquisition history.

To select this transport in the acquisition app, set `FIRMABLE_TRANSPORT` to
`cloudflare-session`, `FIRMABLE_SERVICE_URL` to the Worker URL plus `/firmable`,
and `FIRMABLE_SERVICE_SECRET` to the matching secret. Existing enrichment and
refresh workflows use the same FirmableClient interface. The default public API
transport remains available. ABN-only and LinkedIn-only session lookups are not
implemented; use a stored Firmable ID or an exact website match.
