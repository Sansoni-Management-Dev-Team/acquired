# Coordinated release provenance (SC-02 / SC-06)

Use [simulator-coordination.md](simulator-coordination.md) for ownership and acceptance. The app and hosted simulator remain independently built and deployed. This procedure adds a reproducible release record; it does not move the simulator repository, change the running local simulator, authorize migrations, or enable real outreach.

## One release workflow

1. Each owner supplies a **clean committed release checkout**, exact Git revision, lockfile, build recipe and build configuration. Use isolated worktrees. Never build a release from the simulator testing worktree's unrelated uncommitted changes. Keep secrets and private evidence in ignored directories outside build inputs.
2. Build using locked dependencies. Record every build input and SHA-256 in the build manifest, including dependency files actually bundled. Retain the produced artifact and its hash. Include the build recipe, lockfile, package metadata and build configuration among the component inputs even if the bundler does not list them. App container build manifests must cover the committed build context, not just its entrypoint. An app artifact can be the saved image archive; a simulator artifact can be `hosted-service.cjs` extracted from its built image.
3. Reproduce the artifact from a second clean checkout with the same dependencies and build options. Compare the artifact hash. Record the immutable built image digest and the separate app/simulator schema profiles from reviewed catalog verification. A profile identifies an exact reviewed prerequisite set; it is **not** a new negotiated server field or permission to apply migrations.
4. Capture each component using the command below, combine them into the [manifest example](../../ops/agent-mode/coordinated-release/manifest.example.json), and run the explicit `preflight` check (prepared artifacts only). Deploy the approved artifacts directly to DigitalOcean; do not trigger the exhausted GitHub Actions build. App and simulator deploy separately, using compatible contract version `1`. Preserve the previous image digests for rollback.
5. After deployment, independently read each running image digest and source revision, extract/hash its deployed artifact, and verify its catalog profile/readiness. Save those observations as the evidence JSON below and rerun verification. Finally run the existing authenticated app-to-simulator canary and inspect saved outbound/inbound evidence. A manifest check, healthy HTTP response or matching contract header alone does not prove a message and AI reply.

## Capture and verify

The existing simulator build manifest format is supported directly: `{ "artifact": "hosted-service.cjs", "sha256": "...", "sources": [{ "file": "relative/path", "sha256": "..." }] }`. The app builder must emit this same small provenance shape for its chosen artifact. It is a build record, not a manually curated claim that omitted inputs were verified.

```sh
node scripts/verify-coordinated-release.mjs capture \
  /path/to/clean/simulator /path/to/artifacts simulator.build.json \
  scripts/build-hosted-simulator.mjs pnpm-lock.yaml \
  SIMULATOR_REVIEWED_SCHEMA_PROFILE sha256:BUILT_IMAGE_DIGEST \
  package.json pnpm-workspace.yaml tsconfig.json \
  ops/agent-testing/hosted/Dockerfile > simulator.component.json

node scripts/verify-coordinated-release.mjs preflight \
  release.json /path/to/clean/app /path/to/clean/simulator /path/to/artifacts

# After deployment, check independently collected running observations:
node scripts/verify-coordinated-release.mjs \
  release.json /path/to/clean/app /path/to/clean/simulator \
  /path/to/artifacts observed.private.json
```

`capture` outputs one component record. Set `components.app` and `components.simulator` to those records; set `requires` to the agreed contract and two schema profiles. Use actual hashes/revisions, not the deliberately invalid example placeholders.

The checker rejects dirty or uncommitted source, wrong revisions, missing input/artifact files, source/artifact hash differences, unrecorded bundler inputs, missing build recipe/lockfile, dependency-byte differences, contract/profile differences, and missing/mismatched deployment references. First-party inputs must match both disk and the committed Git blob. `dependencyInputs` are restricted to `node_modules/` and checked by bytes, with the tracked lockfile and reproducible build establishing their dependency provenance; they do not need to be Git-tracked. Symlinks escaping the selected checkout are rejected. Install dependencies inside the isolated checkout rather than linking to the actively used testing tree.

The offline checker validates the supplied records; it cannot authenticate who collected them or inspect a running server. Deployment observations must come from independent read-only deployment/catalog checks, never by copying the planned manifest values. It performs no network calls, database changes or deployment.

```json
{
  "app": {
    "revision": "EXACT_RUNNING_GIT_REVISION",
    "artifactSha256": "EXTRACTED_RUNNING_ARTIFACT_SHA256",
    "imageDigest": "sha256:RUNNING_IMAGE_DIGEST",
    "contractVersion": "1",
    "schemaProfile": "VERIFIED_APP_CATALOG_PROFILE"
  },
  "simulator": {
    "revision": "EXACT_RUNNING_GIT_REVISION",
    "artifactSha256": "EXTRACTED_RUNNING_ARTIFACT_SHA256",
    "imageDigest": "sha256:RUNNING_IMAGE_DIGEST",
    "contractVersion": "1",
    "schemaProfile": "VERIFIED_SIMULATOR_CATALOG_PROFILE"
  }
}
```

## Existing emergency baseline

The earlier hosted simulator was reconstructed from **130 exact manifest inputs**, reproduced byte-for-byte, then received narrowly reviewed patches. See [hosted patch provenance](../../ops/agent-mode/hosted-simulator-patches/README.md). That is valid historical evidence of the artifact reconstruction; it is **not evidence of a clean simulator source commit**. Do not claim that emergency release passes this new normal gate. The checker rejects `provenanceException` records.

Before the next normal simulator release, its owner must preserve that exact first-party baseline and reviewed patches in a clean committed release branch in the simulator-owned repository, retain the complete dependency input hashes and lockfile, and reproduce the deployed artifact. Do this without overwriting local simulator testing work. Keep any legacy emergency provenance record separate and visibly labelled until this baseline is established. No wholesale repository migration is required.

Validation: `node --test scripts/verify-coordinated-release.test.mjs`. Tests use isolated temporary repositories and files; no simulator, provider or database access.
