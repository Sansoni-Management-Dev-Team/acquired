# Consolidated local approval and acceptance record:0033–0035

Status: **specifically approved and applied unchanged** on17 October2026. The user explicitly approved all three artifacts below; the coordinating agent applied them in order after verifying the isolated target and immutable predecessor hashes. Private receipts are `.local-data/agent-mode-orbstack/0033-approved-apply.json`, `0034-approved-apply.json` and `0035-approved-apply.json`.

The user then granted standing migration permission only for this worktree's database `acquire_agent_mode` at `127.0.0.1:5437`, marker `acquire-agent-mode-local-only`, now recorded in the worktree [AGENTS.md](../AGENTS.md). Future migrations within that exact scope do not require repeated approval; identity/marker checks, immutable applied files, reviewed hashes and application/test evidence remain required. This later permission does not extend to another worktree or any main/shared/UAT/production database, live sending or deployment.

Only target: `acquire_agent_mode`, loopback5437, marker `acquire-agent-mode-local-only`. No main/shared/production migration, provider sending, agent activation or deployment is included. All three SQL artifacts have independent scope/permission review and parser checks; source/caller acceptance is now locally verified, with earlier missing-schema failures retained as historical evidence.

| Artifact | SHA256 | Capability |
|---|---|---|
| [0033-agent-company-guidance-evidence.sql](../ops/agent-mode/migrations/0033-agent-company-guidance-evidence.sql) | `2c680aafd13f57d17b03d718ce09ad294a643705de32a42163e8987f2861654c` | Read-only bounded company evidence for current owned people planning, no raw business-table grant |
| [0034-agent-delivery-failure-events.sql](../ops/agent-mode/migrations/0034-agent-delivery-failure-events.sql) | `45fcf4d15b77d9cf218d992855d526bd4544d86fbfa49c1f360c72443d187aaf` | Authentic original receipt/preimage-bound bounce holds and durable human notice; retain original receipts/reservations; no resend |
| [0035-agent-manual-feedback-source.sql](../ops/agent-mode/migrations/0035-agent-manual-feedback-source.sql) | `3ea3b3f12332d70b6f55b342797df2dd9481455a91650a40333de8b1266253bc` | Read-only exact saved manual company-review or actor-owned sequence snapshot with retained row locks; no execution permission |

## Why0035 is required

The original AG15 acceptance requires feedback from the existing manual UI as well as agent chat. An optional disclosure beside a saved manual company assessment or sequence draft now collects an explicit correction and proposed preference. It must reference the real saved assessment version or sequence xmin, rather than pretending that a manual record is an agent operation.

The helper requires the current agent role, held organisation gate, locked current membership and owned thread. It reads only the same mandate's target membership/target or the current actor's same-mandate sequence. SHARE locks hold the exact source version until feedback commits; the snapshot is bounded to60KB. No raw table access, write, responsibility creation, research, workflow activation or message send is granted.

The application atomically saves a human source message, server-derived immutable source/version/digest/snapshot, proposed guidance and notice/outbox. Confirmation is a separate user action. Saved literal manual drafts, manual qualification decisions and original n8n execution remain unchanged. Source provenance cannot be removed or rebound during guidance edits. Creating a feedback conversation does not start an agent responsibility.

## Review and test evidence

-0033/0034 scope, hashes, behavior and prepared tests are detailed in docs48. The revised0034 binds the exact body-free receipt preimage to recipient/message/time and holds all non-complete drivers; its earlier draft hash is withdrawn.
-0035 SQL/PLpgSQL parses; independent review confirmed current role/gate/member, tenant/mandate/owner boundaries, row locks, exact numeric membership version/string xmin, replay serialization and no automatic execution.
-Manual-feedback PostgreSQL cases cover stale/missing/foreign sources, exact source provenance, separate confirmation, replay after approval/edit, atomic rollback and absence of agent startup, plus approved preference applied/explained to later qualification. These cases now pass on approved0035; their earlier missing-schema failures are not retrospectively counted as passes.
-Manual sequence/shared form unit interactions pass, including unsaved draft fences, malformed receipt handling, stable retries and changed-source correction preservation. Target worksheet interaction verifies feedback is disabled while dirty and uses the new saved version after a manual save.
-The shared provenance-rebinding defect was reproduced with an actual PostgreSQL failing assertion before fixing editGuidance. Earlier fixture-only errors are retained separately and are not represented as behavior RED.

## Application commands (historical record; already completed)

The coordinating agent used the selected-artifact runner in this order, each its own transaction with marker/immutable-predecessor-hash verification. Receipts remain private. No previously applied file was edited. Do not reapply or edit these artifacts.

```sh
node scripts/migrate-agent-mode-local.mjs --apply-isolated-local --migration=0033-agent-company-guidance-evidence.sql
node scripts/migrate-agent-mode-local.mjs --apply-isolated-local --migration=0034-agent-delivery-failure-events.sql
node scripts/migrate-agent-mode-local.mjs --apply-isolated-local --migration=0035-agent-manual-feedback-source.sql
```

## Approved-schema verification

The final combined PostgreSQL run enabled all ten relevant integration flags: **184/184 tests passed across31 files, zero skips**. This includes the previously deferred company evidence, authenticated bounce and manual feedback cases, plus the synthetic whole native journey and physical provider-shaped research pipelines. Evidence: `.local-data/agent-mode-orbstack/native-all-approved-final-postgres.log`.

Manual feedback schema/API/UI and legacy UI regression checks separately passed33/33 tests; TypeScript and scoped lint passed. Target interactions verify dirty edits block feedback and the next saved membership revision is used. Manual sequence feedback retains exact string xmin and preserves literal drafts and original sequence execution. The saved-manual-review learning case separately confirms guidance, applies/explains the exact versions during native qualification, excludes foreign-mandate memory and stops use on revocation.

These are isolated local/synthetic results. No live research, messaging, mailbox UAT or production release is established by these tests. Owned-mailbox UAT and production deployment remain separately scoped release work.
