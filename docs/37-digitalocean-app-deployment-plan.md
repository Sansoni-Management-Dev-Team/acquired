# DigitalOcean app deployment plan, preserving Vercel

Prepared: 7 October 2026. Status: DigitalOcean app and research/n8n service cutover completed and verified at `https://acquire.mlai.au`. Ongoing observation, capacity and recovery checks remain listed below.

## Objective and boundaries

Deploy Acquired to a dedicated DigitalOcean Droplet in the existing `project_acquire` project, retaining the same application code, production Supabase database, Cloudflare research infrastructure, and hosted WhatsApp/LinkedIn services. Preserve Vercel as a supported deployment target and document how to return to it.

- Keep `vercel.json`, the Vercel project, recorded Git connection details, environment configuration and existing deployment available. Temporarily disable automatic GitHub deployments so pushes do not consume Vercel builds.
- Add Docker/VM deployment support alongside the current Next.js build path.
- Do not create a new database, copy production data, rotate existing encryption keys, or alter the schema for this hosting change.
- **Never run or apply any database migration without the user's explicit approval for that specific migration.** Provisioning, container startup and deployment scripts must not invoke migrations automatically.
- The user subsequently explicitly authorised working through this plan, including creating the dedicated Droplet. The user approved `acquire.mlai.au`; its DNS-only A record has been created without changing Vercel DNS. Resizing, secret rotation, live outreach and database migrations are not implicit in that authorisation.
- Maintain one active destination for campaign scheduling and research coordination during cutover. Retaining two deployments does not imply running duplicate schedulers.

## 1. Verified starting state

Read-only DigitalOcean API inspection using the existing `.env.local` token succeeded. Read access and the required SSH-key, Droplet, project-resource and firewall writes are now verified through the intended provisioning actions.

| Item | Verified value |
| --- | --- |
| Project | `project_acquire` |
| Project ID | `a5255506-6f88-4e91-b501-f79d7c347d4f` |
| Environment | Production |
| WhatsApp Droplet | `acquire-whatsapp-test-01`, ID `605175578`, Sydney, 512 MiB / 1 vCPU, US$4/month |
| LinkedIn Droplet | `acquire-linkedin-test-01`, ID `606103512`, Sydney, 2 GiB / 1 vCPU, US$12/month |
| Dedicated app Droplet | `acquire-app-01`, ID `606721098`, `134.199.155.67`, Sydney, 2 GiB / 1 vCPU / 50 GiB, US$12/month |
| Vercel project | `project-acquire`; configuration requests `syd1` |
| App stack | Next.js 16.3.2, React 19, Better Auth, Drizzle, PostgreSQL |
| Database | Production configuration/documentation specifies Supabase; local configuration uses OrbStack |
| Research | Existing Cloudflare Worker/Workflows retained; deployed and checked-in `APP_ORIGIN` now point to `https://acquire.mlai.au` |
| Manufacturing index | `.local-data/manufacturing-search-index.json`, approximately 5.2 MiB |

The existing WhatsApp server previously suffered an out-of-memory incident during an additional build. The LinkedIn service has a 1536 MiB container allowance on a 2 GiB host. Neither is a demonstrated spare-capacity app host. Add a separate Droplet; do not resize or repurpose them as part of this plan.

The Vercel usage screenshot exceeds multiple Hobby limits. Its billing interval and per-project attribution remain unverified; it cannot establish app peak load or Droplet capacity.

## 2. Decisions and inventory before implementation

- [ ] Confirm the Git commit/branch to deploy and record current worktree changes. Avoid deploying unrelated unfinished work.
- [x] Confirm the intended Supabase transaction-pooler endpoint and TLS configuration using a read-only connection.
- [ ] Confirm total connection allowance and aggregate pool headroom.
- [ ] Inventory the actual Vercel Production variable names and privately obtain their values. `.env.example` and `.env.local` are not authoritative production configuration.
- [x] Verify required DigitalOcean permissions through the explicitly intended resource creation actions.
- [x] Select the owned hostname `acquire.mlai.au` and confirm DNS access.
- [ ] Obtain Google OAuth configuration access and register the new redirects; browser controls are unavailable in this session.
- [x] Select the initial server size: 2 GiB / 1 vCPU, US$12/month. Backups are currently disabled; approval of a backup arrangement remains open.
- [x] Identify the dedicated deployment SSH key and operator IP allowlist.
- [x] Read-only inventory of production research/jobs, campaign enrolments, n8n workflows and waiting/running executions completed.
- [ ] Refresh inventory immediately before the coordinated cutover.
- [ ] Inventory all inbound webhook destinations, OAuth redirects, service origin restrictions and URLs embedded in saved workflow definitions.
- [ ] Record Vercel availability/reset status. A paused deployment is not an immediately usable rollback destination.

Recommended initial server: `acquire-app-01`, Sydney, Basic Regular bundled 2 GiB / 1 vCPU / 50 GiB disk, US$12/month, with builds performed off-server. Confirm plan availability and final displayed price before creation. Use a supported 64-bit Ubuntu image compatible with the chosen container tooling.

Upgrade to 4 GiB / 2 vCPU only if measured runtime/concurrency or deployment overlap requires it. A monthly CPU total is not a sizing test.

### 2A. Stop Vercel GitHub builds before pushing deployment work

User requirement: GitHub pushes must not automatically build this Vercel project while DigitalOcean is the intended host. This is separate from Vercel's current quota pause: automatic builds must remain disabled even after quotas reset.

