# Specific local migration approval request: 0032

Status: the user specifically approved the exact SHA256 below, and the root agent applied it unchanged to the isolated local database. Application receipt: `.local-data/agent-mode-orbstack/0032-approved-apply.json`. No main/shared/production database was migrated. Migrations0027/0028/0030/0031 were separately approved and applied beforehand.

Only target: database `acquire_agent_mode`, loopback port 5437, marker `acquire-agent-mode-local-only`. No main/shared/production database, live sending, runtime flag change or deployment.

Artifact: [0032-agent-sequence-audit.sql](../ops/agent-mode/migrations/0032-agent-sequence-audit.sql)

SHA256: `9d5e9e2f6c86d31745c20148566574545b5ac4cd9eccf221ac2c4d4c7522a2c0`

The approved-schema PostgreSQL acceptance run found that sequence draft saves cannot insert their required audit event. The transaction fails closed with `permission denied for table audit_events`; draft and receipt writes roll back. Publication/enrolment acceptance currently stops at this prerequisite. Existing native stores have domain-specific audit functions, with no suitable generic audit capability to reuse.

The migration adds one narrow function, `agent_audit_completed_sequence(uuid)`. It requires current membership and the held organisation gate, an owned completed native draft/publication operation, the exact approved review manifest, and its matching owned sequence/version receipt. The function derives the audit action, entity and metadata from the persisted receipt, and deduplicates replay under the organisation gate. It grants no direct audit table access, no sending permission and no campaign advancement capability. Sequence save/publication code calls it in the same transaction as the receipt, chat notice and outbox.

Pre-application evidence, under `.local-data/agent-mode-orbstack/`:

- `agent-sequence-draft-applied-pg.log`: actual approved-schema run, **1/3 passed, 2 failed** at the audit insert.
- `agent-sequence-execution-applied-pg.log`: actual approved-schema run, **1/10 passed, 9 failed** during draft setup at the audit insert; these are prerequisite failures, not passing publication/enrolment tests.
- SQL and PL/pgSQL parsers accept the exact frozen 0032 artifact.
- New acceptance cases were prepared for positive derived audit, rejection of unreviewed/unknown operation IDs, exact receipt replay without duplicate audit events, no broad audit grant, and atomic rollback/recovery after the final outbox fails. The post-application results below supersede that earlier verification gate.

The root agent applied only this specifically approved artifact using the marker- and predecessor-hash-checking runner:

```sh
node scripts/migrate-agent-mode-local.mjs --apply-isolated-local --migration=0032-agent-sequence-audit.sql
```

Post-application scoped PostgreSQL suite commands: `RUN_AGENT_SEQUENCE_LOCAL_INTEGRATION=true` for the five draft/audit cases, and `RUN_AGENT_SEQUENCE_EXECUTION_LOCAL_INTEGRATION=true` for the ten publication/enrolment cases. Each suite uses a synthetic tenant and cleans its fixtures. Provider operations use synthetic ports; these suites do not contact n8n, email recipients or paid AI providers. Record any further failure before declaring the work complete. Previously applied SQL files remain unchanged.


## Post-application verification

- `agent-sequence-draft-audit32-pg.log`: **5/5 passed, zero skipped** on real isolated PostgreSQL. Verifies draft compatibility/current revision checks, exact save replay, derived audit scope and deduplication, no direct audit table grant, and atomic draft/receipt/audit/chat/outbox rollback and recovery.
- `agent-sequence-execution-audit32-pg.log`: the first run passed **6/10** and exposed a strict server adapter mismatch: cached target selections carry `targetId`, while the minimal enrolment schema intentionally rejects extra fields. The adapter now explicitly copies the allowed reviewed enrolment fields without weakening the schema. A membership test also now accepts the correct earlier authenticated-scope rejection rather than requiring one particular error message.
- `agent-sequence-execution-audit32-second-pg.log`: **10/10 passed, zero skipped**, after those code/test corrections. Covers immutable legacy publication/replay, accepted creation and activation with lost responses, fresh-store original receipt reconciliation without duplicate provider writes, stale source/configuration/owner rejection, original account/version/runtime held enrolment, changed-contact isolation, actual interruption after one committed enrolment followed by recovery without duplicates, and no broad enrolment advancement privilege.
- Both suites completed their synthetic tenant cleanup transactions successfully. No runtime flags were changed. Provider effects in these suites use synthetic ports: no n8n HTTP, email or paid AI calls were made.
- The applied0032 SHA256 remains `9d5e9e2f6c86d31745c20148566574545b5ac4cd9eccf221ac2c4d4c7522a2c0`; no applied SQL artifact was edited.
