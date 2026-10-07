# Research test and release procedure

## Test structure

Each register entry has three independently specified scenarios. `planned` scenarios are specifications, not executable or passing tests. Do not add empty, skipped or assertion-free tests to satisfy the matrix.

| Level | Proof required | Intended harness |
| --- | --- | --- |
| Regression | Reproduce the concrete failure with a minimized synthetic equivalent; capture baseline failure where available and success after it. The register explicitly distinguishes captured pre-fix runs from incident-based minimized reproductions. | Colocated Vitest tests at mapper/domain/repository boundaries |
| Generalization | Change names, geography, entity type, payload shape, values, evidence ordering and fault timing. Expected outcomes come from a hand-labelled fixture or explicit invariant independent of production decision functions. | Table/property tests; controlled-clock scheduler and callback fault tests |
| Integration | Cross the actual changed boundary, including serialization and persistence when relevant; compare consumers of the same evidence. | Existing workflow/coordinator suites and local research E2E harness; browser E2E for async server-component/UI paths |

Add actual test-file paths and runnable commands to `acceptance-scenarios.json` when implementing the tests. Preserve stable IDs in test descriptions so evidence maps back to the finding. One shared integration test may cover multiple findings, but it must make the assertions required for every referenced scenario.

## Fixture layout

Use `fixtures/` for fictional minimized inputs and independently written expected outcomes. Each fixture must name its covered scenario IDs, source shape, perturbations and expected result. Do not commit raw production snapshots, emails, phones, access tokens or provider credentials. The scenario matrix names actual executable tests; static fixture descriptions alone are not proof.

Cover positive, negative, unknown and operational-error outcomes. Include non-fire industries and other countries; global-versus-regional conflicts; headquarters-versus-branches; trading names and subsidiaries; no-match provider results; missing financial/manual evidence; duplicate profiles and late callbacks. Never key expectations to production company names or mandate IDs.

Scheduler fixtures must exercise normal dispatch and recovery from GET workspace, GET outreach and POST companies, including simultaneous recovery triggers. Inject 429, application callback 502, database-write failure, partial batch settlement, cancellation and lease expiry. Bound clocks, concurrency and network access. Assert request counts and durable state, not only returned status.

## Existing commands to reuse when relevant

- `pnpm test` for applicable unit/domain regression suites.
- `pnpm test:workflows` and `pnpm test:coordinator` for worker/coordinator boundaries.
- `pnpm test:research:e2e` for the local application/worker/reader/database chain after checking harness prerequisites. This creates isolated synthetic records and must retain its existing cleanup and network isolation rules.
- `pnpm typecheck` and `pnpm lint` for changed application code.

Database-backed verification has run against the explicitly configured local OrbStack database with synthetic fixtures; subsequent runs must retain that explicit local configuration. Never run automatic migrations or resets. Missing schemas require a separately reviewed migration and explicit approval for that migration. Live smoke/canary commands are separate, bounded, cost-aware verification—not a replacement for deterministic fixtures or authorization to run them now.

## Evidence and release gates

Copy the verification template into the finding's `verification` value. For every scenario record the test file, exact command, successful exit code and accessible artifact. Include commit, reviewer, verification timestamp, before/after reproduction evidence, resolved decisions and remaining limitations. A command string without reviewed results does not establish proof.

Before release:

1. Every finding is verified with all three scenarios; all intake entries have evidence-backed resolutions and any new findings are included.
2. Relevant decisions are resolved; fixtures vary industries, countries, sizes and legal-entity shapes.
3. API, screening, worksheet and report agree for the same snapshot; every company and catalogue field has a classified result.
4. Every dispatch/recovery entry point passes admission, idempotency, budget, cancellation and terminal-state tests. Final counters reconcile to durable records.
5. Execute applicable existing checks and integration suites. Document any remaining provider or manual-diligence limits; do not convert them into successful enrichment claims.
6. Use a staged rollout and an explicitly authorized bounded canary, checking existing numerical performance/egress criteria as well as correctness. Record rollback criteria and post-rollout observations.

The structure validator checks traceability and evidence metadata. Review artifacts and execute the referenced tests before accepting its release-readiness result. Passing this metadata gate does not establish production deployment. See verification/README.md for executed local evidence and the disclosed unintended local backfill test/restoration.
