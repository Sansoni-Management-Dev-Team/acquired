# Research architecture A/B benchmark

## Scripted three-mandate A–F comparison

`pnpm benchmark:matrix` runs all six designs on three contrasting briefs from the
actual Run demo catalogue: food packaging manufacturers, veterinary diagnostics
laboratories, and aged care software support. It submits the same `fromBrief`
request as the demo UI. Each sample has a fresh synthetic organization, disposable
OrbStack database, local app, worker state and reader container. Runs are serial
and share one starting database dump; original local and production data are not
modified. No migrations run.

The runner applies a 20-company candidate limit and ten-minute root deadline to
the frozen source copies only. Normal bounded background jobs can drain afterward.
These are workload-controlled experimental copies, not measurements of the
unmodified production presets. Provider limits and evidence validation remain
unchanged. Candidate retrieval is distinct from mandate qualification.
The directory import is capped too, and scheduling remembers previously admitted
domains across refills. The observer excludes samples that exceed the company
limit. Persisted-company coverage uses `mandate_targets` membership.

```sh
pnpm benchmark:matrix --dry-run --out .local-data/research-design/my-matrix
pnpm benchmark:matrix --out .local-data/research-design/my-matrix
pnpm benchmark:matrix --resume --out .local-data/research-design/my-matrix
```

`report.txt` and `report.json` update automatically. Each sample retains observed
field completion, accepted ABNs, exact headcounts versus bands, revenue bands,
real contacts, evidence-validator coverage, provider failures, stage timings,
and restricted raw results. Coverage uses both saved companies and the requested
20 as denominators. F's separate Firmable people runs count toward settlement;
D/E correctly record people as not requested. The first snapshot at the root
deadline is retained separately from final child-job completion. Resume skips
successful samples and retries failed samples in fresh instances. One sample
per case/design is exploratory and does not establish statistical superiority
or automatically authorize deprecation.

The environment selects the default pipeline; production now uses F, with A available via `legacy`. B (`balanced-v1`) is selected only by a local application's `RESEARCH_PIPELINE_DESIGN` environment value; request bodies cannot enable it in production. No database migration is required or performed.

## B v1 scope

B uses the same discovery, task identities, source validation, evidence rules, budgets and fixed AI routes as A. Its separate dispatcher balances active work across website, ABN, headcount, revenue, people and email, then across companies. Sitemap page work is capped at four active tasks. It does not wait for a global ABN wave before admitting the other fields.

For local B, rendered search and page reads share the actual five-slot Crawl4AI pool. AI retains its separate admission path. An ABN follow-up chooses a registry read or deterministic next action without an AI planning call. A durable root Workflow wakes scheduling every ten seconds, independent of UI polling, until settlement or the bounded deadline/grace window.

This is an initial architectural experiment. It does **not** yet implement the official ABN API (registration GUID needed), cross-run source/evidence sharing, a full event/outbox queue, relevance gating or model racing in the production extraction adapter. Those should be independent variants after the first orchestration comparison.

## Isolation and reproducibility

`prepare` captures a local mandate/request, a consistent PostgreSQL dump and a frozen source tree. Each sample creates a **new disposable OrbStack database**, restores that same dump, clears inherited research jobs/evidence/leases in the copy, and uses a fresh synthetic organization. The original development database is untouched. These are copies of the existing schema, not migration runs.

Each sample also has its own Next app, local Worker state, reader container, auth secret and ports. The application executes a frozen source tree with Webpack, and the Worker executes a prebuilt bundle with dependency watching disabled. Any observed Worker reload invalidates the sample and stops it. Copies and logs are private ignored files under `.local-data/research-design`.

Run live performance samples sequentially: separate databases cannot isolate shared laptop CPU, PostgreSQL memory or OpenRouter quotas. The suite wrapper serializes its invocations and checks for an existing live design run. Do not independently run reader benchmarks or other live research while sampling. The original dev launcher has an additional active-job check.

The historical local A run `a946a3db-fd7a-417a-af97-35b5a4e9326f` is diagnostic only: it hot-reloaded during implementation. Use a fresh A copy against B's frozen baseline for timing comparisons.

## Commands

Prepare from an exported request with `localMandateId`, `productionMandateId` and `input`:

```sh
pnpm benchmark:research prepare --request .local-data/local-replay-2026-10-03/request.json --out .local-data/research-design/baseline
pnpm benchmark:research run --design B --baseline .local-data/research-design/baseline --out .local-data/research-design/B-1
pnpm benchmark:research run --design A --baseline .local-data/research-design/baseline --out .local-data/research-design/A-1
pnpm benchmark:research compare --a .local-data/research-design/A-1/final.json --b .local-data/research-design/B-1/final.json
```

A repeatable alternating suite, with a fresh database/container/Worker per sample:

```sh
pnpm benchmark:research pair --baseline .local-data/research-design/baseline --repetitions 3 --order BA
```

A live sample can take an hour. Repetitions must be explicitly requested through the CLI. Databases/results are retained for investigation; there is no automatic database deletion or migration. Observer/source/starting-state changes require preparing a new baseline. Treat snapshots/dumps as private local data.

## Results and acceptance

`manifest.json` records case, database dump, source, observer and provider hashes. `latest.json` and `snapshots.jsonl` record progress every 15 seconds. `final.json`, `jobs.json`, `findings.json`, `app.log` and `worker.log` preserve the terminal results and underlying evidence.

Compare:

- Time until the first job for every field; count of companies receiving each objective.
- Time until settlement, active/pending jobs and deadline termination. A partial root alone does not indicate a finished run.
- Companies with supported ABN/headcount/revenue/owner-or-director/published-owner-email evidence, as a count and percentage of all companies researched. Only this run's evidence counts.
- Qualified company count, separately from candidate count.
- Page/model counters, actual request events, failures, normal capacity deferrals, observed cache events, reported model costs and stage mean/p95/max.

Company coverage uses the application's `fieldSatisfied` rules. Unknown/conflicting/estimated data is not silently converted into observed coverage. Request failures are observed events and may describe nested attempts rather than unique underlying incidents. Page counters include cached/repeated reads; stage work overlaps and must not be summed as wall-clock duration.

The comparison refuses mismatched case, database or provider settings and incomplete samples. Live websites/models remain nondeterministic: preserve catalogue snapshots, alternate A/B order and collect at least three repetitions before claiming a sustained speed improvement. A deadline result measures behavior within the budget, not successful completion of all planned research.

## Deterministic regression and AI experiments

```sh
node scripts/test-research-e2e.mjs --design=B
pnpm benchmark:free-models --live
```

The integration test uses fixed source/search/model fixtures with actual Chromium, Workflows, Next.js and PostgreSQL; it tests evidence, budget, cancellation, replay and field/page fan-out behavior. It does not prove that live search results will be stable.

The free-model probe GETs the OpenRouter catalogue, filters zero-priced text models, excludes duplicate router/audio routes, freezes the catalogue, checks remaining quota, and tests a synthetic evidence extraction. It performs one bounded catalogue-wide burst, then compares healthy candidates at concurrency 1/2/3 and a first-evidence-valid race. It applies a rolling request budget, 25-second request timeout and zero-price ceiling. It never calls the paid fallback and does not change either pipeline's approved model routes.

Availability tests and strict-schema tests are distinguished. A model being listed as free or advertising structured output is not proof that its current route accepts our exact request. A bounded probe can show observed latency/429s, not sustained account capacity or production extraction quality. Use the serialized suite entrypoint after other research has finished.

## First observations

The first live B pilot admitted every field within 15 seconds, but hot-reloaded and was excluded from performance comparisons. The free-model probe found 19 eligible text models, six with valid answers, eight HTTP 404s, two 403s and three 429s. A bounded race returned a source-validated answer in approximately 1.14 seconds. The fastest candidates included routes not advertising strict structured outputs; one advertised structured route returned 400 to the strict-schema probe. These results support testing a small healthy model pool, not broadcasting every production extraction to the full catalogue.

## C: collect once, extract all fields

C (`corpus-v1`) is local-only and keeps A/B available. One durable company job reads the homepage, sitemap/index (or a sitemap declared in robots), then up to seven useful first-party HTML pages. Navigation links are collected before stripping boilerplate; articles, external domains, duplicate URLs and non-HTML assets are excluded. Up to three site-file attempts and eight content pages fit an eleven-read job budget. Failed pages and site-file attempts consume that budget too. The reported page counter counts successful content reads, as in A/B; request events and site-read spans report the other work.

All selected pages are collected before AI extraction. Four-page batches share company/mandate context, with at most two combined extraction calls. Each finding cites its exact fetched page URL and a verbatim quote from that page. App-side validators re-check company identity, sector evidence, ABN checksum/identity, headcount and named people/email. Explicit facts can also be parsed deterministically. Unknown values remain absent. Workflow checkpoints retain fetched pages and extraction results during retries.

