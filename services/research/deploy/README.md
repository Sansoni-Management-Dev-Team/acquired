# Dedicated DigitalOcean research deployment

Host `acquire-research-test-01` (droplet 613028271, Sydney) belongs to `project_acquire` and costs $24/month plus provider usage. Its original test names and initialized research database are retained when enabling production callbacks; promotion does not rename, restore or migrate a database.

This deployment and OrbStack use the same [shared release and runtime](../runtime/README.md): immutable amd64 worker/reader/search artifacts, fixed provider/model settings, reader source hash and one Compose task. PostgreSQL remains a separate container with its existing dedicated volume. Production uses the existing callback relay with an explicit production mode and the exact HTTPS upstream `https://acquire.mlai.au`. The worker keeps its loopback callback/network policy. Local mirror callbacks stay local.

## Reversible production configuration

The production app reaches `http://10.126.0.10:18797` over their shared VPC. The port binds only the research host's private address; its firewall admits only the app host at `10.126.0.13/32`. The relay port18798 remains loopback-only. No public DNS or research listener is required.

The app changes only `RESEARCH_WORKER_URL`. Preserve its existing research credential because the retained Cloudflare Firmable transport also uses it for native admission callbacks. `FIRMABLE_SERVICE_URL` and its separate credential remain unchanged. This promotes orchestration, web reading/search and People workflows; it does not retire Cloudflare's Firmable transport.

The explicit hosted profile uses `RESEARCH_DEPLOYMENT=digitalocean-production`, `RESEARCH_CALLBACK_MODE=acquire-production`, `RESEARCH_APP_ORIGIN=http://127.0.0.1:3100`, and a private callback env file. That relay accepts only the exact production HTTPS origin, authenticated known paths and fixed methods; it refuses redirects. Its production mode has no file-backed synthetic job endpoints.

The app host retains a surgical before/after configuration record and rollback command:

```sh
bash /opt/acquire-app/ops/app/releases/research-cutover-20261028/rollback.sh
```

Rollback restores the saved research settings and restarts the current app image under the existing deployment lock. It does not restore database data, migrate jobs or undo the independently necessary correlated-progress query fix. The configuration editor refuses unexpected settings and preserves unrelated raw values. Activation automatically restores the old settings if its checks fail.

This configuration-only switch retains the production app's existing research policies. The work-items completion and UI changes in the research worktree are a separate app release. No Acquire database migration is required for the endpoint switch or query fix.

From `/opt/acquire-research`:

```sh
bash runtime/stack.sh ps
bash runtime/stack.sh logs --tail 30 research
```

The wrapper reads `runtime/release.env`, private `runtime.env` and `deploy/compose.yml`. For a prepared release, use `bash runtime/stack.sh up -d --wait --wait-timeout 120`. It requires idle workflow state and stops the worker before replacing its task network. It never applies SQL. The root `compose.yml` links to the shared definition; use the wrapper so pins and the target profile are both loaded.

The cloud firewall allows SSH only from the deployment egress IP. Password login is disabled; the deployment key and pinned host identity are private under `.local/digitalocean`. PostgreSQL has no host port. Preserve the app-only VPC research rule when updating operator SSH access.

## Approved schema

On 27 October 2026, the user specifically approved `001-digitalocean-test.sql` for `acquire_research_do_test` on droplet 613028271. Reviewed SHA-256: `e17903b21c6c6a3dc67394e0369a1662874d3e15f4409fe5b1faf4a004a4d8fd`. Applied once after checking host metadata, hostname, SQL hash and exact database identity. Marker: `acquire-research-do-test-only`.

Do not edit/reapply it. Future migrations require separate specific approval. Runtime parity reused this schema/volume without a migration. DBOS automatic migrations remain disabled. PostgreSQL TCP keepalives 15/5/3 bound abandoned connections after a lost task network; clean worker-first stop order is verified.

## Historical matched smoke test before production promotion

Do not use the file-backed runner against a production callback profile. It explicitly refuses `digitalocean-production`. Use a separately scoped app-backed canary for production acceptance.

With SSH forwards on loopback28797/28798, from the worktree root:

```sh
RESEARCH_TEST_ENV=services/research/.local/digitalocean/runtime.env \
RESEARCH_TEST_REPORT=services/research/.local/digitalocean/parity-smoke-report.json \
node services/research/deploy/smoke.mjs
```

This submits the same bounded aged-care mandate and repeats dispatch to check admission idempotency. It does not change runtime configuration. Reports contain input hash, release pins, actual search results, source-supported findings and all acceptance checks. No Acquire database or production callback is connected.

Latest hosted job `1f84e604` read 3 pages, made 3 model calls and saved 6 supported findings, passing the bounded evidence checks. Research correctly remained partial at its page budget. The local matched job `9582adc8` hit DuckDuckGo HTTP 504/Google HTTP 429 upstream failures. Both actual application runtimes and test input hashes match; see the shared runtime guide and ignored parity reports. A passing bounded test does not establish financial fit, company-data/People coverage, full Acquire persistence or readiness for production cutover.

Earlier job `33a1fbfd` produced2supported findings and did not pass the stronger company-evidence check. Its completed-run record survived a clean restart, and repeated dispatch produced no extra pages/model calls or callback changes. This establishes completed-run persistence/idempotency, not in-flight crash recovery or exactly-once external effects.
