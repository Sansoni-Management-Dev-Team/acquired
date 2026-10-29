# Local Acquire mirror for research integration

Worktree: `project-acquire-research-service`, branch `codex/standalone-research-service`.
App URL: `https://acquire-research.orb.local`; direct HTTP port `3032`.
Database: independent PostgreSQL container `acquire-research-app-db`, port `5442`, volume `acquire-research-app_database`.

This mirrors the app code, application database, facts database and simulator behind `acquire-isolated.orb.local`. It uses separate writable volumes and simulator state. App and simulator database URLs point inside the new network namespace. The facts-port alias forwards only to this same new PostgreSQL server. The existing source containers and databases are not reconfigured.

The app's existing research callback API is retained. The mirror's environment directs research and Firmable traffic through the local bridge on host port `18798`, which forwards callbacks to mirror port `3032`. No Acquire application code or application schema change is needed. The research service keeps its separate database on port `5441`. Only one callback target can own that research service at a time; the connection script refuses to switch while workflows are active.


## Online — 27 October 2026

Use **https://acquire-research.orb.local/** and sign in with
`callumpholt@gmail.com` and the same password as the isolated instance.
The password hash matches the source account. Authenticated browser access was
verified with a copied, still-valid Callum session; a password form submission
was not performed. The existing12 saved mandates loaded in its active workspace.

The specifically approved snapshot package has been applied to the new cluster
(system ID `7701165885598298145`). All103 application and62 facts public-table
counts matched the archived snapshot before activation. The source contained two
historical acknowledgement rows without journal parents. The first conventional
restore failed on that FK; recovery rebuilt only the newly created mirror's
unused application database, restoring schema first and data with the standard
`--disable-triggers` import option. Both rows and the original validated FK
metadata were preserved; original databases were not repaired or changed. The
archives/approved manifest stayed immutable. This is a copy of existing state,
not a new application-schema migration.

The app uses the source's verified matching Next16.4.1 dependency volume read-only
and its pinned container image, with its own writable Next volume. The copied
simulator uses its own profile and genuinely re-pinned database/runtime hashes.
The standard native driver now owns both native ticks and scheduled research
maintenance in the mirror. Original services were not reconfigured.

Firmable was connected using a read-only copy of the previously configured
local worker's encrypted credentials, decrypted privately and validated through
the new service's normal reconnect endpoint. The research service uses its own
new encryption key/state. No browser credential renewal or production reconnect
was performed. AU filtering remains enabled. Protected app readiness and the
worker, reader and search health checks pass; workspace, reply alerts, channel
connections and research settings return200.

Normal authenticated app research was started on a separate copy of the aged-care
brief, test mandate `1eefdcb2-d5bb-4e44-87a1-e486c4c13389`, root
`3656182a-9d39-4faa-9e1b-fd49167b9375`. It exercised app→bridge→Node research
worker→app callbacks, live Firmable/web discovery and canonical persistence.
Seventeen company findings/results were saved and displayed in the actual
Companies UI. The test was explicitly cancelled through the normal app action
once transport/persistence were proven; its root is cancelled and active=false.
It did not establish a successful complete research run, People enrichment,
financial qualification or mandate relevance. The existing discovery quality
problem remains: unrelated web sources and out-of-brief companies appeared;
the browser correctly displayed missing evidence/exclusions. A targetBusinesses=1
custom automatic request also did not cap the legacy hybrid profile loop at one;
the external smoke stop bounded the test. No claim of that cap is made.

A copied JSON environment parsing defect found during startup was fixed: nested
keyrings and simulator settings now preserve escaped JSON values and every
local nested database URL points to the mirror. Reply-alert recovery returned200.
Final verification:34 standalone tests,20 native-driver tests, service bundles,
Compose validation, browser rendering and an actual persisted research run.
Evidence stays ignored under `.local/mirror/`; the browser capture is
`output/playwright/research-mirror/companies.png` relative to the repo.
No live outreach or production deployment was performed. This provides an online
integration environment, not whole-product acceptance certification.

## Preparation history — 26 October 2026

