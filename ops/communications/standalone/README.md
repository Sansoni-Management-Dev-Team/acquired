# Standalone service database review

This is the specifically approved and initialized isolated fixture, independent of Acquire's application tables. Both exact SQL artifacts below were applied once after target/hash checks and a fresh validated backup. Existing approvals did not authorize this target; the user subsequently explicitly approved its initialization and these two migrations. No automatic migration runs on startup.

Exact approved target: owned OrbStack `127.0.0.1:5446/communications_fixture`, container `acquire-communications-standalone-postgres-1`, label `acquire.fixture=communications-standalone`. Compose pins the existing PostgreSQL17 image digest, fixes database/user names, binds loopback only, and uses a dedicated ignored data directory. Its private ignored `standalone.env` contains fixture credentials only; do not print it or substitute live credentials.

| Artifact | SHA-256 | Scope |
| --- | --- | --- |
| `001-service-storage.local.sql` | `cedeedde1b873a943af4566af78faf184da56e3d68de7d7bb8a2d69b9127c2d0` | Original approved service001 body; new standalone target/empty-public guard |
| `002-reply-barrier.local.sql` | `3d2423f632f1e36fdffda5eeb803f5b5f6c32950f8a6f649abfdc4f6e6a2cbae` | Exact service-only portions of original approved003; no Acquire fingerprint/member/checkpoint/policy objects |

Static review parsed102+48 SQL statements and18 PL/pgSQL units. The original approved001/002/003 files remain unchanged. The public-footprint guards reject regular/partitioned/foreign tables, views and materialized views. Static parsing and copy comparison do not establish runtime permissions or readiness.

Execution evidence: PostgreSQL17 system identifier `7696118996713136162`; private `communications-approved-standalone-execution.json` records the exact Compose/hash/image checks, fresh custom-format backup validation and sequential SQL execution. Postchecks verified16 FORCE-RLS service tables,17 invoker functions, no PUBLIC execution/DELETE grants, no public application objects or Acquire roles, and no cross-schema foreign keys. The original approved SQL bytes remain unchanged. Do not reapply them.

`COMMUNICATIONS_STANDALONE_AUDIT=1 node scripts/communications-standalone-db-proof.mjs` now passes against this existing database with independently installed copied modules, source/compiled/lock hashes and an injected standard PostgreSQL driver. All three channels exercise encrypted disabled-journal replay and capture/event/outbox persistence, followed by a **synthetic memory application receipt** committed before ACK. Test connections are retired, grants revoked and durable history retained. The proof fails on missing prerequisites; it never initializes a cluster or applies SQL.

A current-source proof rerun on14 October restarted only this existing fixture after validating its nonempty17 cluster, exact system identifier and unchanged approved artifacts/backup. No initialization or migration occurred. Private `legacy-extraction-standalone-recovery.json` and `standalone-db-proof.json` record the result.

This does not enable sending, certify fresh provider coverage, publish a repository, or certify the independent legacy WhatsApp database. Legacy source extraction is recorded separately in [the handoff](../../../docs/communications/legacy-extraction.md). New journal admission remains disabled; the independent application receipt in this proof is synthetic and does not replace Acquire's real policy transaction tests.

## New reviewed storage artifacts awaiting specific approval

The existing001/002 approval/application does not authorize the following new files.
Both target only this existing5446 database/system identifier and are unapplied.

| Artifact | SHA-256 | Scope |
| --- | --- | --- |
| `003-connection-retirement.local.sql` | `2448ee14577f97a6d17e3c307fe376c4d44dfb204f0a94a83b652fb56a905dde` | Durable encrypted retirement intent, exclusive physical-account fences and deferred grant guard |
| `004-email-tracking.local.sql` | `71fa73939d98509d7c28da4d8f8fa0efe550f74fd5a6b134b230747cd4900edc` | Append-only encrypted ACK/verified sent association and deferred scope/identity guard |

See [retirement design](../../../docs/communications/connection-retirement-design.md) and
[tracking TDD](../../../docs/communications/email-tracking-tdd.md) for reviewed code/tests
and execution checks. Before authorized execution, check exact target/system ID, labels,
image, roles, baseline FORCE-RLS tables, absent new objects and artifact hashes; take and
validate a fresh custom-format private backup. Apply each unchanged artifact once,003
then004, and independently verify catalog/privileges/trigger definitions afterward.
There is no new cluster startup or migration hook.

The prepared `COMMUNICATIONS_STANDALONE_LIFECYCLE_AUDIT=1 node scripts/test-communications-standalone-lifecycle-local.mjs`
requires all30 actual PostgreSQL cases, zero skips and stable source fingerprints.
It does not start a container or apply SQL. Those cases remain unexecuted until specific
approval/application. The original three-channel service proof after both schemas is
`COMMUNICATIONS_STANDALONE_AUDIT=1 COMMUNICATIONS_STANDALONE_LIFECYCLE_SCHEMA=1 node scripts/communications-standalone-db-proof.mjs`;
its explicit schema mode requires19 named FORCE-RLS tables and still uses synthetic
memory application receipts. Sending and full runtime integration remain disabled.
