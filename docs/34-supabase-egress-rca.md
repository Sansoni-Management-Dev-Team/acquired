# Supabase egress and discovery-error root cause analysis

Investigation date: 30 September 2026. All timestamps below are UTC unless stated otherwise.

## Conclusion

Repeated full-record database reads are the strongest supported explanation for substantial egress. Research polling loads historical jobs, findings, and evidence, invokes coordination routines that perform further reads, and can trigger a second workspace refresh even when results have not changed.

A separate, confirmed SQL defect prevented discovery claims from being acquired: an untyped parameter passed to `jsonb_build_object` caused PostgreSQL error `42P18`. A read-only reproduction confirmed the cause and the explicit text-cast correction.

The investigation does **not** establish that these queries account for every byte of the reported 82.83 GB. Query statistics measure calls and rows, not network bytes, and the screenshot does not show the egress breakdown by service.

## Scope and evidence

- Organisation: `jbjlqlmslevvoxirjgwt`, `tech@mlai.au's Org`, Free plan.
- Project: `njasjqpztiteionfxxul`, `project_acquire`.
- Dashboard screenshot: 5 GB included, 82.83 GB used, 77.83 GB over allowance. The largest visible daily spikes occur on 29–30 September.
- User-supplied `supabase_logs.json`: 1,000 PostgreSQL events spanning 05:07:37–05:59:57 on 30 September; 985 parameter-type errors and 15 checkpoint events.
- Read-only Management API queries against PostgreSQL statistics and aggregate record sizes.
- Management API log queries retrieving the failing SQL and error counts.
- Source-code and Git-history inspection.

PostgreSQL statement statistics were last reset on **16 September 2026 at 08:31:35 UTC**. Counts below are cumulative since that reset, unless explicitly described as observation deltas.

No application code changes, database mutations, migrations, deployments, or statistics resets were performed for this investigation. Credentials are intentionally excluded from this document.

## Finding 1: repeated reads of full historical research jobs

The [research GET endpoint](../src/app/api/mandates/[id]/research/route.ts) calls `repo.list(id)` twice: once before recovery and dispatch logic, and again afterward. The [repository list method](../src/db/research-repository.ts) selects full job records, ordered by creation time, with a limit of 1,000.

The same request invokes continuation, discovery, and enrichment dispatchers for automatic research. The [discovery dispatcher](../src/lib/automatic-discovery.ts) and [enrichment dispatcher](../src/lib/automatic-enrichment.ts) load further full job records to coordinate work. The internal [discovery-context builder](../src/app/api/research/internal/[jobId]/route.ts) loads mandate jobs and then filters them to the research run in application memory.

Three high-volume job-list queries had returned approximately:

| Query shape | Calls | Rows returned |
| --- | ---: | ---: |
| Jobs for a mandate, ordered by creation time | 9,629 | 798,157 |
| Root job and its research-run children | 10,893 | 738,766 |
| Root/run jobs plus other active organisation jobs | 10,252 | 731,454 |
| **Combined** | **30,774** | **2,268,377** |

A separate single-job query had been called **210,860 times**, returning **204,681 rows** at that snapshot. These figures establish repeated reads; they do not establish the number of distinct jobs or transferred bytes.

An aggregate across all **4,309 current research jobs** measured:

| Measurement | Value |
| --- | ---: |
| Average serialised `config` size | 19,104 bytes |
| Maximum serialised `config` size | 259,691 bytes |
| Total serialised `config` size | 82,317,771 bytes |
| Average `pipelineTiming` size | 1,506 bytes |

An earlier 500-row sample measured an average full research-job JSON size of 9,699 bytes. This differs from the whole-table config average because it covers a different population and representation. Neither measurement should be treated as the historical, query-weighted average wire payload.

Job config contains execution state and can include retained page markdown, discovery results, inherited evidence, and timing spans. Removing `pipelineTiming` when constructing the HTTP response happens after the database has already transferred it to the application. It therefore cannot reduce the bytes consumed by that database read.

**Observed current behaviour:** two statement-statistics snapshots separated by approximately **127 seconds** showed another **1,152 full rows** returned by the three broad job queries: 576, 288, and 288 respectively. This establishes that the read amplification remained observable during the investigation, without assuming that the observation represents peak activity.

## Finding 2: research polls trigger workspace reads without a result change

The [research panel](../src/components/research-panel.tsx) is configured to refresh every five seconds while research is active. Each successful refresh invokes the results callback in [the mandate workspace](../src/components/mandate-workspace.tsx):

```ts
if (changed || next.jobs.length) void refresh();
```

Once any jobs exist, `next.jobs.length` makes the callback refresh the workspace even when `changed` is false. The change signature therefore does not suppress these reads.

