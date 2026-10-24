# Dedicated DigitalOcean app host

This deployment runs alongside the existing Vercel configuration. It does not
apply database migrations or configure external schedulers, DNS or OAuth.
See [the deployment and cutover plan](../../docs/37-digitalocean-app-deployment-plan.md)
for the remaining integration gates.

## Build and deploy

Build off-server. Docker must support `linux/amd64`; the image uses Node
22.23.1 and pnpm 11.8.0. Only the manufacturing index is included from local
data. Production secrets are supplied at runtime, never as build arguments.

```sh
node scripts/app-image-build.mjs https://acquire.mlai.au acquire-app:<release-tag>
node scripts/app-environment.mjs /restricted/runtime.json /restricted/runtime.env
node scripts/app-deploy.mjs acquire-app:<release-tag> /restricted/runtime.env
```

The hostname above was approved and is now active. Both runtime URL
variables must match the image's exact origin. Environment values use Compose's
raw format, without shell quoting; the serializer encodes the database PEM
certificate as `DATABASE_SSL_CA_BASE64`. Existing auth and encryption keys must
be preserved. Keep actual environment files and deployment records out of Git.

The deploy command targets only the pinned host recorded in
`.local-data/app/digitalocean-deployment.json`, checks the SSH host key, transfers
the image and restricted environment, and waits for container health and an
authenticated database-readiness check. It stops the app on a failed first
deployment or restores the previous image and environment after a failed update.
Manual deployments remain available through these commands. GitHub also runs
`.github/workflows/digitalocean.yml` after pushes/PR merges into `main`, or through
its **Run workflow** button on `main`. PRs run build checks on GitHub-hosted
runners, but PR branches are not deployed and do not use the production runner.

GitHub's Ubuntu runner runs deployment regressions and builds both the app and communications Linux images. It uploads an image artifact retained for three days. The dedicated
`acquire-app-01-deploy` runner on the Droplet downloads that run's artifact and
checks both databases read-only and executes `scripts/communications-deploy-host.sh` before `scripts/app-deploy-host.sh`. Images use the exact commit SHA; the
downloaded archive SHA-256 and image revision label are checked before rollout.
This avoids comparing Docker engine-specific image IDs. No app
secret, DigitalOcean token or SSH private key is stored in GitHub for this flow.

The `digitalocean-production` environment permits only `main`. Releases are
serialized and use an on-host lock shared with manual deployment. Runtime secrets
stay in the existing server `.env.hosted`; readiness and public OAuth/sign-in
redirect checks trigger image/compose rollback on failure. There are no automatic database migrations, database initialization or Cloudflare Worker deployments. The communications service requires a separately initialized production database and private runtime configuration; a missing prerequisite stops the release before the app changes. See [the production migration review](../../docs/communications/production-migration-review.md) and [service packaging](../communications/production/service/README.md). Older CI images are removed after a
successful release, retaining the current and previous images. Provider data and
channel sessions are preserved.

The runner is a systemd service named
`actions.runner.callumholt-project-acquire.acquire-app-01-deploy.service` under
`/opt/acquire-actions-runner`. It connects outbound to GitHub; the SSH firewall
does not need GitHub runner IPs. Keep this repository private and limit workflow
writes to trusted maintainers: its deploy runner has Docker administration.
For troubleshooting, inspect the GitHub Actions run and `systemctl status` for
that service. To pause automatic deployment, disable the workflow in GitHub;
manual deployment remains available. A build failure leaves the live app alone.

Browser-origin checks and app-owned redirects must use the configured public
`APP_URL`. Self-hosted Next.js request URLs can contain the container's internal
listening address. Channel origin checks and Gmail/sign-in redirects use
`src/lib/request-origin.ts`; do not replace these with request-URL or forwarded
header comparisons. Check Gmail connect and failed callback redirects on the
public host after releases, as well as signed-in channel connection controls.

The container publishes only `127.0.0.1:18098`, uses a 1400 MiB memory limit,
90-second shutdown grace, non-root user, bounded logs and a persistent cache.
An app release rollback never restores or changes database data.

## Initial private verification (historical)

The initial deployment used `http://localhost:3014` and disabled research/n8n. It has been replaced by the public-origin image. The following tunnel procedure applies only if deliberately restoring that private image; it is not the active public login URL.
Use a tunnel with matching local origin, after stopping any local app on 3014:

```sh
ssh -i .local-data/app/deploy_ed25519 \
  -o UserKnownHostsFile=.local-data/app/known_hosts \
  -o StrictHostKeyChecking=yes -o HostKeyAlgorithms=ssh-ed25519 \
  -L 3014:127.0.0.1:18098 acquire@134.199.155.67
```

Visit `http://localhost:3014/sign-in`. This private instance uses the existing
production database; user actions can change real data. OAuth is not ready for
this private origin, and live provider/scheduler credentials are not installed.
The public Caddy endpoint now serves the approved HTTPS hostname. Research and n8n are now enabled on the public deployment; both Google redirects passed registration checks. The private diagnostic environment remains disabled.

## Langfuse tracing pause

Langfuse tracing was disabled at the user's request on 23 October 2026 to
preserve the free-tier allowance. Keep `LANGFUSE_ENABLED=false` and
`LANGFUSE_TRACING_ENABLED=false` in the existing on-host `.env.hosted` across
releases. Preserve the private credentials. Re-enabling requires a deliberate
operator configuration change and app restart; ordinary releases should retain
the pause.

## Server operations

Use the same SSH key and pinned-host options for all server commands. On-host:

```sh
cd /opt/acquire-app/ops/app
docker compose -f compose.hosted.yml ps
docker stats --no-stream
docker compose -f compose.hosted.yml logs --tail 100 app
df -h /
```

