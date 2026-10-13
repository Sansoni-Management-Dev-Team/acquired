# Standalone service database review

This is a proposed second isolated fixture, independent of Acquire's application tables. **Neither startup nor these migrations is approved or executed.** Existing isolated5445 and shared5434 approvals do not authorize this new database.

Exact proposed target: owned OrbStack `127.0.0.1:5446/communications_fixture`, container `acquire-communications-standalone-postgres-1`, label `acquire.fixture=communications-standalone`. Compose pins the existing PostgreSQL17 image digest, fixes database/user names, binds loopback only, and uses a dedicated ignored data directory. Its private ignored `standalone.env` contains fixture credentials only; do not print it or substitute live credentials.

| Artifact | SHA-256 | Scope |
| --- | --- | --- |
| `001-service-storage.local.sql` | `cedeedde1b873a943af4566af78faf184da56e3d68de7d7bb8a2d69b9127c2d0` | Original approved service001 body; new standalone target/empty-public guard |
| `002-reply-barrier.local.sql` | `3d2423f632f1e36fdffda5eeb803f5b5f6c32950f8a6f649abfdc4f6e6a2cbae` | Exact service-only portions of original approved003; no Acquire fingerprint/member/checkpoint/policy objects |

Static review parsed102+48 SQL statements and18 PL/pgSQL units. The original approved001/002/003 files remain unchanged. The public-footprint guards reject regular/partitioned/foreign tables, views and materialized views. Static parsing and copy comparison do not establish runtime permissions or readiness.

The requested approval must cover initializing this new empty fixture database and applying these exact two artifacts to this exact target. Only after that approval: verify the port is free, the dedicated data directory has no unreviewed prior cluster, and the image/Compose/file hashes match; start only this labelled PostgreSQL service; record its new database system identifier and verify the external loopback connection matches. Take and validate a fresh custom-format backup before applying SQL. Execute each unchanged artifact with `psql -X -v ON_ERROR_STOP=1` against the owned container and verify FORCE RLS, roles, privileges and absence of Acquire application objects afterward. No SQL file or initialization directory is mounted by Compose; startup never invokes either migration.

The prepared `COMMUNICATIONS_STANDALONE_AUDIT=1 node scripts/communications-standalone-db-proof.mjs` proof is separate from startup/migration execution. It will load the independently built package after validating source and compiled hashes, inject a standard PostgreSQL driver, and exercise synthetic three-channel durable claims and reply/event/outbox delivery without Acquire tables. It must fail on missing prerequisites rather than create them. That proof remains unexecuted until specific approval and verified application.

This does not enable sending, certify fresh provider coverage, publish a repository, or complete extraction of the legacy WhatsApp/LinkedIn/Gmail runtimes. New journal admission remains disabled; the independent application receipt in this proof is synthetic and does not replace Acquire's real policy transaction tests.