C can qualify identity and service evidence across separate pages from the same company job. Each quote remains validated against, and stored with, its individual source URL; other jobs and domains cannot supply that qualification. The localhost integration fixture includes this split-page case.

Only after a company job terminates and this run supplies qualified company evidence can missing fields create follow-up jobs. Already satisfied fields create no jobs. Follow-ups inherit this run's findings and have three-read/three-model-call/two-minute budgets; collection jobs have a three-minute ceiling. The scheduler permits twelve active jobs and prioritises up to eight collection jobs before allocating remaining capacity to gaps. Search/reader backend, five browser slots, per-domain restrictions and model routes remain the same as B. The same mandate request and overall research deadline are retained for this first comparison; C is not automatically a ten-minute run.

C's first ABN gap lookup now uses the public ABN Lookup active-name search directly, without a GUID, AI call or browser search admission. A shared local-process queue allows two concurrent HTTP requests, with starts at least 500 ms apart, a ten-second request timeout and a cooldown on HTTP 429. Concurrent duplicate names share one request. All returned candidates and the matching status are retained in the job configuration. A unique active normalized name match supplies an official ABN record URL; unrelated rows are ignored, while multiple matching ABNs remain unresolved. `&` and `and` are equivalent. The record still passes the existing entity, location and quoted-evidence validators before saving an ABN. No-match, ambiguous and failed lookups leave normal later search fallbacks available. This changes C's gap jobs; it does not schedule ABN lookup for every unqualified discovery candidate.

Run the same client independently against a recorded C company list, without database writes:

```sh
node scripts/test-abn-public-service.mjs --jobs .local-data/research-design/pair-C-v8/C-1/diagnostic-jobs.json --out .local-data/abn-public-service-C-test
```

Reuse the exact previous database dump and mandate while freezing the newly added C source:

```sh
pnpm benchmark:research prepare --reuse-baseline .local-data/research-design/baseline-v4 --out .local-data/research-design/baseline-C
node scripts/test-research-e2e.mjs --design=C
pnpm benchmark:research run --design C --baseline .local-data/research-design/baseline-C --out .local-data/research-design/C-1
pnpm benchmark:research pair --baseline .local-data/research-design/baseline-C --order AC --repetitions 3
```

Fresh A/C or B/C pairs use the same source snapshot, measurement code and starting database. The first historical A/B samples were captured with an older observer: preserve them as diagnostics and rerun a control using the new baseline before claiming a controlled speed improvement. The new coverage observer associates source-validated findings with their company job domain, including evidence collected before target qualification; these jobs do not need separate field jobs to have their coverage counted.

## D: Firmable company-only retrieval with public ABN fallback

D is an opt-in local design (`firmable-v1`), with its own disposable database copied from the same frozen mandate and baseline. It calls the existing encrypted Firmable session service directly: AI company search → retain original query and interpreted filters → deduplicate IDs/domains/ABNs → profile jobs in pairs → official ABR verification of reported Firmable ABNs, followed by website/legal-name searches for unresolved identities → persist profile facts, raw responses and screening against the original mandate. Firmable requests retain the service's serialized one-second pacing, renewal and 429 cooldown. Public ABN requests retain the separate two-request queue. No contact retrieval, mobile unlocks, exports or CRM actions are included.

The benchmark caps discovery at 100 unique candidates and permits ten minutes. Employee and revenue bands are stored separately; overlapping bands require review. Profile `employee_count` is a reported count; search-row `au_employee_count` is a taxonomy code and must not become an exact count. Original mandate revenue values are already dollars and are compared directly with parsed profile band bounds. The initial D sample used an entity-name/state-only ABN rule. D now uses the candidate-resolution process described below; initial D results retain their original frozen implementation.

Live pagination preflight retrieved a second page using the original interpreted filters, but 42 IDs overlapped the first page. This does not establish stable exhaustive pagination or a reliable ranking across pages. D deduplicates and detects no-progress/short pages; the initial benchmark reaches its 100-candidate cap on page one. Firmable also broadens the mandate's industries and range filters. Discovery completion means the bounded retrieval completed, not that 100 companies meet all acquisition criteria. EBITDA, audited financials and other diligence remain unverified.

