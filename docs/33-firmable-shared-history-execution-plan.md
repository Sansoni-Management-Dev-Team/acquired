# Firmable shared history: execution plan

Status: implemented and deployed to production on 17 September 2026. Migrations `0006_firmable_history` and `0007_firmable_concurrency_guards`, plus the idempotent legacy backfill, were explicitly approved and applied to local OrbStack and then to production Supabase project `njasjqpztiteionfxxul`. Vercel production deployment `dpl_GXrNAFrK7U95kpPHcTCmrFXzNEpr` and Cloudflare Worker version `d8e6b442-62e4-4220-bd12-6749d393bdab` are live.

## 1. Agreed product contract

- Implement on local `main` first. Preserve existing uncommitted work. Production deployment is a separate operation.
- Store provider data globally across organisations. Credential/account partitioning is deferred.
- Stored data does not expire. No TTL, stale-age policy or `expires_at` field.
- Every normal company view automatically displays previously acquired Firmable data, including people, without a button click or provider call.
- **Find more company data** always requests a new company profile, all people-search pages and every returned person profile. Existing stored data does not skip those calls.
- Preserve every observed Firmable response, including unchanged responses from separate calls and failed attempts. Display the newest validated successful responses.
- A failed refresh preserves the last usable data. A partial refresh exposes successful new data and falls back per failed component.
- Backfill existing embedded Firmable payloads. Preserve original embedded data during initial rollout.
- Organisation-specific assessments, notes, suppressions, drafts, approvals and outreach state remain private and unchanged by shared refreshes.
- Follow TDD, real PostgreSQL integration tests and browser smoke tests before handing off.

The user explicitly approved `drizzle/0006_firmable_history.sql` and `drizzle/0007_firmable_concurrency_guards.sql` first for local OrbStack and later for production Supabase. Those approvals have been consumed for those targets. AGENTS.md still forbids applying either migration, or any future migration, to another database without explicit approval for the concrete migration and destination.

### Current checkpoint

- Implemented shared company/person identities, immutable response/attempt history, sync runs, relationship reconciliation, cached read projections and legacy backfill.
- Forced refresh now persists queued runs before returning HTTP 202 and dispatches a named `FirmableRefresh` workflow in the existing Cloudflare runtime. Authenticated Next callbacks execute one company request, one people-search page, or one five-profile batch at a time; successful stored steps are replay-safe and the UI reads progress on its existing workspace polling cycle after reload.
- The remediation pass adds database-enforced single-active-run and contact uniqueness, company-global people generations, guarded terminal/progress writes, bounded pagination and callbacks, queued/stale-run recovery, failure fallback, newest-shared-data overlays, status preservation, and request-order protection in the UI.
- Local live smoke: A&J produced one successful company response, one successful complete search, and 29 profile attempts (27 successful, two failed). The UI retained all 29 candidates and correctly reported a partial run.
- Local deterministic durable smoke after the remediation pass: two separate button clicks each completed one company response, one search page and two profiles through the real local Worker runtime. PostgreSQL retained two runs, two company observations, two search observations and four person observations while idempotently retaining two contacts. The UI rendered the refreshed company and both saved people in the table and review panel; reload preserved the data and the original `identified` workflow status. Before cleanup, the only browser console error was the pre-existing missing development favicon (HTTP 404); deleting the signed-in smoke user while the page was still polling then produced expected 401s. The exact labelled smoke tenant, user, targets, runs, histories and unreferenced fixture identities were removed afterwards.
- Local backfill result after migration: 25 shared companies, one genuine legacy company response, 32 shared people, 32 company/person relationships, 36 linked targets and 32 linked contacts. No complete person payloads were fabricated from normalized legacy fields.
- The backfill was repeated inside a rollback-only transaction and table counts were unchanged.
- Final automated evidence: 112 test files passed and six were skipped; 642 tests passed and 16 were skipped. The dedicated PostgreSQL suite passed 10 tests, the workflow suite passed 13 tests, and the coordinator suite passed its one test. Typecheck, lint, production build and `git diff --check` passed.
- Production migration verification: eight migrations are recorded; 25 companies, one legacy company response, 32 people, 32 company/person relationships, 36 targets and 32 contacts were backfilled. Both partial unique indexes and the company people-generation column are present.
- Production E2E: a newly created organisation imported the A&J domain and immediately received shared company data without a Firmable call. A manual refresh then completed through Vercel, Cloudflare and Supabase in 44 seconds with one company response, one complete 29-person search and 29/29 successful person profiles. The UI updated its table and open contact panel, retained `identified`, showed all 29 contacts, and persisted after reload. History increased rather than being overwritten; duplicate contacts remained zero. The browser console and Vercel error log were clean. The labelled tenant was removed while the new global response history was retained.

