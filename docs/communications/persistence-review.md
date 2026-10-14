# Independent provisional persistence review

**Current execution update:** The exact reviewed local schemas 001/002 below were subsequently specifically approved and applied to isolated OrbStack, with backup/target/hash/RLS verification and actual service PostgreSQL tests. The review-time wording below records the earlier state. See [durable replies evidence](durable-replies-tdd.md) and [progress](progress.md). Separate 003 is unapproved/unapplied; no production/backfill activation is implied.


Reviewed 2026-10-12. This is a static review of the prepared SQL and design. **No SQL statement, migration, schema change or rollback rehearsal was executed.** Database/runtime isolation and concurrency remain unverified. These artifacts are not approved for execution.

Initial reviewed artifacts:

- `communications/migrations/001-service-storage.local.sql`, initial SHA256 `e9aa7d13f98369d7dc76dc085838360ea7e77172745b137d2cd5ed3ad1081b8b`.
- `ops/communications/002-acquire-bindings.local.sql`, initial SHA256 `c9d33b1eec589d080c11c00b65811be9f41dedf15967518ea18b8b7a28be52a0`.
- `docs/communications/persistence-design.md`, initial SHA256 `ad1541dcd318f01ead5d56df51a701f26e06674544b46ab96ce3538bc50fa884`.

The parity agent is correcting the provisional artifacts concurrently. These hashes identify the first reviewed versions, not final approval targets. Any changed artifact needs its current hash in the eventual approval request.

## Findings sent to parent and parity agent

| ID | Concrete gap | Required correction / proof |
| --- | --- | --- |
| R01 | Journal INSERT can reference a historical generation after retirement. The retirement trigger's pending-operation EXISTS check can race a concurrent claim. Proposed admission locks only the physical account, while retiring `active=false` does not lock that account. | Admission and claimed→dispatching must lock the exact connection row, validate active/current generation/grant, and use the same serialization boundary as retirement/account change. Agree a fixed lock order for connection/account/journal/quota. Scoped role currently cannot lock connections FOR UPDATE with SELECT-only grant; use reviewed control/admission routines rather than granting arbitrary lifecycle UPDATE. |
| R02 | Journal claim/fencing metadata can change while dispatching, with no account-lease/current-generation/quota checks. An expired claimant could write a terminal result after a newer lease owner. | Control-only mutations; fenced conditional transitions and nonempty claim metadata. Once dispatch admission occurs, freeze its original claim/fence. Late results require append/reconciliation evidence and must never authorize dispatch again. Account/application quota reservation must be charged exactly once in the same transaction; table shape alone cannot prove it. |
| R03 | A submitted row can replace its accepted encrypted receipt or lower delivered/read timestamps while retaining the same state. | Preserve the accepted receipt/reference and monotonic observation facts. Separate append-only receipt/event enrichment from changing the accepted operation. Reject replacing a known receipt or regressing nonnull source observations. |
| R04 | Service `event_cursors` and Acquire `communication_reply_monitors` can UPDATE their connection/generation/binding/scope keys to another valid binding while retaining old complete history. | Immutable scope/binding/account keys on UPDATE; a new binding must create a new initially invalidated monitor. Generation invalidation may change coverage flags but cannot move an old cursor to another generation. |
| R05 | Reconnect auth FK verifies owner scope and generation, but not requested channel/platform/backend. An email setup state can reference a WhatsApp generation owned by the same user. | Extend the exact generation unique/FK tuple or add a trusted insert check for channel/platform/backend. Keep setup ownership/expiry/consumption immutable. Callback must still verify actual provider products/account; this FK is supplemental. |
| R06 | Events use an identity bigint and scan index. IDs are allocated before commit; concurrent commit order can differ. A consumer advancing to a higher committed ID can permanently miss a later-committed lower ID. | Do not describe IDs as a commit-order cursor. Use durable pending outbox/deduped acknowledgements, or serialize allocation+commit against an explicitly locked stream/checkpoint. Add a delayed-commit integration case before making completeness claims. |
| R07 | The local database-name guard cannot establish OrbStack host/port/context. The same database name could exist elsewhere. | The approved operator/runner must verify Docker context and private allowlisted host/port/database plus exact artifact hash. SQL remains unapplied; a provisional file's comment is not destination proof. |

