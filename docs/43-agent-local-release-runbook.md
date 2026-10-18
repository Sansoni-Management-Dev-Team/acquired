# Acquire native agent: local verification, stop and rollout

This worktree adds goal-driven conversations alongside the original sequence UI. The original UI retains its n8n sequence runtime; the native conversation driver does not require n8n. Never let both drivers advance the same contact. Driver changes require an explicit reconciled handover, including outstanding sends and approvals.

## Evidence and boundaries

Implemented code is not evidence of live provider delivery or a production release. Local unit tests use scripted/provider-shaped fixtures; PostgreSQL integration tests exercise the isolated database. The paid held-out evaluation is separately opt-in and records actual model receipts. It does not send email. No live communications account or production deployment is verified by that evaluation.

V1 drafts email for a human to approve. Explicit delegated authority is bounded by its saved scope, current context and budgets. When the lead wants a call, the agent posts a human handoff and pauses automated follow-ups. A human reviews and sends the booking link. A generated response is never evidence that a message was delivered or a meeting booked.

The default preview disables native background execution and communications transport. A local sink is a simulation, not provider delivery. Known other-account/channel history without a verified reader blocks automated conversation actions. Oversized histories require human review rather than silent truncation. Provider outcomes without positive original receipts remain unknown and retain reservations.

## Identify the local target before any mutation

Worktree: `/Users/callum/Documents/Development/project-acquire-agent-mode`.
Preview: `http://acquire-agent.orb.local`.
Database: `acquire_agent_mode`, local port `5437`, database comment `acquire-agent-mode-local-only`. The main development database on `5434` is a different target.

Check the database identity and marker read-only before testing. The integration suites perform this check themselves. Migration history is recorded in `agent_local_migrations`; compare the exact migration filename and SHA with the reviewed artifact.

**Current migration authority:** on17 October2026 the user granted standing permission for migrations needed for this agent build only in `/Users/callum/Documents/Development/project-acquire-agent-mode`, database `acquire_agent_mode` at `127.0.0.1:5437`, marker `acquire-agent-mode-local-only`. This exception is recorded in the worktree [AGENTS.md](../AGENTS.md). Do not ask for repeated per-migration approval within this exact scope. Verify identity/marker before every application, keep applied files immutable, and record reviewed hashes, receipts and test evidence. Another database/worktree, production deployment and live sending still require separate approval. A runner's apparent preflight mode is not read-only: it can write its ledger.

Earlier0023–0028 and0030–0032 received exact specific approval and were applied unchanged. The user then specifically approved0033/0034/0035, which were also applied unchanged before the standing exception was granted. Their hashes and receipts are recorded in [docs49](49-agent-final-acceptance-migrations.md);0029 is unused. The final all-ten-flag combined PostgreSQL run passed184/184 tests across31 files, zero skips (`.local-data/agent-mode-orbstack/native-all-approved-final-postgres.log`). All results remain isolated local/synthetic evidence, not mailbox or production acceptance. Migration0024 fixes per-conversation inbound-event deduplication;0028 provides bounded no-submission ledger closure;0033 enables bounded company guidance evidence;0034 applies authentic delivery-failure holds;0035 binds manual feedback to exact saved sources.

Private settings live in ignored `.local-data/agent-mode-orbstack/runtime.env` and `worker.env`. Never print these files or include credentials in tickets, screenshots, logs or fixtures. The launcher imports only configured research credentials, not messaging account credentials.

## Start and inspect the isolated preview

From this worktree:

```sh
node scripts/start-agent-mode-orbstack.mjs --restart-app
```

This regenerates private local environment files and starts containers; it runs no schema commands. It preserves the previous `AGENT_NATIVE_EXECUTION_ENABLED` value, so review that setting deliberately. By default it forces `COMMUNICATIONS_RUNTIME_ENABLED=false`, disables campaign n8n in this isolated preview, and clears live messaging connector settings. An explicit worktree-private connection-only configuration can now enable mailbox setup while retaining zero send quotas and forcing native execution off; see [owned-mailbox setup](51-agent-owned-mailbox-setup.md). This local isolation does not remove original UI/n8n support from the product.

Research, transports and agent workers share the app network namespace. Use the launcher to rebind them after app recreation; restarting the app alone can leave otherwise running dependants attached to its previous namespace.

```sh
docker --context orbstack compose -f ops/agent-mode/compose.local.yml ps
docker --context orbstack compose -f ops/agent-mode/compose.local.yml logs --tail=100 agent
```

