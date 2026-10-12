# Durable reply consumption and tenant admission barrier

Status: proposed, statically reviewed only. No migration application, runtime activation, live provider operation or complete reply coverage is claimed here. Tasks P2.3/P3.4/P4: scoped A05/A09–A13/A21/A24 prerequisites. See [the execution plan](../39-communications-service-execution-plan.md) and [progress](progress.md) for authorization and actual verification.

## Exact local artifact

- File: `ops/communications/003-reply-consumption.local.sql`.
- SHA-256: `4f79939442b22109fed2bee069059d8701126170202fa902e9aa6655b039fefd`.
- Only proposed target: OrbStack `127.0.0.1:5445/acquire_channels`, after approved service schema 001 and Acquire binding schema 002 are applied and verified.
- **003 is unapproved and unapplied.** Approval for 001/002 or earlier parity work does not cover this file. Changed content or another target requires its own exact approval.
- Direct verification: PostgreSQL static parser accepted 74 statements and the PL/pgSQL parser accepted 12 function bodies. No SQL, including rollback-only DDL, was executed. Parsing does not verify privileges, dependency resolution, locks or PostgreSQL behavior.

This combines service/app additions for the local fixture only. Service objects reference only `communications` relations; application objects reference only `public` relations. Separate deployed service/app databases need separately reviewed, specifically approved deployment artifacts. Neither database receives a foreign key into the other.

## The two commits

The reusable service commits encrypted normalized events, semantic deduplication, required subscriber outbox rows, review latches and webhook completion in one **service** transaction. It does not resolve Acquire contacts or commit person holds. Existing `createReplyProcessor` is appropriate only for a colocated application-policy transaction; standalone service processing uses `createWebhookEventProcessor`.

Acquire authenticates the exact subscriber delivery and original immutable binding, rechecks membership and identity/enrolment cutoffs, and commits the consumer receipt, existing person/email holds, all-channel enrolment stops, audit and local checkpoint in one **Acquire** transaction. It acknowledges the service only after that commit. A receipt with result `review` also creates an application review latch and invalidates affected reply coverage in this transaction.

A crash after the Acquire commit and before the service acknowledgement causes a replay. Compare the immutable consumer fingerprint before returning the saved result. A changed fingerprint is review, never another application of the event or an overwrite of the original receipt. Existing observation-to-enforcement replay behavior must be retained: applying a previously observed reply under enforcement can add its holds; duplicate receipts must not erase that possibility.

```text
Service capture commit -> authenticated HTTP acknowledgement
Service normalization/event/outbox commit
Acquire receipt + policy/holds/stops/audit/checkpoint commit
Service fenced subscriber acknowledgement commit
```

These are separate local transactions with at-least-once delivery. They are not a distributed atomic transaction. New outbound admission remains blocked during the gap between service acceptance and application acknowledgement.

## Proposed data additions

| Addition | Purpose and invariant |
| --- | --- |
| `communication_event_receipts.payload_fingerprint` / `fingerprint_version` | Compare the entire stable consumer envelope on replay, including exact binding, service event identity, direction, sender and conversation. Existing receipt immutability protects these fields. The migration aborts if receipts already exist: no invented fingerprint or implicit backfill. |
| `communications.tenant_reply_barriers` | One durable revision and mutex per application/tenant across all owners/channels. Every revision change advances one step. Presence or revision does not certify readiness. |
| `communications.webhook_receipt_routes` | Immutable original inbox-to-binding/generation/account routing. A trigger assigns its capture revision and checks inbox backend/integration against that generation. Codec verification and authenticated routing remain repository obligations. |
| `communications.reply_review_latches` | Event-backed unresolved service review; details stay encrypted in the service event. Resolution is explicit, referenced and immutable once recorded. |
| `communication_consumer_checkpoints` | Scoped subscriber/query cursor, renewable worker lease and observed service revision. Scope/creation identity is immutable; revisions/update timestamps cannot regress. A revision or maximum global event ID cannot certify contiguous application. |
| `communication_reply_review_latches` | Receipt-backed application uncertainty covering the tenant until explicit resolution. Existing person holds remain untouched. |

New reviews must start unresolved. Neither resolution nor generation changes delete or clear existing contact holds. Initial receipts and latches contain no message body or raw webhook. Raw payloads remain inside authenticated encrypted service storage.

The service can store the semantic key/fingerprint inside the authenticated `events.encrypted_event` envelope rather than adding a plaintext fingerprint column. On uniqueness conflict, decode the existing immutable event under its original scope/key/version and compare canonical event facts before completing a new webhook receipt. A global service event ID or a content-derived replacement ID must not disguise a semantic-key conflict.

