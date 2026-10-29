# Agent mode on OrbStack

For connecting **http://acquire-agent.orb.local/** to the local testing service, read [Testing service integration](testing-service.md). Acquire uses the existing communications HTTPS API on5991; the CLI is for operating the simulator. That guide records the request/reply flow, saved-lead lookup, current integration status and clock requirements.

## Background polling and reminders

Normal native polling backs off after empty checks:30seconds, then60seconds until work is found. It drains ready work in sequential bursts of at most5 ordinary authenticated ticks, stopping new requests after a10second start budget. Each in-flight tick keeps its existing timeout and event/dispatch fences. After productive work, the next burst is checked after1second; deferred/review/lost results end the burst. Repeated request failures back off to60seconds. Research maintenance remains a separate non-overlapping once-minute lane.

Accelerated local testing retains1second idle polling only when all three existing operator-owned flags match: `NODE_ENV=development`, `AGENT_MODE_COMMUNICATIONS_MODE=simulator`, and `AGENT_MODE_SIMULATOR_TEST_POLICY=true`. These flags do not grant approval or expand execution scope. The current registered testing stack intentionally uses this fast mode. Logs emit `stage=native.polling` with mode/delay only when the cadence changes, rather than for every empty check.

Reminders stay in the database; no long-lived timer or per-lead cron job is introduced. The worker checks overdue work after a restart, while changed/cancelled reminders remain subject to their original generation and ownership checks. In normal mode, newly queued work can wait up to60seconds for discovery. This implementation does not add push notifications or alter due times, approvals, sending limits or provider routing. No migration is required.

Historical five-contact verification used the saved `simulator` communications profile; current restarts preserve the separately saved profile, including later multichannel pilots. Email, WhatsApp and LinkedIn are local mock connections; the original connection-only Gmail profile remains saved separately. The test mandate is **Simulator — OrbStack local test** (`f2bcb50f-f759-44da-bdb7-e18db530c32d`), with five fictional contacts. Run `pnpm build:communications:service`, then `docker exec project-acquire-agent-mode node /workspace/.local-data/agent-mode-orbstack/simulator-probe.cjs sync` before a test to refresh all channel histories. Use the same probe's `state` action to inspect readiness. Normal launcher restarts preserve the selected profile; `AGENT_MODE_COMMUNICATIONS_PROFILE=mailbox` explicitly restores the saved zero-send Gmail setup. That original verification kept native execution disabled because nine older ready responsibilities also existed; current registered-runtime controls must exclude unregistered responsibilities. Full bridge/proof/clock limits: `../project-acquire-agent-testing/ops/agent-testing/cross-stack.md` from the development directory.

Run from the `project-acquire-agent-mode` worktree. Initial database preparation is explicit, local-only, and refuses to overwrite populated tables. The user authorised discretionary migrations in this isolated worktree OrbStack environment on 17 October 2026:

```sh
node scripts/prepare-agent-mode-database.mjs --initialise-isolated-local
node scripts/migrate-agent-mode-local.mjs --apply-isolated-local
```

Preparation reads the sibling local database in a read-only repeatable-read transaction. It restores the existing schema into a dedicated container/database, then copies allowlisted business records with IDs/provenance intact. Local credential-password accounts are retained for sign-in; OAuth tokens, sessions, mailbox/provider connections, sends and executable enrolments are excluded. Active research copies are cancelled and automatic continuation deadlines disabled. It validates foreign keys before committing. If a failed first import left an **empty**, correctly marked schema, `--seed-existing-empty` permits an explicit retry; it never overwrites populated records.

Start/restart the app after preparation (startup does not seed or migrate):

```sh
node scripts/start-agent-mode-orbstack.mjs
```

Open **http://acquire-agent.orb.local**. Sign in with an existing local email/password account. Google OAuth is deliberately not configured for this additional local origin.

## Additive demo communications runtime