## 2. Corrections to the earlier plan

1. A current people list comes from a **complete paginated search**, not the newest individual page. Partial pagination must never remove prior company/person relationships.
2. Response hashes are not unique for live captures. Two identical live responses are two historical observations. Only a replay of the same recorded attempt or the same legacy import is deduplicated.
3. Page loads must remain read-only. Resolve shared data at read time; persist links on explicit writes and during backfill. Do not create contacts from GET requests.
4. Both server-rendered pages and API reads need the same projection layer. Updating only the mandate API would leave initial rendering and outreach inconsistent.
5. `maxDuration = 300` does not make a 20-company/all-people operation reliable. Refreshes need persisted progress and bounded, resumable execution.
6. Normalized contact fields are not complete provider responses. Backfill must distinguish genuine raw payloads from incomplete legacy projections.
7. Null or empty values in a new valid profile can mean data was removed. Do not merge old non-null values into a successful new snapshot indiscriminately; fallback is for failed/missing snapshots.
8. Schema validity matters as well as HTTP status: HTTP 200 with `success:false`, malformed JSON or an invalid profile is not a usable snapshot.

## 3. Repository baseline and files to trace

Read AGENTS.md and the relevant installed Next.js docs before application edits. Recheck branch, status and migration journal at execution time.

The working tree already contains the earlier company-and-people button implementation. Build on it; do not reset it:

| Area | Existing paths | Required change |
| --- | --- | --- |
| Provider | `src/adapters/firmable-client.ts`, `source-contracts.ts`, `provider-mode.ts` | Capture each request attempt, separate raw parsing from normalized projection, explicit refresh mode |
| People batches | `src/adapters/firmable-people-sync.ts` | Persist pagination/progress; recover individual failures; expose incomplete search explicitly |
| Company mapping | `src/adapters/firmable-mapper.ts`, `src/db/target-record-mapper.ts` | Preserve original retrieval timestamps and map shared responses without modifying workflow fields |
| Company reads | `src/db/repositories.ts`, `src/db/acquisition-repository.ts` | Batched shared-data lookup and projection |
| Contact writes | `src/db/firmable-contacts.ts` | Reference shared identity; idempotent organisation-specific materialization |
| Mandate reads/writes | `src/app/api/mandates/[id]/route.ts`, `src/app/mandates/[id]/page.tsx` | Shared read model and refresh-job submission/status |
| Detail page | `src/app/mandates/[id]/targets/[targetId]/page.tsx` | Same projected company data as list/API |
| Contact endpoints | `src/app/api/targets/[id]/contact-candidates/route.ts`, `contact/route.ts` | Stored candidate reads and shared-person selection/materialization |
| Outreach | `src/db/outreach-view.ts`, outreach drafts/approval routes | Stored candidates visible before materialization; review freshness without silently changing approved messages |
| UI | `src/components/mandate-workspace.tsx`, `company-review-panel.tsx`, outreach components | Stored display, asynchronous refresh progress, partial/failure notices |
| Persistence | `src/db/schema.ts`, `drizzle/`, new Firmable repository and backfill modules | Additive tables, indexes, relationships and immutable history |
| Runtime | `cloudflare/research/index.ts`, `wrangler.jsonc`, local runtime scripts | Inspect existing durable orchestration for a separate Firmable workflow |

`src/db/client.ts` supports Postgres and Neon HTTP. Production is documented as Supabase/Postgres in `docs/31-supabase-database.md`; older local docs still mention Neon. Do not infer the database destination from `.env` or outdated prose. Local development is documented at `127.0.0.1:5434/project_acquire`; verify it without logging credentials.

