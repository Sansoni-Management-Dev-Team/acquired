# Communications persistence and binding design

Prepared 12 October 2026 for P2.1–P2.3, based on the version 1 contracts in `communications/packages/contracts/src/index.ts` and the existing Acquire schema. This is a provisional design and reviewable DDL, **not applied or integration verified**. No migration, backfill, schema push, transaction-rollback DDL execution, credential movement, default change or production operation was performed. The SQL is outside the Drizzle journal and no startup script invokes it.

## Boundary

The communications service owns physical accounts, scoped backend connections, verified identity aliases, connection generations, operation admission/journals, account leases/quotas, setup state, normalized events and transport reconciliation. Its SQL references only its own `communications` schema. It does not query Acquire membership, campaign IDs, Better Auth or n8n.

Acquire owns member authorization, campaign approvals/scheduling, selected contacts, suppressions, cross-channel person holds, business send windows and decisions about consuming events. Its additive tables reference service identifiers and existing Acquire ownership; no cross-database FK is attempted. The first local validation can place the separate schema in the already isolated fixture database. Independent deployment should give the service its own database and login, then prove the same schema works with no Acquire tables. Sharing a test database does not establish independent operation.

A service account ID is an opaque stable identifier, not a provider's account ID and not an organisation/user pair. Physical identity verification uses backend-independent namespaces: normalized mailbox address across email platforms, E164 for WhatsApp, and a verified stable LinkedIn member identity. Store a keyed digest with its key version; do not expose raw values in operational evidence. An unverified legacy account may have a provisional service record with null identity fields; it cannot activate. Verification must not fabricate identity to unblock a test or import.

## Service-owned tables

| Table | Purpose and required invariants |
| --- | --- |
| `access_grants` | Application/tenant/owner authorization issued by trusted service control, with expiry and explicit revocation. No FK to an application membership table. |
| `physical_accounts` | Global identity-digest uniqueness, verified identity, channel and stable service ID. Identity becomes immutable after verification. |
| `connections` | Scoped ownership, channel/platform/backend, current generation, source-observed status and reserved physical-account ownership. A partial unique index rejects a second active binding to the same physical account across workspaces or backends. |
| `connection_generations` | Immutable ownership/account/backend metadata, explicit Unipile API version and versioned provider configuration/credential references, capability snapshot and encrypted provider-account ID with keyed mapping digest. Previous generations survive reconnects and account changes for original receipt recovery. |
| `operation_journal` | Scope-wide unique operation key, exact generation/account FK, payload/recipient digests, immutable encrypted original correlation context, claim/fencing metadata, encrypted accepted receipt or typed blocked/rejected/skipped outcome, and distinct submitted/delivered/read facts. No message text. Key/binding/context cannot change; unknown never transitions back to dispatching. |
| `account_leases` | One fenced renewable worker lease per physical account. Reacquisition after expiry needs a higher token. |
| `quota_buckets` | Account and application quota windows, both charged once by the same operation admission transaction. Backend choice does not create a fresh allowance. |
| `auth_states` | Hashed expiring setup state, requested scope/backend/platform, approved redirect origin, optional original reconnect generation, and immutable single-use consumption. |
| `identity_aliases` | Immutable verified encrypted canonical identity/alias, keyed digests, and exact generation/account ownership. Update/delete is rejected; old aliases cannot be moved to certify a new generation's recipient. |
| `event_cursors` | Exact generation/account/query-scope digest, encrypted cursor, initial-sync/completeness/source timestamps, invalidation and processing lease. |
| `webhook_inbox` | Authenticated encrypted raw delivery committed before acknowledgement, integration-scoped dedupe, bounded retention, retries, dead-letter and replay metadata. |
| `events` | Immutable normalized encrypted metadata with account/generation-scoped source dedupe and stable event sequence. Distinguishes message direction, receipts, account events, folder changes and bounces. |
| `event_outbox` | At-least-once per-subscriber delivery/ack/retry state, linked to the exact event and access scope. No outbound-send replay. |

