# Crawl4AI fallback reader

An authenticated Cloudflare Worker routes one-page reads to one on-demand Crawl4AI container. It sleeps after one idle minute, has at most one 4 GiB instance, serialises browser work and returns 429 when busy. The research workflow uses it only after a primary reader failure or unusable content, within the existing page/time allowance. Public HTTPS targets only; private-address destinations and subrequests are rejected. No CAPTCHA solving, account login, or guessed contact information.

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

Build: `docker build --platform linux/amd64 -t acquire-crawl4ai:test cloudflare/crawl4ai`

Run: `docker run --rm -p 127.0.0.1:18083:8080 acquire-crawl4ai:test`

Only bind locally for testing: the Python HTTP server trusts the authenticating Worker in production. POST `/crawl` with JSON `{ "url": "https://example.com/" }` returns `{url,markdown}`; GET `/health` returns readiness. The request limit is one page and 35 seconds, plus startup. No documents or browser state persist between requests.