## 4. Capture-grounded schema

Private reference: `.local-data/firmable/ajaustralia-company-and-people.json`.

The inspected capture contains one company, a complete search with 29 records, and 29 person-detail envelopes containing `personId`, `httpStatus`, `fetchedAt` and `raw`. All detail statuses are 200 and all IDs match search results. Eleven profiles contain work emails, four contain phones and nineteen contain skills. Company and person phone/email shapes differ. People include nested experience, current company, secondary positions and social profiles. Company data includes registers, industry codes and technographics. Several company fields are null.

Keep whole response JSONB alongside a small set of indexed lookup fields. Do not create a column for every optional vendor field. An absent email is a valid successful result, not a reason to repeat paid requests.

### Proposed tables

Use stable Firmable IDs as text primary keys in identity tables. Use UUIDs for runs, logical calls and observations. Add normal created/updated timestamps to identities and runs; immutable observations retain their original timestamps.

| Table | Essential fields and constraints |
| --- | --- |
| `firmable_companies` | `id`, name, normalized domain/ABN/ACN, global people-generation counter, created/updated timestamps; lookup indexes; domains are not globally unique without evidence |
| `firmable_people` | `id`, normalized LinkedIn identifier when available, created/updated timestamps |
| `firmable_sync_runs` | company ID nullable until resolved, initiating org/actor and target, operation kind, status, target and company-global generation/order, company/search/profile progress, search completeness, timestamps, safe error summary, client idempotency key; at most one queued/running run per organisation target |
| `firmable_company_responses` | observation ID, run ID, company ID nullable for unmatched failures, logical call ID, attempt number, method, safe request parameters, raw JSON or non-JSON body, HTTP status nullable on network failure, validation result/error, hash, requested/fetched/created timestamps |
| `firmable_people_searches` | same observation metadata; company/run ID, filters, offset, requested size, returned count, reported total; each row is one observed page attempt |
| `firmable_person_responses` | same observation metadata; requested/resolved person ID; raw full profile; privacy mode |
| `firmable_company_people` | composite company/person PK, latest search observation reference, raw search record, first/last-seen timestamps, active flag, reconciliation generation |

Add nullable FKs `targets.firmable_company_id` and `contacts.firmable_person_id`. Add indexes for FKs and latest validated-successful response lookup by identity, retrieval time and deterministic tie-breaker. Add a unique attempt key `(run_id, logical_call_id, attempt_number)` in response tables. Add a unique client request key scoped to the initiating organisation. Hashes must not have a live-response uniqueness constraint.

Contact materialization is uniquely enforced by `(organization_id, target_id, firmable_person_id)` for linked rows. The local pre-migration audit found no duplicates before the partial unique index was added. Existing local DND state wins when an atomic upsert refreshes provider-owned contact fields.

Preserve safe request bodies/parameters and all retry attempts. Never store Authorization headers or API keys. HTTP failures and validation failures may lack a resolved identity, so history must not require a successful company FK. Network errors have no HTTP response: store their attempt metadata explicitly.

Keep the current `ALLOW_REAL_PERSONAL_DATA` behavior. Shared reads must enforce it as well as writes. Development fixture runs must not overwrite real shared identity data with fictional payloads: use a dedicated test database/provider namespace. Real-person snapshots are retained only in the allowed mode; record redaction where raw persistence is prohibited. The global-sharing decision does not implicitly disable the existing environment flag.

## 5. Matching and read model

Implement one batched shared-profile resolver used by the server page, mandate GET, detail page and outreach read model.

Matching order: explicit Firmable FK/ID, exact normalized ABN, exact normalized domain. Normalize case, URL host, leading `www`, trailing dot and ABN punctuation. Do not match company names or strip arbitrary subdomains. Strong-identifier conflicts and ambiguous domains must not attach silently. Return a resolvable conflict state and retain the organisation's current data.

Read the newest validated successful company/person snapshot by provider retrieval time, with a deterministic tie-breaker. A database backfill insertion date must not make an older response current. Derive provenance from the original retrieval time, not from the page-load clock.

