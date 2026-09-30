# Research performance and timing

Discovery now plans up to three distinct queries together. Each query gets its
own workflow checkpoint, provider reservation and atomic database claim. Results
are merged and candidate workflows dispatched as each query completes. Legacy
single-query workflows remain supported; overlapping legacy/batch claims and
stale completions cannot replace newer seeds or attempts.

Candidate investigations and company enrichment overlap across websites. Within
one investigation, a single known next page can read while the current page is
being extracted. Same-domain reads remain serialised. The prefetched page is
checkpointed, joined before exit, charged to the budget and retained for a later
pass if extraction cannot finish. Findings and progress writes stay serial.

## Initial and deep enrichment

The initial pass allows four pages and five model calls. Companies with missing
fields queue a deep pass using the remainder of the original twelve-page,
fourteen-model-call allowance. Failed attempts and admission continuations count
toward the appropriate allowances. Retained unextracted content is reused.
Initial coverage is prioritised before deep work. The UI shows pending deeper
research instead of treating the initial allowance as final exhaustion.

Deep work stops pursuing a field after two successful searches yield no new
useful URLs. Failed provider requests do not count as empty evidence searches.
The field remains explicitly missing; this is not a claim that the information
does not exist. Search counts and exhausted fields survive continuations.

Fresh evidence already saved against the same organization's target is reused:
seven days for people/contact information and thirty days for other facts.
Historical relevance findings do not establish relevance to a new mandate.

## Reuse and routing

Public, unauthenticated pages can be reused across runs for one hour. Confirmed
404/410 responses have a five-minute negative cache. Original observation dates
are preserved. Canonical keys remove fragments and tracking parameters while
preserving meaningful queries, scheme, path and www distinctions. In-flight
sharing is best effort within a Worker isolate; Cloudflare cache reuse is
location-dependent, not a globally guaranteed single fetch.

Extraction reuse is private to the research run. Its key includes the complete
request, source content, context, schema/version and routing configuration.
Failed model responses are not cached. Cached output still passes the existing
source-evidence validation before saving findings.

Worker environment options:

| Variable | Default | Meaning |
| --- | --- | --- |
| `RESEARCH_AI_PRIMARY_ROUTE` | `free` | `fast-paid` uses the existing price-capped paid route first. |
| `RESEARCH_AI_FREE_TIMEOUT_MS` | `25000` | Free attempt deadline, clamped to 1–25,000 ms. |
| `RESEARCH_AI_EXTRACTION_REASONING` | Request default | `none` or `medium` overrides bounded extraction. Existing extraction requests already use `none`. |

These settings belong in the research Worker environment, not just the Next.js
app environment. No live routing, secrets or deployment settings were changed by
the implementation. Faster routing must be benchmarked against coverage and
cost before changing the default.

The start API accepts `discoveryConcurrency` and `enrichmentConcurrency` from
1–16; defaults remain eight. Provider slot counts, same-domain spacing, deadlines
and page/model budgets still apply. Higher settings increase demand rather than
guaranteeing a speedup.

## Timing persistence and diagnostics

No database schema changes are required. Spans live in the existing
`research_jobs.config.pipelineTiming` JSON object, keyed by event UUID. Atomic
JSON merges preserve concurrent runtime/discovery updates, and repeated delivery
of the same event is idempotent. Each job retains at most 2,048 spans.

Workers deliver spans in batches to the service-authenticated endpoint
`POST /api/research/internal/:jobId/timings`. Delivery failures retain the current
buffer for the next progress/final flush. Delivery is best effort; hard Worker
termination can lose unflushed spans. Every measured operation also emits a
structured `research-pipeline` log. Telemetry writes do not update the progress
heartbeat, so they cannot conceal a stalled workflow.

Segments cover source discovery/persistence, context, planning, search callbacks,
actual searches, provider admission and durable waits, page/site reads, cache
lookups, extraction, saved progress and active dispatch coordination. Empty
dispatch polls are not retained as work. `research-cache` logs identify hits,
misses, expiry and in-flight sharing without logging page content or prompts.
`research-ai` retains model, route, token, cost and inference-duration details.

The authenticated mandate research GET response returns per-run `timings`,
pending deep jobs and supported-field coverage. Raw spans stay in the database
instead of being transferred on every UI poll. The research panel exposes calls,
failures, work duration, mean and P95. First-new-company and shortlist-target
timestamps are saved when qualifying businesses are added.

Work totals overlap: parallel calls add work time, and a search callback includes
its nested search and coordination. Never sum all segment totals to infer elapsed
time. `measuredWindowMs` is the interval covered by retained spans, not proof of
complete end-to-end capture.

Read-only SQL to inspect individual segments:

```sql
SELECT j.id AS job_id, s.value->>'step' AS step,
       s.value->>'segment' AS segment,
       (s.value->>'elapsedMs')::numeric AS elapsed_ms,
       s.value->>'outcome' AS outcome,
       s.value->>'startedAt' AS started_at
FROM research_jobs j
CROSS JOIN LATERAL jsonb_each(COALESCE(j.config->'pipelineTiming', '{}')) s
WHERE j.organization_id = :organization_id
  AND (j.id = :root_job_id OR j.config->>'researchRunId' = :root_job_id)
ORDER BY s.value->>'startedAt';
```

## Benchmarking

Save authenticated mandate research GET responses for matched runs and compare:

```sh
node scripts/benchmark-research-pipeline.mjs before.json after.json
```

The command only reads the supplied files. It reports first-company/target
latency, accepted-company throughput, page/model counters, pending/failed jobs,
field coverage and segment timings. Match mandate, target, effort, provider
configuration and evidence acceptance criteria. Capture both completed runs and
first-pass milestones; a pending/active run is not a completion benchmark. Cost
must be compared using `research-ai` usage logs; missing cost is not zero cost.

No 10× production speedup has been established by unit tests or simulated
workflow tests. Baseline and post-change live captures are still needed.