`active` is reserved binding ownership, rather than connectivity. A disconnected connection remains reserved until explicit retirement. A connection with claimed/dispatching/unknown operations cannot be retired or moved to another physical account. Status can become disconnected or verification-required immediately, pausing new dispatch while recovery retains the original journal. Status observations cannot regress within a generation. A new generation invalidates existing cursor coverage and old aliases remain historical.

Reject conflicting bindings until shared-account consolidation is proven. The unique index can only cover inventoried service records: Unipile activation must also inventory existing direct/browser/Baileys bindings and session ownership. It cannot safely activate a duplicate account while an unrecorded legacy session remains outside the registry. Legacy quotas and leases remain authoritative until explicit handoff, and an incomplete inventory blocks takeover rather than supplying an assumed free allowance.

## Acquire-owned additions

| Table | Ownership and binding rule |
| --- | --- |
| `communication_bindings` | Immutable typed snapshot of the service connection/account/generation/channel/platform/backend plus scope. Optional legacy mailbox/WhatsApp IDs use composite org/owner FKs; LinkedIn stores an opaque legacy port reference. No secrets are copied. |
| `communication_defaults` | Mutable selection per org/owner/channel used only when creating new work. Composite FK prevents another scope or channel's binding from becoming a default. |
| `campaign_channel_bindings` | Immutable selection per enrolment/channel with composite enrolment-owner and binding-owner FKs. Defaults cannot rewrite it. |
| `campaign_attempt_bindings` | Immutable attempt/enrolment/channel/binding plus original operation key, digest/version and authoritative journal. Historical imports lacking a trustworthy digest are explicitly recovery-only. |
| `outreach_draft_bindings` | Freeze the connection before first provider draft creation; retain it through update/revoke/recovery. Existing provider drafts require evidence of their original owner before importing. |
| `communication_reply_monitors` | Query coverage and leases keyed by exact immutable binding and query scope. Existing org/user/channel monitors remain intact while new connection-specific collectors are introduced. |
| `communication_event_receipts` | Immutable binding/service-event consumption dedupe, source time and outcome. Insert atomically with existing cross-channel holds/audit changes before acknowledging the service. |

No existing column is removed or rewritten. No automatic default is installed. The DDL adds only empty tables, narrowly required composite unique indexes, RLS policies, grants and immutability triggers. It does not alter existing person holds, credentials, delivery journals, campaign claims, draft contents, provider IDs or migration history.

The first release deliberately does not transfer active work to a different binding. Users can change a default for new work; recorded enrolments, attempts and drafts retain their original references. A later transfer feature requires a separately reviewed append-only revision/audit model, fresh coverage, and resolution of every pending attempt. It cannot update these immutable rows in place.

## Operation admission and recovery

The future repository must implement this transaction boundary; these tables alone do not prove it. Journal writes are control-only. Its trigger serializes admission against retirement/generation changes using a shared connection row lock, then locks the physical account and checks active/current connected binding, grant, lease/fence and claim expiry. The quota-reserved flag still cannot prove counters were charged atomically, so the admission repository and concurrency tests remain activation prerequisites:

1. Authenticate the exact application/tenant/owner and verify the current grant. Acquire rechecks member authorization before requesting any dispatch, including background work.
2. Resolve the recorded immutable binding, lock the shared connection row then its physical account, verify active/current-generation readiness and the live worker lease/fencing token, then evaluate application restrictions and account quotas.
3. Insert the operation's unique scope/key claim **without charging quotas**, capturing its original encrypted recipient/correlation metadata. A replay first reads the existing journal and compares operation, complete binding, content digest and original context before returning it; it charges no additional allowance. Do not implement recovery as blind INSERT ON CONFLICT: PostgreSQL runs BEFORE INSERT admission triggers before resolving the conflict, which would incorrectly apply current-generation readiness to a historical lookup. A changed account/content under the same key is a conflict. Only the claim winner preflights the adapter; a known predispatch waiting/review outcome becomes a durable typed block without quota admission.
4. Atomically charge both account/application allowance and commit a single fenced compare-and-set transition from claimed to dispatching before any provider write. Recheck current generation/grant/lease at this point after preflight. Only the successful fenced claimant calls the adapter. No transaction or network timeout changes dispatching/unknown back into a dispatchable state.
5. Persist the normalized encrypted receipt or an honest unknown/rejected result. A crash after possible provider acceptance leaves dispatching/unknown, and a trusted reconciliation worker uses read-only receipt lookup on the recorded backend/account/generation.

