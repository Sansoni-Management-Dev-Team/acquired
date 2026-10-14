# Production communications migration review

Prepared 2026-10-14 from read-only production inspection. **Every production SQL artifact below is unapproved and unapplied.** Local approvals do not authorize execution on production. Publishing application or service images is not authorization to apply these migrations.

## Application database

The reviewed application target is Supabase project `njasjqpztiteionfxxul`, `aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`, operator `postgres`, PostgreSQL17, system identifier `7678071634733212629`. The session authenticated using the existing ignored credential files and the configured Supabase certificate authority; the client connection was TLS1.3, encrypted and certificate-authorized. The pooler's upstream backend reports `pg_stat_ssl.ssl=false`; that describes the pooler-to-database connection, not the verified client-to-pooler TLS connection.

Only catalog, role, privilege and migration-ledger reads were performed inside read-only transactions. No application rows, secrets or provider account contents were read for this review. Private evidence is under `.local-data/communications/production-review/`, mode0600; credentials and certificate values are excluded from this document and tracked artifacts.

### Existing prerequisites: do not reapply

- `drizzle/0012_campaign_rls_roles.sql`, `0017_channel_optional_people.sql` and `0018_whatsapp_delivery_journal.sql` each have their exact current source SHA-256 recorded in the production Drizzle ledger. There are17 ledger entries; this review does not infer completeness of every other migration solely from that count.
- `acquire_campaign_user` and `acquire_campaign_worker` already exist with NOLOGIN, NOSUPERUSER and NOBYPASSRLS. The reviewed `postgres` operator has membership in both and CREATE on public. Existing restricted-role policies and privileges were captured privately.
- `public.whatsapp_delivery_actions` already exists with its eight expected columns, composite primary key, connection foreign key, four checks, capacity index and enabled RLS. **0018 is not a missing production prerequisite and must not be executed again.**
- Existing composite unique indexes on mailbox owner and enrolment owner support the new binding foreign keys. The exact journal/role/index/column catalog evidence was inspected; no schema changes were needed to establish these prerequisites.
- The application database has48 public relations and no `communications` service schema. New application bindings/admission tables and the new `acquire_communications_writer` role are absent. Service storage belongs in the separately reviewed service database.

### Proposed exact application artifacts

Apply neither file without a fresh backup, repeated target/precondition review and explicit user approval of that file, hash and production target. Required order is001, then002.

| Order | Production review artifact | SHA-256 | Intended change |
| --- | --- | --- | --- |
| 1 | [001-app-prerequisites.production.sql](../../ops/communications/production/application/001-app-prerequisites.production.sql) | `51f97c4c1c0ed75fa63ae5ba0c998a4f05f3b4cbebe0b5f2dada00f5e4488b6e` | Nine application binding/reply/checkpoint tables, immutable ownership and member fences, FORCE-RLS policies and restricted grants |
| 2 | [002-send-admission.production.sql](../../ops/communications/production/application/002-send-admission.production.sql) | `918781025751d540efeb3ec57fcbe3eaa5f818e357a6907304a75398473ee06d` | Five admission/gate/permit/resolution tables, one restricted NOLOGIN writer role and its operator membership, review timestamp, held-writer and member trigger fences |

The DDL/DML body of001, starting at `-- Immutable exact service binding snapshots;`, is byte-for-byte identical to `ops/communications/application-shared/001-app-prerequisites.local.sql`. The body of002, starting at `CREATE ROLE acquire_communications_writer`, is byte-for-byte identical to its corresponding local shared source. Only review headers and target preflight guards differ. Source/body/file hashes and boundaries are recorded in [the application manifest](../../ops/communications/production/application/manifest.json).

Both artifacts require the exact production database, operator and system identifier. They also pin a prerequisite-column fingerprint, MD5 `1c31fc217ecc81f0d94f6dda189bb16f`, across the17 existing prerequisite tables listed in the manifest. Those columns are unchanged by001, so the same baseline guard is applicable before002. Original absent-new-object checks and restricted-role checks remain. The broader private catalog SHA-256 is `71e1c0cd82deb18e937006e8e1845db37ef0e3a71cd8243708a84d1a9cb230e2`; that digest is review evidence, not an assertion that the SQL guard detects every possible concurrent privilege, policy or index change.

### Validation and execution boundaries

- Body equality and all generated file/body hashes were verified locally. Read-only SELECT equivalents of the production target, baseline fingerprint, restricted-role and unapplied-object guards passed against the reviewed production database. The migration DO blocks and DDL bodies have **not** been executed in production, including inside a rolled-back transaction.
- The preserved bodies were previously exercised against the specifically approved local databases. This is supporting evidence, not postmigration production proof. Production execution must recheck indexes, policy/role metadata, backups and connection ownership immediately before using these frozen files.
- 001/002 create14 new FORCE-RLS application tables in total. They install triggers and role grants that affect existing application writes. Coordinate application compatibility and cutover before execution; a previous application build that does not acquire the new writer gates may be rejected by the new fences. Do not enable the communications runtime until both database sides, credentials, host configuration and account ownership are verified.
- No historical account, default, campaign binding, message, receipt or unresolved attempt is backfilled, reauthorized or deleted by these artifacts. An existing campaign is not silently reassigned to a new provider. The new member-fence singleton is internal migration state, not a historical account backfill.
- These are explicit transaction-wrapped operations; no startup/bootstrap/migrate-on-deploy path should invoke them. A failed guard must stop execution for fresh review. Do not weaken RLS, ignore partial objects, or change a frozen artifact after approval without obtaining specific approval for the replacement hash.
- After any separately approved execution, verify new object counts, FORCE-RLS flags, role attributes/memberships, policies, trigger/function ownership and retained baseline records. Run bounded synthetic integration checks with the final deployment composition before live activation. No such production verification is claimed here.

