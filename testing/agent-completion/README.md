# Current-agent local completion harness

This CLI composes the current native agent, protected stores, communications SDK/service and the sibling simulator's Unipile-compatible provider. It is the current-agent acceptance harness for SIM26–SIM29, including shared business time (SIM28). Provider acceptance, service submission, application receipt, persona inference and human review are separate observations.

Read [the communications plan](../../docs/39-communications-service-execution-plan.md), [progress](../../docs/communications/progress.md), and both worktrees' `AGENTS.md` before operating it. The paired simulator source is `../project-acquire-agent-testing`; the builder captures the actual transitive input bytes and aliases only its three reviewed current-app ports. It does not discover a database, credentials or a running service automatically.

For **http://acquire-agent.orb.local/** as the caller, see [Testing service integration](../../ops/agent-mode/testing-service.md). The app uses the existing communications SDK/API on5991; it does not invoke this CLI to send. The CLI remains the operator interface. The guide distinguishes the retained fixed fixture from the prepared dynamic saved-recipient service and its pending GUI activation gates.

## Build and lifecycle

Build into two **new absolute ignored paths** below this app's `.local-data` directory:

```sh
node testing/agent-completion/build.mjs "$NEW_BUNDLE" "$NEW_BUILD_MANIFEST"
NODE_EXTRA_CA_CERTS="$CA_FILE" node "$NEW_BUNDLE" init "$PRIVATE_CONFIG"
NODE_EXTRA_CA_CERTS="$CA_FILE" node "$NEW_BUNDLE" serve "$PRIVATE_CONFIG"
```

The builder refuses existing output files, writes bundle/manifest mode0600, records actual compiler inputs, dependency manifests/lockfiles and bundle SHA256. Review the exact bundle, configuration, target identity and source manifest before activation. Retain previous artifacts when creating a successor.

`init` is insert-only and requires a prepared, unused eight-person deep profile. Messages, events, webhooks, auth links, invitations or model calls make that profile ineligible. It creates synthetic identity/run registration and a mandate through the ordinary audited creation command. It never migrates a database, starts supervision or approves work.

`serve` requires the original initialized fixture record and matching database/run/actor/mandate/thread. Use it to restart the same fixture; do not rerun `init`, reset the profile or replace unknown journals. Normal SIGTERM closes owned listeners. Durable remote ownership and uncertain outcomes remain relevant after a crash; inspect them before resuming.

The fixed local tuple is:

| Surface | Address |
| --- | --- |
| Existing marked application/service database | `127.0.0.1:5437/acquire_agent_mode` |
| Provider and mock hosted-auth | `https://127.0.0.1:5990` |
| Communications gateway/webhook | `https://127.0.0.1:5991` |
| Shared clock controller | `https://127.0.0.1:5992` |
| Private durable clock participant | `http://127.0.0.1:5993` |

The database URL must have login `project_acquire`, no URL query/fragment overrides, marker `acquire-agent-mode-local-only` and the separately attested expected system identity. Existing unrelated runtimes and their ports/environment remain independent.

The private configuration selects one explicit `agent-deep-*` run/actor/mandate, exact database URLs, prepared profile and fixture paths, TLS files, normal communications environment and an explicit model kind. In addition to simulator/development origins, preflight requires:

```text
COMMUNICATIONS_RUNTIME_ENABLED=true
CAMPAIGN_REPLY_MONITOR_MODE=enforce
```

`events` does not satisfy final send admission. Preflight rejects it before profile reads, database pools or model preparation. Test policy/accelerated-simulation environment flags are refused. Operational authentication TTLs, leases, retry holds, model budget windows and deadlines remain real time.

Model kinds are `disabled`, `local-fixture`, or `configured-ai`. Disabled rejects explicit native event execution. Configured AI requires an explicit private configuration file and normal native budget accounting. Startup does not infer. Keep all keys, profile credentials, signed-local-sync proof keys, transcripts and review artifacts ignored/private; configuration objects must never be logged.

## Normal commands and artifacts

Use the exact reviewed bundle/config pair for each command:

```sh
NODE_EXTRA_CA_CERTS="$CA_FILE" node "$BUNDLE" command "$CONFIG" inspect "$MANDATE"
```