Treat logs as potentially sensitive. Do not print environment files or run
`docker inspect` in a shared transcript: it can display runtime secrets.
Liveness is `/api/health`; readiness is `/api/health/ready` with the operator's
bearer secret. The readiness secret is not a browser/public API credential.

After a successful update, `releases/previous-image.env` and
`releases/previous-runtime.env` hold the prior configuration. To restore it:

```sh
cp releases/previous-image.env .env
cp releases/previous-runtime.env .env.hosted
docker compose -f compose.hosted.yml up -d --wait --wait-timeout 120
docker compose -f compose.hosted.yml exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready',{headers:{Authorization:'Bearer '+process.env.APP_READINESS_SECRET}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

Do not prune the current or previous image. Review disk usage before removing
older images. CPU/memory/disk alerts notify the verified DigitalOcean account email after 10 minutes above 90%/90%/85%; external uptime monitoring is pending. Droplet backups are currently off; Supabase recovery is separate.
SSH firewall access is restricted to the recorded operator IP. If that changes,
update the dedicated firewall through DigitalOcean before connecting, retaining
the SSH host-key check. The deployment SSH key grants Docker/sudo administration;
protect and back it up securely.

## Public routing and Vercel fallback

Caddy is installed with the approved `acquire.mlai.au` hostname and valid HTTPS. For replacement hosts, install the template `Caddyfile` after DNS readiness.
Set `APP_DOMAIN` for the Caddy service or replace the template variable with the
approved hostname. Validate before reload and verify real HTTPS, redirects,
streaming, login and callbacks. Rebuild the image for the public origin first.

The active runtime uses `RESEARCH_ENABLED=true`, `RESEARCH_PIPELINE_DESIGN=hybrid-firmable-v1`, `CAMPAIGN_N8N_ENABLED=true` and `CAMPAIGN_REPLY_MONITOR_MODE=observe`. Research Worker callbacks and the two original Acquire n8n workflows target `https://acquire.mlai.au`. The one-off `app-service-cutover.mjs` helper has completed; do not rerun it for routine releases. Keep external callback configuration aligned when restoring a different host.

Vercel's Git repository is disconnected and `git.deploymentEnabled` is false.
Its existing project and environment are retained. To return, first verify quota
availability, deploy a compatible release deliberately, restore callback routing
and ensure only one scheduler dispatches. Reconnect Git and remove/change the
override only when automatic Vercel deployment is intended. A powered-off
Droplet still incurs charges; deletion is a separate decision.

## Historical campaign reply enforcement rollout

The reader-specific instructions below describe the retired direct LinkedIn stack. Current campaign delivery and reply coverage use the communications service. Preserve historical holds and attempts; do not redeploy the retired reader as part of a current release.

Both deployment paths run the packaged `campaign-readiness.mjs` after database
health and roll back when enforcement readiness fails. The owner-scoped
`GET /api/internal/campaigns/readiness?organizationId=...&userId=...` requires the
existing `OUTREACH_WORKER_SECRET` bearer credential and returns uncached results.
`enforceReady` requires every active enrolment to have scoped fresh coverage or
an explicit `reply_monitor_wait` state. `recoveryReady` additionally requires
fresh coverage, both hosted LinkedIn delivery switches and no unresolved or
already-sent current attempt. Process/DB health alone does not authorize sending.

Deploy the LinkedIn reader before the app: its `/settings` response now exposes
`campaignsEnabled`, and `/replies` distinguishes scan progress, completed coverage,
rate waits and scope invalidation. Preserve the encrypted volume and key. Keep
both live-delivery switches disabled during rollout. No migration is required.
Align the hosted n8n tick request timeout with the checked-in 120-second setting;
the incident workflow still used 30 seconds. This bounds the caller's wait and
does not increase reader capacity or replace the app's work budget.

The reader performs one requested sweep at a time. Maintenance requests use
`refresh=false` and a 15-minute cadence; accounts with actions due within five
minutes are prioritized and request an earlier sweep. Send preflights can request
refresh after two minutes. Four-folder empty-inbox maintenance uses 16 requests
per hour. Larger inboxes can need more pages. The existing hourly/daily quotas,
20–40-second page spacing and five-minute coverage expiry are unchanged; backlog
or exhausted capacity leaves sends waiting. This does not guarantee that every
due action fits the current account budget.

Reply pages preserve the outreach timer. An eligible queued action refreshes an
expired relationship check without restarting its completed spacing wait. The
read and send each consume capacity, and dispatch rechecks quotas and cooldowns.
Changed recipient identities require review. Existing connections and verified
outgoing pending invitations resolve connection-request steps as skipped.

Recover old `reply_check_failed` enrolments using the existing authenticated
`retry_preflight` action, never a bulk unconditional SQL update. It replays replies,
checks current contacts and canonical/shared holds, scans the required scope,
checks delivery switches, rejects unresolved/sent attempts, and rechecks coverage
under the recovery transaction lock. It preserves the pinned version and current
step. Unknown results, ambiguous identities and human review holds remain held.

Incident and local validation evidence lives in the ignored
`.local-data/campaign-reply-fix/` directory. Subsequent live profile checks found
outgoing pending invitations for all five original incident profiles; those
existing invitations are not evidence that this local test sent them. Recovery
must revalidate their current relationships and resolve verified pending requests
as skipped, rather than create replacement requests. One separately authorized
new-profile test confirmed actual n8n submission, a provider invitation receipt,
completion and duplicate protection. Temporary local limits and sending hours
were restored afterward; production was not changed.

Do not increase production limits or extend coverage expiry as part of this fix.
No migration is required. The separate prepared RLS parity SQL remains unapplied
and still needs approval for that specific migration.
