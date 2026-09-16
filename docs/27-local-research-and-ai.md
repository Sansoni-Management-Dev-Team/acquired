# Local app, local research and free inference

Run `pnpm dev` and open http://localhost:3010. The launcher:

1. Builds/starts the OrbStack Crawl4AI reader on port 18083 and checks the existing
   `project-acquire-postgres` container. The first build downloads Chromium and
   Python dependencies; subsequent builds reuse Docker's cache.
2. Uses `project_acquire` on `127.0.0.1:5434`, with the `postgres` driver.
3. Starts the research Worker and Workflows locally with Wrangler on port 8787.
4. Starts Next.js with a local callback origin and a separate local service secret.
5. Forces `AI_PROVIDER=openrouter-free` for drafting; the Worker uses the same
   free-first OpenRouter adapter for all research inference.

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

Required inference credential in `.env.local`: `OPENROUTER_API_KEY`. The project
file takes precedence over a different OpenRouter key inherited from the shell. Cloudflare
browser credentials are not required or passed to the local Worker. Keys are
never passed in command-line arguments. Other local authentication and optional
source-provider keys retain their existing settings. The launcher does not copy
production records.

All local research web searches and page reads use Crawl4AI/Chromium in OrbStack,
including business discovery, people research and company details. Search reads
the same public search engine used in production. Requests never fall back to
Cloudflare when local browsing fails. The browser still accesses public websites;
those sites can restrict or rate-limit requests from your network.

**Model inference remains external. Free OpenRouter models are tried first, then
`inception/mercury-2.5` as the only paid fallback.** Mercury is capped at $0.04/M
input and $0.15/M output tokens. Requests fail if pricing rises above those caps.
No Workers AI neurons are used. Optional data-source APIs such as
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

Research diagnostics are written as `research-diagnostic` JSON events in the development log (and worker logs in production). Filter by `jobId` to follow discovery counts, source queue exclusions and ordering, selected pages, page quality, planner choices, and extraction outcomes. People validation reports reason counts such as `quote_not_on_page`, `name_or_role_missing_from_quote`, and `company_identity_not_in_quote`. An empty model response is recorded separately from rejected candidates. Company-fact diagnostics report source eligibility and employment-language presence; they do not imply that a supported headcount exists. Logs omit page text, model output, query strings, and contact details. The existing source evidence remains available in the research record.

Automatic research (migration `0005_research_concurrency` required): the form asks for the number of new businesses, public search scope, and whether to find decision-makers. The server chooses ten-page discovery batches and continues unread URLs until the target, source exhaustion, or a safety ceiling (two hours and up to 15 × the target page attempts, minimum 100, maximum 1,000). Counts and visited URLs carry across batches. Failed pages are retained in history rather than retried indefinitely.

One discovery coordinator can keep up to 20 businesses in progress per mandate, with independent candidate reads and paired company-details/people jobs. Different mandates can run in parallel; starting a duplicate run on the same mandate is blocked. Slots are namespaced by mandate in the existing config field, and the database's active-slot unique index prevents racing callbacks from overfilling a slot. Each business/purpose has a deterministic job ID. Enrichment starts on saved, relevant company-website evidence, without waiting for all discovery searches to finish; it uses up to 12 pages per purpose and stops early when the requested headcount or decision-maker evidence is found. Automatic company-name search broadening is attempted once if the targeted domain search is empty. Unsupported facts remain unknown. Stop research cancels the run and its children; callbacks and periodic status checks refill available slots and reconnect queued jobs.

The migration changes only the active-job index. It must be explicitly approved before application. Until that index is present, automatic start requests return a clear service-unavailable response. Older manually bounded jobs retain their existing behaviour.

## Missing-field follow-up and evidence states

Company-detail research runs in rounds. Reading a page never consumes the
external search: when headcount is still unknown after the site's team and
about pages, the Worker runs a bounded ladder of targeted web searches (four
for size, two for people), inspects matched company profiles, and continues
until sourced evidence is found or the ladder is exhausted. Named leaders and
explicitly published work emails on pages already read are saved during
company research; a separate people job is queued only for the remaining gap.

Page text is trimmed of navigation and form scaffolding, and the model excerpt
is chosen by section relevance rather than by a fixed character cut-off, so a
team listing at the end of a long page still reaches extraction. Every saved
quote remains verbatim page text.

Directories, registers, associations and social listings are discovery sources
only. A business counts toward the new-business target, and receives
enrichment effort, once its own website shows mandate-relevant evidence.

Review screens show "Found — awaiting review" separately from "Unknown — N web
searches run". Conflicting headcount or revenue observations are kept with
their source, retrieval date, confidence, currency and reporting period; the
EBITDA scenario abstains while sources disagree.

`node scripts/retest-research-gaps.mjs <mandateId> [--people]` researches the
businesses in a mandate that still lack headcount (or a named person) one at a
time against the local stack and writes a coverage, time and cost report to
`.local-data/research-retests/`.


### Owner and director research

People research retains general managers and other senior leaders as buyer research, but keeps the contact objective open until an evidenced owner, founder, shareholder or company director candidate is found. A candidate's published company-domain email satisfies the email objective; a general manager's email does not close that gap. These roles do not prove ownership or authority to sell.

