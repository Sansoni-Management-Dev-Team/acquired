# Agent store cleanup map

Plane: [L0D499CD9-177](https://plane.mlai.au/mlai/browse/L0D499CD9-177/), C06. Inspected 21 October 2026 in `codex/agent-mode-exploration`, including existing uncommitted work. This is an implementation inventory, not evidence of production release or permission to migrate, send or restart services.

## Committed integration and historical slice evidence

The detailed measurements below describe each reviewed extraction snapshot. The independent commits package ledger/digest, operation families, progress/decision projections and ordered review readers against the older committed branch base. Their source/SQL inverses preserve bodies, parameters, signatures and ordering; composition proofs preserve earlier classification and ledger changes. Before/after evidence comprises 56 ledger/digest cases, 72 operation-family cases, 31 projection cases and 61 ordered-context cases. That independent tree passes 4,923 Vitest and 108 Node tests; focused synthetic PostgreSQL review cases separately pass 9/9 with zero own fixture rows left.

Feature checkpoint `67b7c74` now integrates the richer `research.fields`, version-2, automatic-demo, business-clock and reply-causality implementations on top of those extractions, together with every prior feature-dependent cleanup hunk. Its exact frozen tree passes 6,381 Vitest tests and 165 Node tests, fresh TypeScript and scoped lint; skipped/gated tests remain explicitly unverified. No whole-class rewrite remains required by C06. See the [final commit handoff](agent-cleanup-review-handoff.md) for scope, actual PostgreSQL/GUI receipts and preserved unrelated UI work.

## Current inheritance and responsibilities

The production factory `agentStore()` in `src/lib/agent-runtime.ts` constructs `AgentInvitationStore`. The chain contains **18 classes and 17 inheritance edges**. Intermediate classes are also instantiated directly by tests and some consumers; changing the factory alone does not replace their contracts.

| Base → derived | File under `src/db/` | Responsibility and inherited dependencies |
| --- | --- | --- |
| 1. AgentStore | agent-store.ts | Scoped transactions, membership/RLS, threads/messages/events, operation/review manifests, authority grants and conversation turns |
| 2. AgentGuidanceStore | agent-guidance-store.ts | Feedback, approved guidance and memory decisions |
| 3. AgentBudgetStore | agent-budget-store.ts | Budget settings, reservation and settlement |
| 4. AgentRuntimeRegistryStore | agent-runtime-registry-store.ts | Registered runtime readiness and controlled-runtime registration |
| 5. AgentExecutionStore | agent-execution-store.ts | Native transaction/command wrappers, execution fences, supervision, conversation opening and execution state |
| 6. AgentLifecycleStore | agent-lifecycle-store.ts | Conversation locks, history ingestion, reminders and handoffs |
| 7. AgentOutreachStore | agent-outreach-store.ts | Message proposals, dispatch authority, exact receipts, budgets and reconciliation |
| 8. AgentModelStore | agent-model-store.ts | Model attempts, leases and receipts |
| 9. AgentOwnershipStore | agent-ownership-store.ts | Human/agent/sequence ownership, review holds and explicit resume |
| 10. AgentHandoffStore | agent-handoff-store.ts | Human task inbox/actions/reminders |
| 11. AgentResearchStore | agent-research-store.ts | Research review context, funding, launches, attempts and field plans |
| 12. AgentTargetStore | agent-target-store.ts | Reviewed target selection and allocation |
| 13. AgentPeopleStore | agent-people-store.ts | People research, eligibility and profiles |
| 14. AgentSequenceStore | agent-sequence-store.ts | Draft sequence review and persistence |
| 15. AgentSequenceExecutionStore | agent-sequence-execution-store.ts | Publication, enrolment and reconciliation |
| 16. AgentChatStore | agent-chat-store.ts | Native chat context and saved conversation plans |
| 17. AgentChannelStore | agent-channel-store.ts | Exact channel policy/routes/history, channel ownership, outcome/resume proofs and progress |
| 18. AgentInvitationStore | agent-invitation-store.ts | LinkedIn relationship observations and distinct human-reviewed invitation effects |

## Cross-feature override paths

| Method | Implementation path | Contract that extraction must preserve |
| --- | --- | --- |
| executionChannelProgress | Execution passthrough → Channel people/routes/coverage → Invitation relationships/actions | Called inside `executionState`'s existing native transaction. Channel enrichment runs before invitation enrichment. Optional table checks, protected public company facts, tenant/name joins and oldest coverage are preserved. UI readiness is a projection, not dispatch authority. |
| invalidateNativeReviews | Execution message operations → Invitation adds invitation operations after `super` | Mutates proposed/approved operations and pending exact manifests inside the caller's transaction. Lifecycle/history/ownership/outcome code invokes the most-derived override. Preserve invitation distinction and every invalidation callsite. C05 owns operation-classification cleanup. |
| nativeChannelDecisionContext | Outreach empty fallback → Channel readiness/causality → Invitation per-action eligibility/relationships after `super` | Read within `nativeDecisionContext`'s locked conversation. Preserve route-specific SQL admission checks and causality; do not infer action authority from presentation state. |
| proposeNativeMessage | Outreach reviewed route/evidence/CAS proposal → Invitation forces human review and emits acknowledgement | Invitation override calls `super` with `forceHumanReview: true`, then acknowledges separately. Preserve command idempotency, exact evidence/route/epoch/context, manifest and explicit invitation review. Do not merge transactions as incidental cleanup. |
| pendingNativeEmail | Outreach pending message query → Invitation replacement also includes invitations | The name is historical: current top-level behavior is multichannel. Both versions own a native transaction and lock the conversation; proposed work counts only with a pending manifest. Intermediate-class callers retain their own operation sets. C05 owns list classification. |

Other override clusters matter before flattening: `checkReviewContext` traverses root/research/targets/people/sequences/publication; research specification/provider context is specialized by People; conversation-plan persistence is specialized by Chat; Channel specializes ownership, revocation, routed outcomes and original-history resume proofs; Invitation specializes dispatch records, admission, abandonment, receipts and relationship proofs. Several older overrides omit the TypeScript `override` keyword, so keyword search alone misses them.

## First coherent extraction

Extracted the read-only execution progress projection into `src/db/agent-execution-progress.ts`:

- `projectAgentChannelExecutionProgress(client, thread, conversations, businessSql)` owns saved lead/company/draft enrichment and channel progress/coverage projection.
- `projectAgentInvitationExecutionProgress(client, thread, people)` adds exact-route relationship and latest invitation status.
- Existing protected wrappers remain in Channel and Invitation. Invitation still calls `super` first. Execution's passthrough remains, preserving intermediate-class behavior.

The collaborator accepts only the caller's query-capable transaction client, owned thread, already-loaded rows and server-selected clock expression. It does not connect, start/commit a transaction, change role, acquire authority, mutate state or invoke a provider. Queries and query order are unchanged. Type-only imports avoid a runtime dependency back into the store chain.

At this first stage, the read projection was the only extraction; proposal/review/dispatch methods were excluded until their transactional contracts were characterized. The later sections record the additional decision-context, ordered-validator and review-ledger extractions. The 18-class chain remains throughout; C06 requires incremental collaborators and a reduced dependency/override surface, not a particular final class count.

## Characterization and verification

New `agent-execution-progress.test.ts` exercises the existing **public `executionState()` boundary** through Channel and Invitation before and after extraction. Eight cases cover saved names/account labels, oldest versus combined history observation, exact relationship-route association, latest invitation ordering, absent optional tables, incomplete/stale/missing coverage, held/history/reply status priority and read failure propagation. Existing invitation tests continue to enforce human review and rejection of delegation; active progress components remain covered.

```sh
npx vitest run src/db/agent-execution-progress.test.ts src/db/agent-invitation-store.test.ts src/components/agent-channel-progress.test.tsx src/components/agent-outreach-progress.test.tsx
npx eslint src/db/agent-execution-progress.ts src/db/agent-execution-progress.test.ts src/db/agent-channel-store.ts src/db/agent-invitation-store.ts
npx tsc --noEmit --incremental false
```

Passing characterization before and after is the refactoring evidence; no artificial failing test is claimed. Unit fixtures preserve query/transaction-client boundaries but do not prove real PostgreSQL RLS or concurrency. Detailed local evidence and entry snapshots: `/tmp/acquire-cleanup-c06-evidence.txt`, `/tmp/acquire-cleanup-c06-channel-before.ts`, `/tmp/acquire-cleanup-c06-invitation-before.ts`.

At the first extraction baseline, `agent-channel-business-time.test.ts` and `agent-invitation-business-time.test.ts` could not load the `server-only` marker. Those initial failures are retained as historical evidence, not passes. The subsequent Vitest-only alias to Next’s compiled empty server implementation resolved the marker without changing application guards; the later full-suite results supersede that load limitation. Their guarded application logic was not changed.

The first read-projection extraction did not run database suites. The following broader channel suites remain future verification recipes, not passes; inspect their setup and current gates first. Later, only the focused root review-lifecycle suite was run against PostgreSQL, as recorded below.

```sh
RUN_AGENT_EXECUTION_LOCAL_INTEGRATION=true npx vitest run src/db/agent-execution-local.integration.test.ts src/db/agent-channel-local.integration.test.ts src/db/agent-invitations-local.integration.test.ts src/db/agent-demo-projections-local.integration.test.ts
```

That command is a future verification recipe, not migration approval. Existing suites check the isolated database identity/marker and write synthetic fixtures; inspect current setup and run only within authorized local test scope, without applying migrations.

## Subsequent work

1. Keep this first collaborator stable under the public-boundary tests and review its exact snapshot diff.
2. Separately characterize the `nativeDecisionContext()` read projection, including current causality and invitation-only action availability, before extracting it. Reuse the existing transaction client and SQL functions; keep it separate from execution/UI progress.
3. Inventory `checkReviewContext` as an ordered pipeline of feature validators before introducing composition. Specify which validators must run and their failure order; do not replace it with an untyped callback bag.
4. Extract a single write capability only after transactional PostgreSQL characterization covers its approval/CAS/lease/receipt/unknown-outcome boundaries. Keep `command`, role/membership/send gate, locks and atomic commit ownership centralized. Preserve every independent SQL admission check.
5. Reduce inheritance only after each intermediate-class contract and production factory composition is explicit. Avoid converting all 18 classes in one change.


## Third-batch read and review collaborators

The second read projection is now implemented in `agent-channel-decision-context.ts`: Channel projects readiness and strict reply causality; Invitation adds relationship observations and independently SQL-admitted actions. Existing Channel `channelRows()` still loads policy-ordered routes inside the same transaction and takes the same conversation locks. Invitation still awaits Channel first. All six moved query expressions and parameter arrays match their snapshots. Ten public `nativeDecisionContext()` characterizations pass before/after; expanded engine/invitation/read regressions pass 79 tests / 7 files. Missing optional tables/functions, null routes, malformed causality, errors and saved business-clock observations are covered. A relationship observation still cannot grant action permission.

Review validation order has now been characterized through public `createReviewBatch()` across six intermediate classes: root → Research → Target → People → Sequence → SequenceExecution. Twenty-nine new cases protect first-failure ordering, native-marker bypasses, exact mandate/guidance/supervision/draft revisions and rejection before review insertion. The same 39 boundary/related tests pass before/after, with 70 expanded tests / 10 files passing. `agent-review-context.ts` gives operations an explicit shared type and extracts the root research-mandate revision read. `agent-sequence-review-context.ts` extracts sequence-draft guidance → responsibility → mandate → saved-draft validation. It preserves the query order and exact errors; all four moved query/parameter expressions are unchanged. Five feature stores use the explicit operation type in place of ancestor `Parameters<...>` coupling.

Research/Target/People/SequenceExecution orchestration bodies remain unchanged. In particular, Research's fourth `checkContinuation` argument and its default, virtual `checkResearchRunContext` calls, and People/provider/fields/target/private enrolment snapshots were not homogenized. Moving those boundaries wholesale would require moving private/virtual snapshot ownership or hiding it behind a callback collection. That third batch introduced no write collaborator or new transaction owner; the later review-ledger slice added persistence behind the same root transaction owner.

This reduces the read/validation implementation embedded in subclasses and removes protected ancestor-type queries while retaining all 18 classes and their intermediate public contracts. Subsequent work item 2 above is implemented for Channel/Invitation read projections; item 3 has its ordered validation inventory and first typed validators. The later ledger section supplies focused transaction/concurrency/rollback evidence. Further feature composition is a separate scope decision; it is not implied by keeping 18 classes. Exact evidence: `/tmp/acquire-cleanup-c06-decision-evidence.txt` and `/tmp/acquire-cleanup-c06-review-evidence.txt`.


## Review-ledger persistence collaborator

The next bounded write-lifecycle extraction is implemented in `agent-review-ledger.ts`. `insertAgentReviewBatch` owns the identical batch INSERT reused by creation and edit replacement. `persistAgentReviewDecision` owns the existing ordered operation-state → batch-decision → outbox-event → attributed-message writes and returns the same saved batch. These functions receive the caller's existing transaction client and exact prepared facts; they do not connect, commit, choose accounts, validate/grant authority, invoke a provider or dispatch work.

`AgentStore` retains public schema checks, canonical manifest sorting, thread and batch locks, exact-manifest/prior-request replay rules, revision/state CAS, automatic-demo mode/decision attribution gate, virtual `currentReviewOperations` and all its ordered feature/conversation guards. Editing still performs the same validation → update → invalidate → replacement-insert sequence. Any write error still reaches the original transaction rollback. Root `agentRecordDigest` remains the same public function name/semantics, with the same canonical/hash implementation moved into the dependency leaf `lib/agent-record-digest.ts` and independently AST-checked after isolated formatting to avoid a store↔ledger runtime cycle.

Before/after characterization: 21 public lifecycle cases plus two fixed-vector digest cases passed before the first move; three public edit cases passed before and after sharing the second insert. Final 63 scoped tests / 5 files pass. Query/parameter comparisons preserve all five ledger SQL statements and both original insert callsites; root guard/lock/transaction bodies and legacy hashes are unchanged. The selected actual PostgreSQL `agent-review-local.integration.test.ts` passes all nine cases before and after the move, including concurrent identical approval, exact manifests, stale edit, retry/idempotency, and real-transaction outbox-failure rollback. New teardown postasserts confirm zero own synthetic user/tenant/review/grant/run/event/operation/message/thread/mandate/member/gate fixtures remain.

This actual test run used the existing specifically marked isolated local database and no migrations, worker registration, provider calls or runtime restarts. Other database/live suites remain gated and unverified. A test-only orphan send-gate cleanup defect was demonstrated first and fixed separately; its RED run also performed exact-own-row fallback cleanup. Evidence: `/tmp/acquire-cleanup-c06-lifecycle-evidence.txt`, `/tmp/acquire-cleanup-c06-pg-setup-audit.txt` and private fourth-batch artifacts.

The composition point remains the existing production store factory and its preserved public store contracts. Reads, decision context, selected ordered validators and review-ledger persistence now have explicit collaborators; five feature stores no longer query protected ancestor method types. The 18-class chain remains intentionally visible in the map. The focused review-ledger PostgreSQL evidence establishes the affected review transaction/concurrency/rollback contracts; it must not be represented as all provider/send recovery coverage. The scope reconciliation below distinguishes implemented C06 obligations from optional further refactoring and the tracking/acceptance still needed before closure.


## Original C06 scope and measurable before/after surface

The original issue asks for incremental extraction of coherent collaborators for read projections, proposal/review lifecycle and channel/invitation behavior; it explicitly rejects a wholesale rewrite. It asks for a reduced dependency/override surface and stable external contracts. It does **not** require removing all 18 classes or eliminating every override. AC07 additionally requires passing affected transaction, stale-generation, retry/unknown-outcome and concurrency characterization; any original scope moved to a follow-up must be linked and explicitly accepted before closure.

The before column below uses each slice’s saved entry source, including the pre-existing uncommitted work at that boundary. This is a comparison of selected method responsibilities, not an invented single clean-HEAD baseline. Counts are direct SQL query sites embedded in those class method bodies; runtime query counts and ordering are unchanged.

| Class method(s) | Before: implementation coupled to class | After: explicit collaborator and retained wrapper | Direct query sites before → after |
| --- | --- | --- | --- |
| Channel / Invitation `executionChannelProgress` | Saved people/route/history projection and relationship/action enrichment lived inside two overrides | `agent-execution-progress.ts` owns both projections; wrappers retain the existing client, clock and Channel-before-Invitation order | 6 → 0 |
| Channel / Invitation `nativeChannelDecisionContext` | Per-route SQL admission, protected reply causality and invitation relationship/action projection lived inside overrides | `agent-channel-decision-context.ts` owns the read projection; wrappers retain `channelRows` loading/locking and `super` order | 6 → 0 |
| Root / Sequence `checkReviewContext` | Root mandate read and full sequence-draft guidance/supervision/draft checks were embedded in inherited methods | `agent-review-context.ts` and `agent-sequence-review-context.ts` receive explicit facts/client; root/feature dispatch and failure order remain | 4 → 0 |
| Root `createReviewBatch` | Prior-request read plus repeated batch insertion logic | Root retains lock/replay/validation; shared ledger writer owns insertion | 2 → 1 |
| Root `decideReviewBatch` | Mode/batch reads plus operation, batch, event and message persistence/receipt construction | Root retains every policy/CAS/replay/current-context guard; ledger owns the four ordered writes and receipt construction | 6 → 2 |
| Root `editEmailReview` | Original validation/update/invalidation plus a second identical batch INSERT | Existing guard/update/invalidation sequence remains; exact replacement insertion shares the ledger writer | 5 → 4 |

Across these selected bodies, direct query sites fall from **29 to 7**. The five collaborator modules own 21 distinct query sites: 22 embedded sites were moved and one duplicate INSERT implementation is shared. This is responsibility movement and duplicate-source removal, not fewer database round trips or weaker SQL checks.

Nine protected-method type queries (`Parameters<...['checkReviewContext']>[2]`) across five feature files are replaced by one explicit `AgentReviewContextOperation` contract. The four Channel/Invitation projection overrides now contain ordered delegation instead of projection/admission loops. Their override count does not fall; the independently testable dependency surface does. The graph still has 18 classes and 17 inheritance edges. `agentStore()` still constructs `AgentInvitationStore` as the production entry point; collaborators have no connection factory, mutable account selection, secondary transaction owner or provider client.

The substantive boundary is visible in the tests and types: projection helpers receive a query-capable client and saved rows; review readers receive the same client plus exact typed plan facts; the ledger receives the caller’s existing client and exact prepared review facts. No collaborator receives a generic callback collection, performs dynamic superclass lookup, grants authority or silently starts a new transaction. External store signatures and intermediate-class behavior remain stable.

Measured source artifacts: `/tmp/acquire-cleanup-c06-surface-metrics.json`; progress snapshots `/tmp/acquire-cleanup-c06-{channel,invitation}-before.ts`; decision snapshots `/tmp/acquire-cleanup-c06-decision-{channel,invitation}-before.ts`; review snapshots `/tmp/acquire-cleanup-c06-review-before/src/db/`; ledger snapshot `/tmp/acquire-cleanup-c06-lifecycle-store-before.ts`. Exact SQL/parameter/body equivalence is recorded in the per-slice evidence cited above.

## Affected verification and retained contracts

| Affected boundary | Before/after evidence | Practical limit |
| --- | --- | --- |
| Saved progress, stale/missing coverage, held-state priority and exact relationship association | Eight public `executionState()` cases; 25 scoped cases / 4 files pass before/after | Fixture client checks query composition and output, not actual PostgreSQL RLS or provider synchronization |
| Route-specific decision admission and original reply causality | Ten public `nativeDecisionContext()` cases; 23 / 3 pass before/after, 79 / 7 expanded pass | SQL remains authoritative; observations do not grant action authority; no provider dispatch occurs in these projections |
| Ordered current-context/feature validation | 29 public cases across six intermediate classes; 39 / 4 pass before/after, 70 / 10 expanded pass | Preserves schema/failure order and stale revision rejection; complex private research/people/target/enrolment snapshots remain their current owners |
| Review creation/decision/edit retry and atomic receipt persistence | 24 public lifecycle cases plus two public digest vectors; final 63 / 5 pass. Actual PostgreSQL review suite passes 9 / 9 before/after, including competing identical approvals and atomic outbox-failure rollback | Selected synthetic tenants only; zero-fixture postasserts pass. This does not claim provider send/journal crash recovery |
| Stale generation and unresolved outcomes adjacent to the moved code | Existing native-handler regressions in the expanded decision set reject stale epoch/reminder triggers, retry only read-only history, and reconcile original uncertain receipts without drafting/submitting another send. Root operation/context guards are unchanged; review tests reject changed state/context before writes | The selected PostgreSQL suite does not exercise live provider outcomes or channel-generation races. Those implementations were not moved; do not present a passing full unit suite as actual provider recovery proof |

The following retained boundaries are active contracts, not dead code that must be deleted to reach a class-count target:

- `invalidateNativeReviews` retains ordinary-message and separate invitation invalidation inside the caller’s transaction. The named operation families are shared; the additional invitation pass and virtual call remain intentional.
- `proposeNativeMessage` retains exact evidence/route/epoch/context checks, command idempotency and the invitation override that forces human review before its separate acknowledgement. No proposal backend or transaction was silently merged.
- `pendingNativeEmail` retains the historical ordinary-message intermediate contract and invitation-aware final contract; both lock the conversation and count proposed work only with a pending exact manifest.
- Ownership/provider/dispatch writes retain original sender bindings, independent SQL admission, leases, budgets, history requirements and unknown-outcome handling. Their implementation was not moved into projection or ledger helpers.
- Research/Target/People/SequenceExecution keep their private/virtual snapshots and validation order, including Research’s fourth continuation argument/default. Reducing those declarations would be a separate capability extraction, not necessary cosmetic flattening.

## Original-scope completion and optional follow-up

The implemented collaborators meet the original **incremental extraction** requirement. The proposal/review lifecycle is represented by review creation, exact draft replacement and atomic review-decision/event/message persistence; it was not left at a read-only projection. Channel/invitation behavior is represented by both saved execution progress and route-specific decision/causality/action projection. The map identifies every specifically named cross-feature override, shows a concrete reduction in coupled implementation/type dependencies, and records passing characterization plus the affected real review-ledger concurrency/rollback/retry checks.

No additional required proposal/review-lifecycle implementation slice was identified by this source-and-evidence review. Retaining the unchanged proposal-admission, invalidation, pending-work, ownership and provider-settlement boundaries is a deliberate contract-preservation decision within this incremental cleanup, not an unfinished promise to move every method. The retained 18-class graph is therefore not, by itself, an open C06 task. The earlier map’s blanket “whole-chain composition remains open” wording overstated the original requirement and is superseded by this assessment.

For C06/AC07, the remaining action is to attach this map and the affected before/after evidence to the parent issue and record the completed incremental scope. No portion of the original C06 implementation is being moved outside the issue by this assessment, so the conditional requirement to link and obtain acceptance for deferred original work is **not invoked**. Do not request acceptance for an arbitrary flattening target that the issue never specified. Other issue-level acceptance, final diff/GUI/commit handoff and release status remain the parent’s responsibility.

Further decomposition is an **optional new architecture task**. If selected later, a concrete next capability would be either the current `proposeNativeMessage` / invitation-HIL boundary or original-bound dispatch/unknown-outcome settlement, with ordinary versus invitation invalidation/pending contracts retained explicitly. That future task should require exact client/lock/transaction/query order, stable intermediate contracts, before/after characterization and focused existing-schema concurrency/retry/unknown-outcome tests before moving those writes. This recommendation creates no new requirement to rewrite all 18 classes and does not claim provider/live recovery verification from the current review-ledger PostgreSQL results.
