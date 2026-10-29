# Shared acquisition workflow

2026-10-24. Working branch `codex/shared-acquisition-workflow`. Approved schema 001–004 is applied to isolated rehearsal and production. Application implementation `33e0e25` has been released and production canaries have started. Follow-up `d74960e` passed local validation and is building; its deployment is not yet confirmed. Hosted message/reply acceptance remains incomplete.

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

WF-05–09 implementation and local verification are complete. WF-10–14 remain In Progress for browser/journey, hosted simulator, production workload and release acceptance. The latest production evidence and limitations are below. The intervening migration and integration notes are historical records, not pending approval requests. No local simulator was accessed.

## Remote-main integration

Merged remote main `6c0d90c` into this branch at `0bb930c`. Preserved both progress histories in the only merge conflict; no application-code conflict. The shared AI module is now part of this branch. Combined AI and demo/research characterization: **93 tests passed across 9 files** (1.92s), with mocked providers, no simulator/database calls. Full workflow implementation and migration approval remain separate work.

## Migration package verification

The fresh transitive catalog capture covers 117 functions. All 1,098 inventoried object records match rehearsal except the migration ledger RLS flag, which is intentionally untouched. The package has 119 parsed migration statements and 18 parsed rehearsal-test statements. Independent review corrected target NULL handling, alias-ID locking, write-lock ordering, terminal reactivation and live/workspace manual routing. These are static review results; real PostgreSQL acceptance, concurrency and existing-route compatibility still gate production application. Temporary SSH access was removed and verified.


WF-03 update: exact001–004 approved/applied in isolated rehearsal. Eight rollback SQL suites, four concurrency scenarios,117 predecessor-function comparisons and50 mocked application dispatch/recovery tests pass. Application modules/activation remain unfinished. Production remains conditional on verified backup and fresh application checks; consult migration package evidence for final status.


WF-03/04 completed2026-10-24: approved001–004 applied to production after rehearsal/backup gates.129 function hashes and privileges match rehearsal; authenticated readiness200. New workflow execution count0 and feature activation off. See package `application-record.json`. Next is WF-05 shared start/status; no application workflow release is claimed.


## WF-05–11 application implementation and verification

Implemented shared immutable presets, atomic start/status commands, owned unused source selection, original execution context through existing research workers, workflow-aware simulated mappings and delivery, research-only restrictions, and shared homepage controls. No additional queue, mandate copying, provider implementation or history deletion. Saved request IDs survive reload and reconcile with status even when new starts are disabled. Recovery uses the existing scheduled research pass and bounded background pool.

Local verification on 2026-10-24: 781 Vitest files passed, 6,807 tests passed and 956 opt-in tests skipped; TypeScript passed; 183 Node tests passed. Final rollback/reload regression adds focused coverage after this full run. Four actual PostgreSQL rehearsal scripts cover atomic creation/replay/ownership, research worker context, original event identity, and workflow simulator registration/mapping receipts. All use the approved network-none rehearsal database; no local simulator or external provider calls. Four simultaneous starts admitted one execution and returned three replays, 117–135ms in isolated emulated amd64 rehearsal with two pool clients. These timings are not production performance claims.

Production read-only preflight found no lock waiters, healthy app/communications containers and zero workflow executions. Feature release, live research/provider verification and actual hosted simulator message/reply remain pending. The testing menu creates a research-only run from a description; the API also supports a supplied owned unused mandate. Research-only results open the company table, including when presentation was recorded as agent.


## Latest release and acceptance status

Application implementation `33e0e25` is released. Production demo admission, Start, and an outreach proposal have been persisted. This proves progress through those Acquire steps; it does not yet prove an outbound message was accepted or an AI reply returned from the hosted simulator.

The bounded live-research canary is still in progress: 43 candidates discovered, with 4 companies and 3 people persisted at this checkpoint. These are interim results, not completed enrichment or research-only completion acceptance.

Follow-up `d74960e` reduces pure-read gate contention and preserves bounded history continuation progress. Local validation: **6,825 Vitest tests passed / 956 skipped**. The image is building; deployment and post-release canary results remain pending. `controlsSnapshot` retains its required handoff authority gate and can still contend; that path was not weakened to improve apparent performance.

Plane WF-10–14 remain In Progress. Remaining evidence includes actual browser journeys, a confirmed hosted send/reply, terminal live-research-only completion with zero outreach, bounded production workload performance, and verification of the follow-up release. Earlier local PostgreSQL timings are not production latency guarantees. See `docs/communications/progress.md` for the chronological operational record.