| Command | Existing boundary |
| --- | --- |
| `inspect MANDATE`, `conversations MANDATE` | Protected execution state/current conversation context |
| `budgets MANDATE` | Exact current account windows, revisions and usage |
| `policy MANDATE` | Recorded account choices and current policy |
| `routes MANDATE CONVERSATION` | Recorded person routes/history |
| `reviews MANDATE` | Pending exact manifests and original operation inputs |
| `connections` | Normal SDK management list under the fixed actor subject |
| `connection.setup ARTIFACT` | Normal hosted-auth request; no automatic completion |
| `connection.status ARTIFACT` | Exact original SDK binding/status |
| `connection.history ARTIFACT` | Normal bounded exhaustive account history refresh |
| `connection.record ARTIFACT` | Reverified SDK generation through the ordinary application registrar; no default selection |
| `control ARTIFACT` / `responsibility ARTIFACT` | Existing start/pause/resume command |
| `channel-policy ARTIFACT`, `budget ARTIFACT` | Existing reviewed policy / budget CAS commands |
| `conversation.open ARTIFACT`, `route.register ARTIFACT` | Existing person allocation and exact contact identity proof |
| `conversation.refresh-held ARTIFACT` | Existing `requestHeldHistoryRefresh` |
| `conversation.resume-held ARTIFACT` | Existing `resumeHeldConversation` |
| `conversation.review-history ARTIFACT` | Existing `requestConversationReviewHistory` for an ordinary human-review hold |
| `conversation.reassess-reviewed ARTIFACT` | Existing `reassessConversationAfterReview` after explicit human review and fresh all-route history |
| `grant.channel.create ARTIFACT` | Existing exact-channel/route bounded delegation |
| `grant.create ARTIFACT`, `grant.revoke ARTIFACT` | Existing legacy email grant/revocation; legacy creation is not a multichannel substitute |
| `handover.begin ARTIFACT`, `handover.commit ARTIFACT`, `handoff ARTIFACT` | Existing explicit ownership/human-task commands |
| `buyer-profile ARTIFACT` | Bounded first-public-source fixture described below |
| `service-tick` | Normal exact-subject service work; no implied successful delivery |
| `event MANDATE` | One ordinary native event, which may infer or dispatch already approved work |
| `review.edit ARTIFACT` | Existing pending review-body edit; returns a new pending manifest without approval |
| `operator.message.propose ARTIFACT` | Existing pending-only operator draft with forced separate review |
| `review approved\|rejected ARTIFACT` | Ordinary exact current human review decision |

There is no arbitrary method dispatcher or approve-all command. Native pipeline diagnostics can precede the final CLI result line on stdout. Retain the complete stdout/stderr and exit status; a private operator that parses the final result must also validate the expected action/mandate. A known completed operation followed by a parser error is not a reason to replay it.

Private artifacts must be regular, non-symlink files with no group/other permission bits and at most200KB. A normal thread command has this strict envelope:

```json
{
  "runId": "agent-deep-EXACT-RUN",
  "organizationId": "EXACT-ORGANIZATION",
  "userId": "EXACT-OWNER",
  "threadId": "EXACT-THREAD-UUID",
  "requestId": "SAVED-REQUEST-UUID",
  "input": {}
}
```

`input` is parsed by that command's existing domain schema; no permission, context or ownership field is inferred from the envelope. Save request IDs and exact artifacts before calling a mutating command. A review artifact instead carries `threadId`, `batchId`, `revision` and the complete current `manifest`; inspect the original full operation inputs before deciding it.

Do not round budget windows through `Date.toISOString()`. `budgets` preserves PostgreSQL's six fractional digits so an existing account can be updated using its exact window and revision without creating a new window or resetting spent/reserved usage.

## Editing a pending review body

Use the existing normal review edit when the test operator needs to correct an unsent draft:

```sh
NODE_EXTRA_CA_CERTS="$CA_FILE" node "$BUNDLE" command "$CONFIG" review.edit "$PRIVATE_EDIT_ARTIFACT"
```

The private artifact has this exact shape, with no `input`, `requestId`, `manifest`, decision or authority fields:

```json
{
  "runId": "EXACT-RUN",
  "organizationId": "EXACT-ORGANIZATION",
  "userId": "EXACT-OWNER",
  "threadId": "EXACT-THREAD-UUID",
  "batchId": "CURRENT-PENDING-BATCH-UUID",
  "operationId": "EXACT-OPERATION-UUID",
  "revision": 1,
  "body": "Explicit operator-reviewed replacement text."
}
```

`revision` is the current **operation revision**, not the batch revision. Body text is trimmed and must contain 1–6000 characters; the existing store still enforces channel-specific limits, link restrictions, pending exact-manifest membership, ownership and revision/immutability guards. Validation and exact run/actor checks happen before a runtime pin. The only dispatched method is `editEmailReview(threadId,batchId,operationId,revision,body)`; stale or denied edits refuse without retry or fallback.

The command returns `{action:"review.edit",result:...}` containing the existing store's new pending review batch. The old batch is invalidated. Read `result.id` and its complete new manifest, inspect all current operation inputs and make a **separate** normal `review approved|rejected` decision using that new batch/revision/manifest. Editing alone approves, grants and sends nothing. Existing store idempotency remains in force; an uncertain edit is inspected rather than blindly repeated. Retain the original model output and label replacement text as an operator revision, not native-model-authored evidence.

