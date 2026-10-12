# Independent core and legacy-wrapper review

Date: 2026-10-12. Source revision: `fa544da5578375efd57af4ba680a403a1568769e` plus shared communications working-tree changes. Scope: read-only review of parent-owned core/legacy wrapper, additive review tests, and authorized fixes to reviewer-owned contracts/Gmail adapter. No app, schema, live provider or credential changes.

## Findings and executable evidence

Additive test file: `communications/packages/adapter-legacy/src/review.test.ts`.

| Finding | Evidence / result | Ownership and next action |
| --- | --- | --- |
| Recovery accepted a different message ID despite a supplied original provider-message reference | The recorded reference was `recorded-message`; the port returned `different-message`. Expected `receipt_mismatch`; received submitted receipt. | Parent wrapper must compare the actual recovered ID to a supplied original message reference. |
| Messaging receipt lookup accepted draft_create/update/delete snapshots | Three tests expected unsupported before port I/O; all received submitted message receipts. | Parent wrapper must gate lookup to supported messaging/relationship operations. |
| WhatsApp accepted an invitation operation when its capability record incorrectly included LinkedIn invitation capability | Expected unsupported and zero submit calls; received submitted and dispatched `connect`. | Parent wrapper must bind invitation support to LinkedIn channel/platform as well as capability. |
| Browser LinkedIn action journal ID was mapped as provider message identity | `services/linkedin/campaign.py` generates its action ID from an operation-key hash; WhatsApp `delivery.mjs` uses actual `sent.key.id`. These are different facts. | Parent authorized and reviewer implemented `ActionReceipt` and `SubmissionReceipt` union; parent will normalize browser LinkedIn submitted actions as explicit operation references. |

Actual red command:

```sh
pnpm exec vitest run communications/packages/adapter-legacy/src/review.test.ts communications/packages/adapter-gmail/src/index.test.ts --reporter=dot
```

At initial review: 6 failures / 27 passes. Five were the parent legacy cases above; the sixth was a reviewer-owned Gmail configuration race. After the Gmail fix and contract changes, the three-suite review command had 5 legacy failures / 90 passes. This document does not call those parent cases verified until the parent fixes and reruns them.

## Reviewer-owned corrections

Gmail read `options.mailbox` dynamically after awaiting readiness. A caller replacing that configuration field during the wait switched the injected sender port while the adapter retained the old binding. Added a failing test before fixing it: expected original sender called once, received zero. The factory now snapshots configuration callbacks and binds original port methods/receivers once. Gmail suite passes 28 tests; digest validation and original content remain captured before waits.

Added explicit action/message submission provenance to contracts. `ActionReceipt` contains an operation reference, intended canonical recipient and optional submitted timestamp; it has no provider-message, delivery, reading or conversation claims. `assertSubmissionReceiptMatches` dispatches to the explicit message/action shape and rejects ambiguous fields. Seven tests failed before the new guard APIs; 62 contract tests pass after implementation. These are local pure-guard checks, not source/provider confirmations.

The current Gmail lookup port returns only provider message/thread IDs. `expectedRecipient` is recorded-operation correlation supplied by the caller. The adapter cannot independently verify that recipient from those sparse results. Its README/evidence explicitly limits that claim; later persisted-journal and richer provider lookups must substantiate stronger guarantees.

## Reviewed core properties and remaining boundaries

- `messageDigest` canonically sorts object fields, omits undefined fields, includes operation and every supplied message field, and hashes a versioned representation with SHA-256. No content or credential is logged. Changed content/threading/headers changes the digest.
- `draftDigest` includes the target namespaced draft reference and content. This guards changed draft/account targets; transactional key ownership/deduplication is a repository responsibility.
- Legacy submit copies caller input before awaiting readiness. Existing parent mutation tests protect content/key and returned receipt metadata. No automatic backend fallback exists in the wrapper.
- Unclassified send exceptions remain unknown. Lookup cannot dispatch. Legacy lookup deliberately omits timestamps supplied by old lookup implementations because some substitute observation time for actual submission time.
- Bound ports must be composed against the actual account they represent. A typed binding or content digest cannot prove a legacy service/token belongs to that account; that requires the app/service composition and persistent generation/account validation in subsequent phases.
- Runtime ingress parsing, cursor/history completeness, account quotas, membership revocation, crash recovery and durable concurrency are outside these pure wrappers. Tests with mocked ports cannot certify those boundaries.

## Follow-up verification

Parent corrected all five original legacy cases and mapped submitted browser LinkedIn results to explicit ActionReceipt operation references. Independent rerun:

```sh
pnpm exec vitest run communications/packages/adapter-legacy/src/index.test.ts communications/packages/adapter-legacy/src/review.test.ts communications/packages/contracts/src/guards.test.ts communications/packages/adapter-gmail/src/index.test.ts communications/packages/core/src/message-digest.test.ts
```

Result: 5 files / 121 tests passed, exit 0. This supersedes the original five red findings as current locally verified behavior; it does not change their recorded red evidence.

A further callback-mutation check then found the generic legacy port has the same configuration race as the original Gmail wrapper: changing `port.submit` during `port.ready` switches the sender function under the original binding. Added the sixth additive review case before parent implementation. `pnpm exec vitest run communications/packages/adapter-legacy/src/review.test.ts --reporter=dot` failed 1 / 5 passed: expected original submit function once, got zero. Parent owns capture/bind of the configured port callbacks/receivers and its green rerun.

Parent then captured/bound the original ready/submit/lookup methods at construction. Independent rerun of the same five-suite command passed 5 files / 122 tests, exit 0. All six additive review cases are green; the earlier red evidence remains above.

Current handoff: original five cases, action-receipt correction and sixth callback-mutation case are locally verified. Reviewer-owned Gmail/configuration and contract/provenance slices are green. Keep this review test file in the final regression suite. Static persistence review lives in [persistence-review.md](persistence-review.md); no migrations ran.