The dedicated real-research demo lane coexists with the saved primary communications profile. It is not another value for `AGENT_MODE_COMMUNICATIONS_PROFILE`. Prepare its ignored settings and zero-participant run with `agent-mode-bridge.mjs prepare --profile demos` in the testing worktree, then run that bridge's `serve --profile demos` command in an owned terminal. This creates no prospects, replies or sends. Prospect inference requires its separate explicitly configured worker.

After reviewing the local topology, explicitly activate only the additive services:

```sh
node scripts/start-agent-mode-orbstack.mjs --activate-demos
```

This path uses the saved runtime and primary profile. It stops the native worker, checks exact container ownership plus local native/physical-journal idleness, and writes only the application and dedicated demo-service environment files. It never rewrites research Worker configuration, restarts the research Worker or replaces the primary service/namespace. Failure leaves the native worker stopped. An ordinary restart retains the exact activated demo service and rejects missing or silently changed settings/keyrings. Account registration is independent of default selection; demo setup must not replace normal GUI defaults.

The dedicated topology is TLS5890 for the CLI provider, TLS5891 for callbacks, host relay5892 and communications service5463. The new namespace owns its own published relay; a fixed byte relay joins the existing app namespace. See [runtime verification](../../docs/60-binding-resolved-communications-runtime.md). Activation and account verification alone do not enable demo delivery or establish end-to-end GUI readiness; current mode, mapping, review and original-intent checks remain required.

The start script creates ignored, mode-0600 environment files under `.local-data/agent-mode-orbstack/`. It reuses only research/model credentials from the sibling main checkout's `.env.local`; messaging, production database, infrastructure and browser-session credentials are excluded. `AGENT_MODE_LOCAL_ENV` can select another local configuration file. If the OrbStack hostname is unavailable, start with `AGENT_MODE_ORIGIN=http://localhost:3026` and use that origin consistently; changing the origin requires restarting the stack with the script.

## Real research and enrichment for Run demo

Fresh standard AU20 hybrid runs now use V5: enrich every distinct discovered company within the saved discovery bounds, then automatically retrieve basic People for each accepted exact Firmable company. One search page (up to50rows) selects up to3decision-makers, saving names, roles and available email/LinkedIn details through the shared People executor. Phone reveal remains a separate manual action. Ambiguous identities and explicit manual exclusions/ownership holds require review. Acquisition-fit uncertainty alone does not block basic People retrieval. Existing roots retain their original policy.

Normal GUI launches the existing durable People workflow after company persistence; native agent plans disclose the combined scope for human approval and use the same executor with their current authority and per-request budgets. Companies and People appear in the normal mandate pages. For an agent demo, real researched source data is retained separately from fictional communications destinations. The existing Contacts panel polls saved progress; viewing it does not start research.

### Replace local Firmable credentials

Use the existing service's authenticated reconnect action instead of rewriting
environment files or deleting its persisted account state. From this worktree:

```sh
pnpm firmable:reconnect:local --credentials .local-data/firmable-cookies.json --apply
```

Save the new Cookie export in that ignored JSON file first. It must include
`__client` from `clerk.firmable.com` and `clerk_active_context` from
`app.firmable.com`; app-only exports omit the required Clerk credential. The
existing private `FIRMABLE_CLIENT_COOKIE`, `FIRMABLE_SESSION_ID`,
`FIRMABLE_ORGANIZATION_ID` JSON format also works. The optional session token is
only a renewal hint. Never paste credentials into command arguments.

Without `--apply`, the command performs only local input/ownership/database
checks. With `--apply`, it makes one authentication renewal through the existing
Firmable account service, then reads local connection status. It does not run
searches, enrichment, People/phone lookups or restart jobs/containers. Failed
renewal retains the original connection and does not replace the bootstrap file;
uncertain outcomes are reported without automatic retry. The service retains
its pacing/cooldown and clears its reconnect flag only after successful renewal.
Existing encryption/service keys and the configured organization stay fixed.