Claim expiry by itself never permits dispatching/unknown replay. A claim that provably never crossed dispatch admission may be reclaimed under the same binding/key; the repository must distinguish it from possible acceptance. Account lease loss after admission does not create a new send attempt. The durable single transition/journal prevents another worker from dispatching the same operation; provider-side fencing cannot be assumed. Lease acquisition/renewal uses the same account lock and compare-and-set protocol in a consistent lock order; its row trigger alone does not prove the protocol. An admitted claim/fence cannot be replaced, a stale worker needs read-only reconciliation evidence for a terminal result, and accepted receipts and known source timestamps cannot be overwritten.

Receipt recovery does not require connected status and must not resolve through the current default. The repository interface is `get(scope, connectionId, generation)` for exact immutable-generation lookup. It returns a historical generation as disconnected/read-only, rather than selecting the current/default generation or permitting a new claim. Current authorized users can recover the old generation through this lookup when the original provider account and credential/vault reference remain accessible. Legacy journals and adapters are not assumed to support an account swap: if the underlying vault cannot validate the original account/reference, retain unknown/review and do not dispatch. Trusted control reconciliation can preserve receipts after user access revocation without initiating another provider write or exposing them to the revoked user. The public scoped API denies new reads/writes after grant/member revocation.

Payload digest/version follows the canonical operation representation in the core. Recipient/identity digests use independent keyed normalization and retained key versions. Encryption keys can rotate without changing physical IDs or journal keys; rotating identity-digest keys or canonical payload formats requires an explicit compatibility procedure rather than generating a new account/journal history silently.

### Immutable provider configuration and original operation context

For Unipile, every generation requires `provider_api_version` (`v1` or `v2`) plus `provider_configuration_reference`. Other backends keep these two Unipile-specific fields null. The reference names an **immutable version** in the service's private configuration/vault store, including the exact endpoint origin/API prefix, integration identity, verified product/source IDs and any relevant reference-namespace settings. It is not a raw endpoint or credential. `credential_reference` remains an opaque private vault/legacy-port reference. Neither changing environment defaults nor rotating a mutable latest-version alias may redirect historical lookup: the repository must resolve the generation's exact retained configuration and credential version. The generation immutability trigger covers all of these columns. SQL cannot prove the external referenced object is immutable, authorized, available, or correctly mapped; the resolver/repository must validate that before use.

`encrypted_operation_context`, `operation_context_key_version` and keyed `operation_context_digest` are required at claim and immutable thereafter. The versioned encrypted format holds the original canonical recipient, optional RFC Message-ID, conversation/thread reference, and any independently verified provider identifiers **already known before admission**. It contains no body text. The codec must bind these values to the exact snapshot and generation and validate its format/key versions; the digest uses a retained domain-separated keyed digest key rather than a public hash of guessable recipient data. The key-version identifier resolves the encryption/digest key bundle; these are distinct cryptographic keys. Database constraints ensure nonempty ciphertext/key-version and SHA-256 digest shape, while codec correctness and actual encryption remain repository responsibilities.

A newly returned provider message/action ID belongs in the encrypted accepted receipt, not a mutation of original claim context. An unknown operation cannot fabricate a provider ID to fill missing context. Importing a historical known-ID reference or adding read-only evidence requires proven original authority; no backfill/reconciliation writer is supplied by this DDL. Ciphertext/key versions remain immutable history; key rotation must retain decryption of prior versions or use a separately reviewed envelope-key procedure rather than rewriting these facts.

### SQL state mapping to coordinator ports

The [dispatch coordinator](dispatch-coordinator-tdd.md) requires real atomic ports; the provisional table represents their outcomes as follows:

