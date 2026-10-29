# Shared workflow migration approval package

Status: approved001–004 applied to isolated rehearsal and production on 2026-10-24; feature activation remains off. These files prepare database support only. They do not enable the new workflow, make provider requests, change account registrations or send outreach.

## Exact targets

1. **Rehearsal first:** existing Docker container `acquire-hosted-demo-rehearsal-postgres`, network mode `none`, database `acquire_hosted_demo_rehearsal`, marker `acquire-hosted-demo-rehearsal-only`, PostgreSQL system identifier `7699248227334438947`.
2. **Production only after rehearsal passes:** Supabase project `njasjqpztiteionfxxul`, database `postgres`, system identifier `7678071634733212629`, through Acquire's existing verified connection. New feature activation remains off.

No new rehearsal database or bootstrap is needed. The user's active local simulator and its shared database are excluded. Each proposed migration rejects any other database/cluster before DDL. A missing rehearsal marker fails closed.

## Ordered artifacts

The final filenames and SHA-256 hashes are in [approval-manifest.json](approval-manifest.json). Apply in order, as the existing schema owner, only after specific approval of those exact files and targets.

- `001-workflow-executions.proposed.sql`: one execution record with fixed preset, actor ownership, immutable identity, RLS, active reservation and one lifetime outreach execution per mandate.
- `002-workflow-compatibility.proposed.sql`: execution-scoped simulator evidence, immutable work associations and admission guards. Existing real/demo rows and receipts remain unchanged. New reads use a compatibility view; exact predecessor hashes protect installed function changes.
- `003-workflow-admission.proposed.sql`: narrow start/replay and state-transition functions. Saved selection occurs outside the shared write fence; only one candidate is locked and rechecked. There is no new scheduler or provider work inside a transaction.

The three presets are saved-data demo with hosted simulated outreach, live research test with no outreach, and the normal live flow. Agent/workspace presentation remains independent. Live workspace retains manual sequence outreach; agent-managed, demo and research-only runs cannot use that route.

## Evidence before approval

A fresh SELECT-only production catalog captured 31 tables, 408 columns, 313 constraints, 98 indexes, 67 policies, 64 triggers and 117 function definitions. Comparison against the isolated rehearsal found all 117 functions and all inventoried application columns/constraints/guards identical. The one metadata difference is RLS on the migration ledger (enabled in production, disabled in rehearsal); this bundle does not alter that setting.

`catalog-preflight.sql` uses a read-only transaction controlled by the caller, a five-second statement deadline and one connection. Object identities are explicitly text to avoid PostgreSQL `name` truncation. Raw catalog evidence remains private in `.local-data/workflow-modularity/`; the temporary operator-IP SSH rule was removed and absence verified.

SQL and PL/pgSQL syntax parsing and independent source review are preparation evidence, **not runtime verification**. No migration or new database acceptance test has been executed. Existing AI/demo/research characterization previously passed 93 tests; those tests do not validate this new schema.

## Rehearsal acceptance required before production

Run the rollback-only SQL assertions in `tests/` after applying the approved bundle to the exact rehearsal target. They must not run on production. Their target checks reject any other cluster. No test disables triggers or changes schema.

In addition to those prepared ownership/admission/negative assertions, complete these integration gates before production application:

- Two concurrent starts for the same source produce one accepted execution; a lost-response replay returns the same identity. Race with legacy conversation/research insertion is fenced, with no deadlock.
- Legacy real and demo write paths continue with no workflow association; original dispatch proofs and receipt recovery stay unchanged. Compare predecessor and effective-view semantics using synthetic data.
- New demo mapping evidence resolves only registered simulated recipient/account identities; collisions across old/new mapping tables reject. Missing mappings never fall back to real recipients.
- Research-only cannot create conversation, operation, manual enrolment, policy or dispatch intent. A late/restarted event cannot inherit a later demo execution.
- Live workspace manual enrolment and final dispatch retain their existing approval gates and bind the original execution; agent presentation remains manual-outreach-disabled.
- Terminal/uncertain work cannot restart automatically. Historical receipt/history capture remains possible without a new submission.
- Current membership, same-organization foreign-user isolation, malformed requests, stale revisions and SQL-role restrictions pass using restricted roles.

Any failure stops the production step. A change to proposed SQL requires a new hash and approval; do not edit an already applied file or silently retry changed SQL.

## Locking, rollback and release boundary

Each file uses a transaction, three-second lock timeout and fifteen-second per-statement timeout. Constraint validation/DDL may briefly block writers; a timeout rolls back that file. If a later unit fails, earlier additive units remain inert and feature activation stays off. Record every successfully applied file's exact hash externally alongside the existing ledger; do not rerun a successful file.

