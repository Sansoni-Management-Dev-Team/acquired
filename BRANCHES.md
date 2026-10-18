# Agent testing branch registry

Integration checkpoint: 18 October 2026. The user confirmed the original testing thread finished and authorized merging the paired fix branches. The completed original source was checkpointed before integration, and its newer fixes/evidence are preserved. This is the current registry for the original worktrees; registries on the fix branches describe their historical pre-merge ownership.

| Lane | Original branch / integration destination | Fix branch | Original source checkpoint | Fork snapshot |
| --- | --- | --- | --- | --- |
| simulator | `codex/agent-local-testing` | `codex/agent-testing-audit-fixes` | `159f53bb0f4416e47612b8e626f6a29b5a92434b` | `378289c85c90d9ffe473ed33217deb2ffee8ab23` |
| application | `codex/agent-mode-exploration` | `codex/agent-mode-audit-fixes` | `2f052c4ae0ecc4f94cbdf1707250b043c897651c` | `8b4eec54763d9550ed79fb1e416dcc37067c8ccc` |

## Worktree paths

- **simulator original:** `/Users/callum/Documents/Development/project-acquire-agent-testing`
- **simulator historical fixes:** `/Users/callum/Documents/Development/project-acquire-agent-testing-fixes`
- **application original:** `/Users/callum/Documents/Development/project-acquire-agent-mode`
- **application historical fixes:** `/Users/callum/Documents/Development/project-acquire-agent-mode-fixes`

## Integration record

- Simulator code: `8fa485e` — evidence-backed conversation depth and ambiguous-capture guards.
- Application code: `045f3a3` — shared test discovery and ephemeral gateway fixtures; `ece0449` — stable namespace owner and guarded activation.
- The original pilot source had not been committed. Each original now has a preserved completed-source checkpoint. A content-preserving ancestry merge records the fork's earlier source snapshot, allowing the actual fix-branch merge to apply only subsequent changes instead of overwriting newer original work.
- Concurrent original test-runner/gateway fixes were reconciled with the shared discovery/injected fixture implementation; all original test cases are retained. Original progress/evidence and exact original AGENTS.md permissions are preserved. The fork-only AGENTS ownership appendix is excluded from the original worktrees.
- Both fix branches are merged into their matching destinations, never across lanes or into main. Final merge commit IDs and verification receipts live in ignored `.local-data/agent-simulator/followup-branch-registry/registry.json` in the original simulator worktree.
- No migration, database mutation, container restart, live send, model call, deployment or push is part of this source integration. The new network topology is source-only until a controlled runtime activation; existing stopped-worker, idle and readiness gates still apply.

## Current verification boundaries

The original pilot's final independent00:35:56UTC checkpoint reports103/103 matching provider/native messages, no pending provider callbacks/events/active holds and no live leased runs or approved/running/uncertain physical operations. It deliberately leaves services available and records future reminders, human reviews and a retained unknown model-cost reservation. This is completed local pilot evidence, not production release, fresh shared-clock verification or proof that every human hold autonomously resolved.

Post-merge default tests, TypeScript and focused lint are recorded in [communications progress](docs/communications/progress.md). Shared-clock integration and longer fresh-model acceptance retain their explicit limits in [the audit handoff](docs/agent-testing-audit-fix-handoff.md). Do not treat historical pre-merge counts as the destination's final results.

## Integration verification

Application default command:4877Vitest passed/668gated skipped, then100Node passed. Simulator own suite:463passed/62files. Broader simulator repository command:4801passed/338skipped,13failed tests plus1suite import failure across7files; the exact same failures are reproduced on completed-source checkpoint159f53b before the merge. Both TypeScript and scoped lint pass. No unrelated baseline failures were edited or described as passes.