## Service database

The independent service database and its SQL approvals are separate from the application target above. Its provisioning and exact artifacts must be reviewed and recorded independently before the complete rollout can proceed.

## Separate production communications storage proposal

Prepared, **unapproved and unapplied**. No new production database container or
volume has been initialized, and no service SQL has been executed. These approvals
are separate from application SQL and all earlier local approvals.

| Property | Proposed exact target |
| --- | --- |
| Existing host | `134.199.155.67`, `acquire-app-01` |
| Database | `acquire_communications` in a new isolated PostgreSQL cluster |
| Operator | `communications_admin` |
| Persistent volume | `acquire_communications_production_pgdata` |
| Network | Existing `acquire-app_default`; alias `acquire-communications-db`; no published PostgreSQL port |
| Deployment marker | `acquire-app-01/acquire_communications` |
| System identifier | Unknown until separately approved cluster initialization and fresh inspection |

Explicit approval must cover initialization of this exact new volume/container and each listed file/hash on that target. After approved initialization, independently inspect and record the fresh cluster system identifier before setting the mandatory guard; a different existing volume, database or host is not covered. Guard settings are `acquire.deployment_target` and `acquire.expected_system_identifier`; neither a missing setting nor the original local fixture target can satisfy these artifacts.

| Artifact | SHA-256 |
| --- | --- |
| [001-service-storage.production.sql](../../ops/communications/production/database/001-service-storage.production.sql) | `b7277200f89cf8acaa66b6af060e812d520654a730ad2b8f989cc42b14571e2b` |
| [002-reply-barrier.production.sql](../../ops/communications/production/database/002-reply-barrier.production.sql) | `eaf9850e3433be03c94ce194e0d83eebc14a0939a4405b5ea5e54e16157ec1fb` |
| [003-connection-retirement.production.sql](../../ops/communications/production/database/003-connection-retirement.production.sql) | `d93d499b094e1a03a06b5a89bf67d94a272d9858241e25ff3faa191004757939` |
| [004-email-tracking.production.sql](../../ops/communications/production/database/004-email-tracking.production.sql) | `03695569f5b4a65d0e268473583b915ed57d4f33136120618341ff38888c91cb` |
| [005-send-admission.production.sql](../../ops/communications/production/database/005-send-admission.production.sql) | `70f7b1db8d9078b264747ef8cd113755e09375b87656b2f99e3b98ccfae81dfa` |
| [006-account-runtime.production.sql](../../ops/communications/production/database/006-account-runtime.production.sql) | `e9b8279d1bb69bf1777a138d4a41f24dfbf68dde1c7674de574518688f583d9e` |
| [007-history-checkpoints.production.sql](../../ops/communications/production/database/007-history-checkpoints.production.sql) | `28a862f538573f9ba9c47b3e0886e7e4976f241d0f5e324a6fb4da1366e70611` |
| [008-provider-spool-record-guard.production.sql](../../ops/communications/production/database/008-provider-spool-record-guard.production.sql) | `2fcfda8f11866335f7194742f1f5cdebf1fd3f849dc92ea87072175b1c78649e` |

Bootstrap review files (not SQL authorization):

| Artifact | SHA-256 |
| --- | --- |
| [compose.production.yml](../../ops/communications/production/database/compose.production.yml) | `fc6118db00f358c80344986902488994d89d0365287cfc826ef290742c42e492` |
| [env.production.example](../../ops/communications/production/database/env.production.example) | `c193dcb4a68f80001f61f50dacf4284d1ef48b6254824d0f16835510fefbb872` |
| [manifest.json](../../ops/communications/production/database/manifest.json) | `985d3c60bc37746580cc04bc1a7a4e8e71393138defbfe21d02560308bfc7320` |

All original service DDL, trigger/function bodies, policies and privileges after
the original prerequisite block are byte-preserved. The production prerequisite
checks retain the original guards, adapt database/operator/cluster identity and add
an independent exact production target guard. 001 requires empty public relations
and absent communications schema/roles. 008 checks the original function body,
security, owner and trigger bindings before its narrow repair. Original local SQL
artifacts are unchanged. The manifest separately records original-source and body
hashes. Two source/hash/guard tests passed without executing SQL.

The proposed service memory cap is 384 MiB and database cap is 256 MiB, alongside
the unchanged application cap. These limits are configuration proposals; peak
production workload capacity has not been established. Send quotas remain zero
during preflight, and local account/key material will not be imported implicitly.

## Approved execution status — 2026-10-14

The user specifically approved this proposal. Both application files and all eight
service files committed once on the exact reviewed production targets. The new
service cluster identity and per-file outcomes are retained in the ignored private
execution journal; do not reapply these files. Application14/14 and service27/27
FORCE-RLS table checks pass, and all48 pre-existing application table counts match
the coordinated maintenance baseline. Runtime activation and final release checks
are recorded in progress.md. This execution status supersedes the earlier pending
approval status without changing any frozen SQL artifact or hash.
