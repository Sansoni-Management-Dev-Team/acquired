> Current checkpoint: durable worker, reviewed company research, communications/history accounting, human tasks and execution controls are implemented locally; this module is still in progress. See the latest entry in docs/communications/progress.md for evidence and remaining work. Historical checkpoints below retain their original scope. Pending migrations require specific approval under the latest AGENTS.md. Native execution and external communications remain disabled.

# Goal-driven agent execution and retained n8n sequences

Decision: user-approved on 17 October 2026. This supplements the delivery module and supersedes sequence-only assumptions in earlier plans. Source handoff reviewed: `/tmp/acquire-agent-conversation-handoff.md`; the user's explicit clarification retains n8n as a supported core runtime for the existing UI, not merely a peripheral tool.

## Two supported approaches

- **Structured sequences:** the current UI and builder retain their n8n execution, published versions, steps, waits, branches, progress and manual controls. Do not replace or silently migrate existing n8n enrolments.
- **Agent-managed conversations:** the mandate supplies the goal. A native Acquire worker wakes on replies, research updates, human decisions or persisted timers. It assesses current lead history and chooses the next appropriate permitted action. It does not need to compile a conversation into an n8n workflow or advance a fixed sequence step.

Chat may create an ordinary structured sequence when explicitly requested; a structured sequence is optional in the agent path. n8n downtime must not prevent an exclusively agent-managed conversation from progressing, while the n8n-backed UI must remain functional with Agent mode disabled.

## Goal-to-action loop

1. Persist and deduplicate the triggering event. Claim it with a lease/fencing token.
2. Load the mandate, qualification/evidence, canonical lead identity, current execution owner, prior outreach and available conversation history with coverage/freshness. Retrieve relevant approved scoped guidance. Use bounded context with honest references/coverage rather than claiming a truncated history is complete.
3. Classify interest, question, objection, wrong person, not now, opt-out, meeting readiness or uncertainty. Produce a typed proposed action and concise rationale grounded in approved facts. Never infer missing buyer information.
4. Choose answer/clarify/wait/reassess/stop/escalate/hand off. A due reminder requests fresh assessment; it never unconditionally sends an old draft. Persist the next wake-up, timezone, reason and cancellation/supersession version.
5. Human review is default: Frank-style chat cards with Approve & send, Edit, Reject, Take over and exact-current-batch Approve all. Explicit bounded/revocable YOLO may delegate eligible conversation actions. Memory approval is separate.
6. Before dispatch, revalidate conversation/history/draft/owner/mandate/guidance revisions, authority, recipient/account, sending window, budgets, suppression and takeover. Persist a stable operation key and reconcile uncertain provider acceptance instead of retrying blindly.
7. Save the result and next wake-up or human task atomically with the event/outbox where possible.

For “Who would be buying the business?”, draft an answer using approved buyer context. For “not now”, propose an appropriate reassessment time. Do not advance a fixed pitch or push a booking link regardless of the reply.

## One active automation owner

A lead/conversation has one persisted automation owner: a specific sequence enrolment/runtime, an agent responsibility, or a human. Define the canonical scope to prevent a duplicate contact identity/account or another mandate from creating a second sender. Preserve immutable communications account bindings and current person-wide holds.

Transition is an explicit, versioned command, not a side effect of opening chat. Fence old work, stop/pause the previous executor at its admission boundary, reconcile any in-flight/unknown send, then commit the new owner and wake it. Pending uncertain sends block takeover completion. A late n8n callback must be rejected at Acquire's dispatch gate once ownership changes; a late agent event must likewise be rejected after transfer back. Transfer back must not accidentally re-enable an old callback/enrolment generation. Human takeover blocks all automated prospect outbound. Missing ownership for historical enrolments requires a conservative compatibility/backfill policy and tests, not permission for both to act.

Cold-sequence reply holds stay active. Separately authorised conversational replies can use their own admission path without clearing holds or resuming cold outreach. All v1 modes still stop at meeting-ready interest: create a persistent human task and an agent-to-human message in Acquire chat; the human sends the booking link.

## Persistence and integration

Keep existing Postgres, domain records, sequence builder, n8n integration and communications service. Extend agent responsibilities/events/operations with conversation context revisions, typed decisions, canonical execution ownership/handover, scheduled reassessment and approval references. Do not add `agent` to the campaign runtime enum merely to force an agent conversation through sequence progression. Ownership selects the driver; communications remains the shared transport and outcome journal.

The current `0001-agent-state.sql` is a foundation, not the complete ownership/approval schema. Leave applied migrations immutable; add reviewed forward artifacts. The latest user-supplied AGENTS.md supersedes earlier discretionary-local permission: each future migration requires explicit approval for that specific artifact, including the isolated agent-worktree OrbStack database. No source/main/production/UAT migration, historical runtime switch or live sending is authorised by this architecture decision.

