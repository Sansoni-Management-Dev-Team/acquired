# Testing research locally with Cloudflare runtime parity

Reviewed 15 September 2026 against commit `b30f801` and session
`01a09e82-d0aa-7cf2-951e-3695104908b7`. Implementation continued from session
`01a0a233-a9bb-7e00-b720-c0d4fd84259c`.

## Implemented local test modes

```sh
pnpm test:workflows # Credential-free replay in the real local Workflow runtime
pnpm dev:parity    # OrbStack browser + Postgres, local Worker, live OpenRouter
node scripts/test-parity-server.mjs # Integration checks against that running server
```

Parity mode retains the production request guard, browser admission, page cache
and DuckDuckGo page-one policy. Local research fetches use an allowlist and reject
redirects; the launcher removes Cloudflare credentials and hosted browser fallback
configuration. Replay blocks all unmocked outbound traffic. Live parity still uses
OpenRouter and can incur AI charges.

The Workflow regressions cover execution, early cancellation, callback retries,
the request guard, extraction of a persisted page in a subsequent execution, and
admission denial followed by successful continuation. Deferred pages retain their
content and retrieval time; admission denial preserves the unused page allowance.

OrbStack's Postgres, Crawl4AI and OpenSERP containers were verified healthy. A
read-only database check confirmed the research tables and active-slot unique
index. The launcher checks these prerequisites without applying migrations.

The live integration script uses the saved login in `.local-data/dev/test-cookie`
and leaves a labelled test mandate plus a report under `.local-data/parity-tests`.
It uses one page and one model call, with discovery disabled. On 15 September,
all eight checks passed: authentication, mandate creation, search restrictions,
duplicate starts, the active-slot constraint, real browser/extraction/persistence,
stale callbacks and cancellation. Two findings were saved. The research result
was correctly partial because two links remained after the one-page limit.

This run caught a runtime incompatibility hidden by mocked fetches: workerd does
not accept `redirect: "error"`. The local guard now uses `manual` and explicitly
rejects redirect responses. A test using real Worker fetch guards this behavior.

The design and acceptance matrix below retain broader follow-up coverage:
simultaneous duplicate evidence callbacks, concurrent job fairness, recovery after
a process restart, and browser-driven UI interactions remain unverified.

## Recommendation

Keep Next.js on the Mac, run the research Worker and Workflows through Wrangler,
and use OrbStack for Postgres and browser/provider containers. Add a strict local
mode that preserves production policies while replacing external transports.
Local iteration must consume **zero Cloudflare account quota**. Use recorded
provider responses for repeatable failure tests and OrbStack's browser for fresh
website reads. Real Cloudflare calls are excluded from the normal test loop;
an optional release smoke test would require a separate explicit request.

Two local modes should cover iterative work:

| Mode | Browser/search | AI | Cloudflare requests |
| --- | --- | --- | --- |
| Replay | Recorded responses, including injected failures and delays | Recorded model responses | Zero |
| Fresh websites | Crawl4AI/Chromium in OrbStack, using production search restrictions and parser | Existing OpenRouter adapter when desired | Zero |

Replay needs no provider credentials and should block unmocked external traffic.
Fresh-website mode contacts public websites and, when enabled, OpenRouter; it
still consumes no Cloudflare API quota. OpenRouter retains its own limits and
possible paid fallback. Recorded AI responses test orchestration and validation,
while fresh inference is needed to evaluate model quality on new pages.

Enforce this in the proposed launcher and transport layer: omit Cloudflare
credentials, disable remote bindings, restrict provider destinations to the local
adapter, and fail closed if a Cloudflare API call is attempted. `--local` controls
bindings; it does not by itself prevent ordinary outbound HTTP requests. Add a
test asserting no Cloudflare API requests across both local modes.