Targeted people research uses up to ten distinct follow-up queries within the existing page, model and time budgets. Trading-name searches start with plain company-name + owner searches, then cover founders, ASIC directors and management. Public trade articles with ownership signals are prioritised. Public ZoomInfo company directories can supply candidate names for exact-name follow-up searches; Mike and Michael are kept separate unless evidence links them. Department managers are retained with their literal roles while owner research continues. Phone/email buttons are not contact details. Once a legal operator is supported by source evidence, the search pivots to the legal name, including `site:dnb.com`, director, ownership and ASIC queries. A newly discovered legal entity reopens the search ladder if trading-name queries were exhausted. D&B profile reads may follow the same company's contacts tab; other companies' contacts and the directory publisher's own team are excluded. Search snippets remain leads, and saved people require literal name, role and company evidence on the page. This does not purchase ASIC extracts or unlock gated directory contacts.


### Industry-based EBITDA ranges

The company details panel calculates indicative annual EBITDA ranges from a bounded, sourced headcount and ABS industry benchmarks. The checked-in reference contains 79 industry subdivisions, 72 division/employee-band cohorts, 18 all-size industry divisions and one broad all-industry fallback. The source workbook supplies 2022–23, 2023–24 and 2024–25 observations with original employment/EBITDA inputs and cell references. Refresh with `python3 scripts/build-ebitda-benchmarks.py`; this downloads reference data and does not access a database.

For each benchmark, EBITDA per person is `EBITDA ($m) × 1,000 / employment ('000)`. The displayed low and high are the minimum and maximum products across the sourced headcount endpoints and available historical annual ratios. Negative ratios remain negative and bounds are ordered correctly. This is a historical scenario range, not a confidence interval or a company's reported earnings. Single-point headcount can still produce a range through year-to-year variation.

Industry selection uses exact labels, curated aliases and bounded token/typo matching. Ambiguous or unrelated descriptions use an explicitly labelled broad fallback, and all suggestions can be overridden. Matching scores are not represented as statistical confidence. Where headcount overlaps employee bands, separate broader-division comparisons use the part of the headcount range inside each band. Subdivision and employee-band ratios are never multiplied together. Missing, unbounded or conflicting headcount still prevents calculation. Third-party and search-result headcounts are accepted with an explicit estimated-input label. Estimates remain in the company details panel and do not overwrite reported revenue/EBITDA or automatically qualify a target.

### Headcount-based EBITDA estimates

The company details panel automatically computes an indicative annual EBITDA range whenever its refreshed research evidence contains a usable, bounded headcount. Reported statements, third-party estimates and search-result estimates can all supply the input; the panel labels estimated-headcount inputs explicitly. The calculation uses the selected or suggested ABS cohort from the 170-cohort reference set. Conflicting, missing, zero or open-ended counts remain unavailable until reviewed. This derived estimate does not overwrite reported EBITDA or revenue.

### Parallel research scheduling (September 2026)

New automatic runs fan discovered websites out into independent, two-page candidate jobs as each search slice arrives. Up to 20 business domains may be active per mandate, shared across candidate, company-facts and people work. Company facts and people use paired slots; other mandates have their own business slots. Browser and AI capacity is account-wide.

Provider admission is reserved atomically in the existing research-job JSON state. Workflows wait in durable sleep checkpoints, then consume a job-bound, single-use browser reservation. Search and page reads share the same browser limit (12-second spacing, including a two-second scheduling tolerance); AI has four independent 47-second reservation lanes for its 45-second operation deadline. These defaults preserve free-plan limits. Increasing business concurrency does not raise provider limits or change subscription plans. The synchronous search fallback uses the same queue.

Adjacent control checks reuse a one-second snapshot, and saved progress returns refreshed control state. Run-scoped page-cache hits bypass browser admission, completed reads are reused for one hour, and confirmed HTTP 404/410 pages are cached for five minutes. Transient, authentication and rate-limit failures are not negatively cached. Continuations and sibling enrichment jobs reuse saved evidence from the same target/run. The extra fixed 21-second search delays have been removed; provider admission supplies the wait.

Tests cover 20-business fan-out, paired enrichment, target/page ceilings, account-wide admission, four AI lanes, reservation expiry/single use, checkpoint replay, cached reads, cancellation and request-budget continuation. The local SQL compare-and-swap check uses a rolled-back transaction; no database migration is required.

### Adaptive business discovery

New automatic business runs take a public research scope, geography and an effort
budget. Starting terms are optional hints. The worker plans one query at a time,
using recent search titles/snippets, distinct-domain yield, previous queries and
candidate research outcomes. It can explore industry synonyms, local services and
trade directories within the scope. Only the public scope reaches the planner;
the original acquisition brief and confidential buyer details are not forwarded.
Financial fit and sale intentions remain qualification questions, with missing
facts unknown.

Focused, standard and thorough runs allow up to 12/24/48 discovery search attempts
and 30/60/120 minutes respectively. Failed searches retry once within that limit.
Planner calls use each worker batch's existing model allowance and AI admission
queue. Company and people follow-ups retain their separate bounded search ladders;
these effort settings are not monetary spending caps. The existing candidate-page
ceiling is capped at 100/300/1000 respectively, with separate per-company enrichment
page limits. Cancellation and the run deadline still govern all work.

Search results no longer need to contain the initial sector words. Company-page
extraction assesses relevance semantically against the original public scope;
verbatim quotations, company identity and URL validation remain mandatory.
Generated queries and result snippets cannot qualify a business by themselves.

Attempts, reasons, bounded result excerpts and continuation state live in existing
research-job JSON; no migration is needed. The UI exposes attempted queries,
reasons, result counts and fresh-domain counts. Search leases and attempt indices
prevent concurrent or replayed callbacks from repeating committed searches.
Malformed or unavailable planning falls back to untried scope-based searches.
Deploy the updated research Worker along with the application to enable the planner;
an older Worker uses the bounded fallback searches.