Treat logs as private. Use generic operation states, IDs and receipts for diagnosis; do not log message bodies, full histories or credentials.

## Pause, kill and drain

1. Use the mandate's **Pause agent** control to revoke forward authority through the stored responsibility/context fences. Pausing the agent does not pause independently owned original UI sequences.
2. Revoke any delegated grant when stopping delegated work. Review pending approvals and human handoffs; do not assume an old review remains valid after new history.
3. For a process-level stop, stop the worker service:

   ```sh
   docker --context orbstack compose -f ops/agent-mode/compose.local.yml stop agent
   ```

4. Keep native execution disabled before restarting. A stopped worker cannot undo a provider request already accepted or in flight. Reconcile those operations before moving ownership or resuming.
5. Recover each submitted/unknown operation using its **original** communications intent, recorded account binding and original provider receipt. Receipt lookup precedes current source/window/history checks. A missing receipt is not proof of no submission. Do not resubmit with a new key, swap accounts, delete the operation/outbox, reset counters or discard reservations to clear a hold.
   The locally verified 0028 reconciliation path accepts an authenticated original service-journal no-submission proof; it releases the three send reservations at zero, closes that operation and leaves automation held. An expired operation with no committed application intent can close only under the held organisation gate, with no live sender run; an exact fenced lookup-only reconciliation run is permitted. A missing provider receipt alone grants neither path. Delegated grant usage stays monotonic. This closure has passed the four local PostgreSQL acceptance cases; live mailbox verification remains separate.
6. Resume only after the original outcome is established, opt-outs/suppressions and complete verified history are current, the owner/context/grant is current, and fresh human approval or valid delegation permits the next action. Human-owned conversations remain paused after new inbound events; the chat receives a notice for review.

When draining a sequence runtime, keep each enrolment pinned to its recorded runtime until an explicit migration/handover completes. Stopping n8n does not transfer ownership to the native agent.

## Repeatable checks without provider spend

```sh
pnpm exec vitest run src/lib/agent-conversation-evaluation.test.ts --maxWorkers=1
RUN_AGENT_EXECUTION_LOCAL_INTEGRATION=true pnpm exec vitest run src/db/agent-conversation-evaluation-local.integration.test.ts src/db/agent-model-local.integration.test.ts --maxWorkers=1
pnpm exec tsc --noEmit
```

These commands use no model API. PostgreSQL suites create synthetic tenants and require the existing approved schema. Read the suite output: skipped tests are not passed tests. With both RUN_AGENT_EXECUTION_LOCAL_INTEGRATION=true and RUN_AGENT_NO_SUBMISSION_LOCAL_INTEGRATION=true, the communications and ownership suites pass all 24 cases (19 communications and five ownership), with zero skips. The no-submission cases use synthetic historical ledger fixtures; private codec/provider-shaped tests separately verify original proof authentication. Cleanup assertions verify each test tenant and its operations, reservations and bindings are removed.

The default test run skips `agent-conversation-model-evaluation.local.test.ts`. Running that suite requires both explicit paid-evaluation and local-integration flags. Obtain approval for its stated ceiling first. It uses six persisted call/money budgets, one physical attempt per decision, no automatic fallback/retry, synthetic contacts, saved local pilot criteria and the existing local research key. It leaves synthetic accounting receipts for audit. Its ignored report is `.local-data/agent-mode-orbstack/conversation-paid-evaluation.json`. Report actual model/version, tokens, unknown reservations, conservative configured cost estimates and quality failures. These estimates ignore cached discounts and are not actual billed prices.

The evaluation rubric checks declared claims, private/injection canaries, action choice, source IDs and waits. Passing it is not general semantic entailment or safety proof. Baseline versus confirmed-guidance pairs test context influence, not automatic learning or statistically meaningful improvement. Guidance remains human-confirmed context and cannot grant sending authority.

## Release prerequisites

Before enabling real communications, separately approve the account/environment and complete owned-account UAT: full available history across recorded accounts; inbound-first verified parent threading; original receipt replay and uncertain outcomes; opt-outs and human takeover; new inbound wakeups with browser closed; expired/current approvals; delegated scope/counter bounds; account membership changes; budgets; sending windows; process interruption and drain recovery. Verify the intended environment/schema against its recorded approvals and execute all dependent PostgreSQL cases there; the isolated local schema through0035 already passed its complete184-case suite.