## Admission ordering and pending work

Repositories must take locks in this order: tenant reply barrier, then original connection/physical account/grant, then work/lease/quota/cursor/event rows. Capture must call `communications.lock_reply_barrier` **before** its current-scope query and inbox insertion. Normalization, acknowledgement and review resolution must also acquire the tenant mutex before taking their work-row locks. Existing capture/claim repositories require this composition change before 003 can support activation; a trigger acquiring the tenant lock late is insufficient to prevent deadlocks.

Route insertion assigns and advances the capture revision. Routed inbox mutations, outbox mutations and review mutations advance the same tenant revision. The additional operation-journal trigger runs before the existing connection/account guard when a claim enters `dispatching`. It locks the tenant barrier and rejects admission while any of these exists:

- Routed inbox work that is not processed, including expired or dead-letter work.
- Unrouted inbox history belonging to a known integration for this tenant. This is a conservative recovery gate, including old generations; no encrypted account identity is guessed.
- Any tenant subscriber outbox delivery that is not acknowledged, including dead letters.
- Any unresolved service review latch.

Known routing is authoritative only after the control repository validates the authenticated ciphertext and provider account against that exact original binding. Integration identifiers can span tenants; a correctly routed tenant A event does not become tenant B work. Unrouted history conservatively blocks every matching integration scope until named routing/quarantine is established. Existing local fixture rows from earlier schema verification are not automatically backfilled or treated as complete.

A missing barrier is blocked. This pending-work gate is necessary but **not sufficient**: current membership/ownership, approved content, quotas, exact query coverage, initial sync, five-minute freshness and existing person holds must still be checked. The draft deliberately considers every subscriber in the tenant; optional subscriber exemptions need a separately reviewed rule.

Service normalization and subscriber ACK mutations become control-repository-only; 003 explicitly revokes the earlier scoped role's event INSERT and outbox INSERT/UPDATE grants. A scoped event append cannot bypass the required normalization/outbox/review transaction. The service API must authenticate application/tenant/owner/subscriber and enforce the original delivery identity, current grant and lease token before any control SQL. No control credentials are exposed to applications.

All existing Gmail, Baileys and browser LinkedIn sends must pass an Acquire admission bridge. Obtain the service tenant admission fence first, then use a fresh Acquire transaction/snapshot to recheck current membership, local review latches, person holds and approved content while that authorization remains valid. Earlier or cached local checks cannot authorize a send: a review can commit and its service outbox be acknowledged between an earlier local check and acquisition of the service fence. The concrete permit/serialization protocol must prevent that gap before activation. Checking only the outgoing connection, physical account, channel or owner would allow another channel or owner to send while an email reply waits for application. Service unavailability must fail closed. No legacy path is changed or claimed protected by this proposal.

The admission fence defines ordering of capture and new dispatch authorization. A send already admitted before a later capture is an in-flight operation; the system cannot recall provider acceptance or claim globally atomic network delivery. Expiring/fenced authorization must bind the exact original operation; retries retain the unresolved-send rules and never obtain authorization for a replacement backend.

## Historical scope and authority

Connection defaults never choose the target of reply application. Resolve the recorded application/tenant/owner/connection/account/generation snapshot and exact application binding. Already accepted old-generation events remain historical evidence. Deliver/reconcile them under that original scope or persist explicit review/quarantine; do not silently move them to the current generation.

Current-generation checks govern new send admission, fresh coverage and changed-account enrichment. Reconnect must not erase accepted events, consumer fingerprints, person holds or unresolved reviews. Grant revocation blocks new scoped work; previously committed holds survive it. The current membership check and any worker-role transition must serialize with revocation, not rely solely on an earlier request check. Acquire consumption begins `SERIALIZABLE` before authority queries, sets the authenticated owner role/GUCs, and calls the narrow `communications_lock_reply_member` function. Its fully qualified, SECURITY DEFINER membership lookup takes `FOR SHARE`, rejects a mismatched owner role/GUC, returns only existence, and exposes no table UPDATE grant. Revocation or membership updates wait until this consumer transaction ends; a concurrent row change detected by serializable isolation aborts consumption without acknowledgement. Its owner/search path/EXECUTE permissions and concurrency behavior need actual PostgreSQL verification after approval.

Application user RLS keeps owner/tenant scope and current membership checks. Worker grants on the new application tables are read-only. Tenant-wide local gates use authenticated server worker reads because a user-scoped RLS query cannot see another owner's pending review. New service tables use FORCE RLS; routing writes are control-only. No DELETE permission is granted.

