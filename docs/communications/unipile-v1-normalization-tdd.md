# Unipile v1 normalization: scoped TDD evidence

Task slices: P3.1 and P3.3. Acceptance subsets: A05–A08/A12–A15 provenance and uncertainty guards. These pure helpers do not complete the persistent adapter, connection lifecycle, provider capability verification, or any whole acceptance scenario.

## Contract evidence

The instance's unauthenticated OpenAPI document is retained privately at `.local-data/communications/verification/unipile-v1-openapi.json`. Its v1 response contracts distinguish:

- `Account`: exact account ID/type, product objects inside `connection_params`, and a `sources` array with independent source IDs/statuses. Source IDs are arbitrary strings in the schema. `GOOGLE_OAUTH`, `OUTLOOK`, and `MAIL` map to the explicit Gmail/Outlook/IMAP platform choices; calendar-only account types do not map to email.
- `MessageSent`: an explicitly described Unipile `message_id`, which can be null, without account/recipient/time fields.
- `Message`: its Unipile `id`, `account_id`, `chat_id`, numeric `is_sender`/`is_event`/hidden/deleted flags, and a string timestamp. It has no recipient/To identity.
- `UserInvitationSent`: `invitation_id`, which is an action reference rather than a messaging endpoint's message ID.
- `EmailSent`: `tracking_id` plus nullable `provider_id` and Outlook-specific nullable `provider_immutable_id`. The namespace is insufficiently demonstrated to expose a message receipt or lookup reference. No email-send normalizer was added; a tracking ID is never substituted for a message ID.

Primary references: [Retrieve an account](https://developer.unipile.com/reference/accountscontroller_getaccountbyid), [official v1 API documentation](https://developer.unipile.com/docs/getting-started). Live instance account-list authentication was verified separately; no connected account or live message/invitation was used for these tests.

## Implementation boundary

`communications/packages/adapter-unipile/src/v1-normalization.ts` contains plain synchronous helpers. They import only shared contracts, never environment settings, a provider SDK, a network client, or application persistence.

`normalizeV1AccountReadiness` requires the immutable binding, exact provider account ID, and an explicitly configured relevant source ID. The caller must obtain that source ID from verified product configuration, rather than selecting whichever source happens to be healthy. The helper does not guess source names or accept an empty/absent/duplicate/unknown source. It checks the exact platform account type and relevant `mail`/`im` product-object presence. A healthy status returns only account transport health, without credentials, connection parameters, capability claims, or reply/history freshness. Capability and coverage admission remain separate responsibilities.

`normalizeV1MessageSent` is for an existing chat whose account/chat/recipient correspondence was verified before dispatch. Its receipt uses only the returned Unipile message ID and immutable caller references. A null/malformed ID or invalid operation/channel/chat binding remains unknown. The response itself does not independently prove recipient/account identity; the caller must preserve the verified dispatch context. No time, delivery, or reading fact is invented.

`normalizeV1MessageLookup` requires the original recorded message reference. It checks exact message/account/chat, outbound flags, and the recorded operation recipient against the caller's separately verified direct-chat recipient mapping. This is correlation metadata, not independent recipient proof from the provider response. It cannot recover a lost-response send by searching recipient or message content. Strict RFC3339/calendar validation prevents permissive date parsing from rolling nonexistent dates forward. Seen/delivered flags do not become fabricated timestamps.

`normalizeV1InvitationSent` emits `ActionReceipt.operation` from the invitation ID and never a message receipt. All returned binding/recipient/reference objects are detached copies.

## Red/green evidence

1. Defined four public functions with deliberate `not implemented` stubs and 49 behavior assertions. `pnpm exec vitest run communications/packages/adapter-unipile/src/v1-normalization.test.ts` failed all 49 tests for the intended missing behavior. Private log: `v1-normalization-red.log`.
2. Implemented exact provenance/status/response guards. The same unchanged 49 assertions passed. Private log: `v1-normalization-green.log`.
3. Scoped Unipile and shared-contract regressions passed 161 tests across five files at this checkpoint. Private log: `v1-normalization-regressions.log`.
4. Targeted ESLint passed. Private log: `v1-normalization-lint.log`. Strict isolated compilation of the production normalizer and its shared contracts passed (`pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2022 --module commonjs communications/packages/adapter-unipile/src/v1-normalization.ts`); private log: `v1-normalization-types-scoped.log`. Initial whole-package typecheck encountered an in-progress sibling transport refactor (`http-core.ts` referencing the old configuration type); this was reported to the owning agent. After that refactor settled, `pnpm exec tsc --noEmit -p communications/tsconfig.build.json` passed; private log: `v1-normalization-types-final.log`.
5. Independent review added seven assertions: six failed because control/dot/oversized IDs were emitted as submitted and an explicit contradictory send-response chat ID was ignored; the opaque slash/percent ID characterization already passed. Private red log: `unipile-v1-normalization-review-red.log`. Hardened addressable references to the transport's 2,048-character/no-control/dot-path limits without imposing those path limits on operation digests/keys/source IDs; rejected a contradictory explicit chat ID. All 56 original/review assertions passed; private green log: `v1-normalization-review-green.log`.

These logs contain synthetic inputs only and live under the ignored private verification directory. No database migration, real account setup, live send/invitation, durable operation admission, receipt persistence, quota proof, webhook processing, or deployment occurred in this slice.

Current state: green. Next integrate the helpers behind bounded v1 transport and durable admission/original-binding validation; verify real namespaces and direct-chat mapping with approved connected test accounts before enabling capabilities. Do not treat these pure helper tests as provider or storage compatibility proof.