- Branch fast-forwarded to source app commit `12bbd0044bf61317f3f194c625aa72cc7546ef13`; existing local Firmable country change preserved.
- Read-only snapshots prepared: application database (103 public tables) and separate facts database (62 public tables). Counts were captured inside each exported snapshot. These are separate per-database snapshots, not a global cross-database/simulator transaction.
- Snapshot archives passed `pg_restore --list`; no foreign server, publication or subscription entries were found.
- `callumpholt@gmail.com` exists with a credential password hash. Restoring preserves the existing password; no reset is performed. Browser password login has not been tested.
- Private app/simulator configuration and a separate simulator profile are prepared. The simulator retains its database identity checks: private module/runtime copies must be pinned to the verified new server identity after restoration, with a new reviewed runtime hash.
- Bridge test-first regressions passed: explicit mirror origin pairing and separate Firmable authentication. Full local service suite: 34 passing. Service bundles and research container image build successfully.
- **Not started:** database creation/restore, app/simulator activation, browser login verification and a real mirror-to-research job. Specific restore approval is pending.
- The original Firmable transport currently reports configured with no reconnect required. The standalone Node transport remains unconfigured; its live Firmable credentials must be connected and verified before calling hybrid discovery functional.

## Private restore package

Artifacts, credentials, snapshot dumps, simulator profile and evidence stay under ignored `../.local/mirror/`; none belong in source control. Source environment values are copied privately, and the clone database password is newly generated. Historical messages, bindings, approvals and recorded outcomes are preserved rather than rewritten.

Frozen manifest: `.local/mirror/restore-manifest.json` (relative to `services/research`).
SHA-256: `4b0c68bcfef7c70277c3edd3de7a46c069cc7815dd6204b338149645abef536a`.
The package contains two dumps, reviewed role statements and three database-marker comments. Approval applies only to restoring this package into the new port-5442 container/volume. The standing port-5437 approval in AGENTS.md does not cover this database.

After explicit approval for that exact package, from the repository root:

```sh
node services/research/mirror/restore.mjs --approved-manifest-sha256=4b0c68bcfef7c70277c3edd3de7a46c069cc7815dd6204b338149645abef536a
node services/research/mirror/pin-simulator.mjs
node services/research/mirror/start.mjs
```

The restore refuses a nonempty application database, an existing facts database, changed archive hashes, incorrect container/volume or a source server identity. It verifies every public table count and records separate application evidence. It never runs the application's migration runner. Do not retry a partially failed restore blindly; inspect its private log first.

`start.mjs` requires restore evidence and matching simulator pins. It starts the app/simulator, connects the research bridge, then starts the native background worker. Simulator replies can use the copied model configuration. External communication sending is not enabled by this mirror setup. Browser login, database persistence, provider readiness, both callback directions and one bounded normal app research job remain required acceptance checks.

To stop the mirror without deleting its database:

```sh
docker compose --env-file services/research/.local/mirror/compose.env -f services/research/mirror/compose.yml -f services/research/mirror/compose.runtime.yml stop
```

The independent research service is managed separately. Stopping the app mirror does not delete or reset its research workflows. No destructive cleanup command is provided.

## Source sync — 27 October 2026

Merged the current local `main` by fast-forward to
`de4711f14abbb25e0d4f26ab1191211549011b85`. Preserved the standalone service,
Firmable AU behavior and mirror configuration. Both upstream and local progress
entries were retained. Re-ran all34 service tests and the bundle build: passed.
The existing snapshot package remains immutable and unapplied; its manifest
records its original snapshot commit. No database or running service changed.
The shared app dependency volume/image must be checked against the newly merged
package/lockfile before mirror activation; this merge does not certify runtime
parity or login.

## Research progress, ABNs and Fit — 27 October 2026

The user-requested screen changes are live only in this research-service
worktree/mirror. Overall completion now requires all linked company, People and
company-detail work to settle successfully. Retained results remain available
while work runs. Queued/running/incomplete counts and contact-admission work
that was never attempted stay visible; terminal partial/failed/cancelled work
cannot become a green overall completion. Company-detail work has an independent
budget on dispatch, so its queue remains pending after the contact deadline.

The ABN row is now “Finding ABNs”. Provider-reported ABNs count as available,
with source counts shown. Firmable values take precedence over fallback
identifiers in company read models (including historical retained provider
fields without a raw response). Invalid ABNs still fail normalization. Registry
matches are counted as fallback evidence, with one count per company identity.
Existing accepted observations and Firmable ABN data are used; no data migration,
SQL backfill or fresh registry verification is needed to display them.

