# All-channel Unipile reply detection: branch and TDD evidence

Started 12 October 2026 for P3.4, with P3.3 normalization and P4.2 integration prerequisites; scoped A05/A09–A13/A21/A22 evidence. User requested a separate branch/worktree for the all-channel reply integration.

Branch: `codex/unipile-reply-detection`. Worktree: `/Users/callum/Documents/Development/project-acquire-unipile-replies`. Base `f66781e75582d279cbc949c5cdb7308af42e7b96` matched remote `main` after fetch. This includes the research changes merged since the earlier `fa544da` baseline. The existing communications foundation was copied by an explicit owned-file inventory, verified byte-for-byte and saved as local commit `d8d0654`; unrelated original-checkout work, credentials/private data, generated outputs and dependency trees were excluded. The original checkout remains on `main` with its prior uncommitted work.

The worktree temporarily uses an ignored symlink to the existing dependency installation. Pnpm 11's pre-run dependency check attempted a reinstall and refused the symlink without a terminal; no install was performed. Direct Node invocations of the installed Vitest/TypeScript/ESLint binaries avoid changing shared dependencies. Fixture env testing now resolves `@next/env` through its actual parent package, Next, so strict pnpm/worktree layouts run the same synthetic credential-isolation assertion.

## Implemented boundary

- [V1 normalizer](../../communications/packages/adapter-unipile/src/v1-events.ts): email, WhatsApp and LinkedIn incoming events with exact account/generation/product correlation, trusted canonical sender aliases, verified direct participants and bounded timestamps. Email requires authenticated full-message/header enrichment. Nonreply/outgoing/self/group and known system events are excluded; ambiguous or contradictory evidence goes to review. Spam/trash/custom incoming folders are reviewed, not silently dropped. Output projects known contract fields and contains no message body; parent email IDs are not thread IDs.
- [Ingress/processor](../../communications/packages/core/src/reply-ingress.ts): provider-neutral injected envelope validation, immutable scope/callbacks, raw-byte receipt dedupe and required encrypted capture port; separate fenced claim, enrichment/matching and atomic finish port. Semantic event keys include conversation namespace; fingerprints normalize equivalent timestamps. Wrong scopes, unknown identities and corrupt records cannot become confirmed replies.
- [Native listener](../../communications/services/api/src/reply-webhook-server.ts): a standalone `POST /v1/webhook` boundary with raw-header authentication before reading bytes, exact JSON content type, byte/time limits and sanitized responses. The listener is exported, not installed into current app routes and not registered with Unipile. HTTP 200 requires the awaited capture result to confirm accepted/duplicate.
- [OrbStack runner](../../scripts/test-communications-replies-orbstack.mjs): compiles the package and runs the [all-channel proof](../../scripts/communications-reply-fixture-proof.mjs) in a fresh Node 22 container. Network egress disabled, root and sole compiled-code mount read-only, no env/credentials/database mounts, no replacement of existing channel/communications containers.

## Actual red–green evidence

All logs below are ignored/private in this worktree's `.local-data/communications/verification/`, mode 0600. Setup failures are distinguished from intended behavioral failures.

| Slice | Actual red | Green/refactor scope |
| --- | --- | --- |
| V1 normalizer | `v1-events-red.log`: 35 failures on stub, 20 rejection characterizations passed | Matching account/product/sender, exact scoped chat/aliases, full enriched email and exclusion/review behaviors |
| Normalizer contradictions | `v1-events-contradictions-red.log`: three failures; `v1-events-email-kind-red.log`: one failure | Raw/enriched contradictions and incomplete variants cannot settle reply evidence |
| Folder/metadata/product review | `v1-events-folder-and-sanitization-red.log`, `v1-events-review-product-red.log`, independent normalization red | No lost spam/trash reply evidence; no extra metadata in output; invented product rejected |
| Ingress/processor | `reply-ingress-red.log`: 28 behavioral failures, four guards passed | Durable-port acknowledgement ordering, scope/body validation, all-channel matching/stop and uncertainty |
| Malformed stored receipt | `reply-ingress-invalid-record-red.log`: one failure, 32 passes | Corrupt stored bytes reviewed before enrichment/matching |
| Independent semantic/provenance review | `reply-independent-semantic-red.log`, `reply-independent-nested-red.log`, `reply-independent-direction-red.log` | Chat-scoped IDs, equivalent timestamp fingerprints, exact nested schemas and string direction |
| HTTP listener | `reply-http-red.log`: 30 failures, four guards passed | Real loopback authentication/body/status/acknowledgement tests |
| HTTP duplicate header review | `reply-http-review-red.log`: duplicate Content-Type failure | Duplicate content type rejected; accessor-bearing results never serialized/invoked |
| HTTP capture deadline | `reply-http-capture-timeout-red.log`: seven failures, 36 passes | Hanging capture returns 503 within budget; late storage commit cannot produce a later 200; configured body/capture sum under 30 seconds |

Independent review-only regression files are `reply-review.test.ts` and `v1-events-review.test.ts`. Pure tests and loopback tests demonstrate observable boundaries; they do not prove a database transaction.

## Verification and remaining work

Latest verified counts and commands are recorded in [progress](progress.md) and [verification](verification.md). Run from this worktree:

```sh
node node_modules/vitest/vitest.mjs run communications
node node_modules/next/dist/bin/next typegen
node node_modules/typescript/bin/tsc --noEmit
node scripts/test-communications-replies-orbstack.mjs
```

The native fixture composes actual ingress, normalizer, processor and HTTP listener for all three channels. It verifies exact account/auth rejection, capture failure without acknowledgement, raw and semantic duplicate handling, review outcomes and one person identity across channel-specific stop decisions. Its storage/hold/outbox ports are **synthetic memory fixtures**. Restart durability, PostgreSQL RLS/grants, lease fencing and actual Acquire campaign stops are not proven. No source status, receipt acknowledgement or event arrival advances reply coverage.

Required persistence implementation uses two databases and two transactions: the service commits encrypted event, scoped subscriber outbox and terminal webhook together; Acquire commits its receipt/fingerprint, current identity/cutoff decision, person-wide holds, stops and audit together, then acknowledges the service. No ordinary transaction spans both databases. See [storage continuation](webhook-storage-tdd.md) for the implemented encrypted capture/claim protocol and service-only processor. Actual PostgreSQL validation remains pending exact schema approval, as do terminal event/outbox repositories and application consumption. Review decisions must block coverage across all relevant channels/owners; reconnect must preserve original event bindings and existing holds. Both new storage schemas remain unapproved/unapplied; the earlier three parity approvals do not authorize them.

Required provider/application implementation: trusted default-format v1 webhook subscription routing and secret rotation; actual read-only chat/alias/full-email enrichment; asynchronous worker scheduling/replay; lifecycle invalidation and initial/history reconciliation; complete/fresh product/folder coverage; existing campaign reply-store integration and mixed-backend stops. Webhook receipt alone proves neither absence of replies nor a complete sweep. Inbox-only email normalization requires review/reconciliation for other received folders; known automated events need explicit application policy before activation.

The branch is local, with no push, deployment, new migration or live provider registration/write. Existing connection routing/UI and active campaigns are unchanged.
