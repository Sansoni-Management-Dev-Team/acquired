# Shared application-only migration review artifacts

**UNAPPROVED / UNAPPLIED.** Prepared code only. The user requested all code first and migrations at the end. These files have no automatic startup, bootstrap, runner or application hook. No new database is initialized and no schema/data change has been executed.

These are **application-only** artifacts for the existing owned OrbStack `project-acquire-postgres` container, sole `127.0.0.1:5434`, database/operator `project_acquire`, system identifier `7680143844628185121`. A read-only catalog audit confirmed its application communication bindings/checkpoints/intents are absent, existing `acquire_campaign_user`/`acquire_campaign_worker` roles are restricted and the `communications` service schema is absent. Neither artifact installs service tables, functions, roles, grants, queues, accounts or provider credentials.

The proposed order is `001-app-prerequisites.local.sql`, then `002-send-admission.local.sql`. Each requires its own explicit file/hash/target approval at the final migration stage. The first preserves the full application binding ownership/RLS/immutable history from reviewed app002 and only the PUBLIC receipt fingerprint/checkpoint/review/member-lock portions of approved combined003. It creates nine new FORCE RLS application tables and no default/connection/history backfill. Legacy foreign-key references remain historical provenance; executable legacy connection logic remains in the independent legacy repository.

The second deliberately preserves the frozen isolated app004 admission body; only its target guard/header changes. It adds application gate/writer serialization, encrypted immutable intent/epoch/permit ledgers, explicit review cutoffs and admitted-draft mutation guards. Its one singleton insertion initializes a newly created fence table; it does not clear holds, rewrite recorded work, select defaults or activate providers.

Frozen source artifacts (separate specific approvals still required):

| File | SHA-256 | Static parse |
|---|---|---|
| `001-app-prerequisites.local.sql` | `a4b9a27dc2808eea1f2bbba163772e4c04d4fd400099d552837045a00b49774e` | 92 statements, 5 PL/pgSQL functions |
| `002-send-admission.local.sql` | `67e1891d47d67583e01803fd2fd3ac4b77f79c6964734af9903ca0fa915125d5` | 50 statements, 8 PL/pgSQL functions |

`source-manifest.json` records unchanged source hashes, exact target and artifact hashes. Static ownership tests were authored before artifact construction and passed in the root combined batch. They validate unchanged approved source bodies, exact target isolation and manifests; they do not execute SQL or prove PostgreSQL behavior.

Targets are distinct:

| Target | Exact database identity | Artifacts |
|---|---|---|
| Shared application, `127.0.0.1:5434` | `project_acquire`, `7680143844628185121` | this directory, pending separate approval |
| Existing combined isolated fixture, `127.0.0.1:5445` | `acquire_channels`, `7694812678792806433` | original reviewed app002/combined003 and new isolated app004; originals are unchanged |
| Separate service fixture, `127.0.0.1:5446` | `communications_fixture`, `7696118996713136162` | standalone service artifacts only, never copied into the application database |

Before any eventual approved execution, independently attest container ownership/loopback port/database/system identity/operator, verify exact frozen hashes, take a fresh private mode0600 custom PostgreSQL backup and validate its restore inventory/hash, check required app relations/keys/restricted roles and absence of partial new objects/service schema. Execute only the specifically approved file once with `ON_ERROR_STOP`. Then verify application RLS/role ACLs/immutability/member and statement fences without creating provider connections, and run specifically authorized synthetic DML tests with retained history. An existing isolated5445 proof does not prove the shared5434 execution or parity.

Source-time preservation manifests and static tests compare the approved originals and PUBLIC-only statement bodies. Read-only SQL parsing cannot prove target locks, RLS, foreign keys, grants or concurrency. New shared execution and application-only real PostgreSQL proof remain unperformed. No runtime derivation, migration retry, service schema copy, live provider send or remote deployment is authorized here.
