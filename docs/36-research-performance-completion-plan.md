# Research performance implementation and completion ledger

This is the durable source of truth for the original plan, implementation status,
remaining work, and validation evidence. Update it after each implementation and
verification pass. Do not mark a requirement complete from test counts alone.

Started: 2026-10-01 (Australia/Melbourne).

Current status: implementation, tests, production deployment, rollback canaries
and the four-stage matched benchmark are complete. Three numerical targets
remain unmet; the final table records the measured results and limits.

## Original plan

Focus first on reducing persistence and coordination overhead, then on slow page
reads. Measure each change separately so we can tell what actually helps.

Production baseline: **19 seconds to first candidate, 63 seconds to first saved
company, and 9 minutes 4 seconds to finish**. The run saved **10 of 20 requested
companies**. It included **874 persistence operations averaging 2 seconds** and
coordination operations averaging **2.8 seconds**. These are application-level
measurements, not isolated SQL execution time.

### 1. Establish accurate measurements

Split callbacks into Worker-to-app round-trip duration, app database reads and
writes and query counts, evidence validation/persistence, scheduling queries and
dispatch, telemetry persistence, and request/response sizes. Use a shared request
ID across Worker, API, repository, and scheduling. Return `Server-Timing`.
Label app database duration **database round-trip time**; use existing database
diagnostics, where available, for server-side SQL execution time.

Acceptance: one correlated breakdown per progress callback, without recursively
generating telemetry writes.

### 2. Batch telemetry

Collect server spans in a request-scoped buffer and persist once per request or
background scheduling operation. Attach Worker spans to progress where possible;
retain the standalone endpoint for overflow/final delivery. Remove Worker spans
only after acknowledgement. Preserve UUID deduplication, payload limits, and the
storage cap. Telemetry failures must not fail useful progress; log the failure
and retain Worker spans for retry.

Acceptance: progress requires no preceding timing request; replay creates no
duplicate spans or findings.

### 3. Reduce unnecessary progress saves

| Update | Persistence policy |
| --- | --- |
| Completed page and validated evidence | Immediate |
| New company or discovered candidate URLs | Immediate |
| Completion, failure, cancellation, continuation | Immediate |
| Pending/buffered recovery page | Before yielding/stopping |
| Status-only updates and counters | Coalesced |
| Heartbeat | Initially every ten seconds |

Start conservatively with repeated status-only saves. Keep completed evidence
durable. Distinguish Cloudflare Workflow checkpoints from application checkpoints
and verify recovery before removing application saves.

Acceptance: interruption after reading, extraction, or saving loses no evidence,
does not unnecessarily repeat billed work, and does not reset budgets.

### 4. Make saves cheaper

Reuse a consistent authenticated job snapshot, preserve atomic revision and
terminal guards, return response fields from the update, batch validated finding
inserts, retain existing evidence keys, and avoid unchanged runtime/config
rewrites. Verify both configured drivers before selecting transactions. If using
ordered idempotent writes, acknowledge revision only after evidence persistence.

Acceptance: duplicate/out-of-order events cannot overwrite newer state, duplicate
companies, or exceed budgets.

### 5. Read smaller snapshots

Use purpose-specific control, execution, scheduling, and timing/reporting reads.
Control requires status/revision/deadline/cancellation/budget, execution requires
continuation content, scheduling requires IDs/statuses/slots/domains/targets/
phases/counters, and detailed timing is loaded only when requested. Avoid double
job-list reads and raw timing maps for UI summaries where possible.

Acceptance: frequent control/scheduling exclude large evidence/runtime/timing
payloads while preserving organization isolation and cancellation.

### 6. Coalesce scheduling per run

One scheduling entry point handles new URLs, qualifying companies, released
slots, continuation, and recovery. Each pass shares a snapshot among discovery,
enrichment, and continuation planners. Use an atomic root-config lease, pending
generation/recheck, conditional owner-token release, and expired-lease recovery.
Retain deterministic IDs and the existing unique active-slot constraint. UI
polling provides bounded recovery rather than full scheduling on every refresh.

