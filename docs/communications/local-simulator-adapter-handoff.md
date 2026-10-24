# Local simulator adapter handoff — 24 October 2026

Read-only audit against Acquire `6a3b0f1`. No simulator files, processes, configuration or database were changed.

## Two separate compatibility boundaries

The embedded Acquire TypeScript adapter calls `agent_load_mandate_execution_context`, `agent_communications_source_kind` and `agent_channel_communications_source`; these readers are byte-identical to the latest application source. They delegate execution identity and mapping to installed SQL functions, rather than directly reading legacy mapping tables.

**A separate simulator-owned reader is incompatible with new workflow demos.** In `testing/agent-simulator/saved-recipient-source.mjs`, `mappingSql` reads legacy `agent_demo_contact_mappings`, `agent_demo_mapping_requests`, `agent_demo_mapping_receipts`, and `agent_mandate_execution_modes`. `otherRunSql` also reads legacy mappings. `verified()` requires `row.demo_id === row.mandate_id`; new workflows use the execution ID as demo ID. Recompiling the embedded adapter alone cannot fix this reader.

The simulator owner should add regression tests for a fresh workflow mapping plus retained legacy mappings, then use the approved effective views (`agent_effective_demo_contact_mappings`, `agent_effective_demo_mapping_requests`, `agent_effective_demo_mapping_receipts`, `agent_effective_execution_modes`) with exact execution/owner/mandate/run identity checks. Preserve manifest/result/mapping digest verification, original binding generation, source fingerprint, membership, and cross-run denial. Do not merely remove the demo/mandate equality check without validating the new execution relationship. Existing legacy probe success is not fresh Run demo acceptance.

## Stale embedded adapter inputs

Manifest: `/Users/callum/Documents/Development/acquire-simulator/.local-data/orbstack/runtime-manifest.json`.
Application baseline: `/Users/callum/Documents/Development/project-acquire-database-release` at `6a3b0f1`.
These seven captured inputs differ; hashes below are the new application bytes:

| Path | SHA-256 |
| --- | --- |
| `communications/packages/core/src/dispatch-diagnostic.ts` | `44afb054660f03b714d47187211378e2a9202d40a5bc586508db3232d72183de` |
| `communications/packages/core/src/scoped-service-auth.ts` | `9293030b1cac69dcc03e4e02d6f44866329f1c051952cdd59174a45a3d1b5914` |
| `src/db/campaign-client.ts` | `5f2bcca7e30fb763dbc885bcef958e53e68e69779b6e72ad0bff1d66e102a49c` |
| `src/lib/campaign-send-admission.ts` | `1acd185a5dc73123e94512b4bc27130b549ee703c471ad7786ff2085ae07f29d` |
| `src/lib/campaign-send-gate.ts` | `9082801271437e671c2d7a7692fdf1bcdb95767a0bc4e43c0675e6bc77912107` |
| `src/lib/communications-coverage-projector.ts` | `ac7e9336e8d68bf32dcdecd8dba9756d9452cabb24d392c448c18a6594cff79d` |
| `src/lib/communications-routing.ts` | `2a8ca3a8963e1ba168386070336e048de03a95eb5cf116cafb76f2fda71e66e7` |

Coverage projection notably changes from SERIALIZABLE to gated READ COMMITTED with bounded bootstrap retries and safe diagnostics. Rebuild the entire transitive bundle using the owner builder; do not patch seven individual compiled modules.

## Owner rebuild procedure

Owner instructions: `/Users/callum/Documents/Development/acquire-simulator/ops/local/README.md` and `docs/acquire-local-handoff.md`.
The builder is `testing/agent-simulator/saved-recipient-runtime-build.mjs`; its interface is:

```sh
node testing/agent-simulator/saved-recipient-runtime-build.mjs APPLICATION_ROOT PRIVATE_BUNDLE PRIVATE_MANIFEST
```

Both output paths must be new canonical absolute paths under that simulator checkout's `.local-data`, with existing parent directories. It refuses overwrite and captures all transitive source hashes and dependency metadata. Select the aligned application worktree explicitly; regenerate the owner's runtime configuration hash through its normal process. Preserve existing private environment, TLS, account identities, profile mounts and database identity guards. The README notes that `@vercel/functions` is bundled while `pg` and `zod` resolve from the image; confirm that packaging when regenerating. Docker image rebuild alone does not regenerate the private adapter.

This document is a handoff, not permission to alter the other thread's running simulator or apply any migration. After owner changes, validate old identities/history and fresh workflow recipient lookup before any authorized three-channel send test. Acquire's development app/worker can use latest source while retaining existing local guards; that establishes code/SDK parity, not production-image end-to-end parity.
