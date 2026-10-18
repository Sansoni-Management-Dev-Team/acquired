# Agent testing branch registry

These paired worktrees contain audit fixes while another thread finishes the original local pilot. This registry records source snapshots; it does not authorize merging or runtime changes.

| Lane | Original branch | Fix branch | Source snapshot commit | Merge destination |
| --- | --- | --- | --- | --- |
| simulator | `codex/agent-local-testing` | `codex/agent-testing-audit-fixes` | `378289c85c90d9ffe473ed33217deb2ffee8ab23` | `codex/agent-local-testing` |
| application | `codex/agent-mode-exploration` | `codex/agent-mode-audit-fixes` | `8b4eec54763d9550ed79fb1e416dcc37067c8ccc` | `codex/agent-mode-exploration` |

## Worktree ownership

- **simulator original:** `/Users/callum/Documents/Development/project-acquire-agent-testing`
- **simulator fixes:** `/Users/callum/Documents/Development/project-acquire-agent-testing-fixes`
- **application original:** `/Users/callum/Documents/Development/project-acquire-agent-mode`
- **application fixes:** `/Users/callum/Documents/Development/project-acquire-agent-mode-fixes`

## Snapshot and integration rules

Both original worktrees contained substantial uncommitted implementation. The first commit on each fix branch captures that source state; it is a baseline, not a new audit fix. Private runtime files, credentials, generated output and dependency directories were excluded. The original branch/index were not committed or modified to create these snapshots.

1. Work only in the matching `*-fixes` directory. Confirm `git branch --show-current` and `git status` before changing files.
2. The original thread owns its ongoing tests, containers, databases and saved runs. These fix worktrees own no running OrbStack stack, database, ports or model profile. Copied Compose names, launch commands and standing database permissions do not authorize using the original runtime from these forks.
3. Keep new fixes in commits after the snapshot commit above. Fork-only ownership metadata (especially this fork's AGENTS.md appendix) must not be cherry-picked into the original worktree. The two lanes have different destinations; never merge one lane into the other.
4. After original testing finishes, reconcile its final source against the recorded baseline. Commit the original thread's work first, review divergence, and prefer cherry-picking the selected post-baseline fix commits. Do not blindly merge baseline snapshots over later changes.
5. Run the relevant combined checks on the reconciled destination. Activate runtime changes only after an explicit controlled handoff. No merge, push, deployment, migration or live sending has been performed by this fork operation.

## Audit follow-up ownership

- SIM21 / TA01: application fix lane — test runner discovery and isolated callback gateway fixture.
- SIM22 / TA02: application fix lane — stable shared network namespace across unexpected app restarts; source/process tests now, actual OrbStack acceptance after pilot handoff.
- SIM23 / TA03 and SIM25 / TA05: original testing thread — simultaneous-route migration/reassessment and current pilot; preserve its results.
- SIM24 / TA04, SIM26–SIM30 / TA06–TA10: investigate or execute the remaining acceptance work in a separately owned runtime; do not treat a local fixture as real model/application acceptance.
- SIM28 / TA08: shared external-app clock design is a separate cross-process/schema change; current external-app multichannel profile stays on wall time.
- SIM31 / TA11: reconcile source, evidence and Plane statuses when acceptance is complete. This registry does not mark the module complete.

## Post-snapshot code commits

| Lane | Commits to review for integration |
| --- | --- |
| Application | `045f3a3` SIM21 test discovery; `ece0449` SIM22 network lifecycle and guarded activation |
| Simulator | `8fa485e` SIM26 conversation-depth evidence and ambiguous-capture guards |

The SIM26 commit supplies reporting only; longer real-AI acceptance remains pending. SIM22 actual container/original-receipt acceptance remains pending. Fork-only ownership commits are not integration commits.

## Plane checkpoint

[Testing module](https://plane.mlai.au/mlai/projects/049211e4-72a2-4ee3-9257-157a4f11822f/modules/6819fec1-d2b9-4af0-88e3-7dad7a8ea3d4): SIM21 is Done for locally verified source behavior; SIM22 and SIM31 remain In Progress. SIM26 and SIM28 retain Todo with reporting/design notes. Other items and the original pilot remain pending with their existing owners. Module status remains In Progress.