Acceptance: competing callbacks create one job per task, promptly refill slots,
and recover from crashes/failed dispatch.

### 7. Address page-read waste

Baseline page reads: mean 4.9 seconds, p95 about 20 seconds. Use website-specific
cooldowns, likely-field page prioritization, short negative caching, stopping
repeated unproductive searches/reads, and circuits for unavailable model routes.
Retain evidence requirements and page/model budgets. Do not obtain speedups by
accepting weaker companies or prematurely abandoning useful work.

### 8. Verify and roll out in stages

Snapshot independent telemetry batching, progress coalescing, and scheduling
coalescing flags at run creation. Intended rollout:

1. Measurements.
2. Telemetry batching.
3. Smaller reads/cheaper writes.
4. Status-update coalescing.
5. Scheduling coalescing.
6. Page-read improvements.

Test replay, cancellation, competing callbacks, failed dispatch, expired leases,
Worker restarts, and retained lookahead pages. Compare repeatable recorded
provider responses, then production canaries. Roll back flags independently if
correctness or coverage deteriorates.

Initial validation targets, **not guaranteed speedups**:

- At least 50% fewer progress callback requests.
- At least 80% fewer telemetry write operations.
- Fewer repeated scheduling scans, without stranded queued jobs.
- At least 30% lower comparable end-to-end duration, without reduced coverage.

**No initial schema migration is required. Never apply any migration without
explicit user approval for that specific migration.** Later tables/indexes must
be justified by measurements and separately approved.

## State at the start of this completion pass

| Requirement | Implementation/deployment | Remaining evidence/work |
| --- | --- | --- |
| 1. Measurements | Request IDs, segment timings, `Server-Timing`, DB round-trip/query counts deployed | Callback body byte measurements; existing SQL diagnostics; matched overhead comparison |
| 2. Telemetry | Request batching, piggyback/acknowledgement, deduplication/retries deployed | Measure write reduction against matched legacy execution |
| 3. Progress | Coalesced browser waits, ten-second heartbeats, evidence/recovery saves deployed | Measure callback reduction; recheck restart coverage |
| 4. Saves | Snapshot reuse, bulk findings, guarded returning updates, JSON merges deployed | Document driver-specific ordered-write choice and failure guarantees |
| 5. Reads | Control/execution/review/scheduling projections deployed | Review still loads historical evidence/timing for exact summaries; quantify or eliminate |
| 6. Scheduling | Run leases, generations, shared snapshots, bounded recovery deployed | Matched scan/dispatch comparison and production canary |
| 7. Page reads | Cooldowns/cache/prioritization/exhaustion/model circuits implemented | Reader container diagnostics/origin-status update not deployed |
| 8. Verification | Independent flags, unit/Workflow/OrbStack suites implemented | Recorded A/B comparison, staged canaries, independent rollback drill, target assessment |

The 2026-09-30 deployment shipped the app and Worker together with the three flags
enabled by default. This was **not** the staged rollout described above. Existing
runs preserve saved flags; changing defaults affects new runs only.

Deployment evidence: `.local-data/deployments/2026-09-30-research-performance.json`.
App deployment: `dpl_xmUymLxvDSpYEpztP78wywvBjN4q`.
Research Worker version: `2a1778ba-24b6-4668-a237-277bc8570a1c` (100% traffic).
Reader deployment was stopped while the local Docker API was unresponsive; its
existing production version remained active.

Prior checks: 985 tests, 18 real Workflow tests, eight OrbStack full-stack checks,
lint, app/Worker TypeScript, production build, and eight reader Python tests.
No migrations were applied. No production speedup/coverage parity is established
by those test counts.

## Completion checklist