The workspace refresh calls `/api/mandates/:id`, which loads memberships and associated data. The [membership repository](../src/db/acquisition-repository.ts) reads target records, accreditation data, organisation metadata, and findings. This creates an additional database-read path behind each research poll. A separate workspace poller can also run while company-data enrichment is active.

The underlying design problem is that progress checks and coordination reuse broad data-loading paths. As historical job counts and JSON payloads grow, each check becomes more expensive even when little has changed.

## Finding 3: historical organisation-wide target reads

Two organisation-wide queries accounted for substantial cumulative row traffic:

| Query | Calls | Rows returned |
| --- | ---: | ---: |
| Target IDs and full firmographics for the organisation | 7,354 | 3,464,279 |
| Full target records for the organisation | 6,671 | 3,317,643 |
| **Combined** | **14,025** | **6,781,922** |

Both counters remained unchanged during the 127-second observation. They are evidence of historical traffic, not evidence that those exact query shapes were still running.

Git history contains commit `9b8e2bc`, dated **22 September 2026**, titled “Stop idle polling and scope workspace queries to cut Supabase egress”. Current membership reads pass target IDs to the target repository, and the polling hook stops polling when work is inactive.

This source change supports the explanation for why those broad counters were static, but Git history alone does not establish when a version was deployed or how much of the historical usage it prevented.

## Finding 4: discovery claims fail because a JSON key parameter has no type

Detailed Supabase logs identify the failing statement as the discovery-claim update in the [internal research endpoint](../src/app/api/research/internal/[jobId]/route.ts). Its problematic expression was:

```sql
jsonb_build_object($1, $2::jsonb)
```

The value parameter is explicitly typed as JSONB, but the key parameter has no explicit type. PostgreSQL cannot infer its type in this function call, so the statement fails during parsing with:

```text
42P18: could not determine data type of parameter $1
```

The claim update cannot acquire the discovery lease when parsing fails. This establishes the direct discovery failure; the investigation did not quantify subsequent retries or their bandwidth contribution.

### Read-only reproduction

The following SELECT, with parameters `['q-0-0-example', '{}']`, reproduced the same error:

```sql
SELECT jsonb_build_object($1, $2::jsonb) AS result;
```

Adding the explicit key type succeeded:

```sql
SELECT jsonb_build_object($1::text, $2::jsonb) AS result;
```

The successful result was:

```json
{"q-0-0-example": {}}
```

### Error frequency and correction status

- The 05:00–06:00 window on 30 September contained **1,128 `42P18` errors**, all associated with the same discovery-claim statement.
- The queried 06:00–09:00 window contained **one further matching error**, at 06:00:08.
- The queried 29 September UTC window returned no matching errors. This is limited to recorded events in that window; it does not prove absence outside the available logs.
- The working tree already contained uncommitted `::text` corrections for the discovery JSON key expressions. These were present before this investigation and were not authored as part of it.
- Deployment of that correction was not verified. The absence of later errors in the queried window could also reflect a lack of calls to the failing path.

The SQL defect cannot be established as the cause of the 29 September spike. It is a confirmed discovery failure and must be tracked separately from the broader egress diagnosis.

## Corrective priorities

1. **Verify the discovery SQL correction is deployed.** Preserve explicit text casts on JSON key parameters and validate claim acquisition, completion, and replay against PostgreSQL. The working tree includes an opt-in PostgreSQL test; mocked query tests alone cannot establish that PostgreSQL can infer parameter types.
2. **Remove unconditional workspace refreshes.** Refresh for meaningful result changes and explicit lifecycle events rather than the mere existence of historical jobs. Preserve initial loading and final-state updates.
3. **Use narrow reads for progress and coordination.** Select the fields required by each caller and filter to the relevant research run in SQL. Preserve full config reads where execution or resumption actually needs them.
4. **Reduce duplicate job-list reads.** Reuse a snapshot when recovery or dispatch has not changed state; refresh it when correctness requires an updated view.
5. **Separate historical display needs from frequent progress checks.** Retrieve detailed historical evidence and execution payloads when needed rather than on every poll.
6. **Measure the result under comparable activity.** Compare statement-counter deltas, returned-row counts, and Supabase's egress category breakdown before and after changes. Track active jobs and open workspace tabs so the comparison accounts for workload.

These are recommendations, not implemented changes. Any proposed database migration requires explicit approval for that specific migration.

## Remaining uncertainty

The screenshot establishes the billed usage and daily shape, but not the service breakdown. PostgreSQL statistics cover the period since 16 September and do not allocate calls or bytes to individual days, deployments, browsers, or workflow runs.

