# Hosted submit coverage correction

This narrowly scoped patch belongs to the hosted simulator integration (communications P4/P5). It is recorded here because the simulator's source worktree has unrelated uncommitted work. It does not import that work into Acquire or authorize a database migration.

## Exact baseline

- Hosted `hosted-service.cjs` SHA-256: `99988f42642e261715f1163f3441b9ce41aa6d119cdbc7b149130fe52309743f`.
- Original `testing/agent-simulator/hosted-communications-runtime-entry.ts` SHA-256: `f66753343cbf2c49da9f4d0d67e4d78a77c9f783ce330fa78470b31f574b3915`.
- Corrected runtime SHA-256: `5c7fb67c47ba00fd972a2ca027ea6228d4f0a28b9a7ebc7a8444d3cb1b0caecc`.
- New `hosted-submit-coverage.ts` SHA-256: `cb8f4f10edc9814ff6a23573a9a3a0a071acdc7f89b2e4dd662a7fd83dfe581e`.

The release coordinator reconstructed all 130 manifest inputs and reproduced the original bundle byte-for-byte. Apply the production patch only to that verified isolated source snapshot, not the dirty testing worktree. Preserve its dependency versions and build options.

## Defect and correction

Each successful account refresh advances the shared tenant reply revision. Refreshing and projecting each account in turn left earlier projections behind the final revision. The existing tenant history lock prevents competing turns but does not prevent those increments within the turn itself.

`001-submit-coverage.patch` changes only the hosted runtime and adds one helper. Within the existing `historyTurn`, submit now refreshes every sealed scope, projects all scopes at the same final revision, then calls the unchanged coordinator. A refresh failure, projection failure, inconsistent revision, or empty vector prevents submission. Scope digest checks, proof revalidation, final held admission, freshness limits, and account ownership checks remain intact. Ordinary single-account maintenance retains its existing behavior.

## Verification and reproduction

Use a separate source snapshot and the existing test dependencies. No test below needs database credentials, a provider, a listener, or the running local simulator.

1. Verify the original runtime hash and baseline bundle hash above.
2. Apply `001-submit-coverage-tests.patch` to the test snapshot. Its original runtime test file must hash to `0fa9d65c14e3e4534fe72251ab3d89cfacd0649085bdba70beac38f06e38ba79`. This is a test-only artifact, not a runtime build input.
3. Against the original runtime, run `vitest run testing/agent-simulator/hosted-communications-runtime-entry.test.ts --maxWorkers=1`. Observed: **1 failed, 25 passed**. The regression demonstrates that application projection starts after only one refresh rather than all three.
4. Apply `001-submit-coverage.patch` with `git apply --check` first. Verify the corrected hashes.
5. Run `vitest run testing/agent-simulator/hosted-submit-coverage.test.ts testing/agent-simulator/hosted-communications-runtime-entry.test.ts --maxWorkers=1`. Observed: **30 passed**. Cases cover the advancing revision, inconsistent projections, refresh failure, empty vector, and actual runtime adapter composition.
6. The new helper passed isolated TypeScript checking; the corrected runtime bundled successfully with esbuild. Rebuild the full hosted service using the verified baseline build script and compare the new manifest: only the runtime and the new helper should differ from the original source manifest.

Patch preparation and mocked verification are complete. Production deployment, hosted send/reply verification, and final release artifact hash are separate coordinator-owned acceptance steps. Do not claim these tests prove a successful hosted send.