## Delivery mapping and acceptance

AG01 shared commands; AG02 persistence; AG03 stale-context protection; AG04 persisted chat; AG05 native event/wake-up supervision; AG06/07 authority/budgets; AG09 retained n8n sequences and optional sequence tools; AG10 goal-driven conversational decisions/replies; AG11/12 human handoff/cards; AG13/14 dual-mode regressions/rollout; AG15 scoped guidance; **AG16 exclusive conversation ownership and explicit handover**.

Required tests: factual question with sourced answer; objection/wrong person/not-now/opt-out; missing or stale history; new reply invalidates pending draft; reminder rechecks new context; exact-batch approval and scoped YOLO; replay/restart/unknown acceptance; manual/agent/n8n races and late callbacks; takeover/revocation; end-to-end human booking-link handoff; old UI and n8n with agent disabled; agent-only flow while n8n is unavailable. Use existing local test mandates and controlled delivery sinks first. Record implemented/local/live/released evidence separately.

Reference: n8n Wait persists paused execution and supports time/webhook resumption: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.wait/ . This decision retains that existing capability and introduces a separate agent driver, rather than claiming n8n cannot support waits.

## Implementation checkpoint: native execution foundation (17 October 2026)

Migration0005 was specifically approved and applied only to the marker-checked agent-worktree database. Review decisions, edited replacement batches and confirmed scoped guidance are locally verified. Chrome fixture checks verify review/edit/approve, guidance confirm/revoke across reload and original sequence draft conflict/reload; no provider submission was made.

Native implementation now includes a leased event runner, persisted event/run completion and review notifications; exclusive-driver policy and a shared campaign admission hook; integer budget reservation policy; a goal/history-based conversation decision engine; and prepared execution/history/reminder/human-handoff stores. The engine accepts draft/wait/stop/handoff/review, uses no n8n sequence progression, refuses unknown evidence and outbound links, stops explicit opt-outs before a model call (including incomplete history), and does not silently truncate oversized history. Complete immutable history and current context must be rechecked before any effect.

`0006-agent-execution-control.sql` is **prepared, not applied**. Its new native state, canonical identity claims, budget accounts/reservations, authority-use records, human tasks and local-sink receipts require specific user approval. Existing sequence runtime/version pins and historical data are not backfilled or transferred. The shared send gate remains in place; the agent obtains it through a narrowly scoped bridge before membership/policy row locks. Legacy dispatch checks consult native ownership only when the new schema is installed; native work fails closed without it.

This is not a finished always-on outbound agent. The production supervisor/worker composition, actual model/budget accounting, research and optional sequence mutation tools, approved conversational communications dispatch/reconciliation, ownership handover, YOLO consumption/UI, task completion controls and end-to-end evaluation/release remain incomplete. The new database integration cases are explicitly gated on migration0006 and cannot be counted as passes before installation. Keep native execution disabled and external sending off during this checkpoint.

Latest migration authority: after specifically approving0006, the user explicitly said “i approve all migrations to the local tha tyoure working on”. This authorises subsequent migrations only for the dedicated marker-checked acquire_agent_mode database on5437 in this worktree. Record exact forward files/hashes and tests without requesting repeated local migration approval. Main/source, shared, UAT and production remain excluded. Applied0006 is immutable; all46 combined PostgreSQL cases pass.

Current local implementation (0007): native proposal/review/local-sink, model budget ledger, event handlers and local worker tick/sidecar are implemented.55 isolated-Postgres tests include a controlled conversation flow across fresh store instances and superseding reminders. The local worker is installed but native execution remains feature-disabled while supervisor/tools/UI and communications integration are unfinished. Local delivery receipts explicitly say simulated; no provider or booking outcome is fabricated. See the latest communications progress entry for scope and evidence.


Latest checkpoint (0009): all59 isolated-Postgres cases pass. Persisted cross-runtime/human handover and authenticated exact-context control endpoints are implemented; original n8n versions/accounts stay pinned and unresolved sends block transfer. Direct AG-UI activity updates are browser verified with synthetic fixtures. The installed local worker remains feature-disabled. Research supervisor/tools, actual native communications, bounded YOLO, human task controls, native control UI and full evaluation/release remain unfinished. Local migration permission continues without repeated approval on this isolated target; see latest communications progress for hashes and evidence.

Shared mandate updates now use base revisions, atomic CAS/audit and the same command for the original editor. Research maintenance is extracted with passing before/after characterization; autonomous registration and reviewed launch remain pending. Applied0010 restores only an inert singleton omitted from the isolated clone. See the latest communications progress checkpoint for the exact scope and evidence.
