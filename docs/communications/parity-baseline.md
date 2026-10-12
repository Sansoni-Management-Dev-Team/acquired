# Communications P0 parity baseline

Checked 12 October 2026 for P0.1/P0.2. Remote operations were read-only. No database migrations, deployments, live sends, credential changes or production gate changes were performed. This report records the starting environment; later verification must identify its own revision and evidence.

## Code and deployed services

Fetched `origin` and verified `HEAD` and `origin/main` both equal `fa544da5578375efd57af4ba680a403a1568769e`. The initial tracked worktree change was `AGENTS.md`; planning documents and unrelated infrastructure review output were untracked. Concurrent implementation changes are outside this baseline.

| Surface | Observed running revision/image | Evidence and limits |
| --- | --- | --- |
| Production Acquire | `acquire-app:github-fa544da5578375efd57af4ba680a403a1568769e`; image `sha256:c8675f174fe0511d42f8fd3cb58353ca8450fa53431536c6cfaa0d74578df0ce` | Healthy; image tag matches Git. Runtime build origin is `https://acquire.mlai.au`. Source is bundled, so tag consistency is not a byte-for-byte source comparison. |
| Hosted LinkedIn | `acquire-linkedin:main-fa544da`; image `sha256:76102262f07cb800441ad2b7f3261651e07415d183276b640ed9a44f3ec4aa1c` | Healthy; all 21 Python/dependency files in the running image matched checkout SHA256 values. |
| Hosted WhatsApp | `acquire-whatsapp:main-fa544da`; image `sha256:fb853f8a22f4f3657d3d3772fbdc8e92b75777a5ef62d6dbe284b9d001e8bcd6` | Healthy; all 14 service source/package/lock files in the running image matched checkout SHA256 values. |
| Shared OrbStack LinkedIn | Healthy, **stale source** | Running `adapter.py`, `server.py`, `test_campaign.py` differed from checkout. |
| Shared OrbStack WhatsApp | Healthy, **stale source** | Running `crypto.mjs`, `http.mjs`, `routing.mjs`, `sessions.mjs`, `store.mjs` differed from checkout. |

Private evidence: `.local-data/communications/image-parity-20261012.json`. A hash of the remote runtime database endpoint/database/user matched the restricted environment used for database comparison. No connection URL or secret was printed.

The shared LinkedIn service has `LINKEDIN_ALLOW_LIVE_SENDS=true`, `LINKEDIN_ALLOW_CAMPAIGNS=true`, `LINKEDIN_ENABLE_FIXTURES=true`, and `LINKEDIN_REPLY_MONITOR_ENABLED=true`. The shared WhatsApp service has `WHATSAPP_CAMPAIGNS_ENABLED` unset and `CAMPAIGN_REPLY_MONITOR_ENABLED=true`. Rebuilding images without restarting these containers is possible. Restarting shared services can restore real sessions and should be handled deliberately; baseline tests should use the isolated fixture stack.

## Shared local database versus production

Reviewed and ran:

```text
node scripts/check-local-db-parity.mjs .local-data/app/public.env .local-data/communications/parity-20261012.json
```

The script executes catalog queries inside `BEGIN READ ONLY`, then rolls back. No personal rows or row counts were requested. Exit 1 correctly indicated drift.

| Check | Result |
| --- | --- |
| PostgreSQL versions | OrbStack 17.10; production 17.6. Version difference is explicit. |
| Migration ledger | Local 16 entries; production 17; all hashes are known checked-in migration hashes. |
| Missing local migration | `drizzle/0018_whatsapp_delivery_journal.sql`, SHA256 `faee54818c8ef4008d5e9f004c0a10b567c78e12bc9d2ada32284806d7d12cbc`. |
| Missing schema | `whatsapp_delivery_actions`: eight columns, six constraints, two indexes. |
| Table RLS flags | Production enables RLS on 24 additional existing public tables. Campaign policies already match. |
| Campaign roles/grants | Match. |
| Other columns/constraints/indexes/policies/triggers/views | Match apart from missing delivery journal. |
| Supabase provisioning helper | Production alone has `public.rls_auto_enable()` event-trigger function. This is a platform-specific difference; it is not copied into OrbStack. |

