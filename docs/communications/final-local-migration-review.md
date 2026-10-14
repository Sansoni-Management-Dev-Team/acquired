# Final local migration review

Prepared 2026-10-14. **All eight artifacts below were explicitly approved and applied unchanged on 2026-10-14.** The user answered the exact final approval request with “yes run them.” Fresh target/hash checks and validated private backups preceded execution; all eight committed once. This document requests no production change, provider action, credential transfer, historical backfill, repository publication or DigitalOcean shutdown.

The build-first implementation adds durable original connection ownership, send permission/quota records, tracking recovery and history checkpoints. Provider response formats are translated by adapters; these SQL changes establish our own persistence and concurrency guarantees. Application policy stays in the application database. Service accounts, encrypted provider evidence and transport journals stay in the independent service database. Startup and test runners never apply migrations.

## Exact artifacts and targets

Apply each target's files in the listed order, only after explicit approval for every file/hash/target. Every target is an existing owned local OrbStack database; no new database initialization is proposed.

| Target / system identifier | File | SHA-256 | Purpose |
| --- | --- | --- | --- |
| `127.0.0.1:5446/communications_fixture` / `7696118996713136162` | `ops/communications/standalone/003-connection-retirement.local.sql` | `2448ee14577f97a6d17e3c307fe376c4d44dfb204f0a94a83b652fb56a905dde` | Retained original disconnect intent and account-wide retirement fences |
| Same 5446 target | `ops/communications/standalone/004-email-tracking.local.sql` | `71fa73939d98509d7c28da4d8f8fa0efe550f74fd5a6b134b230747cd4900edc` | Encrypted email acknowledgements and verified actual sent associations |
| Same 5446 target | `ops/communications/standalone/005-send-admission.local.sql` | `6d6179fe4f27359dfbe3f6acaa535741036e1d589c9dafaff28323b37c58710c` | Immutable dispatch permits and application/account quota serialization |
| Same 5446 target | `ops/communications/standalone/006-account-runtime.local.sql` | `cd6ec7e2c305fcd7536b013c7d0fcc2d17476e941fc58cc71f3e035fdaffc732` | Encrypted verified account metadata, defaults, setup notifications and prebinding webhook spool |
| Same 5446 target | `ops/communications/standalone/007-history-checkpoints.local.sql` | `e2406e5e2455856db703360123b7a352e4a7152cfad22ea50aa58b7930390d3e` | Initial-sync and held history-refresh/checkpoint evidence |
| `127.0.0.1:5445/acquire_channels` / `7694812678792806433` | `ops/communications/004-send-admission.local.sql` | `9968570f93ff145c137a2d9d165e6d663b28396d9609b36ef3eb8cc031eefb04` | Held application gate, original encrypted intents/epochs/permits, explicit review cutoff and admitted-draft mutation guards in the isolated application fixture |
| `127.0.0.1:5434/project_acquire` / `7680143844628185121` | `ops/communications/application-shared/001-app-prerequisites.local.sql` | `a4b9a27dc2808eea1f2bbba163772e4c04d4fd400099d552837045a00b49774e` | Application-only bindings, checkpoints, fingerprints and review receipts; no communications service schema |
| Same 5434 target | `ops/communications/application-shared/002-send-admission.local.sql` | `67e1891d47d67583e01803fd2fd3ac4b77f79c6964734af9903ca0fa915125d5` | Same application admission body as isolated 004, with the distinct shared-target guard |

The shared application prerequisites are necessary because those application tables are absent on 5434. Their source manifest preserves the approved original application bodies, extracting only the application portions of the former combined fixture. Approval for isolated 5445 does not authorize shared 5434. The 5447 legacy database is complete and excluded.

## Execution and verification procedure