The parity agent acknowledged R01–R06 and is preparing improvements. R02 quota admission and R06 event commit ordering are explicitly repository/integration responsibilities, not facts proved by DDL. The design correctly labels those as unfinished. Remaining gaps must stay activation/verification blockers until the actual code and isolated concurrent tests exist.

## Properties supported by static inspection

- Standalone service SQL references only its own schema; it introduces no Acquire/Better Auth/member/campaign table dependency. Independent deployment still needs its own target/configuration validation.
- Channel/platform/backend are separate, with valid tuple checks. Generations are immutable and retain prior account ownership for historical recovery; current-generation FK is deferred to support atomic creation.
- Scope contains application, tenant and owner. Composite generation/event FKs prevent a row from naming another tenant/account while keeping its original scope. The physical-account active unique index conservatively rejects simultaneous bindings across backends/workspaces.
- Service RLS enables and forces row security. The access grant's own SELECT policy uses direct scope/expiry checks; `scope_authorized` consults that table without recursively invoking itself. Control-only global policies are deliberately restricted to the internal role. Actual PostgreSQL role/permission behavior still requires runtime verification.
- Acquire binding/attempt/enrolment/default FKs include owner/org/channel where required. Existing `mailbox_connection_owner_fk_idx` and `campaign_enrolment_owner_fk_idx` are present in prior migration definitions; added WhatsApp/attempt/message unique shapes supply the proposed references.
- Defaults are mutable selectors; recorded work bindings are immutable. No automatic backfill, default selection, credential relocation, journal cleanup or hold deletion occurs.
- Historical attempts with missing trustworthy payload digests are recovery-only; no inference from current defaults is specified. First-time legacy draft-owner attribution remains a backfill/application evidence requirement because the old message table has no independent sender-owner column.
- Retention, key rotation, legacy-account inventory and actual quota/lease handoff are expressly unfinished. Identity-digest key rotation needs a compatibility procedure to preserve stable physical-account identity and avoid duplicate quota pools.

## Required future verification

After separately approved exact local migrations and repository implementation, test forbidden/revoked scopes, historical-generation admission, concurrent claim/retire, expired lease/fence writes, same-key concurrent reservation, changed content/account replay, checkpoint rebinding, mismatched reconnect channel, late lower-ID event commits, draft ownership recovery and rollback preserving accepted/unknown work and existing holds. Mock tests or successful SQL parsing cannot substitute for these cases.

## Revised-artifact follow-up

Statically reread the parity agent's corrected SQL:

- Service SQL SHA256 `d927a6589022f7a81e19a5eae7e4246b8c9ce78b049eab3fd67522c483c124e8`.
- Acquire SQL SHA256 `f25cba158289dde111e3aae6038be286b12f1dc4a64db9bf4c94f404259b14cf`.

R01's journal trigger now locks the exact connection before its physical account and checks active/current account/generation/readiness, current grant, lease/fence and claim expiry. R02 journal mutations are control-only; admitted claim/fence ownership is frozen, and stale terminal writes require reconciliation evidence. Dispatch requires a reserved-quota flag. R03 preserves accepted receipt/submission facts and known delivery/read source timestamps. R04's cursor/monitor identity triggers and R05's exact reconnect tuple FK are present. These static corrections address the identified structural omissions; they are not runtime/concurrency passes.

Quota charging once is still a required admission-repository transaction: a boolean flag cannot prove both quota buckets were updated. Lease changes and admission need one explicit lock/CAS protocol. Historical key replay must read and compare existing journal state before attempting fresh INSERT; PostgreSQL BEFORE INSERT triggers also run for an INSERT that later conflicts, so fresh-admission guards must not become a reason to abandon original historical recovery.

R06 requires an actual commit-safe event-consumer implementation and delayed-commit test. R07 remains an operator approval/destination preflight requirement. Design hashes/evidence should be refreshed by the parity agent after documentation catches up with revised scripts.

Current handoff: structural corrections reread statically; parity agent owns final artifacts/hashes and parent owns implementation plus approved runtime tests. No SQL execution, database/runtime pass or approval is claimed.

## Provider configuration, original context and typed outcome revision

The new pure dispatch coordinator exposed missing representation in the original provisional service artifact (`e41749eeaf76b994361e3a7c02751377b808b00eef8b8a65fc383e763b9aeb64`). The revision is still **unapproved and unapplied**; approvals for original WhatsApp migration 0018 and local RLS parity files do not authorize this new schema.