The Companies Fit cell shows the existing weighted mandate-rubric percentage,
including for provisionally sourced or excluded companies. Evidence coverage is
not shown as the Fit value. Missing evidence and exclusion reasons remain in the
Reason for fit cell. A company with outstanding company-data research shows an
accessible loading circle instead of a premature score; People-only work does
not block company fit. Finished research with gaps displays the available score
and an explicit incomplete-evidence reason. No comparable evidence retains a
Not assessed state rather than inventing a zero. The existing rubric is retained:
requirements have double preference weight, potential/estimated evidence earns
half credit, and unknown criteria do not count as assessed evidence. Completion
and percentage changes do not grant qualification or outreach authority.

Compact list revisions include projection version and deadline transitions, and
polling remains active for independently queued company details. This prevents
stale loading states or a score appearing before queued data returns.

A missing app-side loopback reader connection surfaced during the user's run.
`reader-alias` now forwards the app's port18083 `/crawl` requests through the
existing authenticated bridge `/company-page` route to the dedicated research
reader. It publishes no additional host port and starts no second crawler. A
real app-namespace read of `https://www.iana.org/help/example-domains` returned200,
6,825 HTML characters and `only_main_content=false`. A separate example.com probe
returned an upstream503; site/provider failures remain genuine incomplete work.
The alias was added while background jobs were continuing, after the contact
admission deadline; existing failed/partial results were retained, and no root
restart or bulk retry was performed. Later queued work can use the repaired path.

Evidence under `.local/mirror/`: test-first progress/Fit/ABN/polling failures,
passing focused suites, reader probes, typecheck and lint logs. Browser captures
under `output/playwright/research-mirror/`: `fit-updated.png` and
`progress-updated.png`. Live browser inspection showed numerical scores and16
waiting indicators on the first25 company rows, plus195 Firmable ABNs and121
contacts with158 contact-company admissions unattempted in the user run
`6b86728e-b44b-42fa-b8f4-8d64ec5cf5ad`. Counts are dated observations. Background
company details remain a real backlog; these UI changes do not complete or replay
that unfinished research. No database migration or production deployment occurred.

### Saved brief and progress follow-up (27 October 2026)

Fixed missing `responsibility:null` in existing-thread execution responses; the strict client now accepts the saved brief without weakening supervision or outreach checks. Verified the exact c444 endpoint and opened Review brief in an authenticated browser. The saved text and preferences rendered successfully.

Visible provider branding is neutral in progress, legacy messages, proposal details, identity review, paused-service notices and technical source labels. The live progress page shows `from company data`; stored IDs, provider contracts and provenance are preserved.

The agent initial-research projection now waits for its own correlated company-detail children and preserves partial/unattempted outcomes. Live c444 agent endpoints show `extracting` while detail jobs remain queued; company and saved-people counts are retained. The separate bounded tails ended without stopping application jobs; handoffs remain in ignored `.local/tails` directories.

The reader429 category/retry-delay fix and Australian web-search settings are bundled in the separate DigitalOcean test deployment. The active local research worker has not been restarted to apply those worker changes while its long-running detail backlog remains active. Its older process can still exhibit the diagnosed reader429 flattening and search timeouts. Do not interpret source changes as local runtime release or retry historical failures automatically. Local app UI/response fixes are live through HMR.

### Shared runtime parity released locally (27 October 2026)

The historical launch/overlay commands above are superseded by `../runtime/README.md`. Local and hosted research now use one `deploy/compose.yml` plus `runtime/release.env`; the root Compose file links to that definition. The independently configured mandate/isolated overlays were retired, and the connection/test helpers no longer rebuild or choose providers independently.

Live inspection verified identical application runtime fingerprints, including amd64 worker/reader/search artifacts, reader source hash, models/providers and healthy dedicated DB identities. Private environment credentials, DB names/volumes, paths and callback transport remain distinct. Local PostgreSQL retains its native architecture and existing approved volume. No migration or Acquire schema change occurred.

The local native scheduler was paused, callback-driven refills were temporarily drained, and current workflows finished before upgrade. The temporary drain source was restored byte-for-byte. The normal local Acquire callback bridge and native scheduler are running again; authenticated transport was verified from inside the app. Historical partials were not replayed.

Matched mandate tests used equal input hashes/releases: local `9582adc8` produced 0 pages after DuckDuckGo parse timeouts and Google CAPTCHA/rate limits; hosted `1f84e604` produced 3 pages / 6 supported findings and passed the bounded evidence check. This identifies an upstream access difference after runtime drift was removed. It does not claim local live search works. Private handoff: `.local/mirror/parity-handoff.json`; audit: `parity-final-runtime.json`. `acquire.mlai.au` was not changed or connected to DigitalOcean research.