- [x] Preserve the original plan and initial state in this document.
- [x] Measure callback request/response bytes without logging content or adding DB writes.
- [x] Add failing tests first, implement byte measurements, and verify error/privacy behavior.
- [x] Capture available read-only database-side diagnostics separately from round-trip time.
- [x] Verify/document ordered idempotent progress persistence across both drivers.
- [x] Recheck summary reads and remove unnecessary historical payload where safe.
- [x] Add/run repeatable per-stage A/B comparisons with request/write/scan/coverage metrics.
- [x] Assess every numerical target; retain failures as failures rather than hiding them.
- [x] Deploy the reader update without introducing/applying a new migration.
- [x] Run staged isolated production canaries and independent flag rollback checks.
- [x] Verify final app/Worker/reader deployments and meaningful integration checks.
- [x] Update this ledger with artifacts, limitations, and final completion status.

## Iteration log

### 2026-10-01 — pass 1: evidence audit and remaining work

Created this ledger before further changes. Docker responded successfully during
preflight, so the prior reader deployment blocker may now be resolved. The shared
workspace has concurrent unrelated changes; preserve them and deploy a fixed,
tested source snapshot. Measure payload bytes as application UTF-8 body bytes,
not billed egress/protocol/TLS/compressed bytes. Production canaries must be
isolated and bounded; preserve production customer data and evidence thresholds.

Related documents: [performance/timings](33-research-performance-and-timing.md),
[Supabase egress RCA](34-supabase-egress-rca.md),
[OrbStack integration suite](35-research-orbstack-integration-tests.md).

### Pass 2: payload measurements, database diagnostics, and reader deployment

Implemented consumed-request and serialized-response body byte measurements.
Requests are consumed once; responses are serialized once. Malformed JSON still
records consumed bytes; unread request bodies remain explicitly unmeasured.
Streaming/uninstrumented responses are preserved rather than consumed for
telemetry. Tests verified Unicode byte counts, safe header propagation, privacy,
and no additional database writes. Failing tests preceded the implementation.

Added SELECT-only existing `pg_stat_statements` capture. Production diagnostics
are available; the private artifact is
`.local-data/research-performance/production-database-diagnostics-before.json`.
The first 100 research statement entries were captured without SQL text or
credentials. Counters are cumulative/shared, not attributed to one callback.
Do not interpret database-wide counter changes as a controlled single-run result.

Reader version `cf9b3099-75da-49b0-b486-ee771af77966` deployed successfully.
Before deployment, the remote migration tag was verified as the already-applied
`crawl-reader-v1`; no new migration was applied. Reader Python tests passed.
Deployment log: `/tmp/acquire-completion-reader-deploy.log`.

Persistence audit discovered a real company/contact creation race. Atomic IDs
and existing primary-key conflict handling now address competing research writes
without a migration. Current workflow status and contact preferences are retained.
Validation includes both installed PostgreSQL and Neon Drizzle drivers. Precise
driver and cancellation guarantees will be recorded after final integration.

### Pass 3: persistence guarantees and compact reporting

Research-created companies and contacts now use deterministic IDs with the
existing primary-key conflict guard. Concurrent callbacks therefore converge on
one record without a new constraint or migration. Existing workflow status and
contact preferences are retained. Findings are inserted in an idempotent batch;
company milestones and the acknowledged job revision are updated only after
evidence/contact persistence succeeds. Cancellation may retain already validated
evidence, but terminal guards prevent a callback from resurrecting a cancelled
job. This is ordered idempotent persistence, not an all-or-nothing transaction.

Tests exercise SQL produced by both installed Drizzle drivers. PostgreSQL supports
interactive transactions; Neon HTTP does not, so progress uses the ordered
approach for both. Replay and competing callbacks recover partial writes rather
than acknowledging an incomplete revision. Existing historical duplicates or
alternate identities are not retrospectively merged.

Review reads now exclude raw historical timing maps, discovery results and
retained page markdown. A run-scoped SQL projection returns only validated timing
samples and aggregate metadata needed to preserve exact existing percentile and
deduplication semantics. SELECT-only PostgreSQL parity checks covered 2,048 spans,
invalid data, duplicate IDs, caps and decimal durations; the compact payload was
less than one tenth of the raw fixture. This is a fixture measurement, not a
claim about billed Supabase egress.

Standalone timing requests now carry the same request IDs, body byte counts and
Server-Timing breakdown. Actual timing database writes are tagged as telemetry
without generating recursive timing records.

