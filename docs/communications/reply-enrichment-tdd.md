# Read-only v1 reply enrichment and transport TDD

12 October 2026; continuation on `codex/unipile-reply-detection` in the separate reply worktree, after `42b76d8`. P3.3/P3.4 and P3.5 prerequisites; scoped A05/A09–A13/A22. No new schema, live provider request/registration/write, route switch or deployment occurred. The two exact local schema approval requests remain separate from authorization to continue code work.

## Implemented scope

[Read transport](../../communications/packages/adapter-unipile/src/v1-http.ts) now provides account-scoped chat listing and guarded chat-message/attendee reads. [Enricher](../../communications/packages/adapter-unipile/src/v1-reply-enrichment.ts) corroborates default-format authenticated webhook events before passing them to the pure classifier:

1. Match the immutable original binding/generation/provider account and bounded event timestamp.
2. Read the actual account, validate platform and selected source, and require the current physical-owner verification port against the detached recorded owner snapshot.
3. For social channels, read the exact chat and its complete attendee evidence; require direct chat, two distinct account-scoped participants, exactly one self and the recorded owner/peer IDs.
4. Read the exact message; correlate account, chat, message, sender/attendee and timestamp. Reject contradictory flags, exclude system/invitation/acceptance subtypes and review unsupported subtypes.
5. Resolve a separately verified canonical alias with exact binding, account, source, provider ID and product; no phone/LID/profile-name guessing.
6. For email, fetch the exact full `2_full` email with headers and corroborate sender/date/account plus supplied platform/provider/RFC references. Missing/empty headers, incomplete variants and unfamiliar received folders remain review.

All operations are reads. One AbortSignal and monotonic deadline span provider and authority/alias awaits; elapsed work cannot proceed to alias resolution just because a blocked event loop delays the timeout timer. Transient failures throw bounded `ReplyEnrichmentReadError` codes so the processor retains retryability instead of marking them nonreplies. No read result certifies history absence, completeness or freshness.

## Contract discoveries and version boundaries

- [Attendee list](https://developer.unipile.com/reference/chatscontroller_listattendees) has only the chat ID path parameter; no account/pagination query is documented. Its response nevertheless has a cursor. The transport validates exact chat/account before reading the unscoped endpoint; the enricher requires a terminal null cursor. It does not invent pagination or treat a partial page as complete.
- [Chat lookup](https://developer.unipile.com/reference/chatscontroller_getchat) supports the account parameter. Message-list reads also require exact chat preflight because their endpoint lacks an account filter.
- [Full email lookup](https://developer.unipile.com/reference/mailscontroller_getmail) uses `include_headers=true`. Instance OpenAPI `kind:"2_full"` has no `is_complete` field. The normalizer now accepts this documented full variant through required full-fetch context, without fabricating a vendor flag; explicit contradictory/incomplete flags still fail. Missing headers never become an invented empty array.
- [Message semantics](https://developer.unipile.com/docs/message-payload) distinguish human messages from LinkedIn invitations and InMail acceptance/decline. The default webhook can omit those details; actual message corroboration closes that classification gap in this pipeline.
- WhatsApp account phone metadata does not prove a provider PN/LID namespace; IMAP login is not necessarily the mailbox identity. Owner verification and alias provenance remain required trusted ports. Current enrichment supports WhatsApp and LinkedIn Classic/Sales Navigator/Recruiter; organization mailbox proof is not implemented and that runtime product is rejected.

The original private instance schema snapshot was read only for operation/property contracts; no credentials were printed or copied. Its documented hash remains in [v1 investigation](unipile-v1-contracts.md). Public references were rechecked for this slice; these fixtures are not live account certification.

## Actual TDD and independent review

Logs are private/ignored under this worktree's `.local-data/communications/verification/`, mode 0600.

| Slice | Actual red evidence | Verified behavior |
| --- | --- | --- |
| Read-only transport | `v1-reply-http-red.log`; review red for hidden query fields/accessors | 41 new tests; exact documented GET/query scope, immutable pagination, no sync endpoint or write |
| Full email contract | `v1-events-full-get-contract-red.log`: documented full response rejected without nonexistent flag | Eight new regressions; trusted full variant accepted, incomplete/contradictory variants rejected |
| Enrichment | `reply-enrichment-red.log`: 17 missing-behavior failures/18 guards passed | All-channel account/source/owner, chat/attendee/message/email corroboration, alias provenance and failure/deadline behavior |
| Message subtype | `reply-enrichment-subtype-red.log`: array coerced into invitation | Subtype requires valid runtime string; no coerced nonreply classification |
| Independent references/deadline review | `reply-enrichment-independent-red.log`: four failures, three proof characterizations passed | Conflicting email platform/provider/RFC references and synchronous deadline overrun rejected; seven independent assertions green |
| Runtime configuration | `reply-enrichment-config-red.log`, `reply-enrichment-missing-addresses-red.log` | Unsupported LinkedIn products/mismatched WhatsApp product rejected; canonical nonempty owner arrays required. Array test rows were wrapped as objects to pass the actual array rather than Vitest-spread arguments. |

The immutable-input test's alias fixture now owns a detached binding snapshot: changing the outer options must not also mutate the supposed authoritative alias record. Wrong returned alias provenance remains separately rejected. No intended assertion was removed to hide a failure.

The enrichment slice has 44 owned tests plus seven independent tests. With 41 transport and eight full-email regressions, this continuation adds 100 assertions. Current final suite/copy results are in [verification](verification.md).

## Native integration and remaining work

The [OrbStack proof](../../scripts/communications-reply-fixture-proof.mjs) now uses an actual `UnipileV1Transport` against provider-shaped native loopback HTTP routes, the new enricher, actual webhook/core processor and synthetic storage/hold ports for all three channels. Every provider-shaped request is asserted GET; chat preflight and email-header queries are checked. No network egress or real provider activity is possible in that container. Raw/semantic replay, unmatched aliases and person-wide stop decisions are exercised.

Concrete identity/owner repositories, encrypted PostgreSQL ingress, fenced workers, transactional event/hold/outbox integration, lifecycle invalidation, backfill/full-history coverage, revoked-membership races and live account/platform validation remain outstanding. Synthetic authority/storage ports do not establish those guarantees. Choosing an API backend must not switch existing campaigns or clear holds. The separate exact schema approvals remain required before database execution.