| SQL state | `DispatchRecord` mapping | Required stored evidence / quota behavior |
| --- | --- | --- |
| `claimed` | `state: claimed`, no outcome | Original encrypted context and fenced claim; quota remains false |
| `dispatching` | `state: dispatching`, no outcome | Durable dispatch CAS; quota must be true |
| `unknown` | `state: unknown`, `outcome: unknown` | Original context preserved; never redispatch. A preadmission unknown keeps quota false; an admitted unknown retains quota true |
| `submitted` | `state: completed`, submitted receipt | Paired encrypted receipt/key version; quota true; receipt and accepted timestamps immutable |
| `blocked` | `state: completed`, waiting/review outcome | Paired explicit `outcome_status`, encrypted full typed outcome and key version. Predispatch block charges no quota; a definite adapter result after admission retains its reservation |
| `rejected` / `skipped` | `state: completed`, corresponding typed outcome | State/status must agree; full encrypted outcome retains reason/code/original action reference; same-key replay returns it unchanged |

Typed outcome ciphertext includes the complete normalized outcome, including any waiting retry timestamp or skipped operation reference; a plaintext `failure_code` alone cannot reconstruct it. Codecs must enforce the exact subtype, provenance and sanitized machine-code rules on decode. New receipt/outcome pairing checks are deliberately explicit about nulls to avoid PostgreSQL `CHECK`'s three-valued-logic bypass.

Claim → blocked/rejected/skipped/unknown can represent a conservative preflight/admission result without a provider send. Claim → dispatching is the only transition that can flip quota reservation from false to true. Once the claim leaves claimed, claim token/expiry/lease/fencing ownership are frozen. Dispatching → submitted/unknown/blocked/rejected/skipped preserves that admitted ownership; terminal results from a stale worker need trusted read-only resolution evidence. Unknown → submitted requires prior quota reservation plus resolution evidence, and unknown cannot settle to rejected/skipped on generic lookup response. No blocked/terminal row becomes claimed/dispatching again. An unknown that arose before dispatch remains conservative and non-dispatchable; handling a proven never-admitted abandoned claim requires a separately specified repository/control workflow and cannot be guessed from a timeout.

Direct Gmail RFC recovery and browser LinkedIn key-journal recovery remain explicit original-authority paths. Unipile unknown recovery without a proven original message ID stays unknown. The coordinator validates these paths in pure fixtures; the SQL does not prove provider identity/correlation, grant propagation, admission concurrency, encryption, transaction fencing, quota charging, or restart durability. The concrete repository/codecs and independent PostgreSQL tests remain unfinished and are required before application activation.

## Connection setup and event processing

Setup creates a random state whose digest is persisted with scope, requested channel/platform/backend, reconnect target, expiry and an allowlisted redirect origin. The server verifies provider account metadata and products before consuming it with a conditional update requiring `consumed_at IS NULL` and a valid expiry. Cancellation, mismatch or missing authorization cannot bind an account. Authentication credentials and raw state values are never returned by diagnostics. The SQL's origin shape check is supplemental; actual redirect allowlisting and provider identity verification remain API responsibilities.

Webhook authentication occurs before persistence. The server encrypts the verified body, inserts the integration/dedupe-key inbox record and commits before responding. The retry worker locks/leases it, verifies account mapping, stores normalized events plus subscriber outbox entries in a transaction, then marks the inbox processed. A duplicate delivery must also compare payload digest; reused delivery keys with different payloads require review. Source-event keys distinguish meaningful versions of folder/account/receipt events, not just a bare message ID.

Acquire consumes normalized events and records its dedupe receipt together with reply holds/audit updates. Outgoing/self/group messages, bounces/folder moves and receipts do not become inbound-person replies. Ambiguous identity produces a review hold. Replaying outbox delivery is safe because the receipt is generation/binding scoped. Existing hold tables remain the authority and are never cleared by reconnect, default change, replay or rollback.

Cursor commit and durable event insertion are transactional. Both service cursor and Acquire monitor scope keys are immutable: another account/generation/query needs a fresh invalidated row. The events identity ID represents allocation order, not commit order. A naive `id > high_water` cursor can skip a late-committing lower ID. Use pending outbox rows plus durable per-event acknowledgements for consumption, or serialize event allocation/commit under a connection lock acquired before INSERT/identity allocation; prove the chosen checkpoint behavior with two concurrent transactions. Merely ordering by event ID is insufficient. Coverage includes the exact query scope, account generation, initial-sync state, completeness, `from`, actual source `through`, and observation time. A request's success, webhook silence, cached API response or empty approximate search cannot certify coverage. Acquire preserves the five-minute policy via the contract coverage guard. Account changes, history gaps, missed webhook reconciliation or cursor expiry invalidate coverage before another send is admitted.

