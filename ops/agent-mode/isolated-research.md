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
docker compose -f "$ISOLATED_COMPOSE_FILE" -f "$ACQUIRE_SOURCE_ROOT/ops/agent-mode/compose.isolated-research.yml" up -d --no-deps research reader search
```

Use the same Compose project name as the isolated lane. This starts only these sidecars; never recreate its network namespace while the app/simulator are active. It preserves persistent worker state. Cancel any active research through the normal application route before a disruptive worker change.

Check reader `/health` on 18084 and OpenSERP `/health` on 7000 from inside the namespace. Worker `/firmable/validate` requires the matching service credential; don't print it. Then use normal authenticated Find companies or a `live-research-test` workflow on the isolated app. The latter disables outreach. Bound the company target and restore saved settings afterward; candidate exploration can exceed the target count. Retain normal job/callback evidence and use normal cancellation to stop a failed run.

## Verification limits (24 October 2026)

Local worker authentication, reader/search health, one research model request, Firmable validation and live Firmable company/people callbacks passed. A normal research-only workflow persisted data locally, but its web discovery failed: DDG timed out and Google could not find its expected page element. The same pinned OpenSERP image returned two results through its documented Bing endpoint. The explicit Bing configuration is local-only and has no opaque engine fallback. Native searches still require per-request budget admission and retain labeled engine provenance. A subsequent normal authenticated live-research-test workflow verified Bing search, Firmable enrichment and local callback persistence: 19 company memberships, 17 linked people and 14 research findings. At the final check, 20 child/root jobs were complete, two partial and 18 cancelled. The run was deliberately cancelled through the normal application control after sufficient bounded evidence; it did not finish the entire workflow naturally. The target of one business is not a hard candidate/request cap. Original settings were restored and no outreach occurred.
