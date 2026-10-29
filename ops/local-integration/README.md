# Isolated local Acquire integration stack — prepared, not started

This is the app half of the coordinated local test environment. The simulator owner is upgrading the existing OrbStack simulator into its independent `acquire-simulator` checkout while preserving its data. This package does **not** create, reset, migrate or start a simulator database/runtime. Do not substitute a second simulator or an ad-hoc callback bridge.

## Targets and images

| Component | Exact new target | Status |
|---|---|---|
| App PostgreSQL | `127.0.0.1:15441/acquire_integration_app` | Not initialized |
| App database volume | `acquire_integration_app_pgdata_v1` | Proposed new volume |
| Database marker | `acquire-app-integration-local-v1` | Set only by approved SQL |
| Compose project/network | `acquire-integration-app` / `acquire_integration_app_private_v1` | Not started |
| App HTTPS | `https://app.acquire-integration.test:18443` | Not started |
| Simulator | Exact existing endpoint supplied by simulator owner | Handoff pending |

Ports15441 and18443 were checked with `lsof` on2026-10-24 and were not listening at preparation time. Recheck immediately before startup; this does not reserve them. Do not change existing ports/volumes/services to make room. Compose binds only loopback and has no schema-init mount. Both database and runtime services require explicit profiles.

Use the same app Dockerfile/runtime as production, rebuilt from the aligned clean committed local source. Build with `--build-arg NEXT_PUBLIC_APP_URL=https://app.acquire-integration.test:18443` and record that build argument: Next embeds public values into client assets, so changing runtime `NEXT_PUBLIC_APP_URL` alone cannot repoint a production-origin image. The local and production images use the same committed code/Dockerfile but intentionally have different artifact digests when this baked origin differs. Record its immutable image digest using the [release provenance workflow](../../docs/communications/simulator-release.md). Do not treat an earlier production image as proof that new local changes are present. Pin PostgreSQL17 and Caddy image digests as well. The simulator owner supplies its separately built image revision/digest; this compose file neither builds nor runs it.

## Frozen schema approval package

The two SQL files are prepared in the ignored directory `.local-data/local-integration/approval/` of this release checkout; their exact hashes and target are in [approval-manifest.json](approval-manifest.json). **No SQL has been applied and no database has been initialized.** Previous approval for the rehearsal or `acquire_agent_mode` does not authorize this new target.

- `001-local-roles.proposed.sql`: exact local target/empty-catalog/system-identifier guard, nine required NOLOGIN/NOSUPERUSER/NOBYPASSRLS roles, original role memberships and the local database marker. No passwords or application rows.
- `002-app-schema.proposed.sql`: guarded frozen schema-only snapshot from the approved rehearsal (`acquire_hosted_demo_rehearsal`, marker `acquire-hosted-demo-rehearsal-only`, system identifier7699248227334438947). Generated with PostgreSQL17.10 `pg_dump --schema-only --no-owner`; includes tables, indexes, functions, RLS policies and object grants. No fixture, user, production or simulator rows were copied. Objects are owned by the fresh target operator `postgres`, matching this isolated rehearsal's operator. Required roles are created separately first.

The snapshot includes the existing application foundation, native-agent/hosted-registration schema and shared-workflow001–004 guards already applied to the rehearsal. **Do not also replay those migration files after restoring the snapshot.** Hosted registration records, channel accounts, users, memberships, mandates and simulator bindings are data and deliberately absent. Their minimal local fixtures must be created through reviewed setup/test entry points after the simulator handoff; no production registrations or secrets may be copied.

Approval must cover the exact hashes, new local volume/database and database initialization. After that approval, inspect the newly initialized cluster's system identifier and attest it via `acquire.expected_system_identifier` before each file. The files reject another database, marker setting, operator or system identifier. The current manifest leaves this identifier null because the cluster does not exist. A changed SQL file/hash requires renewed approval. The package is a baseline proposal, not an assertion that dynamic SQL and every optional feature have been exhaustively exercised. The catalog comparison below records its supported scope.

## Aligned catalog and runtime readiness

