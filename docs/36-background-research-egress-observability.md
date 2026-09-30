# Background research database traffic

Research database operations now emit `research-db` JSON events. Each event includes a unique query ID, timestamp, driver, query fingerprint, recognised table names, duration, returned row count, returned JSON bytes, and available request/job/run/organisation/mandate/action/stage identifiers. Known large JSON fields such as `config`, `evidence` and `sourceData` also have separate byte totals.

The query fingerprint hashes SQL shape after removing literals and placeholder numbers. SQL, parameters, credentials, search text, prompts, evidence and contact/profile contents are never included in these events. Field metrics use an allowlist. Failed queries and unmeasurable results remain visible; measuring bytes never changes the query outcome. Transaction queries are observed, and parallel stage contexts are isolated.

These measurements are **UTF-8 JSON sizes of returned application records**, after the database adapter maps results. They exclude PostgreSQL framing, TLS, compression and protocol metadata. They are not wire measurements or billable Supabase egress. They are useful for comparing query shapes, large records and repeated reads. Empty results measure the two bytes of `[]`. Writes without `RETURNING` have no returned records; this does not measure upload traffic or SQL parameters.

No extra database reads, schema changes or persistence writes are introduced by byte instrumentation. Measurements are emitted to application logs. The existing timing-span persistence is unchanged. JSON serialization adds CPU and a temporary allocation proportional to returned payload size. Large-field measurements are subsets of the returned-row total; do not add them to it. Nested transactions are covered; database calls made directly through an unwrapped driver are not. Job context is available on internal research callbacks and their deferred dispatch work; other routes without an observability scope are not measured.

## Local report

Normal `pnpm dev` writes application output to `.local-data/dev-start.log`. Start a Find Companies run and use:

```sh
node scripts/research-egress-summary.mjs --watch
node scripts/research-egress-summary.mjs --job=YOUR_RESEARCH_JOB_ID --json
```

The report ranks cumulative payloads by query fingerprint/table, stage/action and job/run. It also shows call frequency, largest individual result, average result size, returned rows and total query duration. Use cumulative bytes to identify repeated reads; use the largest result and field totals to identify oversized JSON. Query events with a `queryId` are deduplicated, and request summaries are excluded from byte totals to prevent double counting. Older timing-only logs are counted as unmeasured rather than zero-byte success.

For production, export Vercel application logs containing `research-db` messages to a file, then run:

```sh
node scripts/research-egress-summary.mjs /path/to/research.log --json
```

Both plain application logs and JSON log lines with a `message` property are accepted. Keep the original logs for correlation by request ID. The report does not make provider or database requests. Instrumented callbacks also measure the request body as it is consumed and serialize JSON responses once to record their body bytes. No second body read is needed; unread or streaming bodies remain unmeasured. These body sizes also exclude framing, TLS and compression.

Request summaries also include `databaseResultJsonBytes` and unavailable-measurement counts, with the total exposed in the internal response header `x-research-db-result-json-bytes`.

## Reading opportunities

- Many calls with a small mean: consider coalescing callbacks, reusing control snapshots or caching within one operation.
- A large `config` share: narrow projections to required keys and keep execution history out of control/scheduling reads.
- A large `evidence` share: scope findings by job/target and avoid rereading all findings during each heartbeat.
- A large profile/source-data share: load summaries first and raw provider records only when required.

Measure another comparable run after each change. Pair these logical payload totals with OrbStack network counters or provider egress reporting when checking actual network savings.
