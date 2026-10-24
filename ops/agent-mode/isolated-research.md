# Isolated local research worker

This overlay runs Wrangler Workflows, the reader and OpenSERP inside the existing isolated app network namespace. It does not publish additional ports, provision a database, deploy Cloudflare resources, or alter the original app/simulator lane. Keep the existing base Compose file and private state directories.

## Configure

Set absolute `ACQUIRE_SOURCE_ROOT`, `ISOLATED_RESEARCH_DIRECTORY`, and `ACQUIRE_NODE_MODULES_VOLUME` (the existing aligned dependency volume). Build the reader using the existing agent-mode reader instructions if its image is missing. OpenSERP is pinned to the locally verified 0.8.12 image digest; do not substitute an unreviewed image.

Generate private `wrangler.json` with `localWorkerConfig` from `scripts/dev-config.mjs`: use a unique worker/workflow name, `/workspace/cloudflare/research/index.ts`, `APP_ORIGIN=http://127.0.0.1:3000`, local Workflows and ProviderCoordinator bindings. Use a fresh persistent state volume; omit Cloudflare account credentials and production bindings.

Store `worker.env` privately (0600, ignored). Copy only the existing approved research/Firmable credentials. Match `SERVICE_SECRET` to the isolated app's `RESEARCH_SERVICE_SECRET` and `FIRMABLE_SERVICE_SECRET` to its matching value. Set:

```dotenv
LOCAL_DEVELOPMENT=true
LOCAL_RESEARCH_POLICY=development
LOCAL_CRAWL4AI_URL=http://127.0.0.1:18084
LOCAL_SEARCH_URL=http://127.0.0.1:7000
LOCAL_SEARCH_ENGINE=bing
```

Use the worker's supported research provider configuration (OpenAI or OpenRouter); the app's Anthropic configuration does not configure this worker. Verify credentials through the normal validation route before starting research. Keep Firmable cookies in ignored private configuration.

## Start or restore

With the existing private base Compose file as `ISOLATED_COMPOSE_FILE`:

```sh
docker compose -f "$ISOLATED_COMPOSE_FILE" -f "$ACQUIRE_SOURCE_ROOT/ops/agent-mode/compose.isolated-research.yml" up -d --no-deps research reader reader-alias search
```

Use the same Compose project name as the isolated lane. This starts only these sidecars; never recreate its network namespace while the app/simulator are active. It preserves persistent worker state. Cancel any active research through the normal application route before a disruptive worker change.

Check reader `/health` on 18084 and OpenSERP `/health` on 7000 from inside the namespace. Worker `/firmable/validate` requires the matching service credential; don't print it. Then use normal authenticated Find companies or a `live-research-test` workflow on the isolated app. The latter disables outreach. Bound the company target and restore saved settings afterward; candidate exploration can exceed the target count. Retain normal job/callback evidence and use normal cancellation to stop a failed run.

## Verification limits (24 October 2026)

Local worker authentication, reader/search health, one research model request, Firmable validation and live Firmable company/people callbacks passed. A normal research-only workflow persisted data locally, but its web discovery failed: DDG timed out and Google could not find its expected page element. The same pinned OpenSERP image returned two results through its documented Bing endpoint. The explicit Bing configuration is local-only and has no opaque engine fallback. Native searches still require per-request budget admission and retain labeled engine provenance. A subsequent normal authenticated live-research-test workflow verified Bing search, Firmable enrichment and local callback persistence: 19 company memberships, 17 linked people and 14 research findings. At the final check, 20 child/root jobs were complete, two partial and 18 cancelled. The run was deliberately cancelled through the normal application control after sufficient bounded evidence; it did not finish the entire workflow naturally. The target of one business is not a hard candidate/request cap. Original settings were restored and no outreach occurred.

## Scoped local maintenance

Wrangler local development does not deliver a production cron automatically. To persistently recover only this isolated workspace, build `node scripts/build-local-research-maintenance.mjs` in the mounted source checkout; its ignored `.local-data/isolated-research/maintenance.cjs` must remain under that checkout so dynamic dependencies resolve from its node_modules. Create private `maintenance.env` from the isolated app environment, adding `LOCAL_DEVELOPMENT=true`, `LOCAL_RESEARCH_MAINTENANCE_ENABLED=true`, `LOCAL_RESEARCH_ORGANIZATION_ID` and `LOCAL_RESEARCH_OWNER_USER_ID` for the isolated test actor. Preserve `NODE_ENV=development` and its loopback5437 database URL.

Append `compose.isolated-maintenance.yml` to the existing base and start only `research-maintenance` with `up -d --no-deps research-maintenance`. It rejects production mode, verifies the exact database marker and current membership every pass, selects at most two owned live/research-test workflow scopes, and reuses normal scoped recovery/projection. Completed workflows with unfinished optional work remain eligible; demos and cancelled workflows do not. The loop is sequential with30s between passes and the existing15s background database budget. No global scheduled dispatcher is invoked.

Discovery's root deadline is not a global optional-enrichment cutoff: saved companies can have separately bounded background field jobs. Report root completion, people settlement and optional field completion independently. Do not silently reinterpret a saved partial/unknown field as verified.

The fixed loopback reader alias18083→18084 supplies the existing app missing-field reader default without restarting the app or changing its active job configuration. It runs only inside the isolated network namespace and publishes no host port. Verify both loopback health endpoints from the isolated app. The alias preserves the reader response and does not manufacture page evidence.

## Natural completion acceptance (24 October 2026)

A second normal `live-research-test` execution (`1e3e9991-4931-44e0-a12d-d3e4d0f71665`) reached workflow `complete` through normal recovery, without cancellation or manual database changes. It retained100 companies,103 people and94 findings. All197 research jobs terminated:101 complete,85 partial,11 failed. Partial/failed optional public-field results remain visible; this does not certify every requested fact. Some failures predate the app reader alias fix. At least one subsequent normal queued job persisted a successful page attempt after the alias was installed.

The existing hybrid discovery goal of one did not cap candidate profiling at one; it explored up to its finite100-company limit. Original organisation settings were restored. No outreach was performed. Earlier deliberately cancelled tests now have correctly cancelled workflow projections after original terminal-run snapshot reconciliation.

Final local health checks: app200, reader default18083 and underlying18084 both200, search7000 health200. Maintenance is idle after terminal settlement and remains available for future owned live workflows. The original local lane and production configuration were not changed by these fixes.
