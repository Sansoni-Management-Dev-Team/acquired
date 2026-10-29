# WF-01 delivery audit

2026-10-24. Source review only, database-release baseline f6f6b3d. No database/simulator calls, migrations, application changes or live sends. Read AGENTS.md, communications execution plan and current progress. This is design evidence, not runtime verification.

## Finding

The existing shared conversation and communications modules can remain. The principal change is persisted execution identity: transport is currently fixed to the mandate, not an individual workflow execution. A new TypeScript `test` flag or execution row alone cannot safely reuse an old real-mode mandate as a demo.

- `0065-agent-mandate-execution-mode.sql` defines an immutable real/demo row per mandate, with demo_id equal to mandate_id.
- `0066-agent-demo-contact-projections.sql` has a mapping-request FK to that exact mandate/org/creator/demo tuple. Its evidence trigger independently verifies it; `agent_effective_contact` uses the immutable mandate row. Missing mappings fail closed, without real-contact fallback.
- `0070-agent-mandate-execution-context.sql` derives delivery recipients, identity/claim scope, sender bindings and dispatch proof from that mode. Dispatch intents preserve their original mode/context digest. Reconciliation must continue using those original facts.
- `AgentDemoProvisioningStore` additionally requires mode=demo and demo_id=mandate_id; `startAgentOutreach` only accepts demo. `AgentChannelStore.demoOutreachAccounts` and hosted registration SQL join the mode row directly.

## Minimal compatible design requirements

Keep historical mode rows, account bindings, original intents and receipts immutable. Introduce one immutable execution policy record, with actor ownership, preset and source mandate, plus an explicit association from new work to that record. Reuse existing worker events and handlers. Do not add another scheduler.

New execution-aware contact/context resolution must support saved source records while selecting simulated mappings only for the demo execution. Version new context proofs; legacy proofs retain their exact digest and replay behavior. Do not infer execution from a mutable current pointer for an existing operation. New mapping evidence needs an execution-aware FK/identity path; it cannot reference a real mandate's existing demo tuple. Preserve legacy mapping rows and their guards. Whether this is additive columns or a separate new mapping table depends on the schema audit; replacing immutable historical mode is not acceptable.

Research-only admission must remain disabled after research completion, not merely while the worker is running. Any later demo is a distinct execution. A per-mandate guard can conservatively block manual/legacy routes when a restricted execution owns that mandate; the new explicit execution route must resolve its own immutable policy. Otherwise a completed research test could be sent through an old route that knows only mandate_id.

For a smaller first release, restricting source eligibility to existing demo-mode mandates avoids transport scope migration, but does not meet reuse of arbitrary prior real research mandates. Do not silently adopt that restriction.

## Required admission coverage

| Boundary | Existing entry points | Required behavior |
|---|---|---|
| Preparation/allocation | agent/demo route, agent/targets, AgentTargetStore, startAgentOutreach | Reject research-only before mappings, policies, target allocation or conversations |
| Control/model proposals | agent/execution, agent/operations, agent/reviews, agent/authority | Resume/reassessment/review cannot elevate immutable research-only policy |
| Worker | native tick; review.approved, email/whatsapp/linkedin.proposed, channel.due, research.completed, conversation.reassess | Resolve saved execution; late/replayed events cannot start outreach |
| Database new effects | agent_conversations, agent_operations trigger; target allocation/register-channel functions | Deny prohibited state even through direct restricted SQL; retain legacy behavior |
| Final dispatch | agent_load_mandate_execution_context, agent_intent_execution_context_guard, assertNewEffectPermitted | Bind allowed mode/recipient/account to exact execution; no caller override |
| Manual routes | mandates/[id]/outreach, outreach drafts/batch/message approval/send, campaign enrolments/action, sequence enrolment | Extend manual mandate guard; agent-managed/research-only cannot escape through sequence flow |
| Recovery | submission ledger, original-intent capture/materialization, incoming reply callbacks | Preserve original proof/binding, permit reconciliation of existing outcomes; never reroute |

`agent_assert_manual_mandate_outreach_mode` currently only detects demo mandates. `agent_mandate_outreach_mode_guard` currently exits early for non-demo mandates. Both therefore require explicit new-policy coverage. `agent_is_demo_origin`, `agent_mandate_identity_scope`, `agent_recorded_demo_route_matches`, `agent_allowed_mandate_binding`, mapping evidence guard, hosted authority recipient joins and store queries must be audited together, not patched independently.

## Acceptance before activation

Characterize legacy real/demo sends and receipt recovery first. Then test new demo on an unused real research mandate without mutating its old mode; all three channels resolve only registered simulated recipients and senders. Missing/stale mapping or mismatched sender must reject, never fall back. Verify two actors and two executions cannot exchange mappings or replies. Research-only must produce zero provisioning, conversations, drafts, dispatch intents or outreach events via normal UI, direct API, SQL and restarted worker. Retry/lost response/late completion must preserve execution identity. Existing uncertain sends must remain recoverable with no second send. Run actual PostgreSQL guards only on a separately approved isolated target, not the user's occupied simulator database. Genuine hosted response acceptance remains separate from mocked/receipt tests.

Next: reconcile schema proposal with these constraints before freezing all SQL hashes. No migration should be labelled complete merely because a policy table was added.