```sh
node scripts/research-design-suite.mjs prepare --reuse-baseline .local-data/research-design/baseline-C-v9 --out .local-data/research-design/baseline-D-v3
node scripts/research-design-suite.mjs run --design D --baseline .local-data/research-design/baseline-D-v2 --out .local-data/research-design/D-v3-firmable
```

The ignored local `.local-data/firmable-D-credentials.json` bootstraps the existing session service; secrets are not included in benchmark reports. Compare band coverage and reported employee counts explicitly. D excludes people/email, so its duration is not a controlled like-for-like replacement for A/B/C's broader research. Provider fingerprints deliberately flag that difference. Subscription balances must be checked before and after each bounded live validation; a small unchanged balance does not establish unlimited free retrieval.

After D finishes, validate persisted profiles and screening with:

```sh
node scripts/verify-firmable-design.mjs .local-data/research-design/D-v3-firmable
```

This read-only verifier checks terminal jobs, unique domains, saved profiles, reported counts from the profile field and revenue screening against the frozen original range. It writes `profile-verification.json`, including separate reported-headcount and band coverage. The generic `final.json` field coverage is based on research findings; D records its profile facts in firmographics, so use the profile report rather than its generic size/revenue zeroes. The reported zero AI extraction calls excludes Firmable's internally operated AI search.


## D ABN candidate resolution

The current D profile callback invokes `resolvePublicCompanyAbn` for every profile. It reads reported identifiers from `region.AU.business_identifiers.abn.value`, legacy `industry_codes.abn`, and the regional field in `browserResponse`, retaining checksum-valid candidates and their source paths. A reported value is never persisted as an accepted ABN without registry verification. A unique active official record with an exact normalized company/entity or registered-name match can complete without website or name-search work; this scope is explicitly `provider_registered_entity`. Website-supported matches retain their stronger, separate scope. Recent (24-hour), same-organization/domain completed evidence can be reused, and selected cached registry records are refreshed before acceptance. Provider/website disagreements and equally supported identities remain unresolved with candidate evidence. Registry reads are deduplicated within each resolution. It reads the company homepage and up to three same-domain legal/privacy/terms/contact HTML pages, extracts disclosed ABNs and legal/owner names, searches at most five aliases and reads at most eight distinct official ABN detail records. Search and detail reads share two registry slots, 500 ms start pacing and the existing 429 cooldown. Website reads have four shared slots, public-address checks, bounded same-domain redirects, HTML byte limits and eight-second read deadlines. Resolution has a 45-second deadline, constrained by the root deadline.

An active registry record must match a legal/owner entity disclosed on that company's website. A matching explicit website ABN has stronger evidence than legal-name-only matches. Distinct equally supported entities remain ambiguous. Headquarters location is supporting context rather than a mandatory equality test; business/trading-name search results are candidates whose actual registry legal entities are verified. Generic brand mentions and third-party pages cannot establish a match. HTML comments/scripts are excluded. Raw candidate searches, official records, website excerpts, errors and resolution scope are retained in child configuration; the saved finding cites the official record and quotes its entity details. A website-disclosed contracting entity does not establish a single ABN for an entire corporate group.

The five previously unresolved companies are a fixed-cohort integration test. Their original Firmable IDs are reused and profiles are fetched live. Only discovery is replaced by the explicit cohort; the existing localhost D worker, company callbacks, ABN resolver and database persistence run normally. This is not a new 100-company mandate benchmark. Cohort runs receive a different case fingerprint.

```sh
node scripts/test-abn-identity-five.mjs
node scripts/research-design-suite.mjs run --design D --baseline .local-data/research-design/baseline-D-abn-v1 --company-cohort .local-data/abn-resolution-five/cohort.json --out .local-data/research-design/D-abn-five-v1
node scripts/verify-firmable-design.mjs .local-data/research-design/D-abn-five-v1
```

The successful five-company localhost sample completed in 25.786 seconds with five accepted and persisted ABNs, six terminal jobs and no failed jobs. Wattyl timed out on some standalone attempts; these remain unresolved with errors until website evidence is available. A successful five-company sample does not establish 100% coverage or unchanged duration across the full mandate.


## D regional-ABN 100-company regression benchmark

