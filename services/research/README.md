# Standalone research service

This service packages Acquire's existing Cloudflare research workflows as one Node process with DBOS/PostgreSQL checkpoints and provider coordination. Acquire's authenticated callback API remains the integration boundary. The worker has no Acquire database credentials.

OrbStack and the dedicated DigitalOcean research test host now run the same pinned application images and provider/model settings from one release file and Compose definition. See [runtime/README.md](runtime/README.md) for operation, parity checks and matched tests. The local Acquire mirror is `https://acquire-research.orb.local/`; production `acquire.mlai.au` now reaches the DigitalOcean worker over the private VPC. Cloudflare continues to provide the existing company-data transport.

## Keep the service small

- One process serves the API and executes workflows; an advisory ownership lock rejects a second worker.
- A separate PostgreSQL container stores workflow checkpoints and coordinator state.
- Workflow source is bundled directly; it is not copied into a second implementation.
- OpenSERP and Crawl4AI are sidecars in the shared task network.
- The same callback adapter supports file-backed independent tests and the local Acquire bridge.

This remains Stage1. Stage2 provider execution still lives partly inside Acquire callbacks and has not been extracted. Multi-replica operation and in-flight crash recovery require their own verification. The reversible production endpoint cutover was verified with an app-backed canary; the additional app policy/UI changes on this branch remain a separate release. Completed-run persistence/idempotency was verified across a clean restart; this does not guarantee exactly-once external provider effects.

## Company enrichment policy

The local Acquire callback checks saved company-data profiles before planning public research. It uses both normalized values and retained raw fields, including zero headcounts, size/revenue bands and register associations. A reported NATA association satisfies a request for that association; it does not establish a certificate number, verified status, expiry or named contact. Contractor directory categories do not establish accreditation.

Public field research requests only missing company values. Team profiles, accreditations and accreditation contacts additionally require a relevant saved mandate criterion or an explicitly reviewed native request. Existing queued jobs recheck current data before execution without changing their saved field manifest. The extraction adapter also excludes provider-covered fields, including when another missing field requires a page read. Skipped fields are recorded as `already_available` or `not_required`, with no invented web observations.

This policy currently executes inside the Acquire callback boundary. It requires no worker image, database schema or production connection change. Historical failed jobs remain recorded; this change does not fix reader/search availability or increase people-research budgets.

## Complete the saved work

New ordinary company runs use `completionPolicy: work-items`. They have no overall 10/15-minute cancellation deadline or one-minute people-admission cutoff. Discovery keeps its declared source/request bounds, saves provider profiles first, and uses additional web discovery only when saved company coverage falls short of the requested target. The accepted company and contact queues drain independently of elapsed run time.

Each successful people check wakes its exact originating queue immediately. The existing periodic maintenance pass remains a recovery fallback. Cancellation and current ownership/identity checks still apply. Existing reviewed native-agent plans and their SQL funding authorizations retain their original semantics; this change does not bypass those approvals or reopen historical cancelled runs.

Company field callbacks use a shared 90-second attempt window, inside the existing callback/step timeouts. An unfinished attempt saves facts, unread URLs, search/read counters and identity evidence in the job's existing JSON, then continues after a durable wait. Completed pages are not fetched again. A checkpoint revision prevents a late callback from overwriting newer progress. Exhausting an explicit retrieval budget retains unfinished work and reports partial results instead of erasing the checkpoint. A successful final response crossing an attempt boundary is accepted.

An old timestamp triggers a worker-status check, not automatic failure. Running/waiting/queued workers retain ownership; an unavailable status endpoint leaves work intact. DBOS recovery resumes the same checkpoint history only for recoverable stopped states. Successful and permanently failed workflows are not automatically restarted. Individual provider requests retain timeouts, finite retrieval limits and rate-limit waits; no new queue service or database migration is introduced.

## Checks

```sh
npm ci --ignore-scripts
npm run build
npm test
npm run test:deployment
```

`npm test` covers workflow contracts, adapter/storage behavior, Australian provider scope and parity-report redaction. `test:deployment` requires Docker Compose and verifies both rendered environments use matching runtime settings and distinct existing database volumes. Neither applies SQL.

`node test-mandate.mjs` tests an already-running local file-backed test profile. It does not restart containers, change providers or copy environment credentials. Reports use the same acceptance checks as the hosted test, including source-supported company identity plus relevant business evidence. Search results, quotes and remaining URLs are retained in ignored private reports. A completed workflow alone does not pass; budget-limited research remains partial. See the runtime guide before switching from the active Acquire bridge to a test harness.

## Configuration and credentials

`runtime/release.env` is the shared public release definition. `deploy/compose.yml` is the canonical task. Update pins deliberately and deploy the same release to both environments; do not rebuild local implicitly during a test. The image build context excludes environment files and private/Wrangler state.

Local private profile: `.local/mirror/runtime.env`. Hosted private profile: `/opt/acquire-research/runtime.env`. Provider keys stay in ignored private files; model/provider choices come from the shared runtime. Local and hosted encryption/service/database secrets remain independent. Company-data searches are scoped to Australia. Existing local provider credentials are retained; connecting the hosted provider account remains separate from runtime parity.

The harness translates the local app's service secrets without forwarding browser session cookies or following redirects. Only the reviewed Acquire job/search/company-page/callback paths and loopback development origins are accepted. The local native worker owns scheduled maintenance; the bridge acknowledges background ticks without creating a second global scheduler. `node connect-isolated.mjs --mirror` validates the app/network/database identities and switches the callback mode only while workflows are idle, using the shared runtime.

## Database approval

No runtime or test command applies migrations. Both databases already have specifically approved schemas:

- Local `acquire_research_local`, marker `acquire-research-local-only`: `migrations/001-local-research.sql`, hash `cb825c573908fbf3ab6817b0d4160e9f43275df3a05ab4d130d051b23397c22f`.
- Dedicated hosted `acquire_research_do_test`, marker `acquire-research-do-test-only`: `deploy/001-digitalocean-test.sql`, hash `e17903b21c6c6a3dc67394e0369a1662874d3e15f4409fe5b1faf4a004a4d8fd`.

Applied files are immutable. Future migrations need specific approval for the exact target. DBOS automatic migrations remain disabled. Parity work reused the existing volumes and changed no Acquire schema.

## Test deployment and history

[deploy/README.md](deploy/README.md) records the dedicated DigitalOcean host and approved migration. [mirror/README.md](mirror/README.md) records local Acquire mirror setup and historical verification. Earlier search investigations remain in `docs/`; their historical backend selections are not the current release configuration.

The latest matched tests proved equal runtime/input fingerprints but different live search accessibility. Local OpenSERP encountered DuckDuckGo timeouts and Google CAPTCHA/rate limits; hosted OpenSERP completed the bounded test. Full financial fit, acquisition suitability, hosted Acquire persistence and outreach are outside that independent web-research test.
