# Agent mode on OrbStack

The app currently uses the saved `simulator` communications profile. Email, WhatsApp and LinkedIn are local mock connections; the original connection-only Gmail profile remains saved separately. The test mandate is **Simulator — OrbStack local test** (`f2bcb50f-f759-44da-bdb7-e18db530c32d`), with five fictional contacts. Run `pnpm build:communications:service`, then `docker exec project-acquire-agent-mode node /workspace/.local-data/agent-mode-orbstack/simulator-probe.cjs sync` before a test to refresh all channel histories. Use the same probe's `state` action to inspect readiness. Normal launcher restarts preserve the selected profile; `AGENT_MODE_COMMUNICATIONS_PROFILE=mailbox` explicitly restores the saved zero-send Gmail setup. Native execution remains disabled because nine older ready responsibilities also exist. Full bridge/proof/clock limits: `../project-acquire-agent-testing/ops/agent-testing/cross-stack.md` from the development directory.

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

The start script creates ignored, mode-0600 environment files under `.local-data/agent-mode-orbstack/`. It reuses only research/model credentials from the sibling main checkout's `.env.local`; messaging, production database, infrastructure and browser-session credentials are excluded. `AGENT_MODE_LOCAL_ENV` can select another local configuration file. If the OrbStack hostname is unavailable, start with `AGENT_MODE_ORIGIN=http://localhost:3026` and use that origin consistently; changing the origin requires restarting the stack with the script.

This is a separate Compose project (`acquire-agent-mode`). It has its own app container, Linux dependencies, Next cache and local research-worker state. The app binds port 3026 to loopback. The research worker shares the app network namespace and is reachable only on loopback8787, with no published worker port. A fixed-destination relay exposes the existing host reader on loopback18083 inside that namespace, preserving the research allowlist. Source is mounted read-only. First startup downloads Linux dependencies; subsequent starts reuse them.

The app now uses **its own** `project-acquire-agent-postgres` container, `acquire_agent_mode` database and `agent-postgres` volume. Host access is loopback5437; app access is `postgres:5432`. The original `project-acquire-postgres` / port5434 is read only during explicit initial preparation and is not used by the preview app or migrated. The target must have the `acquire-agent-mode-local-only` database marker before local migrations can run. SQL files and SHA-256 values are recorded in `agent_local_migrations`; changed applied files are refused. No schema commands, seed, restore or migration run at app startup. The existing reader (:18083) is still reused.

In home/new mandate, enable Agent mode, then use Run demo to inspect a fictional plan without saving. Saving and starting research uses the normal local database/research pipeline and configured model/web services, which may incur provider charges. The agent conversation uses free-first model routing with bounded paid fallbacks and reads saved state; it has no execution tools. Existing mandates have an Open agent workspace link. Live communications and campaign execution remain unconfigured/disabled.

Inspect or stop only this project:

```sh
docker --context orbstack compose -f ops/agent-mode/compose.local.yml ps -a
docker --context orbstack compose -f ops/agent-mode/compose.local.yml logs --tail 50 app research
docker --context orbstack compose -f ops/agent-mode/compose.local.yml stop
```

Do not use volume deletion or database schema commands as a troubleshooting shortcut. The current discretionary migration permission covers only this isolated local target. Main/shared/other-worktree/UAT/production changes remain outside that permission. Do not edit already-applied migration artifacts; add forward migrations.

Worker secrets are mounted as `/config/.dev.vars`, beside the generated Wrangler configuration. Docker process environment alone does not supply Worker bindings while `CLOUDFLARE_INCLUDE_PROCESS_ENV=false`. Keep this explicit allowlist mount: do not enable general process-environment inference to fix authentication.

Startup now checks authenticated worker access and anonymous refusal before printing the ready URL. Existing records can outlive failed dispatch: a saved/queued job is not evidence that a worker accepted it. The agent snapshot separates queued jobs from executing jobs and includes recent saved progress messages and timestamps.

The preview currently leaves `LOCAL_SEARCH_URL` unset and uses the existing reader-based DuckDuckGo search path. The shared OpenSERP service returned DuckDuckGo503 proxy_timeout and Google504 search_timeout during verification; no shared service configuration was changed. A live reader-based search returned200 with search-result content and no detected challenge.

Current temporary model policy (user authorised): OpenRouter requests send `data_collection: "allow"`. The ordered free pool is Dots3 Note Preview → Nemotron3.5 Super VL → Nemotron3 Super120B. OpenRouter routes through that free list with a zero-price cap. On eligible free-route failure, the application tries Mercury2.5 then Mistral NeMo under the shared45-second deadline and the existing$0.04/M input,$0.15/M output ceiling. NeMo omits reasoning controls; all responses must still match the supplied schema. Authentication/payment/request errors stop fallback. Chat, research, scope generation and mandate generation use this free-first policy; brief generation retains its existing final OpenAI fallback when configured. No account-wide privacy setting is changed.


## Foundation verification (17 October 2026)

Shared `mandate.read` and `research.status` commands are used by the current mandate read route and agent snapshot. They validate server-derived scope, current membership, typed input/output and matching mandate identity. They do not launch work. Agent storage supports owner-scoped threads, append-only ordered messages, idempotent proposals/outbox and leased event claims with fencing. It is a persistence foundation, not a connected autonomous runner or persisted chat UI yet.

```sh
node --test scripts/agent-mode-local-database.test.mjs
RUN_AGENT_LOCAL_INTEGRATION=true pnpm exec vitest run src/db/agent-state-local.integration.test.ts src/db/agent-store-local.integration.test.ts
```

Integration tests use only the fixed, marked port5437 database and clean up synthetic fixtures. No provider calls are required. Native goal-driven decision proposals validate history/owner revisions, evidence references, future reassessment and mandatory human booking handoff; approval/admission and ownership-driver wiring remain separate work items. n8n integration/source for the original UI is retained. See `docs/41-goal-driven-agent-execution.md`.
