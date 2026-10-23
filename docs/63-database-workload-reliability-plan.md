# Database workload reliability implementation plan

Date: 2026-10-24. Status: reliability safeguards are deployed directly to DigitalOcean through 28e5409. Pool reservation, bounded background work, durable continuations and read-only snapshots have local and production evidence. DBR-5/6 remain in progress: history callback serialization starvation and combined LinkedIn checkpoint timing have tested, deployed fixes; five-phase history refreshes completed; run timestamps now exclude acquisition waits and decision prechecks reserve the existing 45-second window; complete simulated outbound/reply and final-image soak acceptance are still pending. DBR-4 schema changes remain unapplied and require specific approval if justified by measurements.
Incident evidence and operational history: [communications progress](communications/progress.md), P7.3/P7.4.
Related work: [research performance ledger](36-research-performance-completion-plan.md) and [communications execution plan](39-communications-service-execution-plan.md).

## Outcome and constraints

Keep interactive requests responsive while research, agent execution, campaign processing and simulator callbacks run. Background failures must produce bounded, recoverable delays rather than accumulating queries and lock waits.

Reuse PostgreSQL agent events and Cloudflare research workflows. Do not introduce Redis or another broker in this iteration. Do not raise connection limits as the first remedy. Preserve ownership checks, send gates, approval requirements, event fencing, immutable dispatch intents and simulation routing. A timeout must never cause an uncertain send to be submitted again blindly.

Production database migrations require explicit approval for each exact file and target. This plan is not migration approval. Use existing approved development targets only; the isolated agent database exception does not automatically apply to this worktree. Production releases use direct DigitalOcean deployment, not GitHub Actions.

## What the evidence establishes

- Before the experiment, ordinary reads and Supabase's own diagnostics timed out. Dashboard readings showed high CPU and exhausted disk IO balance.
- Pausing the main background paths did not immediately restore responsiveness. A Supabase restart with those paths paused did. No application data was deleted.
- After restart, the prepared demo candidate query took 1.15 seconds, and the deployed Agent-mode Run demo button opened a workspace containing 8 companies and 220 people. This was workspace-opening verification, not outreach verification.
- After staged restoration, candidate selection took 1.13 seconds; a short CPU interval spanning native-worker restoration was 88.5% idle. The initial cause and long-term recurrence remain unproven.
- A research scope scan still deferred after recovery. There are 12,856 research jobs with approximately 109 MB of stored configuration and 134 MB of TOAST storage.
- Historical query statistics identify research maintenance, evidence reads, review recovery and send-gate waits as priorities. Their elapsed-time shares are not CPU percentages or current request rates.

## Existing controls and gaps

| Area | Existing control | Gap to address |
|---|---|---|
| Main database pool | `src/db/client.ts`: maximum 5 connections per pool/process | No global workload limit; connection timeout is not query cancellation |
| Agent pool | `src/lib/agent-runtime.ts`: maximum 4 connections per pool/process | Shares database capacity with other pools and services |
| Native worker | Awaited ticks, adaptive backoff, bounded discovery SQL, tick singleflight | Inventory transaction paths without budgets; expensive discovery still runs on idle passes |
| Research maintenance | In-process singleflight and scan deadline | Initial research observer executes before that guard; full-pass limits and failure reporting are incomplete |
| Research scheduler | One-minute cron; 15-second HTTP timeout | HTTP expiry does not cancel PostgreSQL work; subsequent invocations can repeat expensive discovery |
| Agent transactions | Membership checks and send-gate serialization | Many transactions lack an explicit budget and hold gates through all work |
| Saved-demo reads | A bounded-read implementation exists locally | Unreleased; must assess separately from the unchanged production image used in the restart experiment |

## Delivery sequence

### DBR-1 — Establish workload measurements and acceptance fixtures

Inventory all application, communications and worker pools, process counts, direct/pooler connection paths and scheduled entrypoints. Count actual deployment replicas before calculating the connection ceiling; 5+4 is not the whole system's limit.

Instrument pool checkout duration and waiting clients, SQL duration by operation label, transaction duration, gate wait/hold duration, active maintenance passes, retries, queue age and timeout classifications. Use existing tracing and structured logs; do not write diagnostic events into the struggling database on every query. Never log raw credentials or message payloads.