After successful reconnect the command atomically updates the ignored mode0600
`.local-data/firmable-D-credentials.json` bootstrap file. Launcher precedence is
explicit override, then this worktree's own file, then the existing main local
fallback. Active encrypted credentials remain managed by the shared account
service. Raw credentials travel over process stdin and the private authenticated
loopback endpoint, not logs or process arguments. The command is fixed to the
marked local agent stack and cannot target production.

Normal GUI **Run demo / Find companies** uses the configured research pipeline and may incur real research, enrichment and model charges. The isolated launcher now supports the same metered Firmable session-worker path as main local development. Source/default tests are verified; a successful launcher/configuration change alone is not evidence that a particular demo finished discovery or enrichment. Check its saved jobs and normal GUI progress.

The launcher first uses this worktree's own ignored `.local-data/firmable-D-credentials.json` when present; otherwise it falls back to the sibling main checkout's file, resolved relative to the selected main local `.env.local` (`AGENT_MODE_LOCAL_ENV`). An explicit override takes precedence and must also be an ignored local JSON path:

```sh
AGENT_MODE_FIRMABLE_CREDENTIALS=/absolute/path/.local-data/firmable-D-credentials.json \
AGENT_MODE_RESEARCH_DESIGN=F \
node scripts/start-agent-mode-orbstack.mjs --restart-app
```

Run this only after the controlled restart checks below. Do not paste credentials into the command. Renew browser credentials from Chrome **Cookies**, as described in `AGENTS.md`, and validate them through the existing Firmable validation flow before replacing the private file. The allow-listed client/session/organization/encryption credentials are mounted only into the research Worker. Next receives the loopback Firmable service URL and service secret, not the raw browser session. The credential file cannot import database, auth or messaging settings. Missing credentials disable research explicitly; fixture enrichment is not used as a fallback.

`AGENT_MODE_RESEARCH_DESIGN=F` selects hybrid discovery plus Firmable enrichment (`hybrid-firmable-v1`). D (`firmable-v1`) and E (`web-firmable-v1`) are also supported explicitly, including their canonical names. Without an override the launcher preserves an explicitly selected main/saved design, otherwise defaults to F. The reviewed local parity flags are `ALLOW_REAL_PERSONAL_DATA=true`, `TARGET_DATA_PROVIDER=live` and `OUTREACH_DRAFTING_PROVIDER=ai`. This does **not** enable live communications: the independently saved communications profile remains selected, including its simulated accounts, sending limits and native execution controls. Do not switch that profile to obtain research access.

Pipeline choice is saved when a new ordinary research root is created. Existing jobs retain their saved pipeline (including older legacy web jobs); activation does not reset, cancel or relabel them. Existing native agent research plans keep their separately saved company-only/HIL policy.

For a controlled app/namespace update, use `--restart-app`. The launcher verifies exact worktree ownership, stops the native worker and checks the marked local database for live native runs/effects. When transitioning from the older app-owned namespace it releases only the verified old app's host ports before creating the independent network owner, then recreates/rebinds the app sidecars and checks health before restarting the worker. A refused ordinary startup does not write the mounted runtime/Worker configuration or saved profile first. This guard does **not** establish that ordinary research or Firmable workflows are idle: inspect their saved job/workflow activity separately and record any deliberately preserved in-flight work before restart.

Keep the existing database and research-state named volumes. Wrangler continues using `/state`; existing workflow/coordinator bindings and persisted Firmable state are reused. Never delete volumes, restore a snapshot, reset jobs or run schema commands as part of configuration activation. `--leave-worker-stopped` is a separate setup path requiring native execution disabled and a verified stopped worker; it is not a way around ownership/idleness checks.

