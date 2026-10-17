> Current authority and result (17 October, latest explicit user instruction): the user specifically approved0033–0035 and they were applied unchanged, then granted standing permission only for agent-build migrations in this worktree on `acquire_agent_mode` at `127.0.0.1:5437`, marker `acquire-agent-mode-local-only`. The worktree [AGENTS.md](../AGENTS.md) records the exception. Do not request per-migration approval again within this exact scope; verify identity/marker, preserve applied hashes and record application/test evidence. Main/shared/UAT/production, other worktrees, deployment and live sending are excluded. Historical per-artifact/blanket permission statements below record their original checkpoints, not the current authority. Final all-ten-flag PostgreSQL acceptance:184/184 passed across31 files, zero skips; see [docs49](49-agent-final-acceptance-migrations.md).

# Historical specific local approval: native execution control

Prepared on17 October2026. Status: **specifically approved and applied** to isolated local with the exact hash below. The user subsequently authorised all migrations for this worktree’s isolated local database; that later explicit scope supersedes the per-artifact approval requirement for this target only. Native execution and provider sending remain off while integration continues.

Artifact: `ops/agent-mode/migrations/0006-agent-execution-control.sql`.

SHA256: `94cd62c03a9fa8e99d4cdba415a7a48ae7459fb7b3653200194cc59eb9b25bdd`.

Only target: agent-worktree OrbStack PostgreSQL `acquire_agent_mode`, host loopback port5437, marker `acquire-agent-mode-local-only`. Main/source PostgreSQL on5434, shared/UAT and production are excluded. The runner fixes and checks the target, holds a migration advisory lock, verifies the earlier five hashes, requires the exact selected artifact, and executes the migration in one transaction. No startup script applies schemas.

This forward migration adds:

- Native conversation records with immutable contact/account binding, current context/history, exclusive driver, ownership epoch and reminder generation.
- Canonical person claims to prevent duplicate senders across contacts, users and mandates; existing campaign admission checks those claims only after this schema is installed.
- Explicit authority-use records, shared budget accounts/reservations and audited administrator/CAS budget configuration.
- Persistent human handoff tasks and separately labelled local test-sink receipts; the sink has no provider-submission implementation.
- Actor-scoped row policies, scoped foreign keys and gate/validation triggers. A narrow agent-role bridge obtains the existing communications organisation gate; existing communications functions are not replaced.
- A forward expansion of0005's bounded grant-action constraint to include follow-up email alongside initial/reply email. Existing data still satisfies it.

There is no sequence/enrolment runtime transfer, historical data backfill, provider account import, calendar provision, live-send enablement or production deployment. New indexes and policy triggers also touch existing contacts, bindings, enrolments and agent records; these remain confined to the isolated local database.

Pre-application evidence: offline parsing of72 statements and all14 PL/pgSQL functions; read-only verification of the target marker, five recorded predecessor hashes, expected0005 constraint and referenced existing source columns. Syntax parsing does not prove PostgreSQL semantic correctness. TypeScript and scoped lint pass; current full serial suite4,298 pass/384 skip; Node43 pass; approved-schema isolated PostgreSQL37 pass.

Historical application command (already completed after specific approval):

```sh
node scripts/migrate-agent-mode-local.mjs --apply-isolated-local --migration=0006-agent-execution-control.sql
```

Then execute the nine prepared native execution/budget Postgres cases with `RUN_AGENT_EXECUTION_LOCAL_INTEGRATION=true`, rerun the approved-schema regression cases against the forward schema, and inspect role/isolation/constraint behavior. A failed transaction rolls back; any necessary change to the approved artifact must be disclosed rather than silently treating this approval as blanket schema permission. Keep live sending off and continue the module implementation; this schema approval does not mean the outbound agent or all work items are complete.

Result: applied0006 unchanged, predecessors verified unchanged. All46 combined PostgreSQL cases pass, including the nine previously deferred cases. First forward-schema run exposed a redundant contact query requiring mandate_targets SELECT and expiry-fixture gate assumptions. Removed the redundant query and retained the existing scoped INSERT trigger as the authoritative mandate check; no SQL change or permission expansion. Updated the synthetic expiry fixture to hold the installed gate. Outbox-failure tests now inject a client fault inside the actual transaction instead of adding temporary table constraints. The migration artifact remains immutable.


## Historical checkpoint:17 October — parallel implementation, local authority retained

The user reiterated continue until complete and explicitly authorised subagents. The earlier blanket migration approval remains limited to marker-checked acquire_agent_mode5437. Applied forward files below with immutable predecessor verification. No main/shared/production schema change, deployment or live sending.

- 0011-agent-handoff-controls.sql — `b7935af0319af55c8ebb0cde0fe2ef86f1b7e9b4e16bf9cd353d57082578a058`
- 0012-agent-delegation-policy.sql — `03bb2d6410bbf7db97da696af09a4dfc701a2d87f0f342625bd8dd030b3dcf89`
- 0013-agent-communications-source.sql — `c54392d18932b103dbe46358e476734fabe5c991de1fad3ef4441481a8bfea71`
- 0014-agent-handoff-integrity.sql — `e11e5c467cde8b052407583338067413248bf12d88a25cb8ddde0db886d13e83`
- 0015-agent-research-launch.sql — `a165e5eb19f514b4a26b2553dc9de1cf001c102bee4dfff8dd6236face4b4803`
- 0016-agent-handoff-reminders.sql — `23e9925b623085200b1207c75337e46c98f5228431caadc3c9f91ec34e221d1a`
- 0017-agent-history-account-guard.sql — `531ec385ed55645661c20dd009c909a1995ea57a4fcb3e3a7183f3515b01c539`
- 0018-agent-firmable-execution.sql — `d31e4ae294ecde776dc382c78fefdb04100c14167acd2f60f0183851da157644`
- 0019-agent-email-reply-parent.sql — `f89fc9da00338f256286860deaf627a16e1aa88718979e1817ff6731df44dcfa`

## Subsequent applied local artifacts

- 0020-agent-target-selection.sql — `cb703dad1dd751aac5c270609be4c83e318a13f163bd61ebb12ea118902aa0e3`
- 0021-agent-research-counts.sql — `2a7e09f7ce9e0bdfe76c916fa7538b7e1c01aa724b315d59f79f7abeb2277d7f`
- 0022-agent-incoming-email-events.sql — `56cfd47cb1682e8f0925e318f73df3dd96a1acd2b14d0c5a1a313851bc89c886`

## Historical specific approval and application0023–0026

The user replied “theyre approved” to the explicit four-artifact request. Root verified all hashes in docs/44-agent-pending-local-migrations.md and applied them in order, each in its own marker-checked transaction on acquire_agent_mode5437. Immutable0001–0022 predecessors verified unchanged on every execution. No main/shared/production migration or runtime flag enablement. Newly enabled people, per-conversation incoming event, target performance and sequence-draft tests are being run; application is not test acceptance. At that checkpoint, later0027/0028/0030/0031 still needed separate specific approval; those approvals and applications have since completed, followed by0032–0035.0029 remains unused.


## Latest applied batch and acceptance

0033 company guidance evidence,0034 authenticated delivery-failure events and0035 exact manual feedback sources were specifically approved and applied unchanged. Their reviewed hashes and private application receipts are recorded in [docs49](49-agent-final-acceptance-migrations.md). All184 combined PostgreSQL tests now pass across31 files, zero skips, including the formerly deferred cases. The user subsequently granted the exact isolated standing permission stated above; no applied artifact was changed and no other database, live-send permission or release scope was added.