Create a deterministic, synthetic workload with production-like research-job counts, config sizes and status distribution. Retain a small correctness fixture too. Record query plans and matched before/after measurements under the same resources, including cold/warm cache conditions. Use existing production counters as deltas with reset timestamps, not historical totals as current rates.

Acceptance: distinguish pool waiting, SQL execution, lock waiting and provider latency for one request across the chain. Reproduce a blocked query and overlapping scheduler calls locally without production load testing.

### DBR-2 — Bound database work and prevent overlapping maintenance

Start at `src/app/api/research/internal/background/route.ts`, `src/lib/agent-initial-research-observer.ts`, `src/lib/research-maintenance.ts` and the existing database budget helpers.

1. Put the observer and maintenance work inside one authenticated singleflight operation. All concurrent callers share the pass; an individual caller disconnecting must not restart or cancel shared work owned by another caller.
2. Establish an overall pass budget and propagate remaining time through discovery, observation and recovery. Stop starting operations when the budget is exhausted.
3. Apply transaction-local PostgreSQL `statement_timeout` and `lock_timeout` on the same checked-out client as the work. Bound checkout, setup, commit and rollback at the driver/lifecycle level too. Discard clients whose transaction state is uncertain; do not return them to the pool.
4. Never treat `Promise.race`, HTTP abort or a driver timeout as proof that server-side work stopped. Verify server cancellation and cleanup in PostgreSQL integration tests.
5. Distinguish completed, idle, deferred and unavailable outcomes. Do not swallow database failures into an apparently successful idle result.

Initial experimental budgets: maintenance pass 10 seconds, discovery statement at most 3 seconds, lock wait at most 500 ms, checkout at most 2 seconds. These are starting values to validate, not blanket replacements for every transaction. Longer legitimate writes need an explicit operation-specific budget and idempotent recovery.

Tests: concurrent requests invoke observer/maintenance once; expired budgets prevent later work; lock and statement cancellation release resources; failed rollback retires the client; late checkout is released; client disconnect does not duplicate shared work; errors return valid bounded JSON. Preserve authentication tests and both configured database-driver contracts.

### DBR-3 — Add backpressure and failure cooldown

Create one shared admission mechanism for background work in the persistent app, covering research maintenance and native/campaign discovery rather than separate unlimited semaphores per module. Start conservatively with one expensive background discovery operation at a time. Keep interactive requests outside that queue and cap queued admission requests.

On repeated database timeout, connection or saturation failures, open a background-only circuit. Proposed starting policy: three consecutive failures, 30-second cooldown, exponential growth with jitter to five minutes, and one half-open probe. Use a cheap bounded database read; never use the full historical scan as the health probe. A successful constant read alone is insufficient to declare workload recovery: resume one small batch and observe it before normal admission.

Do not count authentication, validation or business-review decisions as database outages. Preserve scheduled work for later retry and expose deferred state operationally. Browser polling must back off on unavailable responses and must not trigger recovery scans.

The in-process guard is sufficient only for the current verified single app replica. Before enabling multiple replicas, use an approved durable lease or singleton scheduling ownership. Do not hold a transaction or database connection open for the duration of an external workflow merely to implement a distributed lock.

Tests: repeated failures suppress scans; only one half-open attempt runs; successful recovery resets cooldown; a restart/replica scenario cannot duplicate effects; background saturation leaves interactive capacity available; retry storms remain bounded.

### DBR-4 — Replace historical scans with indexed due-work discovery

Preferred design: keep existing research jobs/workflows authoritative and add a compact scheduling projection containing job/scope identifiers, work kind, due time, status and revision. Reuse equivalent existing fields/tables where possible. Do not put evidence or large execution JSON in this projection.

Update the projection in the same transaction as relevant job state transitions. Discover a small ordered batch through an index on due work. Where multiple consumers are permitted, claim briefly with leases/fencing and `SKIP LOCKED`; commit before provider calls and validate the fence on completion. Preserve fairness across organizations and retain existing workflow identifiers and deduplication keys.

Specify retryable, terminal and exhausted work states explicitly. Existing agent events remain the agent queue; this change must not create a second owner for the same research execution. Add a bounded, infrequent reconciliation path for missing projection rows rather than a full historical scan every minute.

