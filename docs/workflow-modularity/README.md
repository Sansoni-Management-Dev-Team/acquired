# Shared acquisition workflow

2026-10-24. Plane WF-01/02. Working branch `codex/shared-acquisition-workflow`, based on reliability revision `f6f6b3d`. This branch is separate from the independently changing AI release. No feature deployment or migration application has occurred.

## Fixed product behavior

| Action | Mandate | Research | Outreach |
| --- | --- | --- | --- |
| Run demo | Automatically select an owned, previously researched, unused mandate | Load existing company/person references | Hosted simulator through shared conversation handlers |
| Test live research | New mandate or eligible unused existing mandate | Existing live web/Firmable/enrichment pipeline | Stop after saving results; server-enforced prohibition |
| Find companies | Normal submitted mandate | Existing live pipeline | Existing workflow and approvals |

Agent mode remains independent of these presets. Presets are fixed server-side choices; no generic mode builder, provider flags scattered across handlers, second queue or AI implementation.

## Architecture decision

Separate workflow execution identity from mandate and worker-tick identity. Preserve the mandate, company/person IDs, old creation mode, old receipts and old conversation history. Use one lifetime outreach execution per mandate in this release; completed research-only executions can precede it. Once outreach exists, that mandate is not a new demo candidate. This directly matches the unused-mandate selection requirement and avoids supporting repeated delivery identities unnecessarily.

Every new effect must retain its original execution association. A mutable current execution pointer may help selection/status, but cannot decide the identity of an old operation, callback, permit or retry. No conversation history is cleared to make a source eligible.

The existing saved demo already reuses canonical companies/people. The change removes creation of a duplicate mandate and membership initialization, not duplication of company/person rows. Performance must be measured rather than inferred from this simplification.

## Migration-first sequence

1. Inventory current catalog and source, including latest installed function definitions. Source review alone cannot prove the deployed catalog matches a historical baseline dump.
2. Draft the complete expansion, compatibility/guard, and atomic admission SQL together. Preserve legacy fallback only for genuinely historical unassociated work; new workflows must fail closed in old workers.
3. Review exact SQL files, hashes, target identities, rehearsal bootstrap, compatibility tests and rollback plan as one approval bundle.
4. Apply only after specific approval. Migration-only expansion leaves new behavior inactive and no new executions.
5. Implement shared command/research/delivery composition and UI using existing workers and the independent AI boundary; execute the acceptance matrix before activation.

No partial table-only migration is presented as the complete bundle: existing mapping foreign keys, identity proofs, manual routes and late worker events require coordinated changes.

## Evidence

- [Schema and ownership audit](schema-audit.md)
- [Saved/live research audit](research-audit.md)
- [Communications and admission audit](delivery-audit.md)
- Existing characterization: `./node_modules/.bin/vitest run src/lib/cached-demo-research.test.ts src/lib/create-cached-demo.test.ts src/lib/agent-initial-research.test.ts --maxWorkers=1`: **30 tests passed, 3 files, 1.25s**. Test doubles only; no simulator, database or provider calls. This is the extraction baseline, not proof of new behavior.

## Independent AI module

Read-only inspection found `src/adapters/ai/provider.ts` exposes `completeAiJson`, with request/result types in `types.ts` and provider-neutral error normalization. The existing accounted model decision path integrates it. Workflow code will consume existing handlers/ports and will not copy keys, implement provider fallback or add model-specific imports. Its worktree is being modified by another agent, so this audit does not attest its final deployment or test state.

## Current handoff

WF-01 source and production catalog audit is complete. WF-02 has a proposed three-file migration bundle and three rollback-only rehearsal assertions, with exact hashes and targets in `ops/agent-mode/production-proposals/workflow-modularity/approval-manifest.json`. SQL/PLpgSQL parsing passed. WF-03 awaits explicit approval before any application or database acceptance run. Application workflow implementation, activation and live verification remain unfinished. The local simulator was not accessed.

## Remote-main integration

Merged remote main `6c0d90c` into this branch at `0bb930c`. Preserved both progress histories in the only merge conflict; no application-code conflict. The shared AI module is now part of this branch. Combined AI and demo/research characterization: **93 tests passed across 9 files** (1.92s), with mocked providers, no simulator/database calls. Full workflow implementation and migration approval remain separate work.

## Migration package verification

The fresh transitive catalog capture covers 117 functions. All 1,098 inventoried object records match rehearsal except the migration ledger RLS flag, which is intentionally untouched. The package has 119 parsed migration statements and 18 parsed rehearsal-test statements. Independent review corrected target NULL handling, alias-ID locking, write-lock ordering, terminal reactivation and live/workspace manual routing. These are static review results; real PostgreSQL acceptance, concurrency and existing-route compatibility still gate production application. Temporary SSH access was removed and verified.
