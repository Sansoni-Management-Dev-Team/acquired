# P3.2 / P3.5 bounded account lifecycle slice

Implemented in the feature worktree, with synthetic local verification only. This does not complete P3.2 or P3.5, enable a connection, expose a disconnect route, change capabilities, or certify history/reply coverage.

## Provider evidence and owner prerequisites

The current official v1 [account GET](https://developer.unipile.com/reference/accountscontroller_getaccountbyid), [account list schema](https://developer.unipile.com/reference/accountscontroller_listaccounts), [DELETE endpoint](https://developer.unipile.com/reference/accountscontroller_deleteaccount), and [account lifecycle guide](https://developer.unipile.com/docs/account-lifecycle) were checked. The retained public OpenAPI snapshot confirms the selected response fields and DELETE's `200` / `AccountDeleted` envelope. V2 account/product status semantics are separate and are not applied to the configured v1 DSN.

`v1-account-lifecycle.ts` authenticates single-account GETs with the existing bounded transport, verifies exact account/type/source, and compares only a previously verified service-owned owner key. Its output projects known fields and excludes display names, usernames, proxy credentials and raw responses.

| Platform | Owner projection | Conservative boundary |
| --- | --- | --- |
| Gmail | `connection_params.mail.id`, namespace `unipile.v1.google.mail.id` | Opaque ID, not an email-address alias |
| Outlook | JSON pair of `mail.id` and optional `mailbox_id`, namespace `unipile.v1.outlook.mail.id` | Shared mailbox scope remains distinct; missing mailbox ID is explicit `null` |
| WhatsApp | `im.phone_number`, namespace `unipile.v1.whatsapp.im.phone_number` | Requires explicit canonical E.164; never invents PN/JID/LID aliases |
| LinkedIn | `im.id`, namespace `unipile.v1.linkedin.im.id` | Opaque value; not presumed to equal a member URN, public URL or premium-product ID |
| IMAP | No owner projection certified | Login/server/display metadata alone returns `identity_pending` |

These namespaces describe provider evidence and **must not replace the global canonical physical-account identity namespace/digest** used for account deduplication. The trusted resolver must independently establish the original physical owner and current grant, then resolve its corresponding recorded provider owner key. Reading an account and reusing its observed owner as the expected owner would be circular verification. Provider-to-canonical owner/alias resolution and a concrete authenticated binder remain necessary runtime work.

The configured source ID is opaque and explicit. Only the exact unique source drives status; a different product being OK cannot compensate. `OK` maps to connected, `CONNECTING` to connecting, `CREDENTIALS`/`PERMISSIONS` to verification_required, `ERROR` to failed, and `STOPPED` to disconnected. Unknown status or duplicate/missing source requires review. These are observations, not capability or initial-sync evidence. Non-OK cached GET data cannot certify fresh replies. No status event/checkpoint persistence or out-of-order lifecycle-event reconciliation is implemented here.

## Neutral coordinator and disconnect boundary

`connection-lifecycle.ts` validates exact application/tenant/owner/connection/physical account/channel/platform/backend/generation. Status resolves current trusted authority, reads the provider, and resolves authority again before returning the sanitized observation. No caller account ID, default connection or fallback can choose the target. Revoked or changed authority rejects the result.

Disconnect uses a required durable port, with no default permission:

1. Resolve the authorized exact current recorded generation and original owner proof. A retired current record may remain readable for terminal replay; inactivity cannot authorize a new operation.
2. Prepare an operation-key-bound exclusive retirement ticket. The concrete port must recheck grant/generation/owner, reject unresolved sends/shared accounts/inactive new work, definitely commit local retirement and coverage invalidation, and fence reconnect plus every account dispatch while the intent is unresolved. Lost or ambiguous commit cannot return a fresh ticket.
3. A terminal duplicate or review returns without provider reads or writes. An uncertain previous attempt must never return another fresh ticket.
4. After a fresh ticket, corroborate the authenticated provider owner. The concrete v1 deletion method also corroborates the same owner immediately before its DELETE. Only documented `200` / `AccountDeleted` is accepted. Lost responses, timeout, 5xx, unclassified 409/422, wrong success envelopes and unexpected success status remain unknown; no retry occurs.
5. Commit the terminal result through the required port. Unknown/rejected outcomes remain retired for explicit reconciliation. A lost result commit returns unknown. Original receipts, holds and bindings are preserved.

Every asynchronous stage shares a monotonic deadline/abort signal; no late provider or finish callback begins after expiration. A trusted port may still commit after the caller loses its response, so exact same-key durable replay is mandatory. The coordinator itself provides no database atomicity or fence implementation.

The existing approved service schema has no disconnect operation/intent in `operation_journal`. Its leases and inactive connection flag alone do not persist a complete recoverable deletion intent. A concrete durable repository and reviewed schema/protocol are prerequisites for exposing this operation. No migration was prepared/applied for this slice and no mock is represented as PostgreSQL proof.

## TDD and scoped evidence

Acceptance coverage: A04 (bounded status/disconnect composition), A05 (scope/owner/generation rejection), A12 (no assumed coverage), A13 (no implicit identity/backend transfer), A22 (sanitized provider output and errors). A11 durable status-event ordering and A04 live/real-storage disconnect remain outstanding.

Direct installed Node/Vitest command:

```sh
node node_modules/vitest/vitest.mjs run \
  communications/packages/adapter-unipile/src/v1-account-lifecycle.test.ts \
  communications/packages/core/src/connection-lifecycle.test.ts
```

Private ignored verification logs contain synthetic data only:

- `account-lifecycle-red.log`: first 46 assertions failed on genuinely missing projection/coordinator/HTTP behavior.
- `account-lifecycle-guard-red.log`: two failures / 50 passes for source-collection proxy traps and configuration accessor execution; corrected before green.
- `account-lifecycle-native-red.log`: one failure / 19 passes; a rejected promised provider configuration crashed strict native Node; corrected rejection observation.
- `account-lifecycle-terminal-replay-red.log`: one failure / 20 passes; provider removal prevented read-only terminal replay; corrected durable replay ordering.
- `account-lifecycle-config-native-red.log`: one failure / 33 passes; rejected promised HTTP configuration crashed strict native Node; corrected observation before rejection.
- `account-lifecycle-final-green.log`: initial 57 assertions pass, including two strict native Node subprocess checks and two real ephemeral loopback HTTP GET→DELETE characterizations (success and lost socket, no retry).

- `account-lifecycle-bind-red.log`: two failures / 21 passes; own `.bind` overrides substituted the configured authority/retirement callbacks. Captures now use the intrinsic binder for all five ports.
- `account-lifecycle-bind-green.log`: final 59 assertions pass, including the native and real loopback HTTP cases. Package build, root TypeScript and scoped lint passed.

`http-core.ts` changes only the method union and mutation classification to include DELETE; existing POST semantics are retained. Regression/build/type/lint results are reported to the parent separately because other agents are working concurrently. Aggregate exports and app routes are intentionally left to the integration owner after review.

No live account GET/DELETE, account pairing, webhook registration, provider mutation, migration, database bootstrap, deployment or capability activation was performed. Next: independently review the owner proof and durable-retirement contract; implement authenticated physical-owner resolution and a specifically approved recoverable intent repository; then compose/export the lifecycle ports and verify actual persistence before any app activation.
