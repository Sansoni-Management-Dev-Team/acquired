# Next send-admission boundary

P2.3/P4.1 design follow-up, 2026-10-13. This is a proposed implementation protocol based on source review. It is not implemented, migration approval or permission to activate sending. The bounded durable journal still returns `review/delivery_disabled`.

## Existing integration points

Both campaign runtimes converge through `processCampaignEnrolment` and `processDeliveryStep` in `src/lib/campaign-service.ts`. `claimSend` and `claimStillEligible` close their application transactions before `deliveryProvider.submit`; a successful eligibility check therefore cannot authorize a later independent service admission transaction. Other reply/coverage checks also use separate transactions. Existing 003 provides a service tenant barrier and narrow application membership lock, not complete application policy serialization.

Campaign publication authorizes a recorded template/sequence version. Rendered attempt bytes and variable snapshots must be persisted once before service claim and reused on retry. This does not require a new human approval for every campaign message or freezing contact fields when publishing. Explicit email draft approval must bind its actual content version, recipient and original connection; edits/revocation invalidate future permission.

Current cancellation retry can recycle an attempt with a new RFC identifier under the same campaign step key. An immutable bound intent cannot be overwritten. Known no-submission retry needs an explicitly designed append-only attempt epoch/history; unknown attempts must retain the original key and never receive a replacement send.

## Proposed transaction protocol

1. Commit an immutable application intent with attempt/key, original binding, approved source version, rendered variables and encrypted exact content/digest. An intent alone grants no permission.
2. Service admission takes its tenant reply barrier first. The required application authority port opens a fresh application transaction, takes its organization admission gate before all policy/member locks, and validates current membership, intent, enrolment/assignment/binding, approved version, target-person holds across owners/channels, matching suppressions and complete fresh coverage. Unresolved tenant-wide ambiguous review latches block conservatively. Unrelated people's holds need not block this recipient.
3. Keep the application transaction and authority locks open. Service validates its own database-clock grant, physical account lease/fence, original claim and configured quota policy. Commit the journal `claimed→dispatching` CAS, both account/application quota charges and unique application-permit linkage in one service transaction. This is the admission linearization point while application authority is held.
4. Application records the exact service admission proof/permit consumption and definitely commits. Only then may the coordinator return admitted and invoke the provider. A lost/uncertain service or application COMMIT response returns unknown and invokes no provider. Retain charged quota/history conservatively; an original operation cannot be admitted again. This is not a distributed atomic commit.
5. A pause/reply arriving after admission is subsequent to that in-flight operation. It blocks future admission; it cannot recall an already accepted provider action. Preserve this ordering explicitly in recovery and UI behavior.

An authority port must represent a held transaction, for example `open(challenge) → blocked | lease{commit(serviceReceipt), abort}`. A boolean callback that has already closed its transaction cannot satisfy this protocol. Capture fixed callbacks/configuration, bound all connections/SQL/callbacks monotonically, and physically retire uncertain sessions. App/service database clocks are authoritative within their own databases; retain their separate observations/deadlines and bound elapsed time rather than assuming synchronized clocks.

## Proposed schema and writer requirements

- Application organization gate with revision and current-writer transaction marker; narrow scoped lock function. Policy mutations advance the revision so a waiting serializable reader cannot reuse a stale snapshot behind an unchanged mutex.
- Immutable application dispatch intents and permit ledger linked to recorded attempts/bindings/source versions. Opaque service admission-proof ledger linked to the journal with unique journal/nonce. No cross-database foreign key or application model inside service contracts.
- Existing service quota buckets can support atomic exactly-once CAS charges. Limits must come from trusted configuration and cover the recorded physical account/application, including preserved legacy authority; a caller cannot supply a larger allowance.
- Critical application-table triggers assert the organization gate was already acquired in this transaction. They must not acquire it after a target-row lock, which would introduce inverse lock order. Audit all affected writers before enforcing/activating the boundary.
- Audit enrolments/assignments, reply/contact holds, identities/monitors, review latches, matching suppressions, contact/mandate eligibility, membership and applicable approval/content rows. Include `changeEnrolment`, reply apply/replay and identity writes, monitor mutations, publication, contact refresh/upserts, draft edit/approve/revoke, membership/admin and suppression operations. Unknown critical writers fail closed until integrated.
- Preserve immutable published definition fields while allowing operational fields such as the n8n workflow identifier to change. Acquire reply consumption takes the app gate before membership/policy locks, commits, then ACKs the service; it never holds the app gate while acquiring the service barrier in reverse order.

New exact SQL artifacts and their isolated targets require separate specific approval before any application. No draft migration or trigger change is included in this design document.

## Required verification before activation

Demonstrate genuine REDs and actual PostgreSQL competing-client tests for pause/stop/reply/suppression/membership/content changes racing admission, stale snapshots, unknown writers, quota rollback/double charge, claim/lease expiry and both lost COMMIT responses. Verify the provider is never invoked before definite application commit and never invoked on replay/uncertainty. Exercise both legacy and n8n entry points and all three channels, with synthetic provider ports first. Full history/identity/coverage authority, runtime connection methods and live owned-account verification remain separate prerequisites.
