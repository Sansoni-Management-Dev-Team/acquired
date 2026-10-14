# Held send admission implementation evidence

P2.3/P4.1/P5, 2026-10-14. Code is implemented; new SQL is prepared and unapplied. This is not authorization to enable live sends. The user requested code and a combined end verification before migrations.

The application commits encrypted original campaign/draft intents before service dispatch. Both legacy and n8n campaign runtimes carry recorded attempt/enrollment/version/step metadata; enrollment freezes same-owner service bindings. Draft approval and explicit draft send are separate actions. Later defaults never substitute recorded work. Retry epochs append only after concrete authenticated original-journal no-submission evidence; unresolved work keeps its original key and bytes.

Configured service admission holds its tenant reply barrier, original physical lease/fence/current grant and the application organization gate/membership/source authority. It verifies original per-channel recipient coverage and outbound evidence, reserves account/application calendar hour/day quotas, and commits the private service admission ledger and journal CAS atomically. Provider dispatch is admitted only after definite application permit COMMIT. Both uncertain COMMIT responses preserve charged history and invoke no provider. The default journal remains delivery-disabled when the held authority configuration is absent.

Application projection uses the service repository's held `withCoverage` authority. Pending inbox/outbox/review work blocks projection. The service lock precedes the application gate; exact encrypted monitor/checkpoint projection calls same-transaction service revalidation immediately before application COMMIT. Existing review booleans have no fabricated clearance date: configured campaign review records an explicit DB-clock cutoff. Saved-draft edits/revocation remain serialized before admission and proposed SQL forbids approved-source mutation after an admitted permit.

Relevant earlier RED evidence is retained privately in `.local-data/communications/verification`: held-admission, service-quota, configured journal admission, original-binding, business-window, content-accessor/rejected-Promise, draft-coverage-binding, explicit-review-cutoff, per-channel-recipient, canonical-service-identity and configured-monitor branch logs. Recovery tests characterize actual encrypted codecs and scripted driver lifecycles; these do not prove database persistence.

The combined end batch passed **313 tests**, with **14 PostgreSQL cases skipped**, across 20 files. The service package build, root TypeScript check, scoped lint and diff whitespace check passed. End logs are private mode0600 (`send-admission-end-*`). No provider or new database schema was used by this batch.

Prepared real PostgreSQL tests cover application gate ordering/member removal/contact refresh contention, GUC-only rejection, child disposition/permit organization inference, retry refusal after admitted permit, admitted-draft immutability/materialization, actual intent cutoff behavior, concurrent global application quotas across accounts, repeated same-account UPSERT, full partial-charge rollback, immutable configured limits and restricted-role quota ACLs. They remain **unexecuted** until specific approval and application of their exact SQL prerequisites. Missing prerequisites are not a TDD RED.

Prepared artifacts:

| Artifact | Exact target | SHA-256 | Static evidence |
|---|---|---|---|
| `ops/communications/004-send-admission.local.sql` | existing loopback5445 `acquire_channels`, system `7694812678792806433` | `9968570f93ff145c137a2d9d165e6d663b28396d9609b36ef3eb8cc031eefb04` | 50 statements, 8 PL/pgSQL functions parsed |
| `ops/communications/standalone/005-send-admission.local.sql` | existing loopback5446 `communications_fixture`, system `7696118996713136162` | `6d6179fe4f27359dfbe3f6acaa535741036e1d589c9dafaff28323b37c58710c` | 26 statements, 3 PL/pgSQL functions parsed |

Static parsing does not prove RLS, trigger order or lock semantics. Exact SQL approval, backups/preflight, application and competing-client tests remain final-stage work. Pending standalone retirement/tracking/runtime/history artifacts are separate prerequisites and are not implicitly approved here. Deployment login grants, remote parity, full hosted/provider verification and live owned-account sends are not claimed. No history deletion, quota reset, legacy decommission or automatic migration occurs.
