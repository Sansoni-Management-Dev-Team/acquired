# Research integration tests with OrbStack

The repeatable suite starts an isolated Next.js app, the real local research
Worker and Workflows, and a disposable Chromium reader container. It uses the
existing OrbStack PostgreSQL database on `127.0.0.1:5434`.

```sh
pnpm test:research:e2e
```

Prerequisites:

- OrbStack running, with the `orbstack` Docker context selected.
- The existing local database and approved application/auth schema available.
- The `project-acquire-crawl4ai:latest` image, normally built by `pnpm dev`.
  Set `RESEARCH_E2E_READER_IMAGE` to use another already-built compatible image.

There are no automatic migrations, resets, or production database connections.
The read-only schema preflight fails when the required tables/index are missing.
Schema changes require separate explicit approval.

## Repeatable checks

The suite creates its own synthetic account, organization and mandate through
real authentication/API requests and scoped fixture inserts. It exercises:

- Actual Chromium rendering, extraction adapters, source validation, and saved
  PostgreSQL findings within the page/model budgets.
- Duplicate starts and retries after losing a successful evidence-save response.
- Piggyback timing delivery, explicit acknowledgements, and retry after losing a
  timing batch while progress still succeeds.
- A confirmed unavailable free-model route followed by a deterministic fallback.
- Heartbeat/replayed progress and rejection of an over-budget update, with
  database-call ceilings read from actual callback headers.
- Search HTML rendered by the OrbStack reader and parsed by the real Worker.
- Cancellation during an in-flight browser read, retaining the cancelled state
  without saving later evidence.
- Inactive research polling with a single review snapshot and no retained page
  payload in the response.

AI and search content are synthetic and deterministic. The test-only Worker
entrypoint remaps OpenRouter to a local fixture server and blocks unmatched
outbound requests and redirects. The test reader delegates to the production
Crawl4AI/Chromium implementation but remaps only the three synthetic source
hosts and DuckDuckGo HTML to local fixtures. Its browser permits requests only
to that fixture server. Production URL validation remains unchanged.

The fixture transport intentionally loses one telemetry batch before forwarding
it to the app; this tests the acknowledgement/retry protocol rather than
pretending to induce a real PostgreSQL outage. Existing unit/API tests cover
persistence failures themselves.

Ports and process state are isolated. The suite does not stop the existing dev
app, Worker, reader, or PostgreSQL container. On success and failure it cancels
its own remaining work, stops its processes/reader, and deletes only its synthetic
organization's records and account. Cleanup failures fail the command and identify
the retained fixture organization. Logs and a JSON report remain under
`.local-data/research-e2e/<run-id>/` for diagnosis.

`pnpm test` also runs fast fixture/transport/config tests and the existing UI
polling regression tests. The UI tests exercise actual callback functions to
verify unchanged progress does not trigger workspace reads; the OrbStack suite
checks the server side of polling. No real browser UI navigation is claimed by
those callback tests.

## Optional live smoke test

```sh
pnpm test:research:live
```

This starts its own local app/Worker and uses the existing OrbStack Crawl4AI
service on port `18083`, real OpenRouter extraction, and one public website.
Start that reader first through the normal local development setup. The API key
is read from `.env.local`, falling back to the shell's `OPENROUTER_API_KEY`.
The app/database remain local and synthetic records are cleaned up.

The default source is `https://arkindustrial.com.au/`. Override it with
`RESEARCH_E2E_LIVE_URL` when testing another suitable public company page. The
smoke job allows one page and one logical extraction call; existing free/paid
fallback routing can make more than one upstream attempt. Live responses are
variable and may incur provider costs, so this test is opt-in rather than part
of the routine test command. It verifies source-supported evidence, budget
counters, duplicate starts, and durable timing spans. Controlled fault injection
belongs to the repeatable suite.

## Other integration layers

```sh
pnpm test:workflows
pnpm test:coordinator
RUN_RESEARCH_SCHEDULER_SQL_TESTS=true pnpm exec vitest run \
  src/db/research-scheduler-repository.test.ts src/db/research-projections.test.ts
```

The Workflow/coordinator suites run in Cloudflare's local test runtime. The
opt-in SQL checks exercise PostgreSQL JSON/lease expressions using SELECT-only
queries against OrbStack. These remain useful beside the full-stack suite because
failures are faster to isolate.