## Operator-authored pending message proposal — source13

This explicit testing command is in the reviewed prepared source13 bundle. Its availability does not claim that source13 is active or that any proposal has been made:

```sh
NODE_EXTRA_CA_CERTS="$CA_FILE" node "$BUNDLE" command "$CONFIG" operator.message.propose "$PRIVATE_PROPOSAL_ARTIFACT"
```

The private artifact uses the strict thread envelope, with these exact nested fields (replace illustrative identifiers/digest with the current protected state):

```json
{
  "runId": "EXACT-RUN",
  "organizationId": "EXACT-ORGANIZATION",
  "userId": "EXACT-OWNER",
  "threadId": "EXACT-THREAD-UUID",
  "requestId": "SAVED-REQUEST-UUID",
  "input": {
    "conversationId": "EXACT-CONVERSATION-UUID",
    "revision": 1,
    "contextRevision": "EXACT-CURRENT-64-LOWERCASE-HEX-DIGEST",
    "draft": {
      "kind": "initial_whatsapp",
      "routeId": "EXACT-RECORDED-ROUTE-UUID",
      "intent": "initial",
      "subject": "",
      "body": "Operator-authored test message for separate review before sending.",
      "rationale": "Explicit controlled test setup, not native model output.",
      "sourceIds": []
    }
  }
}
```

`revision` is the current conversation revision. An explicit recorded route is required for every email/social message; invitations and legacy route fallback are refused. The existing native draft schema enforces kind/intent, subject, trimmed body1–6000/rationale1–2000, at most20 source IDs and link refusal. Social subject is empty; email subject is required and bounded300. Supply only current allowed evidence IDs. Caller-supplied recipients, bindings, authority, causal metadata or review bypass fields are not accepted.

The sole call is existing `proposeNativeMessage(threadId,requestId,input,undefined,{forceHumanReview:true})`. Actor/thread/person ownership, active agent responsibility, revision/context CAS, all history/source/identity, route stage/cadence, cold cancellation, suppression/hold and other domain/SQL guards remain authoritative. `forceHumanReview` is fixed by the CLI, never chosen by the artifact. The response is `{action:"operator.message.propose",authorship:"test-operator",result:...}` with the normal proposed receipt and `reviewBatchId`. It creates a **pending-only** proposal/review, no approval, grant, model call or physical send. Store refusal propagates without retry or alternate dispatch.

Export the ACTUAL pending batch and unchanged full operation inputs, label the display **operator-authored test setup**, and make a separate exact `review approved|rejected` decision using that batch/revision/manifest. Do not use the retained journey helper's `prepare-review` display for this seed: its historical “Original model proposal” note would misattribute authorship. Future genuine native-model proposals may use that unchanged native review helper. Preserve original request IDs/artifacts and inspect uncertain outcomes rather than replacing them.

A later approved operator-authored WhatsApp initial is controlled setup, not evidence of native channel selection or a native-authored pair. The unchanged native causal metric should refuse that seed's native authorship; separate sealed original-effect proof is needed for any actual operator send. Only later real person-wide messages and native drafts can establish their own continuity. No native WAIT, stop/hold, history, cadence or authority guard is bypassed, and no positive persona outcome is forced.

## Connection setup and readiness

1. Request `connection.setup` with the exact run/actor and `{channel,platform}`. Keep its original returned link ID.
2. Complete only that local mock hosted-auth link through the sibling public CLI: `complete-auth --run PROFILE --id ORIGINAL_ID`. This is an explicit testing action.
3. Call normal `connections` to consume/bind setup before delivering its signed sync callbacks. Preserve generation/account identity.
4. Perform ordinary service ticks/callback delivery and `connection.history` using the returned exact binding. History uses the captured business instant with the ordinary five-minute freshness requirement and a bounded real timeout.
5. Verify `active === true`, `status === connected`, and `readiness.status === ready` separately. Connected/waiting is a valid intermediate state, not ready coverage.
6. `connection.record` re-fetches exact SDK status and registers that original generation without choosing a default or changing work. Recording a connected/syncing account does not make coverage complete.

The status/history/record artifact is `{runId,organizationId,userId,binding}` with the complete original binding vector. If setup succeeded but coverage is incomplete, retain that artifact and finish history/status on the same generation. Do not repeat hosted setup or manufacture initial-sync rows. The optional signed-local-setup transport uses a separate private proof key and genuine new provider events; old unsigned social callbacks remain conservative.

## Public buyer source and held recovery