This is a separate Compose project (`acquire-agent-mode`). It has its own app container, Linux dependencies, Next cache and local research-worker state. The app binds port 3026 to loopback. The app and research worker share the independent local network owner namespace; the Worker is reachable only on loopback8787, with no published worker port. The dedicated `project-acquire-agent-reader` sidecar shares that namespace on loopback18084 (`LOCAL_CRAWL4AI_URL=http://127.0.0.1:18084`). It builds the same existing `cloudflare/crawl4ai/Dockerfile` and mounts that implementation’s `server.py` read-only at `/app/server.py`; it is not a separate extraction implementation. The main worktree’s reader on18083 remains untouched. Source is mounted read-only. First startup downloads Linux dependencies; subsequent starts reuse them.

The app now uses **its own** `project-acquire-agent-postgres` container, `acquire_agent_mode` database and `agent-postgres` volume. Host access is loopback5437; app access is `postgres:5432`. The original `project-acquire-postgres` / port5434 is read only during explicit initial preparation and is not used by the preview app or migrated. The target must have the `acquire-agent-mode-local-only` database marker before local migrations can run. SQL files and SHA-256 values are recorded in `agent_local_migrations`; changed applied files are refused. No schema commands, seed, restore or migration run at app startup.

In home/new mandate, the normal research path saves the brief and starts the configured research pipeline; Agent mode additionally exposes reviewed native tools in the agent workspace. Confirm the saved criteria explicitly before new research. Manual contacts can be reused without representing their qualification as researched. Existing mandates have an Open agent workspace link. Real research/model charges and communications execution have separate controls; a simulated communications profile does not make research fictional or free.

Inspect or stop only this project:

```sh
docker --context orbstack compose -f ops/agent-mode/compose.local.yml ps -a
docker --context orbstack compose -f ops/agent-mode/compose.local.yml logs --tail 50 app research
docker --context orbstack compose -f ops/agent-mode/compose.local.yml stop
```

Do not use volume deletion or database schema commands as a troubleshooting shortcut. The current discretionary migration permission covers only this isolated local target. Main/shared/other-worktree/UAT/production changes remain outside that permission. Do not edit already-applied migration artifacts; add forward migrations.

The controlled launcher includes the dedicated reader in startup and sidecar namespace rebinding; Compose defines its `/health` check on18084. Use the existing `--restart-app` ownership/idleness procedure for topology updates; do not manually move it into another app’s network namespace. The source bind makes reader diagnostics available without introducing another provider path. Reader logs use `research-reader` with `request_started`, `url_validation_completed` and `response` events, request IDs, safe status/categories and timing metadata; URLs, bodies and credentials are excluded.

Current tracing can be inspected without initiating research:

For one mandate across the owned app, research Worker and native worker:

```sh
pnpm agent:logs --mandate <mandate-uuid> --since 15m
pnpm agent:logs --mandate <mandate-uuid> --since 15m --follow
```

This read-only command verifies the isolated namespace and marked local database,
then joins the mandate's saved job/operation IDs with structured container logs.
It projects diagnostic fields only; message bodies, headers and credentials are
excluded. Each container has its own timestamped stream, with at most 3,000
historical lines per container. Legacy records without a mandate ID can only be
matched to jobs known when the command starts; rerun it to include later legacy
jobs. No provider calls, job retries or service restarts are performed. A stale
active database status alone does not prove that a workflow is currently running.

```sh
docker --context orbstack compose -f ops/agent-mode/compose.local.yml logs --tail 200 app research reader | rg 'research-request|research-db|firmable-client|firmable-account|research-reader'
```

The existing request/database observer logs entry, completion and safe failures. Firmable client/account records include optional `jobId`, `requestId` and `logicalCallId`, queue/pacing/renewal/cooldown/upstream metadata; these diagnostic IDs never grant native budget or delivery authority. Only known upstream429 responses increase persisted account spacing (1s, doubling up to30s), respecting cooldown before subsequent spaced calls. Local queue saturation does not increase spacing. A provider-free `/firmable/status` read can verify loaded tracing, but currently does not expose the stored spacing value. Compiled-source markers and status logs do not establish live429 recovery or successful research completion.

Worker secrets are mounted as `/config/.dev.vars`, beside the generated Wrangler configuration. Docker process environment alone does not supply Worker bindings while `CLOUDFLARE_INCLUDE_PROCESS_ENV=false`. Keep this explicit allowlist mount: do not enable general process-environment inference to fix authentication.