Current review targets:

- Service SQL SHA256: `b2d673205ba759bb1126db90b719bf39d44d8f3977d1bbe2ab97aa48c00b308d`.
- Acquire SQL remains unchanged: `f25cba158289dde111e3aae6038be286b12f1dc4a64db9bf4c94f404259b14cf`.
- Proposed target remains isolated OrbStack `127.0.0.1:5445/acquire_channels`; no execution approval or schema application is inferred.

Changes are additive within the unapplied service design: two generation columns (`provider_api_version`, immutable versioned private `provider_configuration_reference`); three required immutable encrypted original-context columns (ciphertext/key version/keyed digest); three paired encrypted terminal-outcome columns (status/ciphertext/key version); `blocked` state and honest claimed/dispatching/unknown/terminal mappings to coordinator ports. No new table or function was introduced. Existing generation immutability covers its new columns; the operation trigger freezes original correlation context and completed typed outcomes.

The two-phase mapping corrects the old quota description: claim charges no quota; only the fenced claimed → dispatching transaction charges both account/application buckets and may set reservation true. The reservation cannot reset or be created on an unrelated state update. Claim ownership freezes when leaving claimed. Unknown cannot become dispatchable or be declared rejected/skipped from generic lookup results; accepted resolution requires previous admission/quota proof plus read-only evidence. Accepted ciphertext/source timestamps retain the original immutability guards. Strict null pairings require Unipile version/config together, complete encrypted original context, and matching blocked/rejected/skipped outcome state/status/ciphertext/key version. Plaintext codes alone are not outcome storage.

Independent static review confirmed these new pairings/transition guards and identified an earlier alias gap: a control UPDATE could move a verified alias to another valid generation while retaining old verification metadata. Added one alias UPDATE/DELETE rejection trigger using the existing generic immutability function. Alias corrections require newly verified immutable history rather than rebinding an old row.

Static `pglast` parsing accepted 102 service statements/thirteen tables/seven PL/pgSQL functions/one target guard and the unchanged 66 app statements/seven tables/two PL/pgSQL functions/one target guard. Evidence: ignored `.local-data/communications/verification/communications-storage-revision-static.log`. No SQL was sent to a database, including transaction-rollback DDL; no database runtime, encryption, trigger, RLS, lease, quota or concurrency verification is claimed.

Final independent static reread confirmed both current hashes, explicit null pairings, immutable generation/context/terminal outcomes, bounded coordinator state mapping, prior-admission quota requirement for unknown resolution and the alias correction. An independent AST check confirmed that every service relation reference belongs to `communications`, with no Acquire/public dependency. Private evidence: `.local-data/communications/verification/service-ddl-v1-independent-static.json` records both hashes, parser counts and `database_execution: false`. No structural blocker remains for this revision's review; execution authorization and concrete repository/runtime conditions remain outstanding.

Remaining blockers: concrete repository mapping/codecs, versioned configuration/vault resolver, retained key-version access, exact encrypted-format validation/provenance, transaction locks/fences/quota counts, current grants, connection-generation races, historical journal import/backfill proof and clean independent database startup. The `configuration_reference` length/type checks cannot prove the referenced external object is immutable or contains correct endpoint/source data; the resolver must enforce this. Key rotations may not rewrite immutable original facts. The coordinator's synthetic red/green tests are evidence of call ordering/provenance under injected ports, not durability or database compatibility. Request a new exact artifact/hash/environment approval only after the repository-backed slice and execution preflight are reviewable.

## Schema-only fixture execution proposal

Parent completed exact hash, OrbStack loopback/container/database/system-ID, absent-schema/role collision and local backup preflight after the independently reviewed revision. Proposal scope is creating the two additive schemas in the isolated fixture database; no concrete repository/runtime pass is claimed. To allow meaningful real PostgreSQL TDD rather than failures caused by missing tables, schema approval/execution precedes new repository behavior tests. This deliberately supersedes the earlier self-imposed repository-before-schema-proposal ordering. Activation, backfill and production rollout remain separate; the new schema artifacts are still unapproved/unapplied until an explicit answer. Evidence: ignored `communications-storage-proposal-preflight.json`.