The internal mandate brief is not the public buyer profile. Native drafting only receives the allowlisted saved public profile as `buyer-profile` with explicit disclosure approval. Private canaries, funding details or internal instructions must not be copied into public source facts.

The explicit local fixture command accepts only:

```json
{
  "runId": "EXACT-RUN",
  "organizationId": "EXACT-ORGANIZATION",
  "userId": "EXACT-OWNER",
  "mandateId": "EXACT-CONFIGURED-MANDATE-UUID",
  "profile": {
    "senderName": "Example Continuity Buyer [fictional local test]",
    "about": "TEST DATA: explicitly reviewed fictional public buyer facts only.",
    "signature": "Example Continuity Buyer [fictional local test]",
    "publicProfileApproved": true
  }
}
```

Root/operator content review must precede applying that artifact. The helper reuses the existing buyer-profile schema and metadata function, requires the marked local target, enabled run registration and owner/admin membership of the normally created mandate, holds the established policy writer/organisation gates, refuses an existing buyer profile or pending outbound authority, and CAS-updates only organisation metadata with the ordinary field-name-only audit. It creates no operation, approval, grant, receipt or budget authority. Include necessary approved introduction facts in `about`; the SQL public projection may omit `callToAction`.

A send can initially be unknown even when the provider has not accepted it. Keep its original intent, journal, key, account and reservations. Only normal original receipt/no-submission reconciliation can establish its result. A negative proof can settle send reservations at zero while leaving the person held for a separate human decision; it does not authorize a replacement message.

For a reconciled hold:

1. Read `inspect` and the actual original result/proof. Do not resume an unresolved send.
2. Explicitly call `conversation.refresh-held` with current `{conversationId,revision,contextRevision,epoch}` in the thread-command envelope.
3. Run only the resulting normal history work. Inspect again after all three route histories and application receipt/barrier checks are fresh.
4. Explicitly call `conversation.resume-held` with the new current context plus `reason`. Its existing store method checks known original no-submission/receipt proof, ownership, all-route history, suppressions, unresolved sends and human tasks. Old approvals/delegations stay revoked.
5. A fresh native assessment may create a new proposal. Stop for its exact test-operator approval through the normal human-review boundary. Do not reapprove or replay the failed original.

Route registration increments epoch/reminder generation. An open-conversation event can therefore become stale while routes are being configured. Finish normal setup, then use an explicit supervision pause/resume boundary for otherwise active conversations; stale events complete harmlessly. Use the specific held controls for reconciled holds, rather than an agent→human→agent workaround.

## Ordinary human-review conversation holds

`human_review_required` is different from a reconciled-send hold. `conversation.refresh-held` and `conversation.resume-held` intentionally accept only `provider_no_submission_confirmed` or `provider_receipt_pending_history`; they cannot clear an ordinary model review request. The existing human-review workflow is exposed explicitly:

```sh
NODE_EXTRA_CA_CERTS="$CA_FILE" node "$BUNDLE" command "$CONFIG" conversation.review-history "$REVIEW_HISTORY_ARTIFACT"
NODE_EXTRA_CA_CERTS="$CA_FILE" node "$BUNDLE" command "$CONFIG" conversation.reassess-reviewed "$REASSESSMENT_ARTIFACT"
```

Both artifacts use the strict thread-command envelope above. Their `input` must contain the exact current `conversationId` (UUID), positive integer `revision` and `epoch`, and 64-character lowercase hexadecimal `contextRevision`. Reassessment additionally requires an explicit human `reason` of 5–2000 characters. Do not add approval, force, driver or grant fields. The existing domain parses these schemas and retains membership, current responsibility, ownership, conflict and outcome checks.

The normal eligible state is agent-owned `phase=held`, `pause_reason=human_review_required`, without pending ownership transfer, stopped/handoff engagement, unresolved sending, suppression or conflicting background work. An otherwise active agent conversation is also supported by these existing review methods. A real new persona reply can arrive while held; incoming history does not silently resume automation. Review the genuine new evidence before deciding whether reassessment is appropriate. Silence or a valid stop/handoff does not require a positive continuation.

The history command returns `history_requested`, keeps the human-review hold, invalidates old reviews/delegations and queues the normal exact-person history refresh. Drain that requested event normally, then inspect the updated conversation and every recorded route. Build the separate reassessment artifact from its new revision/epoch/context; the old artifact is not reused. Reassessment requires fresh complete all-route history, original identities/accounts and no opt-out/unresolved state. It returns `reassessment_requested`, makes the conversation active and queues a fresh native assessment. Both commands revoke old person delegations; any new proposal still needs its normal current authority. Neither retries an old send, approves a proposal or forces a new model outcome.

## Clock ownership and evidence scope