The inbox retains encrypted provider payloads for a bounded configured interval; message text is not stored in the operation journal or Acquire consumption receipt. A retention/redaction worker and its narrowly reviewed privileges are still to be implemented. These provisional artifacts grant no DELETE permission and block deletion of durable journal/history; they do not claim a completed retention lifecycle.

## Authorization and database roles

Service roles are `communications_scoped` and `communications_control`, both NOLOGIN and NOBYPASSRLS. All service tables enable and force RLS. Scoped policies require all three trusted request GUCs (`communications.application_id`, `.tenant_id`, `.owner_id`) and a nonrevoked, unexpired service access grant. The grant's own SELECT policy uses only the exact scope/expiry and avoids recursive authorization. Scoped callers have SELECT-only access to the operation journal; the trusted admission/reconciliation repository is the only writer. Global physical accounts, leases, quotas and raw ingress are control-only. Credential-store references are never raw credentials.

Control policies permit trusted lifecycle/ingress/reconciliation workers to operate, with no DELETE grants; scope authorization must be checked by the API before entering control operations. LOGIN credentials, TLS, role memberships and key storage are separately provisioned. No external app/browser receives database credentials, control-role access, or arbitrary SQL/GUC access. Pooled transactions use `SET LOCAL ROLE` and trusted scope, then commit/rollback. Use of a table-owner/BYPASSRLS login without that role switch cannot be represented as scoped isolation.

Acquire reuses its existing restricted roles. User policies check org/user GUCs and current `member` existence on every scoped read/write. Membership is deliberately not a FK because its deletion must revoke access without deleting history. The scheduling worker has SELECT-only access to the new tables and must re-enter the recorded owner role before dispatch or event processing. The existing trusted legacy paths remain available until integration is explicitly enabled.

Grant revocation is a service concept; its propagation/API enforcement is not magically provided by SQL or by copying Acquire users. Acquire must recheck membership for every dispatch, revoke its service grant on offboarding, and expire any delegated authorization. If that integration cannot establish current authorization, background dispatch waits. Reconciliation of already accepted operations preserves evidence but authorizes no new send.

## Migration review and approval scope

| Artifact | Exact proposed local target | SHA256 |
| --- | --- | --- |
| [001-service-storage.local.sql](../../communications/migrations/001-service-storage.local.sql) | OrbStack `127.0.0.1:5445/acquire_channels`; new independent `communications` schema | `b2d673205ba759bb1126db90b719bf39d44d8f3977d1bbe2ab97aa48c00b308d` |
| [002-acquire-bindings.local.sql](../../ops/communications/002-acquire-bindings.local.sql) | OrbStack `127.0.0.1:5445/acquire_channels`; additive Acquire public tables | `f25cba158289dde111e3aae6038be286b12f1dc4a64db9bf4c94f404259b14cf` |

Both artifacts are **local-only, provisional, unapproved and unapplied**. Guards require database `acquire_channels`; the app artifact also checks existing campaign/journal prerequisites. The operator must additionally verify the exact host/port through its private connection configuration: a database-name guard cannot establish network destination by itself. Do not run a blanket migrator, initialize a new volume, change the Drizzle journal, or infer production approval from a local approval. A revised file/hash or different environment requires new specific approval.

Before proposing execution: review each table/key/FK/policy/trigger; confirm backup/snapshot and exact database identity; verify restricted-role availability and explicit LOGIN role provisioning; reconcile lock/index cost on the target; add the repository/auth/event behaviors and meaningful failing tests that will become runnable against the approved schema. The artifacts create roles named `communications_scoped/control`, so existing role/schema names must be inspected; collisions should fail and be reviewed, not silently reused.

No backfill artifact is included. A later backfill proposal must be separately approved and resumable, selecting only proven legacy references and preserving encrypted credentials in place. Gmail enrolments can use their recorded mailbox ID; WhatsApp/LinkedIn require their original journal/session evidence. Existing draft owner attribution and unresolved social sends must not be inferred from today's default. Ambiguous records remain on the legacy authority or pause for review. Before switching any authority, compare independently collected inventory counts/identities privately and prove the legacy journal/lease/quota handoff.