Before production, recheck target identity, hashes, predecessor definitions, current health and a verified recovery backup. Apply only after the rehearsal gates pass. Check schema/privileges and existing app readiness after application. Do not treat schema readiness as proof that the new product flow works.

Rollback is to disable new starts and retain schema, immutable history and recovery guards. No destructive down migration, history reset, account rebind or old-worker reinterpretation is authorized. Complete application modules and end-to-end tests before activating new execution creation. Deploy application releases directly to DigitalOcean, not GitHub Actions.

## Known bounded behavior

Auto-selection examines a bounded candidate window and reports that scope explicitly; it never falls back to live research. Source availability is not contact-outreach authority: fit, canonical alias conflicts, history, ownership and approvals are checked later by the existing shared modules. A saved source can consequently have no contacts eligible for outreach. A failed or cancelled outreach execution is resumed under its original request rather than allocated a new transport identity.

See [the audit](../../../../docs/workflow-modularity/README.md) and the Plane module for implementation work after migration approval.

## WF-03 rehearsal result, 2026-10-24

All three original migration hashes committed successfully on the exact network-none rehearsal target. A pre-application custom-format dump and per-file logs are private under `.local-data/workflow-modularity/approved-rehearsal/`. Production and the local simulator were untouched.

Initial assertions stopped in fixture setup because the schema-only baseline has no `communication_member_fence` singleton data. Tests now seed that baseline row inside their rollback-only transactions; no migration was altered. Identity/RLS assertions and research-only guards pass. Admission fails under the real restricted agent role with `Reviewed writer role required`: the new entry points call the communications-role helper rather than the existing agent-specific gate helper. This is a confirmed migration defect, not a simulator or application timeout.

`004-workflow-agent-gate.proposed.sql` replaces those two calls with `agent_lock_send_gate()`, keeping role, membership and lock checks. Three compatibility triggers now avoid redundantly acquiring an organization gate already owned by the transaction. The general communications gate allowlist and grants remain unchanged. Exact predecessor checks protect all five replaced functions and the agent helper. See `correction-approval-manifest.json` for the new exact hash and same targets. Applied 001–003 remain byte-for-byte unchanged.

004 has not been applied. Production remains blocked on this correction and all original compatibility/concurrency/security gates. The test files changed only to restore transaction-local baseline seed data; the original approval manifest is retained as the original receipt, with current test hashes in the correction manifest.

## Correction 004 and extended rehearsal acceptance

The user approved exact004 (SHA-256 `c698092533ece1b7f49c43435094a0bdff9b9b9cf6929255edf06b95c1bbf010`) for rehearsal then conditional production. It committed on the exact isolated target, and all three original suites passed. Additional rollback-only files cover legacy projection/mapping, security/manual parity, terminal history and dispatch recovery. Four actual two-session races passed (same-request replay, distinct requests, legacy research first, admission first); loser waits were approximately0.81s, without deadlock. Committed synthetic concurrency fixtures remain isolated because immutable history must not be bypassed for cleanup.

All117 inventoried predecessor functions were checked:107 unchanged,10 changed only by effective-view substitutions. Mapping checks include registered synthetic three-channel identities, immutable receipt evidence, forward alias/UUID and reverse UUID collisions, and no real-recipient fallback. Dispatch tests cover original execution intent/permit binding, stale context denial, terminal receipt projection and legacy real intent/permit compatibility.50 application dispatch/recovery characterization tests across6 files passed with mocked dependencies.

Limitations: fixture setup uses schema-owner privileges; restricted agent admission/lifecycle/RLS are separately exercised. Placeholder encrypted fixture values do not verify service signatures or live providers. No local simulator or hosted provider requests occurred. This is database compatibility acceptance, not complete product workflow release.

## Production application complete

All four exact approved files are committed on production system7678071634733212629. Unit002 initially hit its3s lock timeout while research jobs were active and rolled back completely. After inspecting the contention, the unchanged file was retried as one SQL protocol request, reducing client round trips; it committed, followed by003/004.001 was not repeated. No session was terminated, approval weakened or timeout increased.

A fresh consistent public/drizzle custom backup completed on the app host and was copied off-host; SHA-256 matches and both archive inventories validate. The earlier local-transfer timeout is explicitly incomplete, not a backup.129 installed function hashes match rehearsal; execution RLS is forced, direct agent inserts/anonymous starts are denied, and all6 associations are present. Authenticated readiness returns200 ready and app/communications containers remain healthy. There are0 new workflow executions. See `application-record.json`; private logs/backup are retained under `.local-data/workflow-modularity/production-preflight/`.

WF-03/04 complete: approval and compatible schema release only. Shared application start/status/modules and product end-to-end tests remain pending. No application image deployment or provider/simulator traffic occurred in this schema release.