Effectful native, service and provider work holds durable participant pins for its whole asynchronous lifetime, including late handler completion after an HTTP/native deadline. Controller planning uses only bounded exact-scope read-only observations. No global clock or auth/lease/model-budget time acceleration is installed.

Save an explicit clock request ID and expected business instant before each advance:

```sh
node ../project-acquire-agent-testing/testing/agent-simulator/cli.mjs step \
  --run "$PROFILE" --request-id "$SAVED_REQUEST_ID" --expected-now "$EXACT_CURRENT_NOW"
```

Use the same explicit flags for `advance --by ...`. Unknown transport results require inspecting the original request/ledger and durable pins; never create a new request ID merely to repeat uncertain work. Native causal drain can infer or propose work, so inspect pending human reviews before progressing time. Persona inference is an explicit separate accounted operation; scripted replies cannot count as natural conversation depth.

At a source handoff, distinguish a reviewed immutable compiled bundle from the current dirty tree. Keep its exact bundle/manifest/config hashes and owned process identity. A private operator may record concurrent source drift while accepting a specifically reviewed frozen artifact, but must not claim that artifact proves the later tree.

## Current acceptance handoff

**Runtime update — 19 October 2026:** the same saved profile is now resumed at unchanged business time after inspected dead-owner recovery and restart of the immutable capture13 service. Existing review holds remain. Historical PID-pinned helpers are preserved and require a new reviewed ownership pin before reuse; the documented public CLI remains available. The latest operational receipt is in communications progress.


The retained deep fixture uses reviewed immutable **capture 13** with its current profile publicly resumed, with all three channels established through normal setup/history/registration. Here the authorized test operator is the AI test coordinator using the ordinary human-review API; these are not claims of a real user adjudicating the drafts. Native handoffs are saved pending tasks to the synthetic owner, without human acknowledgement or a booked meeting. Public CLI lifecycle, scoped commands, monitor preflight, source-profile helper, reconciled-send held controls and ordinary human-review controls are implemented and source-verified. The earlier disabled-model bootstrap/two-day idle advance/restart smoke remains separate from the active evidence below. Keep its original bundle and results; it did not exercise accounts, supervision, messages or model work.

Current genuine configured-AI depth is three causal rounds each for easy email 001, cautious email 002 and skeptical WhatsApp 003. These are supervised local journeys with exact test-operator approvals through the normal human-review boundary and operator boundaries: 001 reached a native human handoff; 002/003 reached native waits before explicit operator cohort handovers. They do not establish autonomous-only operation, a meeting, or verification of facts the persona withheld. Ordinary human-review reassessment followed actual new incoming evidence and retained revocation of old authority. No captured model wire prompt or wire-level privacy proof is claimed.

Silent persona 008 made one accounted AI ignore decision with no incoming reply. Public CLI advancement across a full business day drove active native work to its later normal wait without another send. Busy WhatsApp 004's original zero-delay reply was ingested at the unchanged instant through a journaled clock step; positive jumps over already-due provider work still refuse. Leases, backoff, authentication, inference deadlines and native budgets retain real-time behavior.