The saved 100-company cohort from local mandate `5988d42a-d662-4a6c-9c28-9d854604512b` contains 97 reported regional Firmable ABNs. The historical D run ignored these fields and accepted 25 website/registry ABNs. Sixteen of those differ from the reported provider values, so reported-field coverage is not verified identity coverage. The updated localhost benchmark uses the same company IDs and original mandate, with fresh live profiles and registry reads, in a separate database copy. Discovery is replaced by the fixed cohort; inherited research jobs are removed, so this sample does not benefit from the 24-hour evidence cache. It is an identity/persistence regression benchmark, not a full repeat of live discovery or a controlled A/B/C duration comparison.

```sh
node scripts/research-design-suite.mjs run --design D --baseline .local-data/research-design/baseline-D-abn-100-v5 --company-cohort .local-data/research-monitor/D-c97b69e1/cohort.json --out .local-data/research-design/D-abn-100-v5
node scripts/verify-firmable-design.mjs .local-data/research-design/D-abn-100-v5
```

The verifier additionally checks that every saved ABN has an active matching official record and retained evidence, and that conflict/ambiguous results have no accepted ABN. A/B/C switches, implementations and tests remain in the source. No database migrations are required for these changes.

The regional-ABN 100-company sample finished in 242.753 seconds with 101 completed jobs, no failures, and 67 accepted ABNs (51 provider/registry, 16 website/registry). Reported employee counts and employee/revenue bands were present for all 100. Thirty-one ABNs remained candidates-only, one ambiguous and one not found. All companies were excluded by mandate headcount screening. A separate live reuse-of-evidence check withheld four provider/website disagreements as conflicts; the isolated cold-cohort run had not inherited that website corpus. Details are in ignored `.local-data/research-design/D-abn-100-v5/abn-results.json` and `cached-conflict-verification.json`.

## Production rollout and rollback

Production automatic business discovery selects D when the server-only Vercel environment variable `RESEARCH_PIPELINE_DESIGN=firmable-v1` is configured. Manual research, people research and explicit URL investigation retain the original path. Each root snapshots its design; the Cloudflare Worker routes by the persisted root config, so an environment rollback affects new roots and does not redirect existing jobs. D remains company-only, capped at 100 profiles and ten minutes; contacts/email and acquisition diligence are separate actions. Retrieval completion is not mandate qualification.

Set `RESEARCH_PIPELINE_DESIGN=legacy` (or remove it) and redeploy the app to restore A for new production discovery runs. Keep the Worker deployed with all implementations so already-running D roots can finish. B/C remain local benchmark options; all A/B/C source, tests and frozen benchmark switches are retained. The app and Worker must both be deployed: the authenticated internal company callback allows persisted D roots in production and has a 120-second execution limit, while its Worker request deadline is 90 seconds. No database migration is required.

The full production build also uses the existing `firmable-run-recovery` helper instead of exporting a utility from a Next.js route module, which this Next.js version rejects.

## Pipeline E: web discovery → Firmable profiles

E (`web-firmable-v1`) is an alternative selectable locally or in production. A–D remain available. It reuses A's `discoveryQueryPlan`, web-search adapter and sector-relevance filter; it does not use Firmable AI discovery. Search-result titles and URLs are retained, first-party company domains are deduplicated, and directory/government/education results are excluded. Each selected domain receives a company job. The existing Firmable service searches by name, falls back to the domain prefix and reads the profile only after an exact domain match. A second domain check protects against an inconsistent profile response. Ambiguous and missing matches retain the discovered company with an explicit outcome and missing Firmable facts. Operational errors remain failed jobs.

Profiles use D's normalization, employee/revenue bands, mandate screening and registry-backed ABN identity resolver. Provider ABNs are candidates until verified. People/contact retrieval is excluded. The shared service owns authentication, pacing and cooldowns; E admits web searches through the existing browser coordinator and retries a failed query at most three times with durable waits. The root stores search provenance, terminal coverage counts and timing spans. The saved root design controls execution; automatic business discovery can select E in production.

Start interactive local E with `node scripts/dev.mjs --design E` (or `pnpm dev -- --design E`). The same private Firmable credential file used by D is required. This selection does not deploy E or alter production.

For repeatable tests, prepare a fresh frozen baseline using an existing local mandate request, then run:

```sh
node scripts/research-design-benchmark.mjs prepare --request <request.json> --out <baseline-dir>
node scripts/research-design-suite.mjs run --design E --baseline <baseline-dir> --out <run-dir>
node scripts/verify-web-firmable-design.mjs <run-dir>
```