Prepared, **not applied**, [ops/local-db-rls-parity.sql](../../ops/local-db-rls-parity.sql), SHA256 `2f18f0c5f57e0d0ae8c2c43e32f59d4504ff04ba27df6aa6412aa74c0721eb8f`.

It targets only `127.0.0.1:5434/project_acquire`, checks the database name, and transactionally enables the 24 observed RLS flags. It changes no rows, policies, grants, credentials or provisioning functions. Table owners remain exempt because FORCE RLS is not added. Review the exact table list in the artifact and inspect which local connections use owner versus restricted roles before approval. Explicit approval is required separately for this artifact and migration 0018 on this exact target. No blanket migrator should be run.

After any approved application, repeat the catalog comparison; the documented Supabase helper and PostgreSQL patch-level difference remain. Do not call a comparison failure a pass merely because its remaining difference is expected.

## Isolated fixture stack

`ops/channel-services.compose.yml` uses a separate database at `127.0.0.1:5445/acquire_channels`, n8n at 5685, sink at 18124, WhatsApp fixture at 18125, and LinkedIn fixture at 18126. Existing stopped containers and named volumes remained from the approved 10 October run documented in [channel-service-reliability.md](../channel-service-reliability.md). Parent started only its existing PostgreSQL container for this inspection.

A private copy of the reviewed parity script inspected the isolated database with the same read-only catalog queries. It deliberately omitted ledger queries after establishing that `drizzle.__drizzle_migrations` does not exist there. This is not evidence of ledger parity.

- All application columns, constraints, indexes, policies, triggers and views match production, including `whatsapp_delivery_actions`.
- The 24 noncampaign RLS flag differences and Supabase helper difference remain.
- Campaign roles and grants match. The additional local `acquire_channels` login/table owner and its 336 own table grants are expected isolation-specific differences.
- No migration ledger exists: the previously approved bootstrap applied SQL directly. Existing schema correspondence is verified through catalogs rather than fabricated ledger rows.
- Active/paused/needs-review campaign enrolment count was zero. No personal rows were retrieved.

Private evidence: `.local-data/communications/isolated-parity-20261012.json`. It returns nonzero because the differences above remain; the report's empty ledger arrays are omitted-query placeholders, **not** a valid ledger inspection.

The isolated n8n volume was inspected using a temporary container with a read-only volume mount, `--read-only`, `--network none`, and a Node entrypoint that opens SQLite with `{readOnly:true}`. The stored 125 migration names exactly match all 125 names in the pinned n8n 2.1.5 image's SQLite migration registry: zero pending and zero unknown. Its last migration is `AddAgentIdForeignKeys1765886667897`. The stopped container and current image tag share image digest `sha256:45cfd148df28e0b4d87a8e53a567204816029efa9736b1b5e35344783b8d1d3d`. No n8n process or migration was invoked by the inspection.

An existing private n8n key and bootstrap evidence are in the sibling worktree `../project-acquire-channel-services/.local-data/channel-services/`. This checkout initially had no private key directory. Keep the key restricted and ignored if it is reused for the same isolated volume; do not substitute the shared n8n key.

## Startup and verification prerequisites

