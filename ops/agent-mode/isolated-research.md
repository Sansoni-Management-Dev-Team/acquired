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

## Stable research releases for end-to-end testing

Do not use the editable source mount for long research tests. Wrangler watches
imported application files as well as worker files; a UI/domain edit can replace
the local worker and interrupt an in-flight request. A read-only node_modules
mount also prevents Miniflare's default `node_modules/.mf` cache from being
created. `--persist-to /state` preserves workflow storage but does not fix either
problem.

Stage a release explicitly. The command defaults to a read-only plan; append
`--stage` to copy allowlisted source and run Wrangler's normal bundler with
`deploy --dry-run` (no Cloudflare upload). It never starts or stops a service.
Use the current isolated worker's private config, keeping its workflow and
Durable Object identities. No credentials are copied into the source snapshot.

```sh
node scripts/isolated-research-runtime.mjs \
  --config "$ISOLATED_RESEARCH_DIRECTORY/wrangler.json" \
  --directory "$ACQUIRE_SOURCE_ROOT/.local-data/isolated-research/releases" \
  --modules-volume "$ACQUIRE_NODE_MODULES_VOLUME" --stage
```

Each private release contains the bundled worker, local config, a SHA-256
manifest and `compose.runtime.json`. The overlay replaces the live `/workspace`
source mount with that release, loads the bundle with `--no-bundle`, retains the
original `/state` volume, and supplies writable scratch storage at `/runtime`
with `MINIFLARE_CACHE_DIR=/runtime/miniflare`. The dependency volume remains
read-only and must stay aligned with the staged lockfile. Do not edit a staged
release: stage another version for an explicit update. The running container's
`au.mlai.acquire.research.release` label identifies its release. The existing
private `/config/.dev.vars` mount remains in place; coordinate credential/config
renewal because Wrangler may reload when those files change.

Before activation, inspect existing jobs and coordinate an interruption. Record
their IDs/status and preserve any stuck jobs for diagnosis. Do not replay them
automatically. Check the fully merged Compose configuration using `config`
(keep any rendered environment private), then start **only research** with the
same Compose project and files used by the current isolated stack, appending
the staged overlay last:

```sh
docker compose -p acquire-isolated -f "$ISOLATED_COMPOSE_FILE" \
  -f "$ISOLATED_RESEARCH_COMPOSE_FILE" -f "$RELEASE/compose.runtime.json" \
  up -d --no-deps research
```

This necessarily recreates/restarts the research worker. It does not restart
the app, network namespace, database, reader, search or simulator. Never use
`down`, `-v`, or recreate the network namespace. Keep the same workflow names and
state volume; changing those would isolate existing workflow history. Retain
the previous release/overlay for a controlled rollback. Existing jobs still
need normal application reconciliation/cancellation; no replay is implied by
restarting Wrangler.

Run the reusable offline runtime check with
`node scripts/test-isolated-research-runtime.mjs`. It builds the actual worker
and creates only a disposable `acquire-research-runtime-check-*` container with
Docker network `none`, no published ports, fixture-only reader/callback servers,
and fresh temporary volumes. It verifies a delayed `/company-page` request
survives a change to an unobserved editable UI tree, cache writability, and a
real completed Workflow surviving restart. It removes only its own container
and volumes. Logs/release hashes stay in ignored
`.local-data/isolated-research/runtime-checks`. Configuration tests run with
`node --test scripts/isolated-research-runtime.test.mjs`.

## Development source-watch start or restore

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

## Local workflow verification (26 October 2026)

The local UI now reserves the mandate/request UUID before brief generation and
shows `/mandates/<id>?tab=search+enrich` immediately. Classic research stays on
that progress screen until the user selects **View companies**. Companies use
`/mandates/<id>/companies`; old targets query links redirect. Research-only
runs preserve the selected agent presentation, opening `/agent` after admission,
while retaining `live-research-test` and its disabled outreach. Research-only
controls project their actual saved lifecycle before any chat thread exists.
The normal demo/live approval and sending authority is unchanged.