Prepare additive migrations, a bounded resumable backfill and indexes from measured query plans. Separately assess the research-findings context lookup and registered review-recovery query; do not assume one index fixes all three. Compare the current and new selectors on a frozen snapshot, including JSON null/missing distinctions, completed jobs with unfinished people research, cancelled/native work exclusions, fairness and tenant boundaries.

Approval gate: provide exact SQL files, hashes, database target, rehearsal results, expected lock/storage costs and rollback procedure before application. After approval, use expand/backfill/compare/switch rollout. Keep the old schema intact; disable the new selector to roll back, rather than dropping data or running an automatic destructive down migration.

Tests: projection stays consistent on every relevant transition; duplicate callbacks are harmless; crashed claims recover; expired fences cannot commit; retries cannot duplicate sends; no eligible work is silently lost. Performance must remain proportional to due work as historical completed-job volume increases.

### DBR-5 — Reduce work while holding send gates

Review `src/db/agent-store.ts`, campaign transaction wrappers, research persistence and communications coverage projection. Measure before changing boundaries.

Move provider calls, AI generation and expensive preparation outside gate-holding transactions where present. Revalidate ownership, policy, revisions, approvals and dispatch state inside the final short transaction. Keep lock ordering and unresolved-send protections intact. Do not bypass gates on a presumed read-only path unless a correctness review proves that path does not depend on their serialization.

Reuse consistent snapshots and batch evidence lookups where this preserves freshness and scope. Reduce repeated capability/schema discovery only with cache invalidation rules appropriate to rollout. Do not cache authorization decisions across users or reuse stale approval state.

Tests: concurrent pause/revoke/reply versus dispatch still refuses stale work; stale preparation cannot commit; timeouts leave a recoverable intent rather than a duplicate send; tenant isolation and original lock ordering remain intact. Measure gate-hold time and query count, not just total request duration.

## Verification and release gates

Use test-first implementation per the communications execution plan: demonstrate each relevant failure, implement the smallest fix, then record green tests. Existing passing tests are characterization evidence, not proof of a new safeguard. Run real PostgreSQL cancellation/locking tests on an authorized isolated target.

Proposed initial performance targets, to be validated with fixtures:

- Background discovery p95 below 1 second; bounded failure within its configured budget.
- Saved-demo source selection p95 below 2 seconds; complete workspace opening p95 below 10 seconds on a healthy database, with Agent mode on and off measured separately.
- No accumulating active queries after aborted requests; no sustained pool wait backlog.
- Interactive latency remains within target during background load, with no lost work or duplicate effects.
- One-hour local soak with injected database latency and lock contention, followed by at least a 30-minute production canary and a next-day review. Include queue age and throughput so low CPU cannot hide a stalled worker.

Release code-only safeguards separately from scheduling schema changes. Reconcile the existing unreleased demo/Firmable work before building; do not accidentally include it in the reliability release. Publish source/build revision and direct DigitalOcean image digest. Preserve current runtime settings, verify app readiness and actual demo opening, and restore worker lanes gradually while observing metrics.

Rollback triggers: increased timeout rate, persistent admission starvation, rising queue age without throughput, role/scope failures, broken demo opening or any duplicate/uncertain send regression. Disable the affected new feature or restore the previous image/configuration; preserve saved intents for reconciliation. Do not use database resets as a rollback mechanism.

Alert initially on sustained SQL timeouts, oldest due-work age, prolonged circuit-open state, pool checkout waits, long gate holds and resource saturation. Set numeric alert thresholds from DBR-1 baseline and service budgets. Never auto-restart the database or change paid compute from an alert.

## Implementation checkpoints

| Checkpoint | Deliverable | Migration required? |
|---|---|---|
| 1 | DBR-1 measurements and red regression cases | No |
| 2 | DBR-2 full-pass guard and database budgets | No |
| 3 | DBR-3 admission/cooldown and operational controls | No for the verified single-process deployment |
| 4 | DBR-4 selector/projection implementation and exact migration package | Likely; explicit approval required |
| 5 | DBR-5 bounded transactions and measured lookup improvements | Only if a separately approved index/function change is needed |
| 6 | Integrated soak, staged release, production canary and next-day report | No additional migration implied |