1. Keep Docker context `orbstack`; do not reset volumes. Existing PostgreSQL startup does not apply app migrations. Do not initialize a replacement database implicitly.
2. Review explicit approval before applying shared-local migration 0018 or the RLS parity artifact. The isolated RLS artifact is [ops/channel-db-rls-parity.sql](../../ops/channel-db-rls-parity.sql), SHA256 `1fa73750dc46e0d586621b697d978466fb29d7693103d9c0c306d2993a10bbfb`; it targets only `127.0.0.1:5445/acquire_channels`, checks that database name, and enables the same 24 flags without changing its absent ledger. It has not been applied and requires its own target-specific approval. The existing isolated schema does not need a new bootstrap.
3. Build WhatsApp fixture from current source. LinkedIn fixtures mount current source read-only; the base image must retain the matching dependencies and Chromium. Verify fixture source before tests. Rebuild images independently of shared-service restarts.
4. Restart the existing isolated n8n container only using the audited same image/volume: no pending migrations were found. Never upgrade its image or initialize a fresh volume under this finding.
5. Use the isolated n8n API key, confirmed idle database, owned app at port 3025, synthetic sink and provider fixtures. Do not invoke the shared global campaign tick.
6. Explicitly blank Unipile and live provider credentials in every fixture environment. The existing integration launcher reads root `.env.local` and does not blank `UNIPILE_API_KEY`, so credential isolation must be repaired before the new adapter/fixtures can safely use it.
7. Run the reviewed `pnpm test:channels:local` and affected unit/service suites. Record this checkout's test results rather than relying on the prior sibling-worktree run.

Audited `scripts/dev.mjs`, `scripts/whatsapp-local.mjs`, `scripts/linkedin-local.mjs`, `scripts/test-channel-stack-local.mjs`, `scripts/test-campaign-integration-local.mjs`, `scripts/campaign-integration-support.mjs`, Compose files, service entrypoints and app runtime. None applies application migrations. `pnpm dev` rebuilds shared infrastructure and attaches local services; it is not the isolated fixture entrypoint. WhatsApp startup reconciles saved accounts. n8n normally migrates on startup, which is why its exact existing volume/image was checked first.

This baseline establishes code/deployment consistency and specific database/runtime drift. It does not verify Unipile, new contracts, provider sends, extraction, rollout, or exact parity of every production platform object.

## Approved alignment follow-up — 12 October 2026

The user explicitly approved **all three specified local parity changes** in the async question reply. Parent rechecked their exact hashes, OrbStack container/loopback port bindings, database names and PostgreSQL system identifiers before execution. Private mode-0600 custom-format `pg_dump` backups were taken for both local databases. Backup/preflight evidence is in `.local-data/communications/verification/parity-approval-preflight.json`; actual execution is in `parity-approved-execution.json`.

Applied sequentially, only to the previously specified targets:

1. Shared `127.0.0.1:5434/project_acquire`: approved `drizzle/0018_whatsapp_delivery_journal.sql` with its exact SHA256 above, plus its ordinary migration-ledger hash/timestamp recorded atomically. No other migrator or missing ledger entry was run or fabricated.
2. Shared database: approved `ops/local-db-rls-parity.sql`, exact SHA256 above.
3. Isolated `127.0.0.1:5445/acquire_channels`: approved `ops/channel-db-rls-parity.sql`, exact SHA256 above.

Post-execution read-only comparisons show shared application columns, constraints, indexes, table/RLS flags, policies, triggers, views, campaign roles/grants and the **17-entry migration ledger match production**. Isolated application catalogs and campaign privileges also match. Explicit remaining differences: PostgreSQL 17.10 versus 17.6; remote-only Supabase `rls_auto_enable`; isolated `acquire_channels` login/owner grants; no historical isolated migration ledger (not fabricated). Both generic comparison commands still return 1 for those platform differences; that is not converted into a blanket parity pass. Parent asserted no additional catalog differences in `parity-approved-summary.json`.

Post-alignment checks passed 43 shared-database regressions and the full isolated channel workflow harness, including its 96 app/database checks, native WhatsApp journal/event tests, n8n workflows/waits/restarts and Chromium LinkedIn fixture. No new communications schema, production database, real credential backfill, provider send or production deployment was involved.

`HEAD` still matches fetched `origin/main` at `fa544da`. Current isolated service fixtures remain the test baseline; shared real-session channel containers were not restarted. The approved SQL bytes remain unchanged for auditability, so their original preparation comments are historical rather than the execution ledger.
