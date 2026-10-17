# Local migration approval record:0033 and0034

Status: **specifically approved and applied unchanged** on17 October2026 as part of the consolidated0033–0035 batch in [docs49](49-agent-final-acceptance-migrations.md). The earlier pending request below is now resolved. Exact SHA256 values remain unchanged.

Only target: database `acquire_agent_mode`, `127.0.0.1:5437`, marker `acquire-agent-mode-local-only`. The user subsequently granted standing migration permission for this exact worktree/database scope, recorded in [AGENTS.md](../AGENTS.md); do not request repeated per-migration approval within that scope. Identity/marker verification, immutable applied artifacts and recorded hash/test evidence remain mandatory. Other databases/worktrees, live sending and deployment are excluded.

The final work-item audit identified two required behaviors that were missing. The code and narrow database capabilities are now locally verified; they complete these persistence boundaries. Applied migration files remain unchanged.

##0033: evidence for human-confirmed qualification preferences

Artifact: [0033-agent-company-guidance-evidence.sql](../ops/agent-mode/migrations/0033-agent-company-guidance-evidence.sql).

SHA256 `2c680aafd13f57d17b03d718ce09ad294a643705de32a42163e8987f2861654c`.

Adds one read-only function for the native role. It requires the held organisation gate, current membership, owned thread and current supervision/mandate revision. It exposes company profile evidence and at most20 findings for at most50 already associated mandate companies. It grants no raw target/finding access or writes. This lets first-contact people planning assess an explicitly confirmed maintenance/installation preference using actual company evidence, as cached-contact planning already can.

The code freezes exact approved guidance versions in research/target/people plans, rechecks them on review/allocation, and shows the human the applied versions/explanations. Only explicitly reviewed literal phrase policies affect native prioritisation; ordinary free text stays review context. Saved mandate criteria, qualification facts, provider search scope and sending permissions remain unchanged. Independent SQL review found no scope must-fix. The evidence acceptance now passes after approved0033 application. Historical pre-application evidence was30 surrounding PostgreSQL passes and17 unit passes, with the new case blocked by the explicit missing0033 prerequisite. That prerequisite failure remains historical and was never counted as a pass.

##0034: verified delivery failure stops and human notification

Artifact: [0034-agent-delivery-failure-events.sql](../ops/agent-mode/migrations/0034-agent-delivery-failure-events.sql).

SHA256 `45fcf4d15b77d9cf218d992855d526bd4544d86fbfa49c1f360c72443d187aaf`.

Adds a narrowly scoped campaign-role function accepting an original delivery-failure receipt. The held gate/current member, recorded owned email account, immutable receipt and SHA256 of its exact body-free metadata preimage must match. That preimage binds the original connection/account/generation, event, failed recipient, provider message and time; callers cannot substitute a recipient using an unrelated genuine receipt.

The transaction holds every matching non-complete native conversation regardless of agent/sequence/human driver, stops future outreach, invalidates pending email reviews, revokes grants and emits a persistent human notice/history wake once per conversation. It preserves driver/account identity, original submitted/running/unknown operations and their budget/send receipts. A bounce is never proof of no submission and never becomes a human lead reply. There is no resend or account/backend switch.

The full-history fail-closed path already passes20 actual communications PostgreSQL cases. Provider-shaped normalization/codec/storage/outbox/consumer tests pass; prepared0034 PostgreSQL cases cover receipt preimage/recipient/message/time tampering, role denial, all-driver holds, transaction rollback, replay/dedup and preservation of running reservations. Those schema-dependent cases now pass after exact approval/application; see the final combined verification below. Independent review found and corrected both recipient-proof and active non-agent-driver gaps before approval. The earlier draft hash `ee139...` is withdrawn and must never be applied.

## Application commands (historical; already completed)

Each selected artifact was applied in its own transaction, verifying the isolated marker and all immutable predecessor hashes and recording its exact hash. These applied files must remain immutable; do not reapply them.

```sh
node scripts/migrate-agent-mode-local.mjs --apply-isolated-local --migration=0033-agent-company-guidance-evidence.sql
node scripts/migrate-agent-mode-local.mjs --apply-isolated-local --migration=0034-agent-delivery-failure-events.sql
```

The final combined approved-schema PostgreSQL run passed184/184 tests across31 files with all ten relevant flags enabled and zero skips, including the evidence/bounce/manual-feedback cases. Private evidence: `.local-data/agent-mode-orbstack/native-all-approved-final-postgres.log`; exact application receipts are `0033-approved-apply.json` and `0034-approved-apply.json` in the same ignored directory. These synthetic/local checks establish no live-provider delivery. Production and owned-mailbox UAT remain separate release steps.
