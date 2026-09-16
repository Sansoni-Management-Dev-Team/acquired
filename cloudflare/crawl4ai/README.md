# Crawl4AI fallback reader

An authenticated Cloudflare Worker routes one-page reads to one on-demand Crawl4AI container. It sleeps after one idle minute, has at most one standard-3 instance (2 vCPUs, 8 GiB RAM), allows three isolated browser reads and returns 429 when busy. The research workflow uses it only after a primary reader failure or unusable content, within the existing page/time allowance. Public HTTPS targets only; private-address destinations and subrequests are rejected. No CAPTCHA solving, account login, or guessed contact information.

## Migration approval required before first deployment

`wrangler.jsonc` declares migration **crawl-reader-v1**, with `new_sqlite_classes: ["CrawlReader"]`. This registers a new SQLite-backed Durable Object class for the container. It does not modify the application's Postgres tables or existing research records.

The project AGENTS.md requires explicit approval for each database migration. **Do not run the first deployment until the user explicitly approves crawl-reader-v1.** Building the Docker image and checking the bundle do not apply this migration.

## After approval

1. `npm ci --prefix cloudflare/crawl4ai`
2. Verify Cloudflare authentication with `pnpm exec wrangler whoami`.
3. Set a generated `SERVICE_SECRET` for this worker via `wrangler secret put`, without logging it.
4. `pnpm exec wrangler deploy -c cloudflare/crawl4ai/wrangler.jsonc`
5. Wait for container provisioning, then smoke-test authenticated `/crawl` with a public company URL and confirm private IPs are rejected.
6. Configure `CRAWL4AI_URL` and `CRAWL4AI_SECRET` on `acquire-research` to the new service URL and matching secret. Wait for active research workflows to finish before deploying a changed workflow bundle.
7. Trigger a bounded research job on a URL where the primary reader fails and verify saved source evidence and unchanged allowances.

The primary research worker works without these optional secrets. Until they are set, blocked pages remain failed and retryable; no local laptop tunnel is used.

## Local checks

`pnpm dev` now builds and starts this reader automatically in OrbStack using
`compose.local.yml`, without deploying a Cloudflare container or applying its
Durable Object migration. It is the primary reader for local searches and all
research pages. Local compose allows three simultaneous reads; the Cloudflare deployment also allows three. See [local development](../../docs/27-local-research-and-ai.md).

Build: `docker build --platform linux/amd64 -t acquire-crawl4ai:test cloudflare/crawl4ai`

Run: `docker run --rm -p 127.0.0.1:18083:8080 acquire-crawl4ai:test`

Only bind locally for testing: the Python HTTP server trusts the authenticating Worker in production. POST `/crawl` with JSON `{ "url": "https://example.com/" }` returns `{url,markdown}`; GET `/health` returns readiness. The request limit is one page and 35 seconds, plus startup. No documents, cookies or local storage persist between requests; browser processes are reused.

## Hosted VM deployment (no database migration)

The VM route keeps Cloudflare Workflows as the orchestrator and uses this service
only after a primary read fails or returns unusable content. It does not expose
or depend on the developer laptop. The Cloudflare Container migration above is
not used by this route.

The reader keeps up to three browser processes warm. Each request gets a unique
session; its page and context are closed afterwards, so cookies and local storage
are not shared across research jobs. Damaged/timed-out browsers are discarded.
Same-domain reads are spaced by three seconds, with a 30-second cooldown after
an origin 429. Busy responses include `Retry-After`. The Worker preserves a
busy page for bounded continuation rather than marking its sources exhausted.
Persistent user profiles and interactive CAPTCHA handoff are not enabled.

Use a Linux VM with Docker Compose; start with at least 2 vCPUs and enough RAM
for the 4 GiB reader limit plus the OS and HTTPS proxy. Point a DNS hostname at
the VM and allow inbound TCP ports 80 and 443 for Caddy HTTPS. The reader port
is reachable only within the Compose network.

From this directory on the VM:

```sh
# .env.hosted must stay outside version control; create it with mode 600.
# Set READER_HOST=reader.your-domain.example and SERVICE_SECRET to a generated secret.
docker compose --env-file .env.hosted -f compose.hosted.yml up -d --build
curl --fail https://reader.your-domain.example/health
```

The service requires the configured bearer token for `/crawl`; `/health` is public.
Do not send the token over unencrypted public HTTP. Caddy manages TLS certificates
in its named volumes. Browser profiles are intentionally ephemeral; no database
is used. Keep the prior image available to roll back the reader independently.

Before activation, run the 30-URL benchmark against the hosted endpoint. Supply
`READER_BENCHMARK_SECRET` securely through the environment. The manifest is a
JSON array of public HTTPS URLs with one URL per domain:

```sh
python3 scripts/benchmark-crawl4ai.py \
  --urls scripts/reader-benchmark-urls.json \
  --endpoint https://reader.your-domain.example \
  --output .local-data/reader-benchmark-hosted.json
```

Run this from the repository root. The benchmark makes at most 30 page requests,
with no AI calls, searches, or database writes. Reports include quality checks,
latency, failures and short headings for inspection. They do not measure billing
or validate acquisition evidence. Record host billing alongside the report.
Compare with the local report before switching any primary reader.

After the hosted benchmark passes, configure `CRAWL4AI_URL` and `CRAWL4AI_SECRET`
on the research Worker using Wrangler secrets (never commit their values).
Deploy the research Worker after existing runs finish. The existing callback
contract and database schema remain unchanged. Roll back activation by removing
those optional settings; primary Cloudflare page reads continue as before.

Tests: `python3 -m unittest discover -s cloudflare/crawl4ai -p 'test_*.py'`.

## Prepared Cloudflare deployment

The selected Cloudflare configuration uses one `standard-3` instance, three
concurrent reads and a one-minute idle sleep. The Worker authenticates both
`/crawl` and `/health`; the benchmark sends its token to both. No separate VM,
Caddy service or custom DNS hostname is needed. Run the hosted benchmark on its
`workers.dev` URL before enabling it as the production fallback. Browser state
may be discarded on sleep, which is compatible with the isolated reader.
The first deployment remains gated on explicit approval of `crawl-reader-v1`.