Production deployment, live accounts, live-send enablement, mailbox UAT and broader model-quality sign-off are separate release steps. Keep their status distinct from implemented and locally verified work.

## Held-out model evidence, 17 October 2026

The object-enveloped conversation request completed sixteen synthetic pilot-shaped cases on `gpt-6-luna`: 19,486 input tokens and 1,687 output tokens, with a historical2,796 micro-USD estimate under its recorded100,000 input-micro-USD/M configuration (not an invoice or cache-write-inclusive ceiling). The original completed rubric scored 15/16; a truthful draft declining to guarantee unavailable funding was incorrectly required to choose `review`. Version 2 accepts that safe draft and regrades only that stored response offline, yielding 16/16. The original results remain preserved. Four baseline and four confirmed-guidance cases each passed 4/4; this establishes no measured uplift.

Earlier requests exposed an unsupported root-union structured-output schema and failed closed. A subsequent diagnostic confirmed HTTP400; the fixed object envelope succeeded. Earlier unknown receipts remain reserved rather than being retroactively labelled zero cost. No outreach was sent. The small rubric checks and synthetic contacts do not replace owned-mailbox UAT or broader quality review.

## Explicitly resume a reconciled conversation

For an agent-held conversation, use **Refresh history**, then **Resume agent** after the saved full-history check completes. The direct resume command accepts exact current conversation revision, epoch and context. It requires original positive submitted-receipt reflection or a recorded zero-send disposition, settled original budgets, current account/recipient/mandate supervision, complete fresh history and no outstanding canonical-person sends, suppressions or human handoff. It revokes previous delegated grants and approvals and requests a fresh assessment; it grants no send permission. Unknown outcomes cannot resume. Generic same-agent ownership transfer is rejected; human/sequence ownership transfers retain their separate controls.

## Comparing cheaper models, 17 October 2026

A second bounded test used the same prompt/schema hash for eight paired cases on each model. GPT-6 Luna passed8/8; GPT-5 nano passed0/8 (four schema-invalid responses, plus wrong next actions, source IDs or irrelevant answers). Luna used9,628 input and934 output tokens, averaging1.982seconds/provider call; Nano used9,628 input and1,753 output tokens, averaging3.234seconds. Both reported zero reasoning tokens in this run. The configured conservative totals were1,675 and1,186 micro-USD respectively; Luna's cost per passing outcome was209.375micro-USD. These are small synthetic-case results, not general performance guarantees.

Retain GPT-6 Luna among the tested configurations. Nano's lower input price did not produce a passing outcome here. Its returned2025-08-07 snapshot is also scheduled for shutdown11December2026. GPT-4.1 nano was omitted because its shutdown is23October2026. See the [official deprecations](https://developers.openai.com/api/docs/deprecations), [Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), and [Nano pricing](https://developers.openai.com/api/docs/models/gpt-5-nano).