1. Record the user's exact approval scope. Re-read AGENTS.md and compare every approved artifact's SHA-256 with this frozen inventory. Changed bytes require new approval.
2. Independently attest container ownership labels, sole loopback port, PostgreSQL image, current database, operator, system identifier, required existing relations/roles and absence of partial new objects. Inventory legacy row counts and retained holds, bindings, unknown sends and receipts without revealing credentials.
3. Take a fresh private mode0600 custom PostgreSQL backup for each approved target. Validate its restore inventory and SHA-256 before any SQL execution. Never publish backups or database URLs.
4. Execute only the approved unchanged file, once, with stop-on-error. Each artifact has its own transaction and target guard. Record definite outcome and catalogs before proceeding to the next file; an uncertain connection failure requires inspection, never an automatic migration retry.
5. Verify FORCE RLS, restricted-role privileges, immutable history, member/source guards and exact application/service separation. Verify existing historical data counts remain intact. A service-only 5446 catalog must contain no Acquire application objects.
6. Run the prepared actual PostgreSQL suites using synthetic DML and synthetic provider HTTP, with independent competing clients. Require every intended case to execute and pass; skipped tests are not evidence. Re-run applicable existing approved-schema regressions. Shared 5434 postchecks are recorded separately from isolated fixture proof.
7. Record hashes, backup evidence, schema/privilege checks, exact test counts, failures and remaining live limitations in progress.md. Keep runtime activation disabled until its separate configuration and owned-account validation are reviewable.

The eight prepared suites cover retirement15, tracking15, held application gates9, quota atomicity5, account/setup persistence4, all-channel history/checkpoints11, rolling/spacing policy4 and the two-database native service host4: **67 cases**. After specific approval/application of the prerequisites, run `COMMUNICATIONS_PENDING_POSTGRES_AUDIT=1 node scripts/test-communications-pending-postgres-local.mjs`. The runner verifies both existing targets and required schemas before any test child, sanitizes provider configuration and requires all67 cases with zero skips and stable source. Its six orchestration characterizations use a synthetic child/preflight, not PostgreSQL. The first actual67-case run executed every case with zero skips:16 passed /51 failed. A provider-spool trigger references a journal-only field on a generation row, blocking many cases; an application fixture also violates existing owner assignment constraints. These failures are retained and being corrected. See [runner handoff](pending-postgres-runner.md). Static SQL parsing and scripted-driver tests cannot prove database trigger order, RLS, deferred constraints or concurrency.

If execution fails, stop at the failed target and preserve history and diagnostic evidence. Inspect the committed schema and prepare a reviewed repair or backup restore; neither destructive down-migrations nor restoring a database over later data is automatically authorized. No automatic history cleanup, quota reset, account rebind or provider resend is part of recovery.

AGENTS.md requires: “Never run or apply a database migration without explicit user approval for that specific migration.” Approval is therefore required at this final stage despite the earlier authorization to build the code.

## Separately approved corrective migration

The first actual PostgreSQL run exposed a record-field planning defect in the applied006provider-spool trigger. User explicitly approved `ops/communications/standalone/008-provider-spool-record-guard.local.sql`, SHA-256 `bc674ae0ece1ff3a305b35d120848140021b0480dd0c420359ace96cd3de3b5f`, only for existing5446/system7696118996713136162. It committed once after a new validated backup and exact original-function/trigger checks. It nests the journal-specific field access under the table condition and preserves the original pending-evidence barrier. Function OID/owner/ACL/security/search path, trigger bindings, tables and all stored row counts are unchanged. The original eight approved artifacts remain byte-for-byte unchanged. Actual integration verification continues; second run43passes/24failures/zero skips.

## Final verification outcome — 2026-10-14

The separately approved008 repair also committed once; no approval or migration remains pending for this local stage. All67 new actual PostgreSQL cases and198 existing actual PostgreSQL regressions now pass with zero skips and stable source inventories. Earlier16/51,43/24 and63/4 runs remain failure history. Application3,998 passes/338 opt-in skips, independent OrbStack package1,534 passes, native9 passes, compilation/types/lint and production build pass. Shared5434/isolated5445 reviewed application catalogs match;5446 contains27 FORCE-RLS service tables and no application relations. Private backups, exact execution records and final reports are retained under `.local-data/communications/verification/`. Live-account parity, runtime activation and release remain separate. This final outcome supersedes the historical pending statements above; do not reapply any SQL.
