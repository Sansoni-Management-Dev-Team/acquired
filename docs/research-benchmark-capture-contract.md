# Repeatable research performance comparison

`node scripts/benchmark-research-pipeline.mjs before.json after.json` reads local
artifacts only. It does not contact providers or change a database. Saved
research GET responses still produce descriptive summaries, but cannot establish
request/write/scan reduction or end-to-end speedup by themselves.

A measured capture uses this shape:

```json
{
  "version": 1,
  "benchmarkRuns": [{
    "runId": "baseline",
    "complete": true,
    "activeJobs": 0,
    "pendingDeepJobs": 0,
    "metadata": {
      "workloadFingerprint": "64 lowercase hexadecimal characters",
      "recordingFingerprint": "64 lowercase hexadecimal characters",
      "environmentFingerprint": "64 lowercase hexadecimal characters",
      "sourceRevision": "the tested git revision"
    },
    "performanceFlags": {
      "telemetryBatching": false,
      "progressCoalescing": false,
      "schedulerCoalescing": false
    },
    "measurements": {
      "progressCallbackRequests": 100,
      "telemetryDatabaseWrites": 100,
      "schedulingScans": 20,
      "runElapsedMs": 10000
    },
    "measurementSources": {
      "progressCallbackRequests": "observed_request_attempts",
      "telemetryDatabaseWrites": "observed_database_write_attempts",
      "schedulingScans": "observed_scheduling_selects",
      "runElapsedMs": "job_created_to_all_jobs_terminal"
    },
    "evidenceKeys": ["64-character SHA256 semantic evidence key"],
    "fieldCoverage": {"company": 1, "person": 1},
    "samples": [9900, 10000, 10100],
    "segments": {
      "persistence": {"count": 100, "workMs": 5000, "meanMs": 50, "p95Ms": 100}
    }
  }]
}
```

These numbers illustrate the schema; they are not measured performance results.

## Recording and comparison safeguards

Use `comparisonFingerprint()` on canonical JSON descriptions of:

- Workload: scope, seeds, geography, target, effort, page/model/time budgets,
  initial evidence/cache state, cancellation/fault schedule and coverage rules.
  Exclude random database/job IDs and the performance flags being compared.
- Provider recording: fixture implementation or recorded response content and
  routing/model configuration. Identical labels are insufficient if content changed.
- Environment: app/worker/reader/database versions, hardware, concurrency, cache
  reset policy and warm-up policy. Exclude credentials and random listen ports.

Record the tested source revision and the flags explicitly. Disable fault
injection in ordinary throughput comparisons, or use precisely the same faults
in every repetition. Warm compilation before the measured jobs. Use a fresh
synthetic organization and reset run/page/extraction caches consistently between
stages; do not compare a cold baseline with a warmed optimized run.

Complete all jobs and pending enrichment before capture. Select exactly one run
per input file. Unknown/mismatched fingerprints, missing measurements, unfinished
jobs or ambiguous captures produce `unavailable`, not a successful result.

`evidenceCoverageKeys()` hashes source URL, kind, normalized name/value/quote and
published email, ignoring IDs and observation timestamps. Feed it actual saved,
validated findings. Preserve the source URL identity. Coverage passes only when
all baseline semantic claims remain supported and no baseline field count falls.
Additional supported evidence is permitted. Counts alone cannot establish parity.

## Counting operations

`observedPipelineCounters(contents, options)` consumes captured worker/app logs.
Scope it to every actual job ID in the run. Set `completeLogs: true` only after
all streams have been flushed and execution/background work has settled.

It counts `request_started` / `callback_progress` events, including retries.
Database query attempts are counted by unique `queryId`, including failures.
Provide an audited manifest containing repository query-shape fingerprints:

```js
const counts = observedPipelineCounters(workerLog + '\n' + appLog, {
  jobIds: allRunJobIds,
  completeLogs: true,
  queryManifest: {
    telemetryWrites: timingUpdateFingerprints,
    schedulingScans: schedulingSelectFingerprints
  }
});
```