Consequently, the investigation confirms the SQL failure and the application mechanisms that amplify reads, and identifies substantial measured database traffic. It does not fully reconcile the 82.83 GB total or prove what changed specifically on 29 September. Resolving that requires the dashboard's egress-category breakdown and workload/deployment evidence for the spike windows.

## Reference documentation

- [Supabase read-only database query API](https://supabase.com/docs/reference/api/v1-read-only-query)
- [Supabase querying logs with SQL](https://supabase.com/docs/guides/observability/advanced-log-filtering)
- [Supabase log sources and fields](https://supabase.com/docs/guides/observability/log-field-reference)
- [Supabase egress usage](https://supabase.com/docs/guides/platform/manage-your-usage/egress)


## Implementation review after the investigation

The investigation above describes the baseline at the time it was captured.
The following fixes are now implemented in the working tree and checked with
regression tests; this section does not claim a production rollout or a measured
reduction in the billed 82.83 GB.

| RCA priority | Implementation and validation |
| --- | --- |
| Discovery SQL typing | Explicit JSON-key text casts retained. Claim/completion/replay SQL is exercised by an opt-in PostgreSQL test using SELECT-only expressions, not just mocked SQL. Deployment must still be checked against the production version. |
| Unconditional workspace refresh | Workspace refresh now requires a meaningful change. Research signatures ignore status messages, page counters, intermediate stages, candidate admission, reordered records, and zero-result placeholders. Saved company IDs, evidence/results, and lifecycle completion still refresh. Integration tests exercise the actual polling callbacks and count workspace fetches. |
| Narrow progress and coordination reads | Subsequent Worker control requests omit execution content. Execution reads omit timing/scheduler state. Discovery context uses an organization/mandate/run-scoped SQL projection containing only IDs, status, seeds, and the three needed config fields. Shared scheduling snapshots filter jobs in SQL and select only required finding columns. Lease responses contain scheduling state only. |
| Duplicate list reads | Throttled/no-op UI scheduling recovery reuses its initial review snapshot. Successful scheduling, stopped-worker recovery, and partially failed passes refresh it. Tests verify one versus two list reads. |
| Historical execution payloads | Review reads exclude staged directory candidates, scheduling internals, and retained pending/buffered page markdown. Retry attempts and remaining URLs stay available. Full execution content remains available to resumption paths rather than being loaded into review responses. |
| Comparable measurement | Correlated `research-request` logs now report database call count, returned-row count and round-trip work, including workspace/research GET requests. `research-db` logs record operation, outcome, returned rows and duration without SQL/record contents. Live statement-counter deltas and Supabase egress-category comparison remain rollout validation work. |

The implementation also batches timing persistence, bulk-inserts page findings,
returns guarded progress updates without a redundant reread, and coordinates
scheduling with a durable per-run lease. New runs snapshot independently
configurable batching, progress and scheduling flags; legacy runs retain their
original behaviour. JSON updates preserve concurrent timing/scheduling state.
No database migrations are required or were applied.

### Limits that remain visible

Review polling still loads the evidence and historical job/timing data needed
for its existing review summaries and exact percentiles. These reads now omit
execution markdown, but their cost can still grow with history. Server-side
aggregation or an explicit historical-detail endpoint would further reduce that
remaining traffic; those would need coverage and percentile parity tests.

Returned-row counts do not measure network bytes, and database round-trip work
includes driver/network/pool time rather than SQL execution alone. The new logs
must be compared under similar active-run counts and open-tab counts. Verify
production claim success and deployed versions, then compare counters and the
Supabase egress category breakdown. No reduction in billed egress or production
speedup has yet been established by these local tests.


## Completion-pass measurement scope

The remaining implementation and rollout work is tracked in
[the research performance completion ledger](36-research-performance-completion-plan.md).
Review polling now uses compact timing summaries rather than transferring raw
historical span maps, with exact deduplication/percentile parity checked against
PostgreSQL. Request logs additionally measure consumed request and serialized
response UTF-8 body bytes; database logs measure returned-row JSON bytes. These
are application representations, not billed egress or compressed wire bytes.

The SELECT-only production diagnostics capture found existing
`pg_stat_statements` entries. Its cumulative counters include other production
work and cannot attribute a before/after delta to one canary. No extension was
installed, statistics reset, migration applied, or historical customer data
modified. The dashboard egress-category reconciliation remains an external
measurement requirement; it must not be reported as solved by local test counts.

The completion release is deployed to the production app and research Worker,
with all seven isolated production correctness/rollback canaries passing.
See the ledger for immutable release IDs, final checks and benchmark outcomes.
This verifies rollout; it does not reconcile the original billed 82.83 GB or
establish a reduction in the Supabase egress category.
