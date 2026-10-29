# Shared OrbStack and DigitalOcean research runtime

`release.env` pins one worker image, one reader image plus reader source hash, one OpenSERP digest, PostgreSQL version, and the research model pair. `../deploy/compose.yml` is the single runtime definition. The root `compose.yml` links to it; the old independently configured overlays have been retired.

Both application runtimes use Linux amd64, OpenAI, Australian/English OpenSERP search (DuckDuckGo first, existing Google fallback), Crawl4AI and the Australian company-data scope. On Apple Silicon, the application containers run through emulation, so performance can differ. PostgreSQL keeps its native host architecture and existing data directory; its pinned version/configuration and reviewed schema are preserved.

Private profiles supply only the environment-specific project/database/volume, credentials, paths, callback mode and host UID. Existing local and hosted database identities remain distinct. The database volume is external: the runtime requires the already-approved volume and never runs a migration. Provider credential files contain keys, not model or search-engine overrides.

## Commands

From `services/research`, operate the local Acquire mirror:

```sh
export RESEARCH_RUNTIME_ENV="$PWD/.local/mirror/runtime.env"
export RESEARCH_RUNTIME_OVERRIDE="$PWD/runtime/compose.local.yml"
bash runtime/stack.sh ps
```

On the dedicated DigitalOcean host, from `/opt/acquire-research`:

```sh
bash runtime/stack.sh ps
```

Use `bash runtime/stack.sh up -d --wait --wait-timeout 120` to apply a prepared release. The wrapper refuses while DBOS work is pending/queued/delayed and stops the worker before Compose replaces its shared task network. Arrange a dispatch maintenance window first; callbacks can refill the queue even when the native scheduler is stopped. The wrapper does not cancel jobs, rewrite checkpoints or migrate data.

The local-only override retains PostgreSQL access at `127.0.0.1:5441`. Local worker/relay ports remain loopback18797/18798. The hosted production profile binds worker18797 only to its VPC address and permits only the app host; relay18798 remains loopback-only. Explicit production relay mode pins callbacks to `https://acquire.mlai.au`. See [cutover and rollback](../deploy/README.md).

## Verify running parity

From the worktree root:

```sh
node services/research/runtime/parity.mjs \
  --ssh-config services/research/.local/digitalocean/ssh-config \
  --output services/research/.local/mirror/parity-final-runtime.json
```

This is read-only. It checks actual container images, actual application architecture, reader source hash, provider/model configuration, database identity and health. Credentials and database URLs are excluded from the report. Omit `--ssh-config` to inspect only local. Matching fingerprints cover the application runtime; database identity, authentication secrets and callback destination intentionally remain separate.

## Repeat the mandate test

`node test-mandate.mjs` runs the shared smoke runner against an already-running local file-backed callback harness. Its default private profile is `.local/mirror/runtime-test.env`; live local Acquire normally uses `.local/mirror/runtime.env` in bridge mode. Switch only after draining work, using the same shared wrapper and explicit test profile. The test command never rebuilds, changes provider settings, copies credentials or restarts the bridge. `node connect-isolated.mjs --mirror` restores the verified Acquire callback adapter when work is idle.

The hosted smoke runner is `deploy/smoke.mjs`, with `RESEARCH_TEST_ENV` set to the hosted private profile and SSH forwards on loopback28797/28798. Both use the same mandate, budgets, dispatch/callback code and acceptance rules. Reports include the input hash and release pins.

Live search and model responses are external inputs and need not be identical. Use the runtime fingerprint and input hash to separate configuration drift from upstream behavior; unit/contract fixtures remain deterministic.

## Evidence, 27 October 2026

Both live runtimes passed with fingerprint `ef8e31c7fd0af2ddd6ae754db42f6e0320ad94f71ce1f3abad2b86f4054e60ae`. All three application containers run amd64; reader source hash and provider/models match. Existing database identities and credentials were retained; no migration was applied for parity.

The matched mandate/input/release tests differed upstream: local job `9582adc8` returned no pages after DuckDuckGo HTTP 504 parse timeouts and Google HTTP 429 CAPTCHA/rate limits; hosted job `1f84e604` read three pages, saved six supported findings and passed the bounded evidence checks. Both ended partial at their bounds or source limitation. This is runtime parity, not a claim that local live search currently works or that full research/production cutover is accepted.

Local bridge mode and its native worker were restored after the test. The temporary local refill drain was removed and its source restored byte-for-byte. Detailed private evidence: `.local/mirror/parity-handoff.json`, `parity-final-runtime.json`, both smoke reports and provider logs. Production Acquire routing was untouched.

## Reader patch release, 29 October 2026

The current reader pin includes MessagePack1.2.4. This exact image was released
to OrbStack and DigitalOcean after image tests and vulnerability scanning passed.
Full-page and main-content reads passed on both; the hosted full-page read was
made from the production app through its private worker connection. Runtime
fingerprints match at `ea213321fe2fea6b1003600592557de91ba3fffb33138f3fe855cc2f6bed088c`.
Workers, callback relays, app and communications containers were preserved. No
migration was run. This verifies the reader contract, not a new full research run.

For this reader-only release, canonical Compose was invoked with the appropriate
private profile and `up -d --no-deps --wait --wait-timeout 120 reader`. This keeps
the shared task network and workflow owner running. Full stack changes continue
to use the guarded wrapper above. Rollback restores the prior reader pin
`sha256:531c8b40780963a679fda315446fa42255b61f758c9401870e9daa83898e1eb4`
and repeats that reader-only command; the prior image is retained on both hosts.
Release pins record immutable Docker image IDs. These manually transferred
worker/reader images are not published to a registry; a fresh host needs the
verified image archives or a deliberate new build/release. Source is retained
in this repository; the built worker revision is
`15cf5bac69dcfeb140b3978edd2337f51987aae2f0500eef544583cb0d5af5cc`.