Initial verification: eight full-stack OrbStack checks, 18 real Workflow tests,
five coordinator tests, and 71 focused persistence/scheduling/reporting checks
passed. The recorded benchmark uncovered parallel website children omitting the
root company target, preventing saved companies from advancing the root goal.
That bug is being fixed with regression tests before final deployment.

### Pass 4: final checks and integration findings

A fixed source snapshot passed **1,091 unit tests** (23 opt-in tests skipped),
repository lint, generated Next.js route types, app TypeScript and Worker
TypeScript. Snapshot: `/tmp/project-acquire-completion-20261001`; file hashes are
recorded in its `release-manifest.json`. Further changes require refreshing and
rechecking this snapshot before deployment.

The benchmark preserves real browser admission, Workflows, application callbacks
and PostgreSQL, with deterministic provider responses. It compares the current
compatibility path with cumulative flag stages; it does not reconstruct the
historical 874-operation production run. Each stage requires a warm-up, three
completed repetitions, matching workload/source/provider fingerprints, semantic
evidence parity and measured callback/write/scan counts. Incomplete or failed
runs are rejected rather than used to claim performance gains.

A concurrent full-stack check detected ten idle-poll database calls against an
eight-call limit. Eight are authentication, mandate/review/evidence/results and
compact timing reporting; two are needless scheduler recovery calls after
parallel work is exhausted. A durable settled marker and race-safe recovery
guards are being verified. The integration ceiling is retained.

### Pass 5: final release verification

The refreshed release snapshot passed **1,104 unit tests** (23 opt-in tests
skipped), **20 real Workflow tests**, **five coordinator tests**, **nine OrbStack
full-stack checks**, lint, app types and Worker types. The OrbStack check exercises
independent website/ABN/headcount/revenue work and sitemap pages, actual browser
reading and provider admission, replay, telemetry recovery, cancellation and
inactive polling. The measured query counts are heartbeat **3**, replay **2**, and
inactive polling **8**, retaining the original ceiling.

Artifact: `/tmp/project-acquire-completion-20261001/.local-data/research-e2e/85b3fcd8-d18b-46e0-a418-6c68e951a3e4/report.json`.
Logs: `/tmp/acquire-completion-final2-{tests,lint,types,workflows,coordinator,e2e}.log`.

The settled state is written only after no admissible pending work remains,
with live-child, unchanged-state and scheduler lease/generation guards. UI review
checks all related children are terminal before skipping recovery. Real callbacks
still wake the scheduler, and explicit continuation clears the settled state.
The UI's run selection now excludes terminal page jobs when identifying its root.

Production deployment and staged correctness/rollback canaries are in progress.
Recorded performance comparisons are running independently against the same
frozen source; no numerical speedup is claimed until comparable runs complete.

### Pass 6: production release and reader contention fix

App production deployment: `dpl_55XAH8pSJGP5wS934MK8GmA1iipG`, Ready and aliased
to https://project-acquire.vercel.app. Research Worker version
`6fd19ebf-fc66-4e1a-95bc-b3b0e4870417` has 100% traffic. Deployment evidence:
`.local-data/deployments/2026-10-01-research-completion.json`.

The actual-browser benchmark exposed an additional reader bug: an active read's
45-second stale lease was advertised as Retry-After, causing the origin
coordinator to retain a 44–45-second pause after a normal 2–5-second read.
Active-read retries now advertise 1–3 seconds; the 45-second stale lease and real
post-read/origin cooldowns remain. Three failing tests preceded the fix; all
**11 reader Python tests** pass. Actual-browser logs confirm the shorter retry
and continued per-domain serialization. Reader version
`d0402a43-80e6-408c-a74b-3dc4d0a297dc` has 100% traffic. The existing
`crawl-reader-v1` tag was reverified; no new migration was applied.

