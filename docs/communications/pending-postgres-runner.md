# Final pending PostgreSQL verification command

This runner performs synthetic DML verification only against the two **existing** owned fixtures after every exact prerequisite migration has been explicitly approved and applied separately. It never starts/initializes a database, executes a migration or grant, or invokes a live provider. The opt-in flag is not migration approval.

```sh
COMMUNICATIONS_PENDING_POSTGRES_AUDIT=1 node scripts/test-communications-pending-postgres-local.mjs
```

Do not run the command while pending schemas are absent. Both preflights must complete before any test child starts: exact loopback ports/container ownership, PostgreSQL17/current operator/database/system identifier, required FORCE-RLS relations/functions and restricted roles. Service5446 additionally requires no public application relations and the owned ignored0600 credential file; credentials are never printed.

| Fixture | Exact identity | New prerequisites |
|---|---|---|
| `127.0.0.1:5445/acquire_channels` | operator `acquire_channels`, system `7694812678792806433` | reviewed original001/002/003 plus pending isolated application004 admission |
| `127.0.0.1:5446/communications_fixture` | operator `communications_fixture`, system `7696118996713136162` | reviewed standalone001/002 plus pending standalone003 retirement,004 tracking,005 admission,006 runtime/spool,007 history |

Shared application5434 artifacts and legacy WhatsApp5447 are not targets of this command. Historical runners remain unchanged; their prior approved-schema results are separate evidence.

The final-stage inventory is **eight files,67 cases**:

| Suite under `src/db/` | Cases | Target |
|---|---:|---|
| `communications-send-gate-local.integration.test.ts` |9|5445|
| `communications-connection-retirement-local.integration.test.ts` |15|5446|
| `communications-email-tracking-local.integration.test.ts` |15|5446|
| `communications-send-quota-local.integration.test.ts` |5|5446|
| `communications-account-runtime-local.integration.test.ts` |4|5446|
| `communications-history-local.integration.test.ts` |11|5446|
| `communications-rolling-policy-local.integration.test.ts` |4|5446|
| `communications-runtime-host-local.integration.test.ts` |4|both|

The runner sets the actual frozen opt-ins: `COMMUNICATIONS_AUDIT_LOCAL_DB`, `CAMPAIGN_ISOLATED_CHANNEL_STACK`, `COMMUNICATIONS_STANDALONE_AUDIT`, `COMMUNICATIONS_SEND_ADMISSION_AUDIT`, `COMMUNICATIONS_RETIREMENT_AUDIT`, `COMMUNICATIONS_EMAIL_TRACKING_AUDIT`, `COMMUNICATIONS_ACCOUNT_RUNTIME_AUDIT`, `COMMUNICATIONS_HISTORY_AUDIT` and `COMMUNICATIONS_RUNTIME_HOST_AUDIT`. Other provider/runtime credentials are blanked; fixtures inject synthetic authority/HTTP responses. Files execute serially; explicit competing-client concurrency inside individual cases remains enabled.

Private mode0600 logs/results are written under `.local-data/communications/verification/communications-pending-postgres*`. Success requires unchanged source inventory, zero pending/todo/failed cases, every expected file present exactly once and every per-file case count matching the inventory. A child exiting zero, skipped suites or stale/missing reports cannot certify the run. Reports distinguish injected-preflight orchestration characterizations from actual PostgreSQL proof. Actual host cases use real independent application/service transactions plus synthetic provider/callback authority; they do not attest live Unipile compatibility or activate dispatch.

Six orchestration tests were authored first and executed only with a synthetic child Vitest stand-in and injected preflight; no database/private credential was accessed. Initial characterization was RED1/5 because macOS symlink roots produced different absolute reporter paths. Canonical realpath correction produced GREEN6; scoped lint passed. These results certify runner orchestration only. The original eight prerequisites were specifically approved/applied unchanged. The first actual67-case run executed all cases with16passes/51failures/zero skips; its failure evidence is retained. A separately reviewed008function repair and a legitimate application ownership fixture correction address discovered defects. The repair requires its own explicit approval; final successful database proof remains pending. Complete cursor fixtures must respect007 source-proof guards; an explicitly incomplete retirement baseline does not claim ready coverage.

## Current outcome — 2026-10-14

Despite the historical runner name, the prerequisites and separately approved008 repair are now applied unchanged once. The final actual run passed67/67 cases across8 files, zero skips, with stable source;198/198 existing PostgreSQL regressions also passed separately. Private reports: `approved-final-pending67-evidence.json` and `approved-final-existing198-evidence.json`. Earlier failures are retained as RED/integration evidence. No further migration approval is pending for this stage, and the runner never applies SQL. Live provider traffic and runtime activation remain unverified and disabled.