Wrangler uses Miniflare and Cloudflare's `workerd` runtime. OrbStack supplies the
Docker engine; it does not emulate Workers. Local Workflow bindings emulate the
service and expose its lifecycle and step history. Workflows currently do not
support `wrangler dev --remote` or remote Workflow bindings.
[Workers local development](https://developers.cloudflare.com/workers/local-development/),
[Workflows local development](https://developers.cloudflare.com/workflows/build/local-development/).

## What the previous session established

The session implemented and deployed STU-206, then monitored a complete production
run. Its saved [report](../.local-data/stu-206-production-run-report.md) records:

- 20 counted businesses in 69 minutes 41 seconds, across 107 Workflow executions.
- 172 successful page reads, including 36 that stopped before normal extraction.
- 121 failed page attempts; 78 carried the application's admission-rate error.
- Three sourced named contacts and no published person emails.
- Invalid headcounts: DEWC's apparent animated-counter placeholder and a BDI
  employee figure attributed to HMA.

The inspected code still contains the two-attempt browser permit gate, the
32-request stop, and `eligibleForPeople` rejecting companies that already have a
person finding. Production monitoring implicated application scheduling and
continuation; it did not establish that buying more provider capacity would fix
the run. This review did not re-query production or modify its saved findings.

## Original local stack and identified gaps

| Component | Existing local behaviour | Requirement for production-like tests |
| --- | --- | --- |
| Next.js | Host Node, port 3010, local callback URL | Keep real API routes, authentication and repository code; add a build/start smoke test with the same forced local configuration |
| Postgres | OrbStack, `postgres:17-alpine`, port 5434 | Use the application schema and indexes, including the active-job concurrency index; exercise real concurrent callbacks |
| Research Worker | Wrangler 4.129.0, local Workflows, port 8787 | Retain the deployed entrypoint and compatibility date; derive shared configuration to prevent drift |
| Request budget | `LOCAL_DEVELOPMENT=true` disables the 32-request stop; local reads also skip request increments | Preserve the production guard and account for callbacks, permits, reads and AI requests identically |
| Browser admission | Direct local reads bypass `browserMarkdown` and its permit callback | Use the same admission code and actual Postgres atomic permit operation |
| Search | OpenSERP with richer snippets, Google fallback and page offsets | Use the production DuckDuckGo page-one restriction, parser, errors and retry behaviour |
| Page cache | Local reads bypass `caches.default` | Exercise the same cache path, including misses, hits, expiry and run isolation |
| Browser transport | Direct Crawl4AI with a local retry; three concurrent reads | Reproduce production response envelopes, timeouts and error categories; test hosted fallback at concurrency one |
| AI | External OpenRouter, free-first with Mercury fallback | Replay recorded responses for deterministic tests; retain live inference as a separate quality check |
| Automated tests | Node Vitest; Worker entrypoint test mocks `cloudflare:workers` | Add real Workflows/runtime integration tests alongside domain tests |

Evidence: [launcher](../scripts/dev.mjs), [local configuration](../scripts/dev-config.mjs),
[Worker](../cloudflare/research/index.ts), [runtime policy](../cloudflare/research/runtime-policy.ts),
[browser reader](../cloudflare/research/browser-reader.ts),
[permit database operation](../src/lib/research-browser-permit.ts),
[local search](../cloudflare/research/local-search.ts), [Compose](../compose.local.yml).

The 32-request threshold is our application reserve, not Cloudflare's universal
limit. Current Cloudflare documentation distinguishes free-plan external limits
from substantially higher paid Workflow allowances. Preserve 32 to reproduce
the incident, then verify the account's actual plan before changing policy.
[Workflow limits](https://developers.cloudflare.com/workflows/reference/limits/).

## Three test layers

### 1. Repeatable runtime regression tests

Add a separate Workers Vitest configuration using `@cloudflare/vitest-plugin`.
The current documented plugin requires Vitest 4.1 or later; this repo has 4.1.11.
Keep the existing Node suite for Next.js/domain tests. Use a dedicated test Worker
configuration with dummy secrets and controlled outbound responses.
[Setup and supported versions](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/).

Run `AcquireResearch` through its real Workflow binding. Use
`introspectWorkflowInstance` to await steps/status and inspect output. Dispose
introspectors after each test. Mock external HTTP responses, not the scheduler,
extraction validation or continuation decisions being tested. Accelerate Workflow
sleeps for logic tests, but retain a real-time contention case: disabling Workflow
sleeps does not remove the reader's JavaScript timer or Postgres clock semantics.
[Workflow test APIs](https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/#workflows).

Capture small, sanitised fixtures from the saved incident: page markdown, search
responses and AI output, with explicit expected findings. Keep originals and
expected outcomes separate so an incorrect model answer cannot become the test's
definition of correctness. Block unmocked external traffic in this suite.

### 2. Full local integration through OrbStack

Introduce an explicit production-policy mode independent of provider selection.
The existing `LOCAL_DEVELOPMENT` switch conflates loopback safety, local providers,
budget bypass, search capabilities, caching and fallback eligibility. Simply
setting it to false breaks loopback callbacks and selects real Cloudflare APIs.

Proposed split:

- Environment safety: local database, loopback callbacks, isolated service secret.
- Runtime policy: production budgets, search capabilities, admission and caching.
- Provider transport: recorded responses or local browser for local modes.

Preserve `browserMarkdown`'s permit/accounting/error handling while injecting its
HTTP transport. A small local provider service can return the same Browser Run
success/error envelopes from fixtures, or translate Crawl4AI markdown into that
contract. Render DuckDuckGo through the same search parser for live local search.
Keep OpenSERP available for ordinary development, outside parity benchmarks.

Use real Next.js callbacks and local Postgres for races, unique-index enforcement,
continuation, cancellation and duplicate callbacks. Add fixture data through
controlled local application/repository writes after schema readiness is verified.
Never auto-migrate in a launcher or test hook. Any needed migration requires
approval for the specific files and database, per [AGENTS.md](../AGENTS.md).

Host Wrangler can reach the existing localhost-published container ports. If a
test service in a container calls the Mac, OrbStack supports `host.docker.internal`.
There is no need to move the app and Worker into containers merely for networking.
[OrbStack networking](https://docs.orbstack.dev/docker/network).

For testing the optional hosted Crawl4AI fallback, Wrangler can also start the
container through its actual Worker/Container Durable Object wrapper using a
Docker-compatible engine. This covers authentication and routing omitted by
direct Compose reads. Local `max_instances` is not enforced, so test that
constraint explicitly. The repository separately requires specific approval
before the first deployment of its `crawl-reader-v1` migration; this review does
not apply it or provision a new Durable Object test configuration.
[Container local development](https://developers.cloudflare.com/containers/guides/local-dev/),
[repository fallback instructions](../cloudflare/crawl4ai/README.md).

### 3. Optional release verification, outside local iteration

Do not require a real Cloudflare call to develop, debug or pass local tests.
Inject Browser Run-shaped 429/422 errors, retry headers, timeouts and delays
locally to exercise the application's responses without spending account quota.
Retain production request limits and admission spacing for regression checks;
use a controlled clock for fast logic tests and a small real-time concurrency
test for the actual Postgres gate.

Local Chromium cannot exactly reproduce Cloudflare's egress IP, browser output,
access restrictions or account enforcement. Local execution also cannot prove
distributed cache behaviour, Vercel execution constraints or Neon's HTTP driver
behaviour. These are explicit coverage limits, not reasons to call Cloudflare
during every iteration. If later requested, a tightly bounded release smoke test
can check selected platform differences using real resources.

## Regression acceptance matrix

| Scenario | Required outcome |
| --- | --- |
| Either local mode runs with Cloudflare credentials inherited from the shell | Credentials are not forwarded; no Cloudflare API call occurs; no remote fallback |
| Discovery plus two enrichment jobs contend for browser access | All make bounded progress; admission denial waits/requeues rather than becoming a permanently failed page |
| Budget runs out after reading but before extraction | Page remains pending for extraction; continuation extracts it without losing evidence or needlessly fetching it again |
| Process exits after a persisted step | Resume reuses completed step results and avoids duplicate evidence/target writes |
| Callback succeeds but response is lost | Retry remains idempotent; active-job slots remain within the configured limit |
| Person exists, email missing | Relevant company still receives an email objective |
| Headcount exists, revenue missing | Revenue objective continues |
| Zero counter or quote naming a different company | Invalid value is rejected; the field stays unknown |
| Provider 429, timeout, 422, malformed body and successful empty result | Distinct outcomes; bounded retries; successful-empty does not look like transport failure |
| Cached page reused within a run | Original retrieval time preserved; failed reads not cached; separate runs remain isolated |
| Stop during a provider wait or continuation | No new work after cancellation; no stuck active slots |

Record per-field sourced coverage, permit denials versus provider errors, reads
without extraction, repeated reads, attempts, continuation count, queue wait,
elapsed time and model usage. Compare identical fixtures and policies before/after
fixes. A successful Workflow status alone is not a pass for research completeness.

## Original convenience-mode commands

Start OrbStack first. The existing launcher checks for research tables and never
runs migrations; its current schema check only checks two tables, so it does not
prove all required indexes/migrations exist. It requires `OPENROUTER_API_KEY`.
Starting it replaces this project's existing dev servers and clears the dev log.

```sh
docker --context orbstack compose -f compose.local.yml ps
pnpm dev
```

Open `http://localhost:3010`. This is the existing convenience mode, with the gaps
listed above. In another terminal:

```sh
pnpm exec wrangler workflows instances list acquire-research-local --local --port 8787 --config .local-data/dev/wrangler.json
tail -F .local-data/dev-start.log | rg --line-buffered 'research-provider|research-progress|research-runtime|research-diagnostic'
```

Workflow step history is also available at
`http://localhost:8787/cdn-cgi/local/explorer` while Wrangler is running.
[Local inspection](https://developers.cloudflare.com/workflows/build/local-development/).

## Verification performed for the initial review

- Reviewed the referenced session, its incident report and the current code.
- Verified Node 22.23.1, pnpm 11.8.0, Wrangler 4.129.0 and installed CLI local flags.
- Ran the existing focused suite: **74 tests passed across 10 files**:

  ```sh
  pnpm exec vitest run cloudflare/research scripts/dev-config.test.mjs src/domain/research-runner.test.ts src/domain/business-research.test.ts
  ```

- OrbStack's Docker socket was unavailable during the check. Container health,
  database readiness and end-to-end execution remain unverified.
- Created this plan only; no application changes, migrations or deployments.

Recommended first implementation: separate local safety from runtime policy,
add real Workflow tests that reproduce the incident, then fix scheduling and
resumable extraction against those tests before another full production run.
