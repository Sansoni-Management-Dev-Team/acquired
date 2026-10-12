# P1 direct Gmail adapter evidence and handoff

Date: 2026-10-12. Base revision: `fa544da5578375efd57af4ba680a403a1568769e`. Tested against the shared working tree. This slice owns `communications/packages/adapter-gmail/` and this evidence file, plus the approved addition of `ReceiptLookup.expectedRecipient` in contracts. Parent-agent core/digest and other adapter changes may coexist in this tree.

## Scope and verification level

P1.3: implemented a dependency-injected, framework-free wrapper for direct Gmail messaging, receipt recovery and optional draft CRUD. P1.4: locally verified synthetic port conversion and guard behavior alongside unchanged Gmail mailbox/draft/registry characterizations. This is a fixture/contract boundary, not the whole application integration or a live provider certification.

No application files, database schema, auth tokens, environment values, live connections or provider requests were accessed/modified by this slice. No migration, send, deployment or release occurred. OAuth/read/history extraction and wiring this adapter into Acquire remain unfinished parent/plan tasks.

## TDD evidence

Test file: `communications/packages/adapter-gmail/src/index.test.ts`.

| Slice / acceptance subset | Red evidence | Green evidence |
| --- | --- | --- |
| Bind direct Gmail send/drafts/lookup to original sender/account/generation; convert message/thread/RFC correlation; block incorrect operation/digest/ref; retain unknown outcomes without retries; draft CRUD remains draft-only (P1.3/A01/A06/A07/A08/A17) | Before the factory existed, `pnpm exec vitest run communications/packages/adapter-gmail/src/index.test.ts --reporter=dot` failed 23/23 tests, exit 1: `createGmailAdapter is not a function`. Port/interface types loaded; missing production adapter behavior was the intended red condition. | After implementation, same command passed 23/23 tests, exit 0. |
| Do not accept an unexpected returned conversation for a requested thread (A08 threading subset) | Added a mismatch test before the thread guard. Same command failed 1 test / 26 passed, exit 1. Expected `{status:'unknown'}`, received submitted receipt with `other-thread`. | Guard added; final adapter cases all 27 pass. Post-send mismatch stays unknown and does not retry. |
| Shared canonical SHA-256 integration and extra protection cases | Replaced synthetic test digest injection with actual parent-owned core `messageDigest`/`draftDigest`, then exercised case normalization, mismatched lookup ID and blocked draft readiness. Existing implementations already met those extra assertions; no artificial defect was introduced. | These cases passed with the mismatch fix and relevant characterizations. |

Final regression command, exit 0, 6 files / 113 tests passed:

```sh
pnpm exec vitest run communications/packages/adapter-gmail/src/index.test.ts communications/packages/contracts/src/guards.test.ts communications/packages/core/src/message-digest.test.ts src/adapters/mailbox.test.ts src/domain/gmail-draft-approval.test.ts src/lib/channels/delivery-registry.test.ts
```

The original Gmail mailbox characterization was reviewed/run before this slice (see [contracts-tdd.md](contracts-tdd.md)): MIME, draft CRUD, lookup/history and ambiguity behavior passed unchanged. The additional Gmail draft-approval tests in the final regression also passed. The reviewed scoped tests use mocks/synthetic ports, initialize no database and issue no migrations.

Strict isolated typecheck and lint both exited 0:

```sh
pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2017 --module esnext --moduleResolution bundler communications/packages/adapter-gmail/src/index.ts communications/packages/adapter-gmail/src/index.test.ts
pnpm exec eslint communications/packages/adapter-gmail/src
```

## Boundary decisions and limitations

- Existing `GmailMailbox` port signatures are reproduced locally as plain types rather than importing Acquire types. The parent can compose existing mailboxes through those structural interfaces without moving credentials.
- Canonical recipient normalization trims/lowercases email values before provider mapping. The digest still covers the original input so changed contents cannot pass an old fingerprint.
- Conversation, draft and message references must use the original binding. Unsupported channel/backend/platform combinations cannot construct this adapter.
- Draft update/delete fingerprints include target draft identity and message content, using injected core helpers. This prevents accidentally addressing another draft under the same supplied fingerprint; transactional operation-key deduplication remains the core repository's responsibility.
- `durableIdempotency` remains false. This wrapper does not implement Gmail idempotency, persistence, operation leases, membership revocation or physical-account deduplication.
- `ReceiptLookup.expectedRecipient` is correlation metadata from the recorded operation. Legacy lookup currently supplies only message/thread IDs. Such correlation does not independently establish provider recipient identity; later richer provider receipts/conformance checks must make any stronger claim.
- Unavailable provider timestamps are omitted. Unknown or missing recovery results cannot justify dispatch. Read-only lookups do not trigger readiness, retries or send operations.
- Read/event/history capabilities remain false until a normalized reader exists. No successful account readiness result certifies historical coverage.
- Existing send/readiness gates are injected and retained; no local/live gate was enabled by this adapter.

## Exact next action

### Follow-up configuration-race correction

Independent review found `options.mailbox` could be replaced by a caller during asynchronous readiness, causing dispatch through a different injected port under the old binding. Added a failing test before changing production behavior: expected original sender call count 1, got 0. Factory configuration and bound port callbacks are now captured once. `pnpm exec vitest run communications/packages/adapter-gmail/src/index.test.ts --reporter=dot` passes 28 tests after the fix. No automatic fallback or account change was introduced. The contract submission receipt union was also corrected to distinguish accepted journal actions from actual provider-message receipts; Gmail still emits MessageReceipt. Reviewer-owned code passes strict isolated TypeScript and lint. See [legacy-wrapper-review.md](legacy-wrapper-review.md).

TDD stage: green. Parent should compose the existing mailbox/readiness/error-classification ports at the Acquire boundary, integrate through the bound core/SDK, and retain existing sender ownership/draft and reply-readiness behavior. Add conformance tests using the parent core around direct Gmail and existing social backends. Keep operation journals authoritative and preserve unresolved sends. No database migration is needed to run these pure adapter tests.
