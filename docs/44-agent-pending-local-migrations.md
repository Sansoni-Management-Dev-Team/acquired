# Specific local migration approval request:0023–0026

Status: specifically approved by the user ("theyre approved") and applied unchanged to the isolated local target on17 October2026. All four SHA256 values below matched before execution; each runner transaction verified every predecessor. Private apply receipts: .local-data/agent-mode-orbstack/0023-approved-apply.json through0026-approved-apply.json. This approval does not cover later artifacts.

Only target: `acquire_agent_mode`, loopback port5437, database marker `acquire-agent-mode-local-only`. No main/source/shared/UAT/production target. Apply in order, each in its own transaction after marker and immutable predecessor checks. No live-send enablement, automatic startup migration or deployment. New-schema acceptance tests and the pilot performance retest run after approval/application; currently deferred cases are not passes.

- [0023-agent-people-phase.sql](../ops/agent-mode/migrations/0023-agent-people-phase.sql) — Separate exactly reviewed email-only contact enrichment: scoped company snapshots, candidate registry, contact persistence and native job status. Existing missing email may be augmented; existing identity, human fields, fictionalisation and DNC are preserved.

  SHA256 `874e92dfbbb0fe867776b1e4c472322d525a22ab38cefcdcee72c52bc9787a2b`

- [0024-agent-incoming-conversation-dedup.sql](../ops/agent-mode/migrations/0024-agent-incoming-conversation-dedup.sql) — Correct incoming-message deduplication per conversation, retaining legacy event replay detection for its original conversation.

  SHA256 `2925b6233efed46e9329217b41f4197882733423c17ef2d9f2d55ff39710b83f`

- [0025-agent-canonical-alias-performance.sql](../ops/agent-mode/migrations/0025-agent-canonical-alias-performance.sql) — Optimize canonical alias lookup and cached target snapshots while preserving existing unresolved-send, ownership and suppression checks. Pilot latency retest remains required.

  SHA256 `2862539956965663e99c38ee9be4a27fb95ad3c2d00c16d6499e1ef283f73706`

- [0026-agent-sequence-drafts.sql](../ops/agent-mode/migrations/0026-agent-sequence-drafts.sql) — Grant the scoped agent role access to owned editable sequence drafts, with explicit permissive owner policy plus restrictive membership fence. No publication/version/enrolment privilege.

  SHA256 `b6cf3e64474bbfa870db5cece201d2e688457f1a536d91050ee0f23c9977b744`

Existing applied0001–0022 remain immutable. Failure rolls back the selected artifact; changed artifacts need fresh disclosure and approval. Code is still under construction in independent slices, which will continue while this request is pending.