Target: [project-acquire settings](https://vercel.com/callumholts-projects/project-acquire/settings/general), project ID `prj_I5GfvS1wmVSut4IS1VN5bcHNcvTI`. Current status: **Git repository disconnected and verified by the Vercel API; project remains quota-paused**. Previous Git settings are retained privately in `.local-data/app/vercel-before.json`. No implementation push has been performed.

Recommended immediate control: temporarily disconnect this project's Git repository in **Settings → Git**. This avoids depending on a new Vercel deployment successfully activating repository configuration while the account is paused. Preserve the project, environment variables, domains and existing deployments. Do not delete the project, uninstall the account-wide GitHub app, revoke repository access for other projects, or delete the GitHub repository.

- [x] Before any implementation push, inspect the target project's settings through the authenticated Vercel API and record the connected repository owner/name, production branch, root directory, build/install/output settings, branch-specific environment rules and any ignored-build configuration.
- [ ] Inspect repository GitHub Actions, Vercel deploy hooks and other external CI jobs for explicit Vercel CLI/API deployment triggers. Disable only this app's automatic Vercel jobs/hooks where necessary; disconnecting Git does not prevent a separate workflow from invoking Vercel directly.
- [x] Disconnect the Git repository for **this Vercel project only** and verify Settings → Git shows it disconnected. Preserve private restoration records. This control does not delete the existing deployment, but the existing quota pause may still prevent it serving requests.
- [x] Inspect queued/building deployments and cancel this project's unnecessary pending builds individually. Do not cancel another project's deployments.
- [ ] Check GitHub branch protection for required Vercel checks. Record any required adjustment so PRs are not blocked indefinitely by a deployment deliberately disabled; change repository rules only as needed and explicitly record the restoration action.
- [ ] Use the next intended GitHub push to verify that its commit SHA produces **no automatic Vercel build/deployment** for this project. Do not push a dummy commit solely for this check. Check both Vercel Deployments and any GitHub deployment workflows.
- [ ] Record the disabled control, timestamp, latest retained Vercel deployment and verification evidence. If the project merely rejects builds because of quota, the requirement is not yet verified.

Optional persistent repository control: during implementation, retain the existing schema/region fields and add the officially supported setting below to `vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "regions": ["syd1"],
  "git": {
    "deploymentEnabled": false
  }
}
```

`false` covers **all branches**, including previews. Do not use deprecated `github.enabled`, and do not disable only the production branch while leaving preview builds active. This setting is compatible with an intentional manual Vercel deployment later, subject to account availability. It does not disable explicit CLI/API/CI deployments.

Do not assume committing the setting alone proves immediate enforcement on the paused project. Keep the project disconnected until the desired control is demonstrably active. There is no need to reconnect it while using DigitalOcean.

An Ignored Build Step such as `exit 0` skips building, but can still create cancelled deployment records that count toward deployment/concurrency limits. Use it only as a recorded fallback if the stronger controls are unavailable; it is not the preferred solution for avoiding GitHub-triggered deployments altogether.

Restoration choices:

1. **Manual Vercel standby:** retain disabled Git deployments and deploy an explicitly selected release manually after the quota pause is resolved.
2. **Resume automatic Vercel deployments:** restore `git.deploymentEnabled` to `true` or remove the optional override, restore any ignored-build setting and app-specific CI/check rules, then reconnect the recorded repository/production branch when ready. Reconnection may trigger a deployment; treat it as an intentional action. Verify one intended commit builds successfully and does not also trigger unwanted DigitalOcean deployment.

Gate: no implementation pushes until project-level build suppression is confirmed. The Markdown plan itself does not apply these settings.

## 3. Intended architecture

```text
Browser / OAuth / external callbacks
                 |
          owned HTTPS hostname
                 |
            Caddy :443
                 |
     loopback port -> app container
                 |
       existing Supabase database

App -> existing Cloudflare research Worker -> active app callback hostname
App <-> existing n8n -> active app campaign endpoints
App -> existing WhatsApp and LinkedIn HTTPS services

Vercel remains an alternative deployment of the same application.
```

Run one app process initially. Existing in-memory cooldown/concurrency guards are process-local; multiple app processes or overlapping active hosts require a separate concurrency review. Database transactions/idempotency remain necessary, but do not justify intentionally duplicating dispatchers.

## 4. Add deployment files without replacing Vercel

Deployment files implemented (optional CI is deferred):

| File | Purpose |
| --- | --- |
| `ops/app/Dockerfile` | Multi-stage Linux app build and non-root runtime |
| `.dockerignore` | Exclude secrets, host dependencies, caches, unrelated data and deployment records |
| `ops/app/compose.hosted.yml` | Image, runtime environment, loopback port, restart policy, health check, logging and shutdown grace |
| `ops/app/hosted.env.example` | Secret-free production variable template |
| `ops/app/Caddyfile` | App hostname, TLS and reverse proxy |
| `scripts/app-image-build.mjs` | Reproducible image build/tagging, if a helper is needed |
| `scripts/app-deploy.mjs` | Explicit host/image deployment, health verification and failure handling |
| `ops/app/README.md` | Operator commands, upgrades, restoration and troubleshooting |
| `.github/workflows/app-digitalocean.yml` | Optional manual CI deployment after the local path works |

- [x] Read installed Next.js deployment, standalone output, environment and self-hosting guides before code changes, as required by `AGENTS.md`.
- [x] Enable `output: "standalone"` only for the Docker build using an explicit build variable. Preserve normal `pnpm build`, `pnpm start`, `vercel.json` and existing tracing settings.
- [x] Pin a supported Node LTS version satisfying Next.js, pnpm and dependency engines; pin the existing pnpm version. Use the repository lockfile with `pnpm install --frozen-lockfile`.
- [x] Build for the Droplet's Linux architecture. On Apple Silicon, explicitly target Linux amd64 or use an amd64 CI builder.
- [x] Copy standalone output, `public` and `.next/static`; explicitly copy the manufacturing index at its expected runtime path or set `MANUFACTURING_DIRECTORY_DATA_PATH` consistently.
- [ ] Verify the index exists inside the final image and manufacturing discovery actually reads it. Do not assume tracing covers every route.
- [x] Exclude `.env*`, `.vercel`, SSH keys, DigitalOcean credentials, local databases, test results, `.git`, host `node_modules` and unrelated `.local-data` files. Include only the required index data.
- [x] Do not use production secrets as Docker build arguments or bake them into layers. Where a build requires server configuration, use non-production build-only configuration/secret mounts and verify it cannot reach production services.
- [x] Supply `NEXT_PUBLIC_APP_URL` at build time: Next.js embeds public variables in browser bundles. A different hostname can require rebuilding the image.
- [x] Use `NODE_ENV=production`, listen on the container interface, and publish the app port on host loopback only.
- [x] Add a cheap liveness endpoint exposing no secrets, plus an operator readiness check for database connectivity. Public liveness should not repeatedly query providers or trigger work.
- [ ] Set restart policy, resource limits, bounded logs and a shutdown grace period compatible with in-flight requests/background dispatch. Test SIGTERM behaviour.
- [ ] Give the runtime user write access only where needed, including Next.js cache/image optimisation paths. Persist or deliberately recreate cache directories; do not treat caches as business data.
- [ ] Tag images by commit and retain the previous working release. Do not deploy a mutable `latest` tag as the only recovery record.

### Existing code compatibility

- [ ] Retain the `@vercel/functions` database pool integration unless runtime testing reveals a problem. The installed implementation skips its Vercel-specific waiting behaviour without `VERCEL_URL` and `VERCEL_REGION`; removing it is not necessary for the VM.
- [ ] Keep ordinary PostgreSQL pools. Verify main and campaign pools, connection counts, TLS CA handling, transaction rollback, `SET LOCAL ROLE`, organisation isolation and reconnect after a transient failure.
- [ ] Verify Better Auth and Gmail token decryption against the intended configuration.
- [ ] Keep Node DNS/HTTPS website-validation behaviour. Unlike Workers, a standard Node VM does not require rewriting it.
- [ ] Verify `proxy.ts`, server rendering, image optimisation and `after()` in the production container.
- [ ] Do not assume route `maxDuration` automatically configures Docker or Caddy request limits. Check real long-request and graceful-drain behaviour.

## 5. Production environment mapping

Maintain an inventory of variable names, source, destination, purpose and whether the value changes. Keep actual values in restricted files or a secret manager, never in this document, Git, command output or image metadata.

### Local availability audit (7 October 2026)

Authenticated Vercel CLI credentials can list 46 production environment entries. The API returned values for three regular encrypted entries; 43 sensitive entries did not return their values. The local production DB credentials passed an SSL-verified read-only connection check; the original encryption key decrypted the one sampled stored mailbox token successfully, without printing plaintext. Access to configuration metadata is not access to all production secrets.

Local inspection found candidate values for the Supabase connection/certificate, Better Auth secret, 32-byte token encryption key, Google OAuth, Resend, Firmable/Google Places/Apollo/Tavily, inbound reply secrets, and OpenRouter/OpenAI credentials. Sources include `.env` and `.env.local`. Presence and key format were checked, but equality with the currently deployed sensitive values has **not** been established. The local files contain differing database configurations; the local n8n URL points to a local instance, so copying `.env.local` is not a production setup.

Additional original deployment records exist:

- `.local-data/mlai-research-service-secret`: nonempty candidate research secret; validate against the intended deployed Worker without printing it.
- `.local-data/n8n-acquire-api-key.json`: populated original API key record; verify its hosted n8n scope/current validity through read-only access.
- `.local-data/whatsapp/production-service.env` and `.local-data/linkedin/cloud-service.env`: candidate hosted channel secrets. Local and hosted service keys differ; use the correct hosted sources.
- Hosted service URLs can be reconstructed from recorded deployments/Caddy configuration and verified with authenticated read-only health checks.

Additional original records found: `.local-data/campaign-worker-production.secret` and the production Firmable credential/service-secret records. The saved key returned HTTP 401 because it belonged to the local instance; it matches `.env.local`. The actual Oracle production key was subsequently recovered read-only from its original `Acquire sequence publishing` record and passed authenticated production API access (200).

Remaining readiness gates: complete the n8n credential domain allowlist and callback retargeting, active research configuration, Google OAuth registration, and parity of remaining unreadable Vercel feature/model settings. The original worker secret now matches the decrypted production n8n credential; the original Firmable secret passed hosted authentication; the encryption key decrypted a sampled production mailbox token. Recover missing values from trusted original records or intended service configuration; do not substitute local credentials or rotate production keys silently. Until these checks pass, the environment is **partially recoverable, not yet production-ready**.

| Group | Variables / requirements |
| --- | --- |
| Database | `DATABASE_DRIVER=postgres`, production `DATABASE_URL`, `DATABASE_SSL_CA`; preserve certificate formatting and verification |
| Authentication | Existing `BETTER_AUTH_SECRET`; `APP_URL`; build-time `NEXT_PUBLIC_APP_URL`; `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` |
| Gmail encryption | Preserve the exact production `TOKEN_ENCRYPTION_KEY`; do not generate a replacement |
| Gmail callback | `GOOGLE_GMAIL_REDIRECT_URI=<active-origin>/api/mailbox/google/callback` |
| Transactional email | `RESEND_API_KEY`, `AUTH_EMAIL_FROM`; verified sender domain |
| Research | `RESEARCH_ENABLED`, `RESEARCH_WORKER_URL`, `RESEARCH_SERVICE_SECRET`; matching Worker service secret and active `APP_ORIGIN` |
| Discovery/enrichment | Current Firmable transport, API/service URLs and secrets; Google Places, ABN, Apollo and other configured providers |
| AI/drafting | Current provider mode, keys, base URLs, model settings and verbosity flags; validate current production values rather than copying stale example model names |
| Campaigns | `OUTREACH_WORKER_SECRET`, all `CAMPAIGN_N8N_*` settings, `CAMPAIGN_APP_URL`, `CAMPAIGN_REPLY_MONITOR_MODE`, `CAMPAIGN_LINKEDIN_ENABLED` |
| Hosted channels | Production `WHATSAPP_SERVICE_URL`, `WHATSAPP_SERVICE_SECRET`, `LINKEDIN_SERVICE_URL`, `LINKEDIN_SERVICE_SECRET`; do not use local SSH tunnel URLs |
| Inbound replies | `INBOUND_REPLY_SECRET`, `INBOUND_WEBHOOK_SECRET`, `REPLY_DOMAIN` and actual external webhook destinations |
| Index | Expected manufacturing index path or `MANUFACTURING_DIRECTORY_DATA_PATH` |
| Runtime | Port, hostname, production mode and any explicitly required Node settings |

- [ ] Inventory additional variables from the full source tree and actual production deployment; the table is not a substitute for that comparison.
- [x] Do not export deployment tokens (`DIGITALOCEAN_TOKEN`, Vercel administration credentials) to the app. Keep only API credentials the app genuinely uses, including any required Cloudflare API/access credentials.
- [x] Exclude `LOCAL_DEVELOPMENT`, `CAMPAIGN_E2E_LOCAL`, `CAMPAIGN_TEST_SINK_URL`, `CAMPAIGN_TEST_SEND_ANYTIME` and `CAMPAIGN_TEST_FAST_WAITS` from production.
- [x] Use a restricted environment file outside the image. Preserve multiline PEM values with a tested encoding/Compose mechanism; do not assume a copied multiline `.env` entry parses correctly.
- [ ] Check required variables privately before startup. Report missing names only.
- [ ] Preserve service encryption keys and volumes on the existing channel hosts; no channel-state transfer is required.

## 6. Local verification before provisioning

- [x] Run scoped tests for packaging/config changes, `pnpm typecheck`, `pnpm lint` and the production Docker build.
- [x] Review test scripts before running them. Run no migration/apply commands and no test that applies schema without specific approval. Use an already prepared isolated local database for database-backed tests.
- [x] Run the container locally against isolated OrbStack configuration and controlled provider fixtures.
- [x] Exercise isolated container signup, session, organisation creation, authenticated mandate rendering and sign-in; remove synthetic fixtures afterward.
- [ ] Exercise target hydration, manufacturing discovery, website validation and remaining API routes in the new runtime.
- [ ] Exercise research progress, callback authorisation and `after()` dispatch with local test infrastructure.
- [ ] Run campaign integration using the existing local no-send sink. Do not set the local sink in a production-mode container; its guards deliberately reject production use. Use the existing supported local test harness separately.
- [ ] Test container restart, SIGTERM, health failure, database reconnect, static assets and cache write permissions.
- [x] Verify the build context excludes production secrets; scan the final container filesystem for candidate local production credentials. Twenty-four candidates checked, zero matches across 288,026,624 bytes. Runtime environment secrets are deliberately not part of this filesystem scan.
- [x] Verify the standard Vercel build path still succeeds after the additions.

Gate: proceed to provisioning only after the image works and the intended resource/cost is approved.

## 7. Provision the dedicated Droplet

- [x] Verify DigitalOcean identity/project and final server plan immediately before provisioning.
- [x] Create `acquire-app-01` with the selected region/size/SSH key and monitoring; assign it to project `a5255506-6f88-4e91-b501-f79d7c347d4f`.
- [x] Record Droplet ID, public/private addresses, image, size, billing and firewall IDs in ignored deployment records. Do not store private keys in Git.
- [x] Establish SSH host identity and verify its fingerprint; do not disable host-key verification.
- [x] Configure a deployment user and least-required access, OS updates and reboot behaviour.
- [x] Install Docker/Compose and Caddy from trusted repositories. Arrange boot startup.
- [x] Apply a DigitalOcean firewall: SSH from authorised sources, HTTP/HTTPS publicly as needed, no public Node/database/debug ports. Account for IPv6 if enabled.
- [ ] Create the deployment directory, restricted environment file and cache/release directories with appropriate ownership.
- [ ] Configure bounded Docker logs, log redaction and disk/image retention.
- [ ] Enable chosen backups and record restoration procedures. Droplet backups do not cover the external Supabase database; confirm its existing recovery arrangement separately.
- [x] Transfer/pull the immutable image and record its digest. If using a registry, use scoped credentials and account for registry cost; registry provisioning is optional.
- [x] Start the container and verify local readiness before enabling public routing.

## 8. HTTPS and hostname setup

### Initial parallel deployment

- [x] Add the approved owned hostname `acquire.mlai.au` pointing to the new server. Leave Vercel DNS and hostname configuration unchanged.
- [x] Configure Caddy to proxy to the loopback app port; validate configuration before reload.
- [x] Verify publicly trusted HTTPS, HTTP-to-HTTPS 308 redirect, correct app origin and successful static assets. Caddy handles automatic certificate renewal.
- [ ] Verify renewal over time and real client IP handling under representative requests.
- [ ] Preserve streaming, Next.js caching headers and suitable upload/request timeouts. Avoid blanket CDN caching of authenticated HTML or APIs.
- [ ] If Cloudflare DNS proxying is used, confirm its proxy timeout/body-size limits against app requests and use end-to-end HTTPS. DNS-only is a valid initial choice.
- [ ] Add Google OAuth authorised origins and both redirect paths, retaining existing Vercel entries:
  - `<new-origin>/api/auth/callback/google`
  - `<new-origin>/api/mailbox/google/callback`
- [x] Update host-specific app variables and rebuild browser assets for `https://acquire.mlai.au`.
- [ ] Expect re-login on a different hostname; preserving the auth secret does not move cookies across unrelated domains.

### Eventual canonical hostname

Prefer a stable owned hostname for app users and callbacks, with a separate host-specific diagnostic/test hostname. Later switches can route the stable hostname to DigitalOcean or Vercel.

- [ ] If introducing a canonical hostname, explicitly prepare both hosts and Google OAuth settings for it; this is a deliberate configuration change, not an implicit replacement of the Vercel project.
- [ ] Retain existing Vercel hostname/OAuth entries. `project-acquire.vercel.app` cannot be redirected through DNS to a Droplet.
- [ ] Record current A/AAAA/CNAME/proxy settings and lower TTL ahead of cutover where appropriate. DNS propagation is not instantaneous; keep both backends compatible during the overlap.
- [ ] Test hostname-specific auth, redirect, certificate and browser-bundle behaviour before changing routing.

## 9. Staging checks without production side effects

Use isolated local/approved staging infrastructure for mutation and campaign tests. A second app pointed at production Supabase can still write data or invoke services; changing UI flags alone does not establish read-only staging.

- [ ] Keep the public test deployment access-restricted while production credentials are present. Preserve access for explicitly allowed callback tests; do not accidentally block bearer-authenticated automation with interactive authentication.
- [ ] Do not connect a test deployment to the active production scheduler or change the production research Worker solely to test it.
- [ ] For end-to-end research staging, use the existing isolated test harness or a separately approved test Worker/configuration and database.
- [x] Test controlled database connectivity, session reads and service health without publishing sequences, enrolling contacts or sending messages.
- [ ] Verify Google login and delegated Gmail grant only with an intended test account; do not revoke existing grants.
- [ ] Measure memory, CPU, event-loop delay, request latency, DB connections, error rate and disk under representative concurrent load. Avoid unsolicited live-provider load tests.
- [ ] Verify private organisation data cannot leak through Caddy/CDN cache or logs.
- [ ] Establish acceptable thresholds and minimum memory/disk headroom before declaring the server ready. Resize only after approval if it fails the gate.

## 10. Callback and automation cutover inventory

| System | Current dependency | Action and rollback record |
| --- | --- | --- |
| Cloudflare research/Firmable refresh | Worker `APP_ORIGIN` | Inspect deployed configuration as well as checked-in Wrangler values; preserve bindings/secrets, change only intended origin, record old value |
| n8n scheduler | Embedded `/api/internal/campaigns/tick` URL | Export current workflow, change intended URL and retain schedule/timezone |
| Published sequence workflows | Callback URLs compiled when created | Export and inspect each workflow; plan updates without recreating enrolments or resetting progress |
| n8n waiting executions | May retain an execution's saved workflow/config | Inspect actual n8n behaviour/version and outstanding executions; workflow edits alone may not retarget them |
| n8n Header Auth credential | Domain restriction and shared worker secret | Permit intended active hostname without exposing/replacing secret; retain original restriction details |
| Future sequence publishing | `CAMPAIGN_APP_URL` | Set active/canonical hostname; retain all other production n8n settings |
| LinkedIn viewer | Caddy `frame-ancestors` | Add new app origin while retaining Vercel/local entries; validate/reload existing service Caddy |
| Google login/Gmail | Registered origins and redirects | Add new entries, retain existing entries; align app redirect variable |
| Inbound reply/webhook providers | Registered app endpoints | Inspect provider configuration, signatures, event retries and old/new destinations |
| Email/reset links | App base URL | Verify links use active hostname |
| Saved browser/workflow links | Hostnames persisted outside deployment env | Inventory and retain a mapping for restoration |

Important repository behaviour: `syncMissingCampaignWorkflows()` only provisions versions without `n8n_workflow_id`. It does **not** update callback URLs in existing workflows. Do not run sync or recreate/delete existing workflows as a URL migration shortcut.

Gate: no cutover until every active workflow and waiting execution has an explicit handling strategy. Options include draining to completion before switching, or carefully updating supported execution configuration. Do not replay sends or duplicate workflows to recover a callback failure.

## 11. Production cutover sequence

Completed service cutover: see the final dated record below. No maintenance mode or scheduler pause remains active.

- [ ] Record the exact app commit/image digest and snapshot current routing, environment-name inventory, Worker origin, n8n workflow exports/credentials, and outstanding job/enrolment state. Store secrets privately.
- [ ] Confirm a working rollback destination. If Vercel is paused, retain the previous healthy DigitalOcean image for immediate release rollback; returning to Vercel must wait for restored service.
- [x] Agree on a short cutover window and operator. Pause new research starts and campaign dispatch using an explicit reviewed procedure; do not assume an undeveloped maintenance flag exists.
- [ ] Account for already running research, due sends and n8n waits. Preserve legitimate inbound reply handling, or ensure retries/temporary forwarding are accounted for during the window.
- [x] Deploy the verified image and exact production configuration. Run private readiness, database/session and token-decryption checks.
- [x] Switch the selected hostname/routing and necessary automation destinations according to the completed inventory. Verify bearer authentication and credential restrictions at each destination.
- [ ] Verify existing research progress reaches the intended app and is persisted; avoid starting duplicate jobs.
- [ ] Verify campaign dispatch/reply monitoring state without forcing a live send. Any controlled live send requires its own intended contact/message approval.
- [x] Resume the single intended scheduler/new-job path after checks pass. Ensure there is no additional Droplet cron timer duplicating the n8n schedule.
- [ ] Verify Gmail/OAuth, channel settings/viewer, targets, audit, research status and password-reset link origin.
- [ ] Monitor errors, memory, CPU, latency, DB connections and automation progress during the cutover and the following 24–48 hours.
- [x] Record final active host/origin and restore normal DNS TTL only after stability.

Abort if readiness fails, token decryption fails, auth redirects loop, callbacks fail, organisation isolation changes, server memory is exhausted, or campaign state becomes ambiguous. Preserve evidence and reconcile ambiguous sends before retries.

## 12. Routine deployments and local rollback

- [ ] Use manual deployment initially. Keep Vercel's build compatibility and recorded Git configuration intact, but leave automatic GitHub deployments disabled as described in section 2A. Do not add automatic dual-host production deployments by default.
- [ ] Build/tag the selected commit off-server, run required checks and transfer/pull the image by immutable digest.
- [ ] Validate environment changes separately. Do not overwrite the server's production environment with local values.
- [ ] For replacement, allow graceful shutdown/drain and document the expected short interruption. If using two containers for smoother updates, test memory headroom and prevent duplicate active automation; 2 GiB may not support overlap comfortably.
- [ ] Start the release, wait for readiness, verify app/callback behaviour and retain the prior image/configuration.
- [ ] On failure, restore previous image/config, check readiness and account for interrupted work. Do not restore a database backup as an application-release rollback.
- [ ] Prune only confirmed-unused images after the retention period; keep at least the current and previous release. Bound cache/log growth and retain useful diagnostics.
- [ ] Optional CI: manual dispatch with protected deployment secrets, selected commit, architecture-correct build, test gates, deployment concurrency lock, health checks and rollback. Do not attach migrations to CI.

## 13. Returning to Vercel

- [ ] Confirm Vercel's quota/plan permits requests and deployments again. A quota reset alone is not proof that the app serves correctly.
- [ ] Deploy the compatible desired commit through the normal Vercel path. Retain its original build settings and provider integrations.
- [ ] Choose manual Vercel deployment with Git automation still disabled, or deliberately re-enable/reconnect the original Git deployment integration using section 2A. Verify automatic builds do not resume prematurely during rollback preparation.
- [ ] Verify production database access, token decryption, auth, assets and controlled callback behaviour on Vercel.
- [ ] If using a canonical hostname, align Vercel app/build-time variables and domain/certificate configuration before switching DNS. If returning to the original `.vercel.app` hostname, account for browser URL/cookie changes and rebuild any host-specific public configuration.
- [ ] Pause/coordinate new job starts and dispatch, account for in-flight work and n8n waiting executions using the same cutover procedure.
- [ ] Route users and active callbacks to Vercel; restore Worker origins, workflow endpoints and credential restrictions wherever still host-specific.
- [ ] Resume one intended automation path and verify progress, reply monitoring and due-enrolment handling.
- [ ] Drain the DigitalOcean app before stopping it. Existing channel Droplets and Cloudflare research services remain running.
- [ ] Retain the app Droplet for a defined fallback period if desired. A powered-off Droplet still accrues Droplet charges; destruction requires a separate decision after preserving deployment records/secrets/images.
- [ ] Do not roll back or copy Supabase data. Both hosts use the same schema and records; future schema changes must remain compatible with the release intended for rollback.

## 14. Operating responsibilities and cost

| Item | Planned treatment |
| --- | --- |
| App Droplet | US$12/month initial bundled plan; verify before provisioning |
| Weekly percentage-based backup | US$2.40/month additional on that plan, if selected |
| Existing channel Droplets | US$16/month combined; unchanged |
| Supabase / Cloudflare / providers | Existing independent billing continues |
| Optional registry, DNS/domain, snapshots, transfer excess | Confirm separately; not included in app estimate |
| Maintenance | OS/security updates, container/Node updates, monitoring, certificate renewal checks, image/log retention and restoration drills |

- [x] Create dedicated app resource alerts: CPU >90%, memory >90%, disk >85%, each sustained for 10 minutes; notify the verified DigitalOcean account email.
- [ ] Add external HTTPS uptime monitoring and confirm ongoing response ownership.
- [ ] Test service recovery after container crash and planned host reboot.
- [ ] Confirm backups/release artefacts and protected secret storage can recreate the app on a replacement host.
- [ ] Track aggregate DB connections across app, Vercel standby and existing services.
- [ ] Reassess 2 GiB sizing with measured peaks and growth. Self-hosting removes per-invocation billing, not capacity limits.
- [ ] Keep a dated record of the active host and periodic Vercel compatibility checks so the fallback does not silently become stale.

## 15. Completion criteria

- [x] Dedicated app deployment exists in the specified project and passes production checks.
- [ ] Hostname, OAuth, research, n8n, inbound events and channel viewer integrations point to the intended active host.
- [ ] Existing data, encrypted tokens, connected accounts and campaign progress remain intact.
- [ ] No duplicate scheduler/dispatch path exists; waiting executions have been accounted for.
- [x] No database migration was performed without specific approval.
- [ ] Vercel remains configured and the normal build path passes.
- [ ] Vercel automatic GitHub deployments are explicitly disabled and an intended push confirms no build is triggered; re-enable/manual deployment instructions and connection metadata are retained.
- [ ] Same-image configuration rollback is tested; verify different-image rollback before full cutover; return-to-Vercel procedure is documented with any availability limitation.
- [ ] Monitoring, backups/recovery, log/image retention, secret handling and maintenance ownership are established.
- [ ] Final commit, image digest, configuration changes, costs, validation results and unresolved limitations are recorded.


## Execution record — 7 October 2026

- **Vercel:** retained project/environment/deployments; disconnected only this project's Git repository using the CLI, then verified `gitConnected=false` and `paused=true` through the API. No queued builds were found. Added `git.deploymentEnabled=false` to the working-tree configuration. No push has been made, so push-level verification is pending. No repository `.github/workflows` directory or explicit Vercel deploy invocation was found in the inspected source.
- **Provisioning:** dedicated app Droplet `606721098`, firewall `8171457b-920a-41bd-acca-99fdc6d15068`, SSH-key record `59885895`. Monitoring on, backups off. SSH is restricted to `116.91.223.62/32`; HTTP/HTTPS allowed; app port loopback-only. Existing WhatsApp host/state is untouched; the LinkedIn host later received only the required Caddy viewer-origin addition, with prior configuration saved and existing origins retained. SSH host identity was installed through cloud-init and pinned locally; host checking stays enabled.
- **Bootstrap:** Ubuntu 24.04, Docker 29.1.3, Compose 2.40.3 and Caddy installed. Cloud-init's last `reload ssh` action failed because Ubuntu uses socket activation; `ssh.socket` was subsequently restarted and SSH policy/service checks passed. The historical cloud-init error is not hidden. Caddy currently returns 503 rather than routing to the app.
- **Packaging:** conditional standalone build, non-root runtime, Linux amd64 image, secret-free build configuration, allowlisted build context, raw runtime environment with certificate encoding, liveness/readiness routes, manual deployment helper and operator guide implemented. Readiness is bearer-protected and reports no database details.
- **Verification:** normal `pnpm build` and typecheck passed; lint passed with two existing unused-variable warnings. Nineteen scoped tests passed across environment handling, readiness, campaign pool behaviour and opt-in local database isolation/lock checks. Those local DB fixtures rolled back; no schema changes were made. Local production container returned expected liveness/readiness/session/sign-in responses and unauthenticated mandate redirect. Its 5,471,269-byte manufacturing index is readable. Runtime memory during the basic checks was approximately 174 MiB; this is not a representative load test.
- **Production data checks:** read-only SSL-verified connection and one stored mailbox refresh-token decryption passed. Research status inventory found no active rows; campaign-enrolment count was empty at inspection. This is a point-in-time snapshot, not a cutover guarantee. The original production n8n key was recovered after searching the separate `/Users/callum/Documents/Development/n8n` project. Strict-host-key SSH to the documented Oracle VM succeeded; production key and intended worker credential were read from the original records without database writes, migrations or restarting n8n. Production workflow API returned 200: two active Acquire workflows and one unrelated inactive accounting workflow. No waiting/running executions were present at inspection. Read-only deployed Worker settings confirmed `APP_ORIGIN=https://project-acquire.vercel.app`; original research secret passed an authenticated unmatched-path probe (404 rather than 401). The Firmable secret in the D credentials JSON returned 401, but the original D rollout service-secret record passed hosted `/firmable/status` with 200. Only the verified secret is selected for the public runtime. Existing WhatsApp and LinkedIn HTTPS health checks both returned 200 with their hosted credentials, without sending messages or changing their configuration.
- **Private release:** `acquire-app:5725d59-20261007-local`, built from base commit `5725d59` plus the uncommitted deployment changes, with public origin `http://localhost:3014`. Production DB/auth/encryption configuration is supplied privately at runtime; no live provider, channel, email or n8n credentials are installed and research/n8n are disabled. This initial private image is now retained as a diagnostic artefact; the active image was rebuilt for the approved public origin. Remote liveness/session/sign-in returned 200 and unauthenticated mandates redirected with 307; authenticated production DB readiness passed. At initial private verification the container was healthy, app port was loopback-only and public HTTP returned the deliberate 503 placeholder. A deliberately invalid database environment triggered automatic restoration; production readiness passed after rollback. This exercised configuration rollback using the same image, not rollback to a different application version. Do not treat this as a finished production deployment.
- **Public release:** active `acquire-app:5725d59-20261007-public`, Docker manifest-list ID `sha256:737330f5834fafb154208d6d0aab2f8517a24dbcf00941b62141719fdbb8e043`, with exact build/runtime origin `https://acquire.mlai.au`. DNS-only A record points to `134.199.155.67` (TTL 300); Caddy validation/reload passed and public TLS validation succeeded without bypasses. Public liveness/sign-in/session/static asset checks returned 200, unauthenticated readiness 401, protected mandates 307 to sign-in, authenticated production DB readiness 200 and HTTP-to-HTTPS 308. Runtime environment and prior environment are mode 600. Basic runtime memory measured approximately 86 MiB; disk use 6%, not a capacity benchmark.
- **Runtime/integrations:** original DB/auth/encryption settings retained; Google and Resend configuration installed. Explicit live target-provider and hosted Cloudflare Firmable transport installed using the verified service secret. OpenRouter and Resend read-only API authentication both returned 200; `openrouter-free`/AI drafting is selected from the local known configuration, but exact equality with Vercel's unreadable sensitive feature/model settings is not proven. Verified hosted WhatsApp/LinkedIn settings and original inbound secrets are installed. LinkedIn Caddy adds `https://acquire.mlai.au` to `frame-ancestors`, retaining Vercel and localhost; backed up before reload and verified by HTTPS response header. No channel session/encryption state was moved and no live sends were enabled by this deployment.
- **OAuth registration:** Google initially reported `redirect_uri_mismatch`; after the user updated registration, both the login and Gmail callback URLs reached Google's identifier page without redirect or invalid-client errors. Required authorised JavaScript origin `https://acquire.mlai.au` and redirects `https://acquire.mlai.au/api/auth/callback/google` and `https://acquire.mlai.au/api/mailbox/google/callback` are registered on the existing OAuth client; retain all Vercel redirects. No client secret was rotated. Browser controls were unavailable; the user performed the editor changes. Email/password authentication was exercised with disposable fixtures only in the isolated local container; no production account was created for testing.
- **Automation status:** `RESEARCH_ENABLED=true`, `RESEARCH_PIPELINE_DESIGN=hybrid-firmable-v1`, `CAMPAIGN_N8N_ENABLED=true`, `CAMPAIGN_REPLY_MONITOR_MODE=observe`. The last five production automatic business jobs confirmed the same hybrid pipeline; the previous production reply-monitor release documented observe mode. LinkedIn campaign activation remains false, preserving the existing pilot's live-send restriction. The original production n8n key and matching worker secret are installed. The user corrected the original Header Auth credential to allow both old and new domains, preserving `Authorization` and its value. Research Worker origin and both existing Acquire workflow callbacks now target the new hostname. No keys or workflow IDs were rotated and no enrolments were recreated.
- **Monitoring:** dedicated CPU/memory/disk alert policies were created for only app Droplet `606721098`, with thresholds 90%/90%/85% sustained for 10 minutes and the verified DigitalOcean account email as recipient. Existing alert policies were retained; IDs are in restricted `.local-data/app/resource-alerts.json`. External HTTPS uptime monitoring and backup/recovery decisions remain open.
- **Remaining operational checks:** representative load/capacity, external HTTPS uptime monitoring, backup/recovery decisions and 24–48-hour observation. Full Google/Gmail consent with an intended user and any controlled live-send validation are separate from redirect/authentication preflight; no live send was forced. Legacy `/api/inbound/reply` is not campaign ingestion: Resend has no registered webhooks, Cloudflare mail routing has no Worker action in the accessible zone, and Vercel has no production `REPLY_DOMAIN` setting. The unused local `reply.localhost` placeholder was removed from the subsequent-deployment input. There was no active legacy webhook destination to retarget in those inventories.


### Remaining n8n steps with the recovered production key

1. In `https://n8n.mlai.au`, open Credentials → **Header Auth account**, ID `SLEV9qdDG6POrNwP`. Its domain mode is `domains` and existing allowed domain is `project-acquire.vercel.app`. Add `acquire.mlai.au` using the editor's domain-list format; retain the old domain and existing `Authorization` bearer value. Do not rotate the worker secret or broaden access to all domains. The user performed this editor action; the original credential and matching bearer value were verified read-only on Oracle.
2. Refresh the read-only credential/workflow/running/waiting inventory. Private backups are `.local-data/app/n8n-workflows-before.json`, `n8n-waits-before.json` and `n8n-worker-credential.json`. Values stay outside Git.
3. Pause only Acquire scheduler `kBiaIm7v9cK9Eoe6` and sequence `0IQl0zTZ8GFXykNk` through their supported deactivate API. Leave unrelated accounting workflow `tZ5QduSQacWWWrwM` unchanged. Confirm no in-flight/waiting execution needs handling.
4. Update only the scheduler tick URL and the sequence's two step URLs from `https://project-acquire.vercel.app` to `https://acquire.mlai.au`, preserving workflow/node/webhook IDs, connections, schedules, timezones, credentials and progress. The concrete proposed definitions are in restricted `.local-data/app/n8n-workflows-proposed.json`; do not submit GET-only metadata in an API PUT. Inspect the installed PUT schema before selecting writable fields.
5. App configuration already contains the original production n8n API key/URL, worker credential ID/name and matching worker secret; `CAMPAIGN_APP_URL` is the new origin. Worker authentication was verified using intentionally invalid `{}` step payloads: unauthenticated 401 and authenticated 400 occurred before campaign processing, without sending messages.
6. Enable the app's intended n8n feature flag, deploy/check readiness, then reactivate exactly the two originally active Acquire workflows. Do not call tick/sync/start to force a live send, recreate a sequence, or generate test enrolments in production. Verify subsequent scheduled execution status without replaying an old execution.
7. Record final callbacks and retain original workflow JSON and credential-domain mapping for Vercel restoration. Recheck enrolments/executions immediately before activation, because the earlier zero counts were point-in-time observations.

## References

- [Cloudflare Worker settings and inherited bindings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit/)
- [DigitalOcean project](https://cloud.digitalocean.com/projects/a5255506-6f88-4e91-b501-f79d7c347d4f/resources)
- [Droplet creation](https://docs.digitalocean.com/products/droplets/how-to/create/)
- [Droplet pricing](https://www.digitalocean.com/pricing/droplets)
- [Backup pricing](https://docs.digitalocean.com/products/backups/details/pricing/)
- [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
- [Vercel Git deployment configuration](https://vercel.com/docs/project-configuration/git-configuration)
- [Vercel Git settings and repository disconnection](https://vercel.com/docs/project-configuration/git-settings)
- [Vercel ignored builds and deployment limits](https://vercel.com/docs/monorepos)
- Repository: `next.config.ts`, `vercel.json`, `src/db/client.ts`, `src/db/campaign-client.ts`, `src/lib/auth.ts`, `src/lib/auth-client.ts`, `src/lib/token-crypto.ts`, `src/lib/campaign-n8n.ts`, `src/lib/campaign-service.ts`, `cloudflare/research/wrangler.jsonc`, `docs/campaign-automation.md`, `ops/linkedin/Caddyfile`, `ops/linkedin/README.md`, `ops/whatsapp/README.md`.

Use the installed Next.js guides under `node_modules/next/dist/docs/` as the version-specific implementation reference. Recheck live provider configuration and pricing before executing this plan.

## Follow-up verification — 7 October 2026

After the user requested testing both configuration changes, the Google sign-in callback reached Google's sign-in identifier page with no redirect-URI mismatch or invalid-client error. The Gmail callback was separately checked against the same OAuth client and exact configured scope/PKCE parameters. This verifies redirect acceptance, not a completed user sign-in or delegated Gmail consent/token exchange.

The live Oracle n8n credential was re-read without writes: domain mode remains `domains`, and allowed domains still contain only `project-acquire.vercel.app`. The new domain was not present in the saved production credential at this check. Direct app worker authentication returned unauthenticated 401 and authenticated invalid-payload 400; this proves the app bearer check, not that n8n's current domain restriction permits the request. Workflow/callback cutover and automation activation remain pending.

### Saved credential recheck

The original workflow credential `SLEV9qdDG6POrNwP` (**Header Auth account**) now has header name `Authorization`, specific-domain mode, and allowed domains `project-acquire.vercel.app,acquire.mlai.au`. Its bearer value matches the app's preserved production worker secret. The intentionally invalid step payload again returned 401 without authentication and 400 with authentication; no campaign processing or sending occurred. The unused **Header Auth account 2** is not referenced by these existing workflows and was left unchanged. The domain restriction blocker is resolved; existing workflow URLs and Worker origin still await the coordinated callback cutover, and automation remains disabled in the app.

## Completed service cutover — 7 October 2026

The user explicitly requested continuing deployment after seeing “Research is awaiting service activation”. Fresh read-only production checks found no active research or Firmable runs, no campaign enrolments and no running/waiting n8n executions. Existing keys, production database and persisted provider/channel state were preserved.

- `scripts/app-service-cutover.mjs --apply` briefly placed only the new app in maintenance mode, paused the two originally active Acquire workflows, updated the runtime, validated authenticated database/research controls, switched the Worker and workflow callback origins, restored public routing and reactivated those same workflows. The unrelated accounting workflow was left unchanged. Do not rerun this one-off helper after cutover; normal app releases use `app-deploy.mjs`.
- The first settings update was rejected by Cloudflare with code 100402 because the existing `ProviderCoordinator` export declaration was omitted. App configuration and workflows were restored automatically. The retry included the existing SQLite Durable Object declaration, with no namespace creation, rename, deletion or database migration. The existing namespace ID and every non-origin binding definition were verified unchanged; compatibility date/flags, usage model, placement, logging, observability, tags and tail consumers were also preserved. Worker source code was not redeployed.
- Existing scheduler `kBiaIm7v9cK9Eoe6` now posts tick to the new origin. Existing sequence `0IQl0zTZ8GFXykNk` has both step URLs updated to the new origin; its webhook, node IDs, connections, timezone and saved sequence/version identity were retained. Both workflows are active. Three observed scheduled executions (`16842`, `16843`, `16844`) succeeded and each processed zero enrolments; no tick or send was forced manually.
- Protected database readiness and the authenticated control endpoint for an existing completed research job returned 200. Firmable hosted status returned 200, configured true and reconnectRequired false. Public liveness returned 200. Final running environment was inspected: research true, hybrid pipeline, n8n true, reply monitor observe and new app origin.
- The deployment image remains `acquire-app:5725d59-20261007-public` (built from base commit plus uncommitted deployment changes). No app-source change was needed to activate the service flags. Changes to the Worker origin and LinkedIn viewer policy are reflected in the worktree to prevent a later deployment restoring stale routing. No Git push or commit was made by this task; Vercel remains Git-disconnected and quota-paused.
- Rollback artefacts are private: `public-pre-cutover.env`, `n8n-cutover-before.json`, `research-worker-cutover-before.json`, `Caddyfile.pre-cutover` and `service-cutover-result.json` under `.local-data/app/`. Latest scheduler/HTTP/runtime evidence is retained there too. A release-image rollback alone does not restore external callbacks: coordinate origins/schedulers as described in sections 12–13. Returning to Vercel requires quota availability and deliberate restoration of callback origins; retain both OAuth redirects and the credential's two-domain allowlist.

No database migration or live outbound test message was performed. The initial activation error is resolved; the user's Run demo can now initiate research through the existing Cloudflare services with callbacks to DigitalOcean.

## Channel origin fix — 7 October 2026

The user reported “Invalid origin” when testing LinkedIn on the public app. The channel health, LinkedIn and WhatsApp mutation routes compared the browser's Origin header with `request.url`. The self-hosted Next.js server constructs that URL using its internal listening address, so a legitimate public HTTPS origin was rejected before reaching the channel service.

These routes now validate the browser Origin against the configured `APP_URL`, with no trust in caller-supplied Host or forwarded headers. Development retains a request-URL fallback; production fails closed without a configured app URL. Authentication and session-derived organisation/user ownership remain required.

Deployed image: `acquire-app:20261007-origin-fix`, manifest list `sha256:9471da7481b6cc515bd12509d96cdcf54a17f73e14526f2916b3a756f67c404a`. The manual deployment completed with container health and protected database readiness passing. Public liveness, protected readiness and sign-in each returned 200. Sixteen origin/channel route tests, TypeScript checking, targeted lint and the production Docker build passed. The user's authenticated browser connection test still needs retesting after refresh. No database migration, outbound message or channel-state change was performed by this fix.

### Other connection checks and regression coverage

The subsequent review found Gmail connect/callback redirects and protected-page sign-in redirects also resolved destinations against `request.url`. A live unauthenticated Gmail connect request reproduced `Location: https://0.0.0.0:3000/sign-in?next=/settings`. These app-owned redirects now use the configured public origin through the same helper, which rejects external redirect destinations. Google OAuth initiation/token exchange already uses the configured public callback; runtime app/callback values were verified correct. LinkedIn viewer WebSocket origin checking uses the viewer service's own public origin, as intended; the app domain remains allowed by its iframe policy. LinkedIn and WhatsApp authenticated service liveness checks both returned 200.

Existing channel tests exercised matching request URLs and Origin headers, so they did not represent the public-HTTPS/internal-container split. Added tests cover public-origin channel writes and health checks with internal request URLs, rejection of foreign/spoofed origins, safe app-owned redirects and Gmail connect/error callback redirects. Thirty-two relevant tests passed, together with TypeScript checking, targeted lint and the Docker production build.

Latest deployed image: `acquire-app:20261007-connection-redirect-fix`, manifest list `sha256:b75f09cfbc95311a04b868e34cde19087b1aeeb3281262c1a551386ea3a13841`. Deployment readiness passed. Live Gmail connect, invalid-state callback, `/settings` and `/mandates` redirects all retained `https://acquire.mlai.au`; public liveness, protected database readiness and sign-in returned 200. No user impersonation, actual Google consent/token exchange, outbound messaging or database migration was performed. Signed-in connection buttons/browser reopening remain user-browser verification steps.