Rollback disables new connection creation/selection and stops new communications dispatch while preserving every accepted/unknown operation, binding, receipt, old generation, credential reference and Acquire hold. Restore compatible prior application/service images under reviewed feature gates. Unipile-bound work waits on its original backend; it never falls through to Gmail/Baileys/browser. No down migration drops journals, binding snapshots, event receipts, aliases or holds. Actual schemas remain additive while a forward correction is reviewed.

## Verification completed and outstanding

Static verification used `uv run --with pglast python` without importing repository credentials or opening any database connection. The reproducible syntax check is:

```bash
uv run --with pglast python - <<'PY'
from pathlib import Path
from pglast import parse_sql, parse_plpgsql, ast
from pglast.stream import RawStream
for filename in ["communications/migrations/001-service-storage.local.sql",
                 "ops/communications/002-acquire-bindings.local.sql"]:
    nodes = parse_sql(Path(filename).read_text())
    for node in nodes:
        statement = node.stmt
        if isinstance(statement, ast.DoStmt) or (
            isinstance(statement, ast.CreateFunctionStmt)
            and any(option.defname == "language" and option.arg.sval == "plpgsql"
                    for option in statement.options)
        ):
            parse_plpgsql(RawStream()(statement))
    print(filename, len(nodes), "statements parsed; no SQL executed")
PY
```
 The parser accepted both complete SQL scripts, all nine PL/pgSQL trigger functions and both target guards. Twenty-eight FK shapes/reference unique keys were checked against the parsed artifacts and the previously captured read-only isolated catalog snapshot. This confirms syntax and reference structure only; it does not execute DDL, validate role/trigger runtime behavior or prove concurrency/isolation.

The pure required-port coordinator has [scoped red/green evidence](dispatch-coordinator-tdd.md); no red/green **database repository integration** result is claimed for P2. The artifacts are prepared for review, with real transaction/codec/RLS/concurrency evidence pending. The provider/context/outcome revision and independent alias immutability correction were statically parsed as 102 service statements, thirteen tables, seven PL/pgSQL functions and one target guard; the unchanged app artifact parsed as 66 statements, seven tables, two PL/pgSQL functions and one target guard. No database connection or SQL execution occurred; private evidence is `.local-data/communications/verification/communications-storage-revision-static.log`. After specific migration approval, the repository tests must demonstrate these scenarios on isolated OrbStack PostgreSQL:

| Acceptance IDs | Required evidence |
| --- | --- |
| A05 | Forbidden scopes, revoked grants/member access, wrong composite ownership and attempted control-role client access fail. |
| A06–A08 | Concurrent equal keys charge once; changed content/account conflicts; crash after admission remains unknown; original receipt matching and distinct delivery/read facts survive restart. |
| A12–A13 | New generation/gap/expired cursor invalidates coverage; aliases/cursors never cross accounts; actual history completeness is required. |
| A15–A17 | Changed defaults leave old enrolment/attempt/draft bindings unchanged; duplicate physical-account active bindings fail; draft approval/update/revoke stays draft-only on the original connection. |
| A21 | Lease theft/expiry and crash at journal/event/checkpoint commit cannot dispatch twice or certify partial coverage. |
| A24 | Backfill proposal is separately reviewed; disabling new code keeps legacy credentials/unknown actions/holds/original bindings intact. |
| A25 | Service schema plus a synthetic independent client runs in an empty database without any Acquire/Better Auth/n8n table. |

Next action: propose the independently reviewed **schema-only isolated fixture prerequisite** with exact current hashes and verified target/backup. This changes the earlier sequencing requirement to let real repository tests reach meaningful behavior failures against an explicitly approved schema; no repository-backed readiness or activation is claimed. Existing pure adapter/coordinator slices are green. After specific schema approval, implement the concrete codecs/repositories and demonstrate red–green transactional/RLS/concurrency behavior; retain app activation, backfill and production rollout as separate later steps. The additive schema proposal does not authorize those later operations or any automatic startup migration.