The first production canary stopped at evidence persistence because its public
ARK source read returned HTTP 422 and fallback could not read it. Workflow
completed safely within budget; isolated canary cleanup passed. This failed
canary is preserved at
`.local-data/research-performance/production-canary-20261001/report.json`.
The bounded canary source was changed to
[REDARC's first-party company page](https://www.redarcelectronics.com/au/about-us),
with four harness tests passing after a failing whitelist test. No application
or Worker change was required. The seven-stage rerun is in progress.

Recorded runs that failed to complete, used incomplete fixture evidence, or
overlapped the local Docker build are excluded explicitly. Final comparisons
include the actual frozen reader script in provider/source fingerprints, rather
than relying on the Docker base image hash while code is mounted separately.

### Pass 7: production correctness and rollback verified

All **seven production canaries passed** on the new production Worker and reader:
measurements, telemetry, progress, scheduling, and each independent rollback.
Every stage saved supported evidence, completed its Workflow, stayed within one
page/one logical model call, retained its original flags, persisted timing spans
and left no queued/active work. Scheduling-enabled stages exercised the durable
generation/lease path. Isolated records were cleaned up successfully.

Artifact:
`.local-data/research-performance/production-canary-redarc-20261001/report.json`.
Provider/model results varied between stages, so these are correctness/rollback
checks, not a controlled speed or coverage comparison. The separate deterministic
benchmark requires exact evidence parity across completed repetitions.

Implementation and deployment are complete. Remaining work in this ledger is
recording the completed benchmark matrix and assessing all numerical targets;
those results must not be inferred from the successful correctness checks.

### Pass 8: first matched benchmark stages

Three completed repetitions per stage, after an unmeasured warm-up, preserve all
47 semantic evidence keys and identical field coverage. Workload, provider
recording and environment/source fingerprints match. Each run completes 22
real Workflow jobs for three deterministic companies.

| Stage | Progress attempts | Telemetry writes | Scheduling SELECTs | Median elapsed |
| --- | ---: | ---: | ---: | ---: |
| Compatibility (all flags off) | 85 | 159 | 665 | 84.982 s |
| Telemetry batching only | 85 | 111 | 665 | 85.925 s |

Telemetry-only write reduction: **30.19%**, below the 80% target. Its elapsed
median is 1.11% higher; it does not establish an end-to-end speedup. Progress and
scheduling flags are disabled in this intermediate stage, so their effects
remain to be measured. Keep unmet targets explicit.

Artifacts:
- `.local-data/research-e2e/fadf3a0e-fd03-42a4-9b1a-a0ae7bd2f308/benchmark.json`
- `.local-data/research-e2e/83d7fbc7-fb63-407e-a541-dbe2dca7d45d/benchmark.json`

This baseline includes the common cheap reads/writes, parallel task scheduling
and fixed reader policy. It cannot isolate those common changes against their
historical implementations or prove an improvement over the original production
run. Its purpose is to measure cumulative flag effects without weakening evidence.

### Pass 9: benchmark regression requires another implementation pass

The first progress-coalescing sample made **104** callbacks versus **85** in its
matched telemetry-only sample. Read-only event decomposition found 26 additional
extraction heartbeats and seven fewer waiting updates. The flag shortened
persisted heartbeats from 60 seconds to ten seconds; long provider waits erased
the intended savings. Persisted heartbeats are being tuned to 60 seconds based
on this measurement, retaining existing control/cancellation checks and immediate
evidence/yield checkpoints. This remains below the 90-second stalled inspection.

A subsequent repetition had 46 rather than 47 semantic evidence keys. The strict
benchmark rejects this coverage drift. A likely cause is the company-goal guard
applying to newly created parallel website/page tasks: those tasks inherit the
root goal for accounting but must finish research already admitted when the goal
is reached. The guard is being checked and corrected with regression tests.

The current production release passed correctness checks, but these newly found
issues require a follow-up verified release. Do not mark the completion checklist
finished until those corrections and their measured comparisons are recorded.

### Pass 10: capacity, coverage and checkpoint corrections

Confirmed and fixed the admitted-page goal guard with failing website/page
regressions. Persisted heartbeats are now 60 seconds; repeated control checks,
cancellation and immediate evidence checkpoints retain their cadence.

The lost Alpha email had a separate, concrete cause: both people/email jobs
exhausted their query ladders on temporary browser admission/domain cooldowns
without reading a source. Temporary capacity failures now release only their
request's search lease and return a deferred result without consuming a query.
The runner uses unique durable retry steps and bounded waits, checks cancellation
and deadlines, and checkpoints persistent contention rather than marking the
field exhausted.

The explicit `targetedSearchDeferred` checkpoint permits an empty field search
to continue with remaining page/model budgets and the original absolute deadline.
No-progress continuation remains capped at two. `followupPlannerUsed` is retained
so a new Workflow does not bill the same empty-field planning step again. Both
true and false values are validated and merged without overwriting other config.

Parallel field jobs without an initial target ID now reuse sibling findings
through a single SQL query. Reuse requires one uniquely matching mandate target,
the same organization, mandate and research run, and validated non-snippet
evidence. Ambiguity falls back to the job's own evidence. Initial execution can
load these facts; frequent lean control reads stay lean. PostgreSQL SELECT-only
fixtures verify isolation and ambiguity handling.

The fixture now honors the actual business prompt requesting published owners
within its four-finding cap, and claim/job audit records make future coverage
drift diagnosable. The failed 46-key progress matrix is retained and excluded:
`.local-data/research-e2e/6a63e65c-df82-4807-b8e5-4187c5f6018a`.

Focused checks passed: 120 runner/schema/persistence tests; 42 route tests
including real PostgreSQL scope fixtures (one existing skip); 16 continuation
checks; fixture/comparator/capture checks. The complete follow-up release is now
being verified before deployment.

### Pass 11: corrected follow-up release deployed

The frozen source `/tmp/project-acquire-completion-final-20261001` passes
**1,141 unit tests, 20 real Workflow tests, five coordinator tests, nine OrbStack
checks, lint, app types and Worker types**. The unchanged deployed reader passes
11 Python tests. Frozen hashes are in its `release-manifest.json`.

Production app `dpl_DuymzjvNBVZgdRUUU7pVjupPTMYX` is Ready and serves
https://project-acquire.vercel.app. Research Worker
`d96b9ec3-0f2b-4614-9216-003c24a58424` receives 100% of traffic. Reader
`d0402a43-80e6-408c-a74b-3dc4d0a297dc` remains at 100%. No migration was applied.
Follow-up production canaries are running against this release.

The restarted deterministic legacy benchmark found optional duplicate identity
evidence: a grounded heading parser adds a title when sibling identity evidence
has not arrived yet, while the recorded model fixture used a different sentence
for the same identity. All substantive coverage was present, but exact evidence
keys differed. Keep these repetitions excluded. The fixture is being aligned
with the actual Markdown heading, with a grounded sentence fallback, so exact
comparison remains strict. This changes recorded fixtures, not production code.
All four stages must use the same new recording fingerprint.

All **seven follow-up production canaries passed**: measurement, telemetry,
progress, scheduling and three independent rollbacks. Every run saved supported
evidence, completed within one page/one logical model call, retained its flag
snapshot, persisted timings and left no queued work. Isolated production records
and Workflows were cleaned up successfully. Artifact:
`.local-data/research-performance/production-canary-followup-20261001/report.json`.
These are correctness checks; variable upstream responses prevent a performance
or exact coverage comparison across these production canaries.

### Pass 12: final matched benchmark matrix

Each accepted stage uses the same frozen application source, workload, recorded
provider responses and environment fingerprints, with one unmeasured warm-up and
three completed repetitions. Exact parity requires all 48 supported source/quote
evidence keys and matching field coverage; every run completes 22 Workflow jobs.
Counters include observed requests and SQL attempts rather than inferred spans.

| Stage | Median progress attempts | Median telemetry writes | Median scheduling SELECTs | Median elapsed |
| --- | ---: | ---: | ---: | ---: |
| Compatibility, flags off | 62 | 119 | 512 | 37.752 s |
| Telemetry batching | 62 | 88 | 498 | 35.538 s |
| + Progress coalescing | 52 | 78 | 509 | 36.571 s |
| + Scheduling coalescing | 52 | 78 | 419 | 36.522 s |

Accepted artifacts:
- Compatibility: `.local-data/research-e2e/0abcdc5d-de39-4256-ac47-b7d0e3fda718/benchmark.json`.
- Telemetry: `.local-data/research-e2e/c3431c01-9a22-4b56-97f9-dbeecda8715d/benchmark.json`.

Telemetry-only write reduction is **26.05%**, below the 80% validation target.
All four stages completed three comparable repetitions. The compatibility baseline
already includes common smaller reads, cheaper writes, parallel scheduling and
reader improvements; this matrix measures independent cumulative flag effects,
not all changes against the original nine-minute production run.

Final accepted artifacts:
- Progress: `.local-data/research-e2e/2b396223-49ef-4929-be60-86e4ebf788a1/benchmark.json`.
- Scheduling: `.local-data/research-e2e/2e57d0f5-bd0c-4196-a739-d100cdeeadf4/benchmark.json`.

| Validation target | All flags vs compatibility | Result |
| --- | --- | --- |
| At least 50% fewer progress callbacks | 62 → 52; **16.13% fewer** | Not met |
| At least 80% fewer telemetry writes | 119 → 78; **34.45% fewer** | Not met |
| Fewer scheduling scans, no stranded work | 512 → 419; **18.16% fewer**, zero active/queued jobs | Met for this fixture |
| At least 30% shorter elapsed, no coverage loss | 37.752 → 36.522 seconds; **3.26% shorter**, identical 48 keys and field coverage | Speed target not met; coverage preserved |

The telemetry-only stage reduced writes 26.05%; scheduling reduced scans 17.68%
relative to the immediately preceding progress stage. These local medians do not
establish statistical significance or a comparable production speedup. Provider
latency is recorded, and the original production workload differs.

### Completion status

All eight implementation/verification stages are complete, including the original
plan ledger, TDD corrections, real Workflow/coordinator/OrbStack coverage, explicit
target assessment, release verification and independent production rollback
checks. **Completion does not mean the numerical performance targets were met.**
The failed targets above remain failed. Do not replace this result with earlier
noncomparable or incomplete runs.

The deployed source was checked against its frozen test/release manifest: 488
production app/Worker/reader files matched without changes. Final checks: 1,141
unit tests, 20 Workflow tests, five coordinator tests, nine OrbStack integration
checks, 11 reader Python tests, lint and app/Worker type checks; seven production
canaries passed and their isolated records were removed. Fixture/observer changes
after the source freeze passed 33 focused tests and fixture lint, and did not
change production code. No database migration was applied.

Remaining measurement limits are explicit: the original production duration and
billed Supabase 82.83 GB egress have not been reconciled by this local flag matrix.
A subsequent comparable production run and egress usage-category breakdown are
needed for those claims. Additional optimization should use the new correlated
request/database/segment data to explain residual useful-progress saves, request
telemetry flushes and scheduling scans before changing durability or evidence
requirements. These are follow-up measurements, not unfinished implementation
items concealed by this checklist.

Canonical comparison artifacts:
`.local-data/research-e2e/2e57d0f5-bd0c-4196-a739-d100cdeeadf4/matrix.md`
and adjacent `matrix.json` and four comparison JSONs. SELECT-only cleanup checks
confirm zero remaining fixture organizations, jobs or findings across all four
stages. Benchmark app/Worker/fixture processes and reader containers were stopped;
shared development containers were preserved. All four frozen benchmark source
copies match current production app/Worker/reader source byte for byte (508 files
per copy, zero mismatches).

The final stage's segment totals include approximately 372.5 seconds of provider
wait and 61.0 seconds of targeted search across concurrent jobs, versus 2.07
seconds of persistence work. These totals overlap and must not be summed as wall
time. They point to admission/cooldown/search/read waits as the next measured
optimization area; the local result does not identify production SQL as the
dominant bottleneck or prove that changing database storage would help.