Next action: implement DBR-1/DBR-2 regression tests and the whole-pass guard before changing pool sizes, adding infrastructure or requesting a migration. Update this plan and the P7.3/P7.4 progress record with implemented, locally verified, production verified and released status separately.

## Plane tracking

Module: [Database workload reliability](https://plane.mlai.au/mlai/projects/049211e4-72a2-4ee3-9257-157a4f11822f/modules/fba20a80-41b8-4c39-8bfd-ec7a38d78079) in MLAI / [Studio] Project Acquire. Module is Planned; issues are Backlog, with dependency links and acceptance criteria.

- [[DBR-1] Measure database workload and reproduce saturation](https://plane.mlai.au/mlai/browse/L0D499CD9-178/)
- [[DBR-2A] Prevent overlapping observer and maintenance passes](https://plane.mlai.au/mlai/browse/L0D499CD9-179/)
- [[DBR-2B] Bound background SQL and transaction lifetimes](https://plane.mlai.au/mlai/browse/L0D499CD9-180/)
- [[DBR-3] Add background admission limits and outage backoff](https://plane.mlai.au/mlai/browse/L0D499CD9-181/)
- [[DBR-4A] Design indexed due-work scheduling and approval package](https://plane.mlai.au/mlai/browse/L0D499CD9-182/)
- [[DBR-4B] Implement indexed scheduling and bounded queue recovery](https://plane.mlai.au/mlai/browse/L0D499CD9-183/)
- [[DBR-5] Shorten send-gate transactions and batch evidence reads](https://plane.mlai.au/mlai/browse/L0D499CD9-184/)
- [[DBR-6] Verify recovery under load and roll out reliability safeguards](https://plane.mlai.au/mlai/browse/L0D499CD9-185/)

## Implementation update — 2026-10-23

DBR-2A implemented locally: `scheduled-research-pass.ts` shares observer and maintenance work across authenticated concurrent route calls. The guard stays held until actual work settles, even if an HTTP caller disconnects. Each caller receives its own JSON response; rejected passes return sanitized 503 JSON with Retry-After and release the guard for subsequent work. Added per-phase/pass elapsed-time logs without SQL, arbitrary error messages or payloads (first portion of DBR-1 instrumentation).

Red evidence: route regression run had 3 failures—observer executed three times for concurrent calls, twice after caller disconnect, and uncaught failure prevented a JSON response. Green evidence: route, maintenance and observer suites pass 33 tests; TypeScript passes. Includes authorization during an active pass, successful and failed cleanup, maintenance failure and sanitized timing logs.

Limits: process-local guard only, no distributed lease; phase timing is not pool/SQL/gate timing. Existing observer/maintenance internals still swallow some failures, so phase_finished means the function returned, not that all work succeeded. No SQL cancellation, whole-pass deadline or circuit breaker is claimed in this checkpoint. No migration or production changes. Next: DBR-2B same-client SQL/lifecycle budgets, explicit deferred outcomes, and cancellation evidence, followed by shared admission controls.

## Release verification in progress — 2026-10-23

The code-only release is isolated from the unreleased demo/Firmable changes, based on production b0593d6. Commit 1af21a8 was deployed directly to the existing single DigitalOcean app replica. No migrations, runtime settings, credentials, Caddy configuration or GitHub Actions deployment settings changed.

Implemented DBR-2B/DBR-3: explicit background contexts, one admitted background transaction, at most two queued requests with one-second admission waits, same-client transaction-local statement/lock/idle limits, checkout and lifecycle deadlines, physical retirement of uncertain clients, and bounded failure cooldown with one cheap half-open probe. Main, agent and campaign pools share the admission lane only within explicit background scopes. Interactive work and actual send handling are not silently placed behind this queue. Scheduled observer and maintenance share a complete-pass guard; HTTP timeout does not release ownership of unfinished work.

Verification: release baseline 6,610 Vitest and 169 Node tests passed; four actual PostgreSQL cancellation/locking/Drizzle tests passed without DDL on the isolated marked local database. Real statement cancellation returned 57014, lock cancellation returned 55P03, and cancelled/expired work did not remain active. Follow-up browser regression suite: 87 passed; full suite including those changes: 6,614 passed, 938 opt-in skips. Build/typecheck and targeted lint passed.

Production exposed a separate agent-controls issue: six parallel reads compete for a shared send gate. The browser remained at Loading agent controls despite successful readiness checks. Commits b8fd7de and 7081ce4 serialize the shared controls loader and back off repeated polling failures up to 60 seconds. New failing regressions were observed before both fixes; required reads remain authoritative and optional capability failures remain explicitly unavailable. These commits must still pass the actual production browser check.

Limits: historical research discovery still exceeds its bounded query budget and defers. DBR-4 indexed discovery is not implemented or released. Native event handling and full send-gate transaction restructuring remain outside this checkpoint. A healthy readiness response alone is not evidence that the agent journey or research throughput is healthy. One-hour local fault soak and final-image production canary are in progress.

### Pool inventory verified during release

The production application uses Supabase's transaction pooler at port 6543. Its persistent app process has configured client ceilings of main 5 + agent 4 + campaign/application 3 + hosted callback reads 2 = 14 client connections to the application database. This is a client ceiling, not a promise of 14 PostgreSQL server backends: Supavisor multiplexes them. The communications service pool (5) points at the separate DigitalOcean communications database and is shared between configured communication profiles. The hosted callback read pool is a singleton. Supabase platform clients, diagnostics and any independent deployment must be counted separately. Compose runs one app service; no replica increase was made.

Supabase CLI `inspect db blocking` successfully connected and captured waits at the shared communications/agent gate. `inspect db db-stats` failed because this deployment lacks `pg_stat_statements_info` (42P01); this is a diagnostic compatibility failure, not an application query failure. The logs Management API returned 403 with the available CLI credential; no permissions were expanded.

Authenticated production baseline, with this agent's extra chat polling stopped: execution 8.22s, handoffs 13.09s, authority 8.54s, targets 12.77s (all 200). A prior execution request took 16.68s under polling load, exceeding the browser's 15s request deadline. The new optional bundled-controls response reuses a single actor-store transaction and ownership gate for these four required projections. Scope authorization still runs before access; channel-policy/provider readiness remain outside the bundle. The legacy response remains available during rollout.

Bundling verification: new failing scope/rollback tests first, then passing unit tests and one actual PostgreSQL test of concurrent actor isolation and connection reuse. No DDL was run; synthetic local test memberships were removed. Full suite after bundling: 6,620 passed, 939 opt-in skips. The composite request has a 30s client cap because it replaces four requests; the server transaction optimization, rather than a timeout increase alone, is the intended latency fix. Production timing and UI verification remain required.

Activity follow-up: production activity GET returned 200 in 30.55s before the change, beyond the browser request deadline. Commit ebb522f bundles message, pending review and optional guidance reads in one actor-scoped database transaction. Four regression failures were demonstrated before implementation; 13 targeted tests and TypeScript passed afterward. Full suite: 6,621 passed, 939 skipped. The Docker image built successfully. Production acceptance remains pending; do not infer user-flow health from readiness.

A subsequent Supabase CLI blocking snapshot recorded gate waits up to 5.56s. A separate bounded, read-only `pg_stat_activity` check confirmed one blocker per waiting transaction and active short transactions holding the gate. No long-running research scan was present in that individual snapshot; this does not establish sustained research throughput.

### Measured recovery and readiness follow-up

Production Start completed recipient preparation at 40.65s, channel defaults at 73.84s and contact selection at 95.00s. The old browser's 90s cap reported an unconfirmed result before the saved selection completed. Rechecking the same request completed in 35.58s without rebuilding recipients; the five-contact proposal appeared in the UI. Activity after bundling measured 23.45s versus 30.55s before. These remain above the latency target.

Commit 49987fa aligns activity reads to a finite 30s cap, the composite post-action controls refresh to 60s, and demo Start to 150s. These are recovery-budget corrections, not claims of faster database work. Tests prove a measured 23s read and 95s Start can finish, stuck reads/Start still terminate, caller cancellation propagates and retries preserve the original command key. Full suite: 6,625 passed / 939 skipped. Direct production image: sha256:5b8387705e1d757904132feaae1cac34e0a05f488c711535789fa0eea6f093ca; runtime hash unchanged (4b52a8731ca1028fee39137c8820a883b06cce954685442f391679fc9cf291e4).

The one-hour marked-local-database fault soak completed successfully: 358 cycles and successful interactive probes, 1,313 deferred background attempts, 119 recoveries. The private harness was removed from the source tree. No DDL was used. Production canaries are recorded separately for each image; interrupted canaries are not a completed final-image observation window.

A direct bounded, read-only production execution of the initial-research discovery query returned zero eligible rows successfully; EXPLAIN also completed. This observation does not support attributing every scheduled deferral to a missing index. Admission/cooldown and the maintenance selector require separate evidence before DBR-4 migration design.

Channel-readiness GET exceeded 40s. Code inspection found three separate owned-binding transactions and three separate communications-client membership checks. Commit cccd489 batches the binding read in one existing actor-gated transaction and creates a lazy request-local communications client once. Each binding is still checked for tenant/owner/channel, each service status retains exact-binding and capability validation, and the existing 30s status cache remains keyed to actor/binding facts. No provider call is made inside the batch transaction. Red regression demonstrated per-channel fan-out; green tests cover one binding read/client, cache reuse, foreign ownership and database failure. Full suite: 6,627 passed / 939 skipped; typecheck/lint passed. Production timing acceptance is pending.


### Reserved discovery capacity and saved-action refresh — 2026-10-23

Production logs showed native discovery retiring checkouts at 2,000ms before SQL while interactive requests occupied the agent pool. The agent pool now reserves one of its existing four clients for explicitly budgeted background work (three interactive + one background); the total application client ceiling stays 14. Role, tenant, approval and gate checks are unchanged. The regression first failed with all interactive clients held; the actual PostgreSQL test then proved discovery could complete while every interactive client was occupied. Combined pool and actor-bundle suite: 16 passed, including six actual-database tests; no DDL.

Channel readiness after batching returned 200 in 22.01s, with all three demo channels connected and ready. This exceeds the previous 15s browser deadline, so controls now use the shared bounded 30s status reader. Saved review/control actions refresh the bundled activity projection instead of repeating full snapshot plus reviews reads. A failing regression demonstrated the duplicate refresh before the change. These changes do not claim the underlying latency target is met.

Production contact approval persisted and its worker event progressed from pending to leased, with a conversation reassessment queued. No simulated message/reply round trip is yet claimed for this verification run. Final image deployment, worker progress and canary remain pending for this follow-up.


### Bounded contact allocation continuation — 2026-10-23

After the capacity release, five observed agent discovery passes acquired/released connections with no checkout retirements. Three independent cold connection probes completed in 534–564ms, ruling out slow establishment in that observation window. The previous 2s failures were pool contention. Supabase CLI blocking inspection continued to work; no migrations were applied.

A separate production event exceeded its native 45s duration while allocating a five-contact approval. It created one conversation, then lost authority; one retry ended in review rather than silently repeating effects. The continuation fix preserves the same approved batch, allocates at most one contact per worker event, checkpoints results and emits the next event in the same final transaction. Existing per-contact command receipts make a crash before the checkpoint idempotent. Final fence checks remain inside the store before allocation/checkpoint; lease duration and send authority are not widened. The adapter reuses the already loaded approved target list instead of reading it twice.

Red evidence: one-contact checkpoint regression failed (two contacts attempted), and adapter regression failed (reviewed target list not passed). Green evidence: ten unit allocation cases plus six actual PostgreSQL channel cases passed, including fresh-store continuation, no duplicate conversations and zero dispatch intents. Tests also cover lost fence and foreign checkpoint rejection. Full release checks/deployment are pending for this checkpoint.


### Demo recovery deadline evidence — 2026-10-23

A fresh agent-mode Run demo saved mandate 57f7e9d9-1721-4e17-89b6-2bb4dc58a1c1, its demo mode/thread/responsibility and all six selected companies. The browser nevertheless reported an unconfirmed result. An authenticated request to the same saved-status route returned 200/ready in 6.90s. Recovery checks had a 5s cap, so repeated cancelled reads could never acknowledge this healthy response. The fix permits 30s per status read within one 60s recovery budget; it retains the exact original request/source, one creation POST, authentication failures and bounded retry count. Two failing timing regressions were demonstrated, then all eight recovery tests passed. This is a measured deadline mismatch correction; creation latency remains a separate performance concern. No migration or provider send was involved.