The new test reported9,604 actual cache-write tokens on Luna. [Official prompt-caching documentation](https://developers.openai.com/api/docs/guides/prompt-caching) confirms implicit writes on GPT-5.6+ cost1.25times ordinary input. Future native admission therefore uses125,000 micro-USD/million input tokens and500,000/output, with a9,000micro-USD per-attempt reservation at64k/2k bounds. Stored old receipts and their old configured rates remain unchanged; earlier100,000-input estimates omitted write charges and must not be read as universal billing bounds. Optional reported cache-write counts are retained and validated alongside cached reads. The comparison's token-rate estimates including reported writes were1,669.9micro-USD for Luna and1,182.6for Nano, before per-receipt rounding; neither is an actual invoice. The ignored comparison summary records raw metrics, failures and limitations.


Feature flag changes must be reflected in the application build as well as runtime configuration: home/new server entry props can be prerendered. Disabling native execution remains the authoritative forward-work kill switch. Disabling only the optional UI entry does not imply that already persisted background work has stopped. Test the built artifact with the intended flag matrix before release.
### AG10 delivery-failure guard and immediate wake

The native full-history reader now distinguishes qualified machine delivery reports from human replies. A full authenticated email must have a delivery-status report, a null return path, a machine sender and one exact canonical `X-Failed-Recipients` address. Body text, display names and model guesses cannot select a recipient. Ambiguous machine reports make native history incomplete; reports for another exact peer do not become this lead's reply. Boundaries remain200 messages/6,000 body characters per message; oversized history never silently truncates.

A qualified failure permanently holds/stops the recorded native conversation, invalidates outstanding reviews, revokes old automatic-send grants and adds a human chat notice. A later ordinary complete snapshot cannot reactivate it. Running/unknown and submitted operations retain their original delivery receipts and budget reservations: a bounce is not proof of no submission. No replacement send or reminder is created. The original sequence reply policy is unchanged.

Immediate webhook delivery uses a distinct encrypted `email_change`/`bounce` event, the `email_bounce/v1` namespace and versioned semantic fingerprints. The existing authenticated consumer inserts its immutable application receipt and the native hold/wake/notice in one owner transaction before ACK. The SQL guard verifies the exact body-free original receipt preimage against its saved SHA256 and binding vector/event/version/recipient/message/time, so a real receipt cannot be rebound to another lead. Every non-complete driver is held, including human/sequence ownership; driver/account/version remain recorded and the existing dispatch gate denies further sends. No machine failure is represented as a human inbound message. This requires specifically approved migration0034, SHA256 `45fcf4d15b77d9cf218d992855d526bd4544d86fbfa49c1f360c72443d187aaf`; it has been prepared, **not applied** by this implementation. While native tables exist, missing or uncertain helper readiness fails without acknowledging the qualified bounce. If both the helper and native conversation table are provably absent, the original UI retains its ignored receipt/ACK behavior with zero native effects; no feature flag bypasses an active module hold.

Meaningful RED: the exact-peer DSN was previously certified as complete empty history; the webhook processor returned protocol review instead of the distinct event; the actual prepared PostgreSQL wake test currently fails only because0034 is absent. GREEN: the isolated application PostgreSQL communications suite passes20/20 including permanent failure hold/notice replay and unchanged original accounting; provider-shaped normalizer/history, real encryption and service SQL write/read protocol, consumer commit ordering and rollback tests pass. Broader communications/domain/consumer regression passes1,787 tests (270 opt-in skips) including the storage roundtrip; the separate optional-schema helper/consumer characterization passes79 tests. The latest isolated PostgreSQL run has20 passes and one pending0034 scenario skipped. SQL0034's actual rollback/replay test remains pending specific approval/application. No live provider call, external message, flag change or deployment was performed.


## Final qualification, feedback and delivery-failure additions

Only confirmed guidance for the current owner/mandate is used. Qualification preferences can optionally contain explicitly reviewed literal prefer/avoid phrases; free text alone is shown as review context and does not silently become an exclusion rule. Assessments cite the applied guidance versions and evidence matches, do not modify saved mandate criteria or qualification facts, and become stale when relevant guidance changes. Generated sequences use confirmed tone/buyer/follow-up guidance; a human-supplied draft is preserved literally. Company evidence for first-contact people planning requires migration0033 (specifically approved and applied locally; docs49).

Give feedback on an exact current proposal or owned handoff to save the human correction and a server-derived entity/version/context digest plus bounded preview. The message, proposed guidance and notice/outbox commit together; replay does not duplicate them. Confirm the suggestion separately before retrieval. Editing or revoking guidance invalidates affected pending contexts. Feedback never approves or sends an email. The enabled synthetic browser checks exercised save→confirm→revoke and stale-context blocking; test accounts/fixtures were subsequently removed.

Qualified bounce webhooks are distinct machine delivery-failure events, never lead replies. Migration0034 (specifically approved and applied locally; docs49) is required to atomically hold matching native conversations, including sequence/human drivers, and notify the human before ACK. The exact immutable body-free original receipt preimage binds account, generation, event, failed recipient, provider message and time. Preserve submitted/unknown receipts and paid send reservations: bounced does not mean not submitted. Full-history machine DSN evidence also fails closed; complete history cannot silently clear a saved delivery-failure stop. Ambiguous/unattributable machine reports cannot become human replies. If the native module is provably absent, original UI receipt handling remains compatible; an installed module with a missing helper fails closed.


Manual company reviews and saved sequence drafts now offer an optional feedback disclosure when guidance, durable state and agent workspace flags are enabled. Unsaved changes disable feedback until the real source is saved. A read-only source projection (0035, specifically approved and applied locally; docs49) locks the own-mandate membership version or actor-owned sequence xmin through the atomic feedback commit. It creates only a saved conversation/candidate, not a responsibility, research job or send. Inspect/confirm/revoke in the existing mandate guidance panel; literal manual drafting and n8n execution stay separate.