Overlay provider fields in memory onto the organisation target, preserving target ID, mandate assessment, manual identity evidence, accreditations and workflow status. Recompute derived views using existing scoring rules where required; do not persist workflow transitions on a GET. Provider snapshots are authoritative for provider-owned fields, while manual evidence retains its separate provenance.

For contacts, return shared candidates separately from saved organisation contacts. Use Firmable person IDs for candidates; only actual `contacts.id` values may be passed to draft/enrolment APIs. An explicit selection POST materializes or updates the organisation contact without a provider call when a usable profile exists. Preserve local do-not-contact/suppression rules with precedence over shared availability.

Existing contacts must not mask newer shared data in displays. Approved/sent message contents remain immutable; approval/send checks must apply current suppression and DND state. Do not automatically enroll newly discovered people.

Do not publish raw histories or another organisation's sync metadata through normal workspace APIs. Return only the fields needed by the UI. Batch lookups by the requested target set; avoid scanning all history or one query per contact on every five-second poll.

Normal reads never call Firmable, even when no stored match exists. Missing data displays as unknown. Audit other callers of `enrichCompany`/`enrichPerson`: non-forced enrichment paths should use stored successful data first and record history when they really call the provider.

## 6. Refresh execution and failure semantics

### Durable execution

Implement refresh as job submission plus polling, retaining the existing button and 20-selection limit. POST returns 202 with per-company run IDs. Persist the run before dispatching work.

Preferred local implementation: a separate Firmable workflow in the existing Cloudflare runtime coordinates bounded server callbacks. Firmable calls and database writes remain in the application's backend. Reuse existing authenticated callback/origin checks; pass IDs and counters through orchestration, not raw personal payloads. Inspect the installed runtime and local launcher before coding. This requires local workflow configuration and integration tests but no deployment during this task.

Do not execute arbitrary work after returning an HTTP response without durable orchestration. Do not hold database transactions open across provider requests. Add dispatch recovery for jobs persisted before a failed workflow start. Persist per-page and per-person completion so execution resumes after interruption without repeating already completed calls.

Use database-backed company-level concurrency control; the current in-memory organisation guard is insufficient across users/processes. Concurrent duplicate submissions join an active run or receive a stable already-running result. A completed run never satisfies a new explicit button click. Keep job access authorised through the user's target; never expose another tenant's run details when joining shared work.

Give runs a deterministic generation order. Older delayed workers must not overwrite newer relationship reconciliation or progress. Lease expiry must be recoverable. No browser tab must be required to stay open for completion. Bound profile concurrency and provider request rate; keep status updates usable under slow and rate-limited responses.

### Search and profile handling

1. Capture and validate the fresh company response. Persist it before deriving UI fields.
2. If company lookup fails but a known Firmable identity exists, attempt its people refresh independently; retain the old company profile and report partial status. If identity is unknown, record failure and stop dependent calls.
3. Capture every people-search page and retry. Track offsets and provider totals separately from deduplicated person count.
4. Detect repeated pages, malformed IDs, inconsistent totals and pagination safety ceilings. They produce an explicit incomplete result, never silent success. The current 10,000-result loop must not silently truncate a complete-looking list.
5. Once all pages validate, reconcile active relationships atomically for that search generation. A successful complete empty search deactivates current relationships. A failed/incomplete search preserves the previous current set; any successfully observed new people can be shown as provisional.
6. Fetch profiles for every distinct returned person, regardless of availability flags. Save each successful profile immediately; record failed profiles and retain their previous successful snapshots.
7. A complete search with some failed profiles can still establish the company list. It is a partial refresh, with successful profiles plus per-person fallback. A search-only record without a profile is a candidate, not a fully enriched contact.
8. Finish with structured counts and errors. Keep company success, search completeness, profiles succeeded/failed and contact-materialization outcomes separate.

Record observed attempts at the HTTP boundary. If persistence fails, do not claim the paid response was saved. Exactly-once provider calls cannot be guaranteed across a crash between the network response and database commit; minimize this window, document it and test replay idempotency. A timeout or process crash must not leave a run reported as complete.

## 7. Backfill and migration

Create the next available migration; use `0006_firmable_history` only if 0006 remains free. Review generated SQL, snapshot and journal together. No unrelated schema changes or automatic startup migrations.