## Implementation and verification still required

Prepare behavior tests before implementing the repository/consumer bridge. Applying this proposal requires separate approval, target/system-ID/hash checks and private backups; no test harness may provision it automatically. Then verify on the approved isolated PostgreSQL database:

1. Exact fingerprint replay, conflicting replay and observe-to-enforce hold recovery.
2. Acquire commit before service ACK; process crashes on each side of both commits.
3. Concurrent capture/admission under the tenant mutex and all-channel/all-owner pending-work gates.
4. Stale subscriber leases, current grant/membership revocation and concurrent review resolution.
5. Original-generation replay after reconnect without rebinding or clearing holds.
6. Route source mismatch, foreign scope, immutable receipts/routes/outbox identities and no DELETE privilege.
7. Expired/dead-letter/unrouted work keeps admission closed until an explicitly implemented recovery path resolves it.
8. SQL dependency/trigger order, role privileges, pooled-session isolation, RLS and real rollback behavior.

No tests with an in-memory store or scripted SQL driver establish these transaction and concurrency properties. Runtime consumers, legacy admission integration, full coverage/reconciliation, UI, live channel validation and release remain outstanding.

## Prepared Acquire consumer slice

`src/lib/communications-reply-consumer.ts` implements the proposed application transaction using an injected SQL pool, mandatory authenticated-delivery verification and mandatory current verified identity mapping. It is server-only, is not registered as a Server Action/route, and is not wired to campaign dispatch or UI. The relevant installed Next server/data-access guides were read before this slice.

The consumer validates original actor/binding/subscriber and recomputes canonical event/review fingerprints before SQL. It begins serializable isolation, checks effective RLS roles, locks current membership through the proposed narrow function, and resolves the immutable application binding. Existing `applyCampaignReply` uses the same client/transaction for incoming mapped identities; LinkedIn public URLs cannot be guessed into legacy URNs. Outgoing/self/group activity records an ignored receipt. Review outcomes create a latch and invalidate coverage without manufacturing person holds. Mode `off` rejects consumption without service acknowledgement.

Exact replays rerun existing policy so observation-to-enforcement can add holds. A changed consumer fingerprint records review without replacing its original receipt or applying the conflicting payload. If that event's review latch was already resolved, another conflicting payload fails without acknowledgement. An unchanged previously reviewed event may acknowledge its recorded explicit resolution without invalidating coverage again. Commit uncertainty or rollback failure discards the pooled client; no result returns before commit.

TDD evidence in ignored private verification files: `acquire-reply-consumer-red.log` captured 33 initial missing-behavior failures; `acquire-reply-consumer-resolved-latch-red.log` captured the two resolution/replay failures; `acquire-reply-consumer-green.log` records 35 consumer checks plus eight existing reply-store regressions passing. These use a scripted SQL driver and a policy-helper mock. They do **not** establish real application holds, PostgreSQL isolation, SECURITY DEFINER permissions, revocation locks, cursor persistence or cross-database acknowledgement. Real integration tests require approval/application of this exact 003 artifact. No activation is claimed.

Independent outbox review added three passing characterizations on the existing approved 001/002 isolated database: lease expiry after a locked ACK read rejects without changing the row; owner-grant expiry during ACK rolls back its attempted transition; exact terminal-token replay after the original lease expires returns duplicate without renewing provenance. `outbox-independent-clock-green.log` records 20 actual PostgreSQL cases plus 18 scripted guard cases passing; the private log and scoped lint log have mode 0600. No production defect was found in that bounded outbox review, and no migration ran. These checks do not verify the unapplied 003 tenant fence, real Acquire receipt/holds, live subscriber authentication or complete reply coverage.

The recorded identity bridge was independently exercised under the real restricted Acquire owner role on approved 002, with synthetic data rolled back. The first seven cases reproduced `permission denied for table communication_bindings`: `FOR SHARE` required UPDATE privileges absent from immutable binding history. The resolver now locks mutable identity rows only, keeping binding history read-only. Nine actual cases plus 21 identity and eight delivery unit checks pass; root typecheck, scoped lint and diff checks pass. Private `acquire-reply-identity-independent-{red,green,lint,types}.log` files record the evidence without credentials. Coverage includes all three channels, exact URL/URN proof, duplicate/conflicting mappings, foreign owner/organization RLS, missing/changed original account/generation and membership revocation. This proves existing recorded mappings under 002, not provider-side ownership/alias provenance, the pending 003 consumer transaction, complete reply coverage or activation. No migration or provider operation ran.