Generate/audit those fingerprints against actual repository queries. Do not
classify all `research_jobs` updates as timing writes, or all selects as
scheduling scans. A missing manifest makes the relevant metric unavailable.
Never derive write counts from persistence spans, timing-span counts or HTTP
acknowledgements. These count different operations.

Measure elapsed time from the first job's persisted creation timestamp to the
last run job's terminal progress timestamp. Include deferred work and retries.
The measured telemetry window and summed parallel work are different quantities.

## Repetitions and targets

Call `aggregateRecordedCaptures([sample1, sample2, sample3], stageName)` for each
stage. It rejects configuration or evidence drift within repetitions, returns
per-repetition medians and preserves raw duration samples/range. Duration targets
require at least three complete repetitions per side and a duration matching its
sample median. Per-segment work/count/mean/p95 deltas are descriptive and parallel
stage totals must not be added to obtain wall-clock time.

Compare stages cumulatively, then independently roll back each flag with the
same workload. The output reports each target as `pass`, `fail` or `unavailable`:

- Progress callbacks: at least 50% fewer requests.
- Telemetry writes: at least 80% fewer database write attempts.
- Scheduling scans: strictly fewer observed scheduling selects.
- Elapsed run: at least 30% lower median duration, preserving supported coverage.

Zero baseline activity cannot establish a reduction for that target. Unknown
coverage makes the duration acceptance unavailable; demonstrated coverage loss
fails it. A failed numerical target remains a failure, even if correctness tests
pass. Offline deterministic parity does not prove equivalent production traffic
or a production speedup; production canaries remain separate evidence.

## Actual OrbStack capture

Run the four stages sequentially, with no source changes between invocations:

```sh
node scripts/test-research-e2e.mjs --benchmark-stage=legacy
node scripts/test-research-e2e.mjs --benchmark-stage=telemetry
node scripts/test-research-e2e.mjs --benchmark-stage=progress
node scripts/test-research-e2e.mjs --benchmark-stage=scheduler
```

Each stage runs one unmeasured warm-up and three measured automatic discovery
and enrichment runs through real app APIs, workerd Workflows, PostgreSQL and
Chromium. Every repetition clears only the disposable organization’s records
and synthetic public page cache entries, and disables injected faults. App, Worker, fixture and mounted Chromium reader source
files are frozen for the lifetime of each invocation. The recording fingerprint
includes the production reader script, Dockerfile and requirements as well as
test fixtures; the environment fingerprint includes the actual reader image ID. The fixture returns the
same supported industrial sensor evidence for every stage.

The stage flags are cumulative: all disabled; telemetry enabled; telemetry and
progress enabled; all three enabled. `legacy` means current compatibility code
with these flags disabled, not the historical production baseline.

The run directory contains `benchmark-sample-1.json` through
`benchmark-sample-3.json`, projected `benchmark-jobs-1.json` through
`benchmark-jobs-3.json`, aggregate `benchmark.json`, and actual app/worker logs.
Samples include allowlisted supported claim descriptors alongside semantic keys
so a missing claim can be traced to its public source and quote. Arbitrary
evidence metadata, prompts and credentials are excluded.
Feed the aggregate paths to the offline comparator above. Captures count actual
fixture callback attempts and explicitly attributed telemetry updates and
coordination selects in app query logs. An empty or incomplete workload is
rejected, and a fresh fixture page read is required in every repetition.

This bounded deterministic workload tests parity and local costs. It does not
reproduce production provider latency, large mandates, or historical database
operation counts. Numerical targets can fail even when all correctness checks
pass; report those results without claiming a production speedup.

Recorded company identity follows the observed Markdown company heading when
present, matching the production heading parser; HTML-only unit fixtures retain
the explicit company sentence fallback. This prevents concurrent sibling evidence
reuse from optionally adding a second identity quote for the same source and
name. The comparator still requires every source/field/value/quote key to match.
The pre-alignment run `ccf2d899-6f24-4593-b799-3ea7a69e8875` remains rejected:
its three completed repetitions had 49/50/50 keys because one optional Alpha
homepage heading identity appeared only in the latter two. No threshold or
coverage filter was changed to accept that run.
