# Research correctness implementation and verification

All 18 RCA fixes are implemented in the local working tree. The register records 54 scoped regression, generalization and integration scenarios with executable test references and reviewed local artifacts. No changes have been deployed.

| Record | Purpose |
| --- | --- |
| [Fix register](research-correctness/fix-register.json) | Incident evidence, dependencies, decisions, actual local verification and remaining limitations |
| [Acceptance scenarios](research-correctness/acceptance-scenarios.json) | Three scoped proof obligations per finding, matching tested assertions |
| [Verification and evidence](research-correctness/verification/README.md) | Results, exact boundary distinctions, investigation limits and local database safety incident |
| [Architecture contracts](research-correctness/architecture.md) | Shared evidence, admission, lifecycle and completeness rules |
| [Completeness catalogue](research-correctness/completeness-catalogue.json) | 53 company/datapoint coverage fields |
| [Decision register](research-correctness/decisions.json) | Explicit engineering defaults under authorized implementation, not individually selected user defaults |
| [Test procedure](research-correctness/testing.md) | Reproduction, integration and release separation |

The original incident is retained in the register. Historical source line numbers are investigation pointers, not immutable code references. Provider payloads, personal contact values and private database backups are excluded from committed evidence.

The earlier A9 mandate has a read-only completeness audit and 92-company report. The initial screenshot investigation is bounded: its run/error cannot be attributed reliably. Historical callback 502 is confirmed downstream but its underlying failure remains unproved. These limitations remain explicit even though the investigation intake records are closed.

For missing provider fields and manual diligence, verification means accurate classification, scope and provenance; it does not mean every field is populated. Scenario specifications were narrowed where initial dimensions were broader than actual tests. Financial freshness and configurable HQ-only criteria remain unimplemented; synthetic identity-handler persistence is distinguished from actual PostgreSQL scoped-diligence and contact tests.

Run `node scripts/validate-research-correctness-plan.mjs --require-verified` and `node --test scripts/validate-research-correctness-plan.selftest.mjs` to validate the recorded evidence and rejection rules. A passing evidence gate verifies traceability only. It does not execute application tests, approve a release or prove production rollout. See the linked artifacts for actual results and limitations.

Reuse the [integration harness](35-research-orbstack-integration-tests.md), [performance ledger](36-research-performance-completion-plan.md) and [benchmark contract](research-benchmark-capture-contract.md) for separately authorized rollout validation. Never run a migration without explicit approval for that specific migration. An earlier unintended local backfill test and its exact restoration are disclosed in the verification record; ordinary verification now skips that migration case and uses SAVEPOINT isolation.