Separate additive schema creation from an idempotent, resumable backfill command with a dry-run/report mode. Backfill remains a data migration subject to the approved target. Seed data installation for integration tests also needs the correct target scope.

Backfill genuine company `firmographics.firmable.rawResponse` and contact `personalData.firmable.searchResult` / `personProfile` payloads. Reconcile their IDs with legacy identifiers and provenance. Quarantine/report malformed or conflicting rows. Do not invent a full profile from normalized email/name fields, or a complete company search from a handful of saved contacts.

Maintain stable import keys and hashes so rerunning the backfill adds no copies of the same source observation. Identical legacy copies with the same known capture time may share a backfilled observation; different capture times remain separate history. Preserve source row references. If a capture timestamp is unavailable, label the fallback explicitly and avoid allowing that inferred date to displace a known live response.

Create relationships from available legacy search records but mark membership coverage unknown/incomplete. Only a verified complete search may set completeness. Existing legacy contacts without raw profiles remain usable organisation records. Leave embedded JSON intact. Verify record counts, IDs, hashes, timestamps, FK integrity and unchanged workflow rows before enabling new reads.

The private AJ Australia capture is a replay input, not automatically a production seed. Keep its raw data untracked. For normal tests create a synthetic, consistently anonymized equivalent preserving nested shapes, nulls, 29 identities, 11 work-email profiles and four phone profiles. Do not import `.local-data` into browser bundles or tracked fixtures.

## 8. Frontend contract

- Initial server rendering and API reloads display stored company/people data with the same provenance timestamps.
- Keep the button text **Find more company data**. It submits forced refresh jobs and shows per-company progress rather than blocking on a single long request.
- While refreshing, keep existing data visible. Poll only while relevant jobs are active; resume status display after reload.
- Completion reloads company and people views, including the open review panel and contacts area. Another organisation sees the new shared values on its next normal fetch.
- Distinguish success, partial results, failure with stored fallback, and failure without any data. Do not label partial data as fully refreshed.
- Display a last-successful retrieval timestamp, not an expiration warning. Keep technical run IDs, JSON and HTTP details out of normal product copy.
- Return typed `refresh`/`messages` fields; stop placing ordinary success text into a `warnings` array.
- Summarize/rank people in the list and provide the full list in the contact view. Avoid dumping 29 names into the key-decision-makers table cell.
- Ensure polling responses cannot overwrite a newer completed refresh with an older request result. Use a generation/revision or request-order check.
- Provide accessible loading/status/error messaging and prevent accidental repeated submissions without locking unrelated work.

## 9. TDD execution sequence and evidence

Each slice starts with failing tests for the observable behavior, then implementation, then refactoring. Record commands/results. A plan to test or a skipped integration suite is not passing evidence.

### Slice A: contracts and pure behavior

Write tests for normalized identity lookup/conflicts, latest successful selection, deterministic ordering, privacy projection, successful-null replacement, fallback, complete-search reconciliation and response/import deduplication semantics. Refactor parser/projection functions to accept capture time explicitly. Include HTTP 200 failures, malformed payloads, failed later pages, repeated pages and a complete empty search.

### Slice B: schema, repository and backfill

Build a dedicated PostgreSQL integration harness with an explicit test URL, destructive-target guard and labelled isolated fixtures. Never infer it from the app's default DATABASE_URL. Once schema application is authorised, test a clean install and an upgrade from migrations 0000–0005 using synthetic legacy rows. Verify journal/snapshot consistency, FKs, indexes, repeated backfill, duplicate contacts, missing raw payloads and preserved workflow references. Exercise actual queries and transactions, not mocked Drizzle chains.

Test cross-organisation shared identity reuse, attempt idempotency, identical responses on two live calls, out-of-order run completion, concurrent materialization and relationship reconciliation. Roll back data fixtures where practical; exact test IDs govern cleanup. Never reset the user's local database or delete its volume.

### Slice C: provider capture and durable sync

Inject a deterministic HTTP replay provider and clock. Prove every page/attempt/profile response is saved, including retries and non-JSON errors. Test interruption/resume, dispatch failure, lease recovery, provider/database failures, concurrency bounds and progress counts. Use a multi-page fixture in addition to the 29-person sample. Include a refresh exceeding one callback duration to prove resume behavior. Verify fixture mode produces no paid network calls.