Read-only catalog comparison against the frozen rehearsal on 2026-10-24 used aligned app revision `48457bf` (which includes `daaa01f` and hosted SDK alignment `9798ed0`). All 83 statically referenced public relations and 78 of 79 public function names exist. The sole absent function, `local_simulator_business_now()`, belongs to explicitly injected accelerated business-time testing. Normal agent transactions probe for it and continue on the real clock when absent. This baseline intentionally does not enable accelerated time or its optional columns; those would require a separate exact migration proposal. Static names are not proof of all dynamic SQL, argument signatures or runtime permissions. The existing shared-workflow adapter/guard rehearsal passed against this source database; the fresh target still needs restore and acceptance tests.

Private evidence: `.local-data/local-integration/catalog-comparison.json`. Both proposed SQL hashes were rechecked unchanged after the comparison. No additional schema migration is identified for the normal real-clock workflow by this comparison.

The production runtime requires `DATABASE_DRIVER=postgres`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_READINESS_SECRET`, `APP_URL` and `NEXT_PUBLIC_APP_URL`. Both origin values must exactly match the image's baked origin. The example starts with workflow, research and agent execution disabled; a healthy HTTP server alone does not mean Run demo is enabled. After schema and fixtures are verified, enable the workflow schema/activation and agent durable/native/exploration flags deliberately. The registered background worker additionally needs a fresh local runtime registration and its matching runtime ID/secret, registered scope mode and mandate-scope enforcement. Do not set `AGENT_WORKER_MANDATE_ID` or copy a production runtime. Keep live research disabled until its own provider configuration is approved. Simulator registration, trust and callback readiness remain separate prerequisites supplied by its owner.

## Private configuration and callback handoff

Create a new ignored absolute `PRIVATE_DIR`, outside the build context. Generate local-only database/auth/readiness keys; never copy production environment files. Populate `app.env` from [app.env.example](app.env.example). Keep the database password in `database.password` and ensure it matches the URL. No provider credentials are supplied by default.

Provision a private local CA and an app certificate/key with SAN `app.acquire-integration.test`; store `app.crt`, `app.key` and the app+simulator trust anchors in `integration-trust.pem`. Do not disable TLS verification. The gateway terminates TLS directly at18443 both inside and outside the network; the app resolves its own hostname through the gateway alias. The browser needs a user-approved host mapping to loopback and trust of the local CA. Do not edit the host trust store automatically.

Before enabling demo communications, obtain from the simulator owner:

1. Exact HTTPS endpoint, contract version1, image/source revision and CA chain.
2. Callback reachability to `https://app.acquire-integration.test:18443` from the existing simulator runtime. The simulator owner configures that hostname to reach this host/gateway, **not its container's own127.0.0.1**. No bridge process is needed.
3. Exact isolated run/organization/user identifiers, three channel account bindings, local scoped-auth/callback keys and expected callback registration. These must match newly owned app fixtures; never use production recipients/accounts.
4. Readiness/history support and evidence that its email/WhatsApp/LinkedIn tests passed while existing simulator data stayed intact.

Configure the app's normal hosted-demo registration/setup path with that endpoint and scope. No simulator fields are guessed in the compose file. Only after registration and readiness checks should the ordinary Run demo HTTP route be tested. Live web/Firmable research and real-channel outreach remain separate authorization/configuration decisions.

## Bring-up after approval and owner handoff

1. Finish source alignment; build and hash the clean app image. Validate its prerequisite catalog against the frozen package.
2. Recheck ports and named-volume absence. Obtain exact migration/initialization approval, then start only the `approved-database` profile and inspect the fresh identity. Apply only the approved hash-verified files to15441 with identity attestation; never mount them in an automatic entrypoint.
3. Create minimal local ownership fixtures and register the simulator accounts through normal reviewed setup tools. Keep fixture IDs/evidence in the private directory. Verify local actor/tenant isolation.
4. Validate private TLS and callback DNS from both runtimes. Start `approved-runtime` only after configuration is complete. Run app health, database/catalog and communications readiness before the authenticated demo canary.
5. Use the shared three-channel canary and direct SQL assertions for outbound, inbound reply and research-only zero-outreach boundaries. Restart only this stack to verify persistence; stop without `down -v` to preserve local evidence.

Static validation completed with `docker compose ... config --no-env-resolution --no-interpolate`; no services started. Runtime configuration, fresh database restore and end-to-end verification remain pending approval and simulator handoff.