The displayed 50% scores on the inspected water-treatment run were provisional
half-credit for every assessed criterion, rather than comparative rankings.
The table now labels that state **Provisional match**, retains assessed coverage
and exclusions, and presents available company-specific scope facts. It does
not manufacture scores or upgrade estimated facts. The joined per-company
refresh queue paragraph is removed; polling and error handling continue.

Three local research defects were reproduced before repair:

- Full-page missing-field research dropped reader `Retry-After`, retried too
  soon, and consumed page allowance for requests the reader had not admitted.
  Only explicit reader-busy/domain-backoff responses now defer within the same
  original deadline. Actual started reads retain normal accounting.
- Source-watch Wrangler reloaded during long research runs, and the read-only
  dependency mount caused `node_modules/.mf` cache errors. Versioned bundles
  and writable isolated scratch storage are covered by the offline runtime
  check above. Activation is a separate explicit operational step.
- People counter refreshes updated the root execution time and concealed
  stopped company work. Counter maintenance no longer changes that timestamp;
  both maintenance and the worker use scoped root/company callback progress.
  Terminal severity, saved results, authority and recovery CAS remain intact.

Integrated verification: 7,238 Vitest tests passed (959 existing skips), 238
Node tests passed, and 48 real Miniflare Workflows tests passed with unmocked
outbound traffic blocked. TypeScript and scoped ESLint passed. The first broad
run exposed five obsolete route/loading-copy assertions, which were updated;
an independent 50ms wall-clock canary fixture timed out under concurrent load
and passed on the full Node recheck without a product change.

Browser routing checks exercised the real local Next UI with generation and
admission intercepted: the UUID appeared during delayed preparation; classic
research retained its URL after results/completion and refresh did not repeat
admission; agent-mode research-only testing opened `/agent`. These are navigation
proofs, not fresh live-provider or message/reply proofs. Evidence is under
`output/playwright/search-stage/` and ignored `.local-data/` directories for
reader cooldown, research liveness, fit projection and runtime checks.

Existing user runs were inspected read-only, not silently replayed. Optional
field failures, saved partial results and a Firmable country-interpretation
review stop remain distinct from routing/runtime fixes. No migrations or
production deployment were performed by this local change package.

### Stable runtime activated locally

At 02:38:43 UTC on 26 October, the isolated research worker switched to release
`c680d96d52c4-33390a0c03d7-1792982302916` from commit `20ba1a5`.
The original durable state volume and workflow names were retained. The app,
native worker and simulator container IDs/start times were unchanged. The scoped
maintenance bundle was rebuilt and its own service restarted gracefully.

The first activation exposed a packaging defect: the read-only release lacked
the nested `node_modules` mount point. No workflow storage was removed. The
reusable Docker test was corrected to mount the same read-only parent as the
active overlay; it reproduced the mount failure, then passed after release
staging created that empty directory before mounting. Fixture cleanup now also
removes its own container when Docker creates it but fails startup. The corrected
fixture again verified full-page reading, no source reload, writable cache and
persisted real Workflow state across its own restart.

Post-switch checks: app 200, reader and reader alias 200, search health 200;
worker root returned the expected authenticated 404 and unauthenticated 401.
Existing workflow instances were readable after restart. A real full-page read
of `https://example.com` through the worker returned 200 with HTML and
`only_main_content:false` in 2,894 ms. Startup logs contained zero cache errors
and zero unexpected reloads. The 238 Node tests passed again after packaging
changes.

The source-watch worker was replaced during bounded optional field work because
completion callbacks continually refilled its queue. In-flight reads may need
normal recovery; no original job was manually replayed, cancelled, deleted or
marked successful. This cutover and page-read check do not establish that every
older research run or every optional field succeeded. Production remains on its
previous release; this package was activated only in the isolated local lane.
