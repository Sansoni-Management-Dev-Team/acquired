# P1 contracts evidence and handoff

Date: 2026-10-12. Base revision: `fa544da5578375efd57af4ba680a403a1568769e`. Tests ran against the working tree, including the pre-existing uncommitted `AGENTS.md`, execution-plan/progress documentation and unrelated `output/aws-infrastructure-review/`. This slice changed only `communications/packages/contracts/` and this evidence file. Parent-agent changes may coexist in the shared tree.

## Scope and status

- P1.1: implemented version-1 transport types and locally verified pure guards for ownership, frozen bindings, operation snapshots, receipt provenance and coverage.
- P1.2: implemented separate messaging, event, connection, optional email draft and LinkedIn relationship interfaces. Adapter implementations and shared conformance checks remain parent-agent work.
- P0.1: inspected the current delivery registry/adapters, Gmail mailbox, reply provider/page types and relevant tests; full application/runtime inventory remains parent-agent work.
- P0.2: scoped characterization baseline passed before additions and remains passing afterward.
- No live verification, release, database change, credential access, account connection or external send occurred in this slice. Pure guards do not certify whole acceptance scenarios.

## Baseline review and command

Reviewed `vitest.config.mts`, package scripts and the four test files below before execution. These scoped tests use synthetic mailbox fetchers or mocks; they do not initialize a database or invoke a schema/migration runner. They exercise Gmail MIME/drafts/history/error handling, original delivery receipt/error normalization and existing reply freshness/identity rules.

```sh
pnpm exec vitest run src/adapters/mailbox.test.ts src/lib/channels/delivery-registry.test.ts src/lib/channels/email-reply-reader.test.ts src/domain/campaign-replies.test.ts
```

Before additions: 4 files / 30 tests passed at 09:10:49 local tool clock. Exit 0. Passing characterization tests were reused; legacy implementations were not moved or modified.

## Red–green evidence

Tests: `communications/packages/contracts/src/guards.test.ts`. Fixtures are synthetic; no environment files or credentials are loaded.

| Behavior / acceptance scope | Red evidence | Green evidence |
| --- | --- | --- |
| Exact original connection selection; missing-original rejection; application/tenant/owner checks; no fallback; generation-bound recovery (A05/A07/A13/A15), immutable journal snapshots (A06/A07), complete fresh query coverage (A12/A13) | Before guard implementation, `pnpm exec vitest run communications/packages/contracts/src/guards.test.ts --reporter=dot` failed: 41/41 tests, exit 1. Missing exported guard functions were the intended absent API/behavior; existing module/types loaded correctly. Assertions required the specific unavailable/forbidden/conflict results, rather than accepting any thrown exception. | After implementation, same contract tests plus four characterization files passed: 5 files / 71 tests, exit 0. |
| Account/backend/generation/recipient/conversation receipt provenance without synthetic timestamp claims (A08) | Added six receipt tests before `assertReceiptMatches`; same contract command failed 6 tests / 41 passed, exit 1, due to absent receipt validation API. | After implementation, same combined suite passed 5 files / 77 tests, exit 0. |
| Reject incompatible backend/channel/platform combinations (P1.1/A05/A13 subset) | Added eight cases; same contract command failed 3 tests / 52 passed, exit 1. Assertion: expected incompatible bindings to throw `invalid_binding`, received no error. | Added backend/channel compatibility enforcement. Final combined suite passed 5 files / 85 tests, exit 0 (55 contract + 30 legacy characterization). |

Final green command:

```sh
pnpm exec vitest run communications/packages/contracts/src/guards.test.ts src/adapters/mailbox.test.ts src/lib/channels/delivery-registry.test.ts src/lib/channels/email-reply-reader.test.ts src/domain/campaign-replies.test.ts
```

Final isolated typecheck and lint commands both exited 0:

```sh
pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2017 --module esnext --moduleResolution bundler communications/packages/contracts/src/index.ts communications/packages/contracts/src/guards.test.ts
pnpm exec eslint communications/packages/contracts/src
```

## Contract decisions

- `ConnectionBinding` includes application/tenant/owner, connection ID, service-owned account identity, generation, channel, platform and backend. No Acquire actor, membership-table, campaign or database type enters the package.
- Readiness and coverage are separate. Resolution permits a disconnected original for read-only lookup; it does not authorize submission.
- Original unknown outcomes stay unknown. Lookup absence has no retry/failover implication. `ReceiptLookup.rfcMessageId` is read-only correlation metadata needed by the current Gmail recovery path.
- Provider receipt timestamps are optional. Wrappers must not invent a submission time from lookup time. Skipped actions are operation references rather than fabricated messages.
- Email draft and relationship operations are separate capability interfaces; current legacy wrappers need not implement unsupported features.
- Coverage binds the exact query scope and account generation. Completeness and provider-covered timestamp must be established by adapters, not inferred from successful transport.
- `direct` is restricted to the email channel, `baileys` to WhatsApp and `browser` to LinkedIn; Unipile can bind all three channels. A valid platform does not enable that platform or imply account/product availability. Actual enabled platforms remain adapter configuration/capability decisions.

## Entry points to preserve during wrapping

The registry cannot alone cover the extraction. Direct backend calls also appear in `campaign-service.ts` (LinkedIn acceptance branching and manual/conversation checks), `campaign-mailbox.ts` (mailbox token/ownership binding), the Gmail draft-approval domain/API, `campaign-reply-monitor.ts` (provider identity and history aliases), channel connection routes/settings/health, and social runtime/reply-provider functions. The plan inventory covers these areas; the parent must verify every entry point routes through the appropriate connection boundary before P4 can be complete.

## Exact next action

### Follow-up independent review

Parent-authorized correction: `DeliveryOutcome.submitted` now uses `SubmissionReceipt = MessageReceipt | ActionReceipt` so accepted LinkedIn journal actions do not fabricate provider-message references. Added seven action/union provenance tests before guards: `pnpm exec vitest run communications/packages/contracts/src/guards.test.ts --reporter=dot` failed 7 / 55 passed (exit 1, intentionally missing action/union guard APIs). After implementation, 62 contract tests pass. New guards validate operation binding/recipient and reject ambiguous action+message or action delivery/read fields. Actual MessageReceipt remains required for delivery/read events and real message identifiers. See [legacy-wrapper-review.md](legacy-wrapper-review.md).

Current stage: green; no pending red tests. Parent can import `communications/packages/contracts/src/index.ts`, implement dependency-injected core/legacy wrappers, and run adapter conformance checks while keeping the four legacy characterization files passing. Persistence, transactional deduplication, quotas, fencing, membership revocation, live receipt provenance and actual complete history remain unverified. No migration is necessary for these contracts; do not create a schema to run their tests.