Startup now checks authenticated worker access and anonymous refusal before printing the ready URL. Existing records can outlive failed dispatch: a saved/queued job is not evidence that a worker accepted it. The agent snapshot separates queued jobs from executing jobs and includes recent saved progress messages and timestamps.

The preview currently leaves `LOCAL_SEARCH_URL` unset and uses the existing reader-based DuckDuckGo search path. The shared OpenSERP service returned DuckDuckGo503 proxy_timeout and Google504 search_timeout during verification; no shared service configuration was changed. A live reader-based search returned200 with search-result content and no detected challenge.

Historical initial model-policy verification (not the launcher's current native-model configuration): OpenRouter requests send `data_collection: "allow"`. The ordered free pool is Dots3 Note Preview → Nemotron3.5 Super VL → Nemotron3 Super120B. OpenRouter routes through that free list with a zero-price cap. On eligible free-route failure, the application tries Mercury2.5 then Mistral NeMo under the shared45-second deadline and the existing$0.04/M input,$0.15/M output ceiling. NeMo omits reasoning controls; all responses must still match the supplied schema. Authentication/payment/request errors stop fallback. Chat, research, scope generation and mandate generation use this free-first policy; brief generation retains its existing final OpenAI fallback when configured. No account-wide privacy setting is changed.


## Foundation verification (17 October 2026)

Shared `mandate.read` and `research.status` commands are used by the current mandate read route and agent snapshot. They validate server-derived scope, current membership, typed input/output and matching mandate identity. They do not launch work. Agent storage supports owner-scoped threads, append-only ordered messages, idempotent proposals/outbox and leased event claims with fencing. It is a persistence foundation, not a connected autonomous runner or persisted chat UI yet.

```sh
node --test scripts/agent-mode-local-database.test.mjs
RUN_AGENT_LOCAL_INTEGRATION=true pnpm exec vitest run src/db/agent-state-local.integration.test.ts src/db/agent-store-local.integration.test.ts
```

Integration tests use only the fixed, marked port5437 database and clean up synthetic fixtures. No provider calls are required. Native goal-driven decision proposals validate history/owner revisions, evidence references, future reassessment and mandatory human booking handoff; approval/admission and ownership-driver wiring remain separate work items. n8n integration/source for the original UI is retained. See `docs/41-goal-driven-agent-execution.md`.

## New demo testing target (20 October 2026)

New Run demo instances now select the external HTTPS communications API on5991; its provider is5990. Selection is explicit (`AGENT_DEMO_TARGET=testing`) and server-only; historical5891/primary bindings stay pinned. `compose.testing.yml` adds only `app-testing-relay`, which forwards fixed loopback5990/5991 unchanged to the host. The ordinary launcher retains the reviewed private settings and overlay. Existing service processes are not repurposed.

Current GUI source data is ready, but outreach waits: the host currently runs its original eight-person profile with another actor, so recipient lookup/account readiness is not certified. Private descriptor capabilities remain false. The GUI says “Waiting for the testing service”; it does not fall back to the historical demo. See docs61's 20October checkpoint for the strict-TLS/app-selection proof and remaining actual submission/reply acceptance.

Private additions live in ignored runtime.env; the current Next development process received the same five new fields via ignored `.env.development.local` using supported env reload, without app recreation. Future CLI profile/configuration transitions must keep those private fields consistent, validate actor/run/account identity and preserve original bindings; do not edit captured CLI processes or flip capability flags based on health alone. The old queued73ed22b8 research operation remains intact and still prevents guarded app recreation until normally reconciled. No migration is authorized by this configuration change.


### Saved demo auto-approval preferences (2026-10-21)

The agent header uses **Auto-approve · Off / Custom / All**. Choices are stored in this browser’s local storage, scoped to the supervision owner and mandate; they survive refreshes and reopening the same demo. Each new demo defaults Off. Preferences are hydrated after mount with strict version/boolean validation and never make real mandates eligible for demo approvals. Loss of verified readiness or an automatic approval failure disarms and saves Off, preserving the existing eligibility and server review checks. If browser storage is blocked, the menu says that the choice applies to this page only.

Automatic approval processing still requires the page to remain open. These preferences do not create server authority or a background approval job. “Booking-link drafts” refers to reviewing drafts; sending booking links and recording meetings remain manual. No migration is needed for browser preferences. Log-tail terminal sessions are observers and may be stopped without stopping the app, worker, database or testing services.


### Lead-centred conversation activity (2026-10-21)

Chat groups only controlled saved status records; typed questions and model answers retain their conversational boundaries. Each lead’s newest update shows their name/company, available reply preview and next action. Earlier updates, setup/approval records and channel diagnostics are expandable. View conversation reads the saved thread inline; Review draft and Review conversation target the exact lead. Automatic demo approvals are labelled separately from human decisions for new records; old attribution is not inferred. Unknown sends and review holds remain in place.

Partial channel-history ingestion can invalidate the original retry generation. Semantic coverage transitions now emit a replacement current-generation reassessment even when message bodies are unchanged. Pure observation refreshes do not emit work, and this does not wake held or human-owned conversations. Do not revive stale reminders or blindly retry a send to repair missing history. The two identified historical stranded checks in mandate2722863b were recovered via normal application events with identity verification, without bypassing approval or clearing holds.

### 21 October 2026 — simplified Start and settings

Saved-data agent demos now open with a welcome and, after3seconds, their mandate summary and Start. Start uses the existing authenticated demo endpoint to prepare recipients, choose the exact saved simulator-run accounts and propose contact review. It does not approve contacts/messages; existing Auto-approve choices apply separately. New live agent mandates wait for Start before ordinary company research begins. Agent mode remains available in both the create page and its loading form. Cached demo settings show only a concise account/timing summary and a link to global Settings; Context shows the brief/useful guidance. No migration or restart was needed. Detailed evidence/limits: latest P4.4/P5 progress entry in `docs/communications/progress.md`.

## Existing app5437 source alignment (24 October 2026)

Append `compose.aligned.yml` **last**, after the existing local, multichannel,
demos and testing overlays. It changes only dependency/cache mount sources for
`dependencies`, `app` and `agent`. Compose merges mounts by container target:
`/install/node_modules` and `/workspace/node_modules` use the new
`agent-aligned-node-modules` volume; app/agent `.next` uses `agent-aligned-next`.
The old communications/research dependency volume, database volume, namespace
owner, transport bridges, environment, CA mounts and source mounts are preserved.
Do not rebuild/retag the shared development image, delete volumes, or recreate
namespace owners/communications services as part of this alignment.

The existing `acquire-agent-mode:dev` image was inspected: its build history
installs `pnpm@11.8.0`, matching both the Dockerfile and current package-manager
pin. The normal installer uses the latest source's frozen lockfile. Installation
must target the new dependency volume before restarting app/agent; retain the
original volume for still-running services and rollback.

Controlled cutover: stop only app/agent, preserve the dirty source snapshot and
local configuration, update source to reviewed main, install `dependencies`
with all five overlays and `--no-build --no-deps`, then recreate only app/agent
with the same overlays and `--no-build --no-deps`. Never run a broad `down`,
`up --build`, volume prune, or migration replay. Existing immutable app5437
bindings, recipient mappings and saved operations are reused.

Static validation (no containers started, no environment-file values printed):

```sh
node --test ops/agent-mode/compose-aligned.test.mjs
```

The test runs `docker compose config --no-env-resolution` for both compositions
and proves every unchanged service remains identical, all other mounts remain
identical, and the PostgreSQL volume is unchanged. Red: missing overlay failed;
green: this structural test passed. Runtime installation, namespace reachability
and normal send/reply acceptance are separate cutover checks.