### Slice D: API/read integration

Exercise real repositories with replay HTTP at the provider boundary. Prove normal GETs make zero Firmable calls and zero writes, stored data appears for a second organisation with no preexisting contacts, and a forced POST calls Firmable despite existing data. Verify server-page and API projections agree; selection creates exactly one organisation contact; foreign targets/runs are rejected. Test complete, partial, unavailable and zero-result states.

### Slice E: browser smoke and end-to-end wiring

Use the applicable browser skill and an actual locally running application, PostgreSQL and workflow runtime. Add a repeatable harness if one does not exist; the current package scripts provide no dedicated Firmable browser suite. The existing `scripts/test-parity-server.mjs` uses live research providers and is not the appropriate default for these replay tests.

Use labelled test mandates in two organisations and a replay server that exposes request counters. Verify:

1. Organisation A's previously stored company appears on initial navigation with people and zero provider calls.
2. Organisation B's same-domain/ABN company immediately displays the shared data while A's assessments/notes are absent.
3. The button creates new provider calls and a visible running job. Seed the next replay response with visibly changed company and person values.
4. Updated values appear in list, detail and contacts views; history count increases; a reload preserves the result.
5. Closing/reopening the page during a refresh resumes progress display and the job completes independently.
6. A later-page failure preserves membership; a single profile failure falls back for that person; a total outage retains previous data and shows a useful message.
7. Selecting a shared person materializes the local contact and connects to the draft workflow without sending email. Verify suppression/DND blocks still work.
8. Browser console and application network requests have no unexpected errors. Retain screenshots and a sanitized request/DB verification report.

### Slice F: regression and handoff

Run `pnpm test`, `pnpm typecheck`, ESLint on affected code, `pnpm build`, the new PostgreSQL integration suite and browser smoke suite. If workflow code changes, also run `pnpm test:workflows` and `pnpm test:coordinator`. Document the exact commands added for new suites; CI must not silently skip required integration checks.

Inspect `git diff --check`, tracked-file secrets/PII and generated-file changes. Preserve unrelated work. Report the actual pass/fail/skip counts and any environmental blockers. A live Firmable smoke call is optional, separately opted into and unnecessary for the deterministic completion gate.

## 10. Completion and local rollout gate

- [x] Database schema, history and idempotent backfill are implemented and reviewed.
- [x] Concrete migration and test/local database destinations are recorded; only authorised targets receive SQL.
- [x] Shared snapshots appear automatically in the implemented frontend and backend read paths.
- [x] Explicit refresh acquires new data, records every observed attempt and updates views.
- [x] Partial pagination cannot remove valid people; failed profiles fall back correctly.
- [x] Refresh progress survives request interruption and page reload; queued dispatch failures and stale workflow statuses are recovered by authenticated polling.
- [x] Organisation workflows remain separate and stored contact selection connects to outreach.
- [x] TDD evidence, real database integration, Cloudflare workflow replay and deterministic browser smoke checks pass for the durable checkpoint.
- [x] Original embedded data remains available for rollback; backfill verification is recorded above.
- [x] Local main changes, migration status and test commands are documented for review.

Validation commands for this checkpoint:

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:workflows
pnpm test:coordinator
FIRMABLE_INTEGRATION_DATABASE_URL='postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire' pnpm test:firmable-db
```

The local and production upgrade paths from the existing database through `0007` were exercised. The production browser journey also proved cross-organisation shared reads. A brand-new empty-database migration install and a literal Worker-process kill/restart browser test were not executed; repository integration tests cover migration constraints and stale-run recovery, and they must not be represented as executed production evidence.

Production used the required release order: additive schema and verified backfill, Vercel backend/frontend callback support, then Cloudflare Worker/Workflow publication. Rollback should revert the application and Worker together while retaining response history; do not drop the new tables or erase successful observations.

This plan supersedes conflicting historical Firmable storage advice in `docs/22-firmable-implementation-plan.md` for this feature. Update that document with a pointer during implementation so future agents do not reintroduce the old no-history behavior.
