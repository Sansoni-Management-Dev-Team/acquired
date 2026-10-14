# Production communications schema proposal

**Prepared, unapproved and unapplied.** No runtime, image or compose startup runs
these SQL files. They are separate production artifacts; local migration approvals
do not authorize them.

Proposed target: existing host `acquire-app-01` (`134.199.155.67`), a new private
PostgreSQL cluster/database `acquire_communications`, operator
`communications_admin`, persistent storage and no published database port.
Creating/initializing that container and volume requires specific approval before
it starts. The application database is excluded from these eight files.

`manifest.json` records each complete production SHA-256, original reviewed source
SHA-256 and unchanged migration-body SHA-256. Each file preserves all bytes after
the original prerequisite guard. The guard is adapted to production database,
operator and fresh cluster attestation; production adds an independent guard.
Migration 008 also verifies that the existing trigger function belongs to the
production operator, rather than the original local fixture owner.

Every execution session must carry both exact settings:

- `acquire.deployment_target`: `acquire-app-01/acquire_communications`.
- `acquire.expected_system_identifier`: the newly inspected, independently reviewed
  production PostgreSQL system identifier, after approved cluster initialization.

Missing, malformed, incorrect or mismatched settings abort the transaction. These
are session settings, not placeholders interpolated into SQL. No local system
identifier is accepted as a hard-coded alternative. The actual production system
identifier is currently unknown (`null` in the manifest), so these artifacts are
not yet an executable target approval request.

001 additionally requires an absent communications namespace, absent restricted
service roles and no public application relations. Later files retain original
prerequisite, FORCE-RLS and unapplied checks. Apply in numerical order only after
exact file/hash/target approval, private backup verification and fresh target
inspection. An operator login's restricted-role memberships and runtime credentials
must be reviewed separately; no runtime login or provider account is created here.

These files do not import local account metadata, connect providers, enable send
capacity or backfill application history. Migration 008 preserves the approved
pending-evidence barrier while fixing trigger record-field evaluation order.
Read-only source/guard/hash checks run with:

```sh
node --test scripts/communications-production-database.test.mjs
```

Those tests verify review artifacts only. They do not execute SQL, create a
PostgreSQL cluster or establish production schema correctness.