The benchmark restores a disposable database copy, creates a fresh organization, runs the local Next app and Worker with an isolated reader, and polls until terminal. It runs no migrations. Coverage uses all discovered companies, including unmatched and failed lookups. A single run compares observed outcomes; repeated paired runs are needed to estimate performance variance. E and D use different discovery methods and therefore may find different companies even with identical mandate inputs.

## Pipeline F: parallel Firmable and web discovery

F (`hybrid-firmable-v1`) is the production-selectable extension retaining A–E. Its Firmable mandate search and A-style web searches start concurrently. The first Firmable result page indexes IDs before web matching; known IDs bypass the name matcher. A shared queue holds selected domains and allows two company retrieval jobs at a time while further web searches continue. The 100-company cap reserves 50 new domains per branch; overlapping results merge their provenance and do not create a second job. Spare capacity is filled from retained overflow when discovery finishes. Screening and ABN verification reuse the company-only service path.

The saved root `hybridResult` includes discovery counts, cross-branch overlap, the selected domains and their provenance, matched/unmatched counts and operational failures. The verifier checks one job per selected domain, unique retrieved Firmable IDs, exact domain agreement, accepted ABN identity evidence and missing facts on unmatched companies. Shared verified ABNs are flagged in the report for review rather than assuming distinct domains are distinct legal entities.

```sh
node scripts/research-design-benchmark.mjs prepare --reuse-baseline <E-baseline-dir> --out <F-baseline-dir>
node scripts/research-design-suite.mjs run --design F --baseline <F-baseline-dir> --out <F-run-dir>
node scripts/verify-hybrid-design.mjs <F-run-dir>
node scripts/dev.mjs --design F
```

Reusing a baseline preserves the mandate request and database snapshot while freezing the current F implementation. Report discovery overlap separately from overlap among selected companies. Profile coverage is measured across all selected domains, not just successful Firmable matches. This remains a company-only flow; it does not request contacts or unlock mobile numbers. Website matching on the web branch remains name-search candidate generation followed by exact domain validation; F adds direct ID retrieval for candidates supplied by Firmable discovery, not a newly verified upstream domain-search endpoint.

For the interactive localhost search path, run a frozen sample with `--policy development`:

```sh
node scripts/research-design-suite.mjs run --design F --policy development --baseline <baseline-directory> --out <sample-directory>
```

This uses OpenSERP on localhost alongside the isolated application, worker, reader and database copy. The default `production` policy uses the rendered DuckDuckGo reader path. Compare samples with the same policy; the manifest records the policy and search provider. Prepare the request with `fromBrief: true` to reproduce a user-started Find Companies action; stored job configurations contain expanded internal budgets and cannot be posted unchanged to the public start endpoint.

Modern D–F progress displays parallel discovery and company retrieval counts, including saved records, matched profiles and verified ABNs. A settled partial run opens Companies and is labelled “Finished with issues”, rather than reporting a completed child as a successful overall run. Legacy pipeline progress remains available.

## Production release

Set the application `RESEARCH_PIPELINE_DESIGN=hybrid-firmable-v1` to use F for new automatic company discovery runs. Deploy the application and research Worker together. Existing roots retain their saved design. Set `firmable-v1` for D, `web-firmable-v1` for E, or `legacy` for A to roll back new runs. B/C remain local benchmark options. Company discovery keeps the progress screen visible until the root and its company jobs settle; intermediate saves do not navigate away. Raw company profiles and ABN verification evidence remain persisted using existing JSON columns; no database migration is needed.

## Automatic people and email retrieval

New F roots snapshot `includeCompanyPeople=true`. Each saved, matched company queues an idempotent `discovery` Firmable refresh. The company step reuses the saved identity, preserving verified ABNs and bands. One automatic people workflow per root runs alongside company discovery; remaining companies queue. Profile reads explicitly use `includePhones=false` and never request phone availability or unlock endpoints. F waits durably for the linked people runs before finishing, and exposes live contact counts. Cancellation, parent failure and the original ten-minute deadline close unfinished people runs with saved results retained. Large people populations can therefore produce partial coverage within this budget. Earlier F roots and A–E preserve their previous behavior.

The manual selected-company action now retrieves phone numbers for stored contacts. It uses the captured `/phones/new` and `/phones/show` requests, skips already saved numbers and records an atomic per-contact claim before any credit-bearing call. Unknown outcomes are not retried automatically. Successful phone unlock response parsing is fixture-tested; the captured real unlock attempt returned 402, so no live credit-bearing unlock was performed during verification.