The earlier calendar gate and eight receipt-guard probes passed after reviewed local migration 0082, with one genuine submitted receipt/callback and no acceleration of its real retry hold. Forward migrations 0083/0084 and the capture 10 lifecycle correction subsequently passed a fresh zero-model causal gate: three normal native submissions/receipts, genuine authenticated incoming history, whole-turn consumed metadata, duplicate/ambiguous/unknown refusal and repeated idempotent refresh. The explicitly controlled fixture also contains one external provider outbound record; it is not a fourth native send or AI round. The earlier failed fixture charges and original uncertain attempt remain preserved. See the [testing-service checkpoint](../../../project-acquire-agent-testing/ops/agent-testing/README.md#verified-current-checkpoint-and-remaining-acceptance) and [communications progress](../../docs/communications/progress.md) for precise source, SQL, test and preservation boundaries. Local signed setup epochs remain a simulator extension, not vendor parity.

The durable clock ledger now archives released work-pin records without forgetting their exact IDs or ownership. Immutable hashed buckets are written and synced before the hot-ledger cutover; startup validates every referenced bucket, old work IDs remain refused and exact-owner release remains idempotent. Active/orphan pins and every advance record stay protected. Storage remains finite: 8 MiB per archive file, 256 buckets, 256 MiB/4,096 retained files including old versions and partial orphans; full storage fails closed. Source11 actual startup preserved all 10,000 original released records and all 21 advance records exactly, with unchanged scope/time and all 17 protected application record sets unchanged before continuation. A ledger-capacity error may occur during post-commit native drain: inspect the original advance, provider events and pins first. A completed advance is not retried to resume native work, and cached replay does not run its post-drain again. Never reset or manually prune its ledger, archives or ownership files.

Busy WhatsApp 004 now also has three authenticated causal reply rounds. Source11 continued its already-delivered third incoming through normal history and a fresh native assessment, reaching human-owned paused engagement with a pending native handoff task. The lead asked which human would coordinate; no named operator, human acknowledgement or booked meeting was invented. There was no operator handover, fourth persona, new grant or replay of the committed clock advance.

LinkedIn 005 retains three authenticated native pairs at causal depth 3. A later UNSENT model proposal made an unsupported post-sale role claim. Normal CLI12 `review.edit` changed BODY ONLY, invalidated the old batch and returned a new pending manifest. The root AI coordinator, acting as the authorized test operator through the ordinary human-review API, read that full manifest and separately approved the revision. The corrected fourth outgoing is now submitted and reflected with the exact approved operator wording: post-sale expectations/arrangements remain unverified and require a human response. It is operator-revised, not native-agent-authored or literal external-user adjudication. The original unsafe model output is preserved.

A subsequent native assessment again produced a raw unsupported role claim, but normal current-context/readiness constraints created NO new outbound operation or physical effect and left `human_review_required`. This was a deterministic context guard, not a semantic classifier or a grounding fix. An explicit operator ownership handover followed; there was no native handoff, fourth persona, booked meeting or human acknowledgement. Final observed 005 traffic is 4 outgoing / 3 incoming: three native-authored outbounds plus one operator-revised answer. The unchanged causal-v2 metric correctly refuses native authorship for that fourth body; separate authenticated original intent, application/service receipts, settled authority/budgets and history prove the approved physical effect. The earlier three-pair depth result remains distinct from the two retained raw semantic negatives.

The grounding finding is recorded on existing parent agent item AG10/#128, still InReview. Its readback/history comparison was reconciled only for one API-added outer HTML wrapper and a `rel` attribute on the new link; the original description and recorded state/relationship fields remain preserved. The earlier literal-comparison false flag remains retained. No new work item or module membership change is implied, and no native grounding/product-prompt fix is claimed here.

LinkedIn 006 completes four native-authored outgoing messages, three genuine incoming replies and three independently authenticated native causal pairs/depth 3. All four delivered bodies match the original native drafts; the test operator used exact normal approvals without body edits. When asked for company-specific public evidence, the native agent first requested review rather than inventing research. Normal review-history/reassessment then produced an answer admitting that no public evidence or independent fit assessment was available. Later valuation and staff/role commitments stayed explicitly unverified, with no pressure, private-record request or claimed meeting.

A single finite one-route/max 2 reply grant had been created, but every actual 006 send has settled exact review authority and `grant_id=NULL`; no later grant creation/restoration was recorded. The ordinary review controls were used, but the current stored grant row is absent from the bounded audit, so neither its current status nor a used-send counter is asserted. After the final staff answer, the native agent chose a wait until 2030-01-19T00:00Z; a separate explicit operator ownership handover followed. That is not a native handoff, conversion or external-human acknowledgement. LinkedIn used the declared preexisting-connected fixture, not a new invitation acceptance.

The original public clock step to 2030-01-17T22:00Z preserved the same off-hours approved event and manifest. Its saved response explicitly has `causallyDrained:false` and post-drain `quiescent:false`. Ordinary delivery/history/native work later settled that original effect without clock replay or reapproval. The later known settled boundary does not relabel the original response as fully drained. Nine native model calls (4,652 microUSD) and three separate persona calls are accounted; four sends each retain their four mirrored settled budget scopes. Delivered canary/known other-person facts were not observed; no wire prompt or universal privacy guarantee is claimed.

Mixed-channel 007 now has four outgoing / two incoming and two genuine configured-AI persona decisions: three original native bodies plus one explicitly operator-authored WhatsApp introduction. The original native WAIT until15February remains retained. CLI13 created that operator seed as pending-only with forced review; the AI test coordinator separately read and approved its full exact manifest. Its original input, sealed application/service receipts, settled review authority, physical effect and history are independently authenticated. It is not evidence of native WhatsApp choice or a native-authored pair.

The genuine email question referred to both earlier messages. Its native email answer was delivered before the genuine WhatsApp persona acknowledged that shared context and asked for the co-owner introduction agenda. Separate authenticated original/context proof confirms that the later native WhatsApp decision consumed the exact earlier email question and answer in whole-person history, and its delivered answer remained consistent without re-asking that resolved question. This is bounded observed cross-channel continuity: no perfect recall, isolated source-of-fact attribution or explicit retelling of the earlier email question is claimed. The unchanged strict causal metric remains email1/WhatsApp0 for007; its RFC-only email projection cannot certify the full mixed aggregate. The separate full-history/original proof is retained without relaxing that metric. Six single-channel cases retain three verified native causal rounds each.

The final WhatsApp answer is submitted and reflected, not booked or acknowledged by a human. A later native model produced a similar agenda draft without another incoming; normal protected current-context/readiness checks created NO new outbound operation/effect and left `human_review_required` with complete history. This raw duplicate-draft quality negative is preserved; it is not a native WAIT, handoff, semantic classifier or model-quality fix. Existing parent AG10/#128 remains InReview with both grounding and duplicate-draft findings appended through the test coordinator; earlier history/state and the HTML-normalization reconciliation remain retained.

Fresh whole-cohort accounting is65 native model calls /32,884 microUSD /27 logical sends with zero current native reservations, plus21 separate persona calls. The older failed profile remains separate with4 native calls /1,853 microUSD and1 persona call, its original spent/held send and uncertainty preserved. Mirrored budget scopes are not added together. No delivered canary or known other-person identity was observed; neither model nor persona wire prompts were captured, so no wire-prompt privacy guarantee is claimed.

The SAME retained profile on immutable capture13 was paused ONCE through the public CLI at2030-02-01T02:00:00Z. Readback is coherent with activeOperations0, advancing:false and uncertain:false; ledger bytes, messages/decisions/events/webhooks and business time are unchanged. Services remain available and the native review hold remains. This is a current-profile pause, not a claim that the older provider profile is paused or that all historical uncertainty is resolved. Final source13 file-only verification matches all257 runtime inputs/four dependency metadata files, bundle/config and both helpers. The latest ordinary simulator checkpoint remains4,992 Vitest passes/338 gated skips plus39 Node passes; the three unrelated application research failures remain non-green. No production release, live-provider sending, GUI or n8n integration is claimed.

### Cohort checkpoint

Counts describe retained local evidence, not booked meetings or autonomous-only operation. Test-operator approvals use the normal human-review boundary; the test operator is the AI coordinator.

| Lead / channel | Observed out / in | Verified native causal depth | Recorded boundary |
| --- | --- | --- | --- |
| 001 easy email | 4 / 3 | 3 | Pending native handoff task to synthetic owner |
| 002 cautious email | 3 / 3 | 3 | Native wait, then explicit operator ownership handover |
| 003 skeptical WhatsApp | 4 / 3 | 3 | Native wait, then explicit operator ownership handover |
| 004 busy WhatsApp | 3 / 3 | 3 | Pending native handoff task to synthetic owner |
| 005 LinkedIn | 4 / 3; fourth out operator-revised | 3 before the operator-revised final answer | Native review hold, then explicit operator ownership handover; two raw grounding negatives retained |
| 006 LinkedIn | 4 / 3; all original native bodies | 3 | Native wait until 19 January, then explicit operator ownership handover; no native handoff |
| 007 mixed-channel continuity | 4 / 2; three native + one operator WA seed | Separate mixed-context proof; strict metric email1 / WhatsApp0 | Native review hold after duplicate raw draft; profile resumed with hold retained, no native WAIT/handoff |
| 008 silent | 1 / 0 | 0, intentional | Genuine AI ignore; public full-business-day advance, native later wait |

**Local testing module complete:** all eight declared persona cases have their bounded observed outcomes, including006 truthful evidence limits,007 operator-seeded mixed context and008 deliberate silence. Final full-pagination readback verifies all31 original work items Done, includingSIM26/SIM28/SIM31, and the [Plane module](https://plane.mlai.au/mlai/projects/049211e4-72a2-4ee3-9257-157a4f11822f/modules/6819fec1-d2b9-4af0-88e3-7dad7a8ea3d4) completed, with membership/history preserved. Existing parent AG10/#128 remains InReview for the retained model-quality findings. The current profile is resumed and services available; existing review holds remain; whole-application green, production release and live-provider sending are not claimed.


The bounded recheck of only `scripts/research-design-matrix.test.mjs` and `src/db/research-timing-observability.test.ts`, with every `RUN_*` opt-in unset, is1pass/3fail/0skips. These are the SAME two Cloudflare benchmark-source override failures and one observability event-count mismatch previously recorded, with no new failure names and no source drift during that check. Tests use in-memory transformations and a mocked database client; no benchmark, database, provider or model execution was performed. Private evidence is `.local-data/completion-final-research-known-failures-classification.private.json` in the application worktree. Scoped module results do not establish whole-application green.


### 19 October 2026 — pending007 clock checkpoint

007 remains incomplete because a read-only installed-function diagnosis found a selected-business-time defect in the outer `agent_channel_proposal_before_execution_context` wrapper: its person-wide cold-channel quiet comparison still uses `clock_timestamp()`, although the three inner functions use the selected business clock. At the recorded2030-01-26 instant, the exact owned routes/history/source revisions are fresh, the WhatsApp cold route is already due, and the same quiet predicate is blocked by2026 wall time while due under business time. This is a confirmed SQL consumer mismatch, not evidence that a persona declined to reply.

The original public advances of one day to2030-01-19 and seven further days to2030-01-26 both returned quiescent and `causallyDrained:true`; their legitimate native waits and original request records remain retained. No007 persona decision/incoming, clock replay, manual route forcing or new CLI seeding feature is credited. A new zero-model regression and forward0085 are in preparation, **not applied**; existing migration files are unchanged.006 remains locally verified, while007, SIM26/SIM28/SIM31 and module completion remain in progress. No final scan or repair success is claimed at this checkpoint.


### 19 October 2026 — applied0085 and fresh local gate; original007 still pending

Root applied new forward `0085-agent-cold-quiet-business-clock.sql` once on the standing-approved marked5437 database after backup/review. It corrects only the outer cold quiet-time consumer; existing migration files and the selected inner helper remain unchanged. The authentic old-database RED failed at the due WhatsApp route after one real local email, with zero model calls. Its paused fixture, charge and failure evidence remain retained.

A DIFFERENT fresh zero-model gate now passes1case/10other gated skips: one completed email has genuine application/service receipt and reflected history; WhatsApp refuses one millisecond before24hours and permits a controlled proposal at the exact boundary. A genuine owned-provider email incoming then cancels the unsent cold WhatsApp proposal, with no second physical send. Scope/default-clock and rollback/budget negatives also pass. This is controlled component evidence, not a native AI WhatsApp send or007 continuity. Both fixtures are normally paused with immutable evidence/charges preserved and owned listeners closed.

The original007 fixture remains1out/0in and incomplete. Capture12 runtime inputs, bundle/config/manifest remain unchanged; reviewed resume-helper clones change only the future ownership-record filename. At this recorded stage the original runtime was stopped for the exclusive gate and its same-fixture resume is prepared, **not yet claimed active**. SIM26/SIM28/SIM31/module completion remain in progress. No final scan or original007 recovery is claimed by this fresh gate.


### 19 October 2026 — source13 proposal contract prepared;007 still pending

The preserved original Feb1 public advance completed quiescent/causallyDrained:true, after which the native agent selected WAIT untilFeb15 despite a fresh ready WhatsApp route. That strategy decision remains evidence; no repeated wake or claim of native WhatsApp selection is substituted.007 remains one email outgoing, zero incoming/persona decisions at this preparation checkpoint.

Reviewed source13 adds only the explicit pending-only `operator.message.propose` CLI bridge to existing forced review. Five relevant RED cases precede55passing scoped cases/4suites, full TypeScript/lint and independent source review. Its operator-authored setup must be labelled separately, with a distinct full-manifest approval and any later sealed effect proof; it is not native-authored pair/choice evidence. Immutable bundle/manifest/config and two helper clones passed independent file-only pins/inverse review: same257 runtime paths/four dependency metadata files, onlycli.ts changed. At this recorded preparation stage source13 is **not claimed activated**, no operator seed has been executed, and007/SIM26/SIM28/SIM31/module completion remain in progress. No new SQL, prompt/stop bypass or final scan is introduced.


### 19 October 2026 — final source13 supervised cohort and pause checkpoint

The current account is the final cohort checkpoint above; older preparation/RED entries below it are historical phase records. Private final evidence is `independent-lead007-final-mixed-semantic-audit.private.json`, `independent-lead007-native-mixed-context-final-held.private.json`, `final-profile13-pause-readback.private.json`, `independent-source13-final-frozen-pins.private.json` and `independent-source13-final-test-inventory.private.json` under the application’s ignored `.local-data/agent-completion/verified-20261018/`. Tests were reconciled from retained logs without another broad run. The final bounded source/private-value scan passes with no private-value copies, and coordinator full-pagination Plane readback verifies31Done/module completed. No secret value belongs in public documentation.


Final paused handoff `final-profile13-paused-handoff.private.json` SHA84b734427167bbef595e2e535a9ba213344495fc7fb5a67f2920827fb12a3f79 verifies all18 protected application arrays unchanged across pause,27out/20in/21persona,34complete advances and30,126 unique released operation IDs (2,128hot plus27,998 in the current archive index), with768historical archive files retained. Historical bucket generations are not additional unique IDs. Six stored pending review-batch rows are retained history, not an assertion that all remain actionable. The older provider paused flag was observed false; its native responsibility was last root-verified paused and was not mutated by this handoff. Current services remain listening; profile resumption requires explicit operator action.
