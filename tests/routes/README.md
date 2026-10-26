# Route coverage

This suite tests the checkout it lives in. It does not target or modify
`https://acquire-isolated.orb.local`, which mounts the main worktree.

## Run

Use Node 22.23.1 and the package manager pinned in package.json:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test:routes
pnpm test:routes:report
```

The server starts on `http://127.0.0.1:3217` and stops after the run. An occupied
port fails rather than reusing another checkout. Use a worktree without `.env`
files. The launcher supplies an allowlisted environment, no provider credentials,
and a deliberately unreachable local database URL. No database is created or
migrated. The baseline `pages.spec.ts` uses the real application, auth adapter and proxy
without mocked responses. Its browser requests outside the local origin or with
methods other than GET/HEAD fail the test. Additional contract suites intercept
all API calls and fail on any request without an explicit fixture; fixture POSTs
never reach the server. There are no background workers.

## What this proves

The current manifest has 26 page routes: six public renders and 20 signed-out
redirects, each run in desktop and mobile Chromium (52 baseline browser cases). Every baseline case
asserts the final URL, HTTP 200, a specific visible heading, and a functioning
theme toggle after hydration. JavaScript errors, console errors, failed requests
and HTTP errors fail the case. Only 401s from the two known signed-out shell
probes (`acquisition-session` and `campaigns/reply-alerts`) and browser-aborted
obsolete navigation requests are exempted. Screenshots and traces are retained on
failure. This is a development-server smoke test, not a production-build test or
visual regression suite.

A signed-out redirect does **not** prove that the authenticated page renders.
The synthetic UUIDs are URL samples for access checks, not database records.
The development preview is also redirected by the shared shell when signed out.

`coverage.json` explicitly records every page and API handler. The inventory
command discovers routes from `src/app`, handles groups/dynamic segments and
records exported API methods. Missing, stale and duplicate entries fail the run;
parallel/intercepted routes fail closed until discovery support is added. Each
new page needs a concrete URL and assertion; redirect-only cases must record an
authenticated coverage gap. API entries record gaps rather than pretending a
browser visit covers their methods. Inventory generation does not execute APIs.

## Additional behaviour coverage

- `auth-forms.spec.ts`: seven real-browser form scenarios, including rejection,
  retained input, password mismatch, rate-limit recovery, invalid reset tokens,
  reset success and social sign-in failure. Authentication API responses are
  synthetic; no account is created and no reset email is sent.
- `client-workspace.spec.ts`: seven scenarios for loaded/empty/error/retry mandate
  lists and all four picker destinations. A synthetic cookie passes the proxy's
  presence check, while all session/data APIs are intercepted. This cookie is
  **not** a real authenticated server session and these tests do not prove access
  control or database integration. All server-side page authentication remains intact.
- These 14 scenarios run on both device projects, giving **80 total browser cases**.
- Vitest tests exercise auth/workspace forms, research-settings UI and GET/POST,
  research-job ownership and cancel/retry/resume/accept actions, owned company
  worksheet rendering and missing membership handling, audit rendering and escaped
  metadata, workflow recovery/coalescing, active polling and tooltip interaction.
  Persistence/provider boundaries are mocked. Query predicates are checked for
  the active organization, job and finding IDs where relevant.
- Selected entries in `coverage.json` link to the new unit and fixture browser
  suites. These links document scope; a green inventory alone is still not proof
  that the linked tests ran.

## Reports and CI

- `coverage/routes/inventory.json`: discovered routes, declared cases, and gaps;
  **not** a pass/fail report.
- `output/playwright/routes/report/index.html`: browser results and failure artifacts.
- `output/playwright/routes/results.json`: machine-readable browser results.
- `pnpm test:coverage`: full Vitest V8 line, branch, function and statement coverage
  under `coverage/unit`. Untested `src` files are included. Source-map remapping
  also includes communications implementation sources reached by application tests;
  totals describe the generated Vitest report, not only files under `src`. This excludes tests,
  fixtures and declarations; it does not combine Node-runner or browser coverage.
  Database/live suites retain their existing opt-in gates. No arbitrary percentage
  threshold is imposed before measuring and reviewing a baseline.
- `.github/workflows/route-coverage.yml`: separate browser and unit coverage jobs on
  PRs to main and manual dispatch; uploads reports even on failure. It does not deploy.

## Remaining coverage

Real authenticated browser sessions, database-backed loading, end-to-end role/tenant
isolation and complete business workflows remain separate acceptance work. Some
form, query-string, invalid-record and rendering behaviour is now covered by the
controlled fixtures above; they do not replace integration acceptance. API method coverage also needs a scenario-level review of the
existing unit/integration suites. The next step is dedicated deterministic
fixtures and authenticated browser cases. Any schema application for a new test
database requires approval for that specific migration under AGENTS.md; the
standing agent-mode exception does not cover this worktree. Do not borrow live
sessions or shared credentials to turn these gaps green.

## Verified baseline — 26 October 2026

Worktree branch `test/route-coverage`, based on local main `597b589`.

- Browser suite: **52 passed**, desktop and mobile Chromium, separate local app.
- Vitest with coverage: **823 files passed / 138 skipped**;
  **7,271 tests passed / 959 skipped**. Existing opt-in suites were not enabled.
- Initial Vitest report coverage: **79.92% lines, 75.79% statements, 74.83% branches,
  75.03% functions**. This is Vitest source coverage, not authenticated route coverage.
- Inventory regression suite: **3 passed**. Destructured handler exports were
  first demonstrated missing (GET/POST absent), then verified after the fix.
- Full TypeScript check, scoped ESLint and `git diff --check`: passed.
- First browser attempt preceded Chromium installation; subsequent initial run
  passed 48/52 and exposed expected shell 401s missing from the allowlist. Only
  those endpoint/status pairs were added, then all 52 passed.
- First coverage run exceeded the default timeout in existing discovery wiring;
  rerun used the repository CI's 20-second test timeout and passed. No application
  behavior was changed to make tests pass.
- No database creation, migrations, shared-service changes, live sends or deployment.
  CI configuration is implemented but has not run on GitHub yet.

Local run logs are retained under ignored `coverage/routes/evidence/`. Reports
are regenerated by the commands above; these numbers describe this checkout and
run, not subsequent main changes.


## Expanded verification — 26 October 2026

Added 118 Vitest scenarios across eight new test files and the existing workspace
routing suite. Added 28 browser cases (14 scenarios × two device projects).

| Metric | Initial report | Expanded report |
| --- | ---: | ---: |
| Lines | 79.92% | 80.88% |
| Branches | 74.83% | 75.23% |
| Statements | 75.79% | 76.54% |
| Functions | 75.03% | 75.64% |

The denominators are unchanged: 28,123 lines, 47,435 branches, 45,158 statements,
and 8,767 functions. This adds 270 covered lines and 194 covered branches without
excluding sources or changing application logic. Both reports include application
sources and remapped communications sources; they are not exclusively `src` coverage.

Full Vitest run: **831 files passed / 138 skipped**, **7,389 tests passed / 959 skipped**.
Research-job actions, research settings (UI and API), sign-up, and active polling
now have 100% line and branch coverage within these mocked-boundary tests. Other
auth forms, workflow recovery and tooltips have 100% line coverage with remaining
branch gaps. These percentages do not imply complete behavioural coverage.

Full browser run: **80 passed**. Full TypeScript, scoped ESLint and diff whitespace
checks passed. No production code was changed. No database migrations, real
account creation, email delivery or provider calls were enabled. CI remains locally
verified configuration, not a completed GitHub run.

Next substantive coverage work is real authenticated browser/data integration
using a dedicated fixture database, plus method/role scenarios for the remaining
API handlers. The schema approval rule still applies; mocked session responses
must not be counted as verification of real authentication.


## Local authenticated account

On 26 October 2026 a synthetic user and separate empty workspace were created
through normal registration on `https://acquire-isolated.orb.local`. That service
uses the existing local `acquire_agent_mode` database and mounts the main worktree;
it is not the port-3217 smoke server. No schema changes were applied.

Private, ignored files under `.local-data/route-auth/` contain:

- `credentials.json`: account credentials and workspace identity (mode 0600).
- `storage-state.json`: real Playwright authentication state (mode 0600).
- `verification.json`: fresh login and `/mandates` + `/audit` HTTP 200/render evidence.
- `create-user.mjs`: local bootstrap/verification script; it reuses the saved
  account and workspace when rerun. Use the authenticated suite below to refresh
  sessions now that the workspace contains fixtures.

Fresh login, membership, active-workspace identity, the acquisition-session API,
and the empty mandates API were verified. Both pages rendered their expected
headings with no JavaScript page errors. Network-idle waiting initially timed out;
verification uses DOM readiness and visible headings because the app polls.

The state is host-specific and expires; refresh via normal login. Do not commit
these files or upload them as CI artifacts. The default mock/signed-out suites
remain independent of this account. The following opt-in suite uses prepared
records in this test workspace.


## Authenticated fixture coverage — 26 October 2026

Run `pnpm test:routes:authenticated` from this worktree. This opt-in command uses
`playwright.authenticated.config.ts` and the existing isolated service, which mounts
**main**, not this worktree. It refreshes the synthetic account session through normal
login, verifies the database marker and workspace membership, and refuses to run
mount-time recovery if executable research, agent-operation or enrolment state exists.
It requires the ignored local credentials and fixture receipt; it is not enabled in CI.

With the user's authorization, copied a sample from a mandate owned by
`callumpholt@gmail.com`: five companies and ten contacts, into a separately owned
workspace with new record IDs. Created a second empty mandate for empty-state checks.
The source mandate, selected companies and contacts still match their pre-copy hash.
No account/provider credentials, jobs, campaigns, enrolments, messages or send state
were copied. Normal page loading created a default draft sequence. No migrations,
research starts, publishing, enrolment or sends occurred.

The suite contains 52 checks (26 scenarios on desktop and mobile Chromium), covering
real login/session reuse, workspace redirects, mandate pickers, saved briefs,
companies and contact panels, company worksheets, People with copied contacts,
Sequences, agent setup, settings, audit, and API ownership/identifier checks.
The test account is denied access to the original source mandate and company IDs.
Unexpected HTTP failures and browser exceptions fail tests; mount-time Companies
recovery is explicitly awaited so its HTTP failure cannot be missed during teardown.

Final live run: **48 passed / 4 failed** (46.9 seconds). All four failures are the
populated/empty Companies recovery on desktop/mobile.

The live suite exposed HTTP 415 from Companies' automatic recovery POST. The client
omitted JSON headers/body, while the browser mutation guard requires JSON for the
request body forwarded by Next. The worktree now sends `Content-Type: application/json`
and `{}`. The regression test failed with 415 before the change and passed afterwards;
all 38 targeted polling, guard, proxy and companies-route tests pass. The correctly
encoded request also returned HTTP 200 against the local service. The running main
checkout has not received this fix, so its browser failures remain visible.

Private evidence and data remain in `.local-data/route-auth/`: `fixtures.json`,
`authenticated-final.log`, `results.json`, browser traces/report, `recovery-red.log`,
`recovery-green.log`, and `postflight.json`. Credentials/session files are mode 0600
inside a mode-0700 directory. Do not publish these artifacts: they contain copied
business/contact data and potentially authenticated browser state.


## Testing the fixed worktree

Run `pnpm test:routes:authenticated:worktree` to start **this checkout** on
`http://127.0.0.1:3218` and run the same 52 authenticated checks. The runner refuses
dotenv files and inherited provider credentials, verifies the marked local database,
and creates a fresh session using an ephemeral local auth secret. Agent setup
feature flags are explicitly configured; no workers or provider credentials are
started. The suite still blocks execution mutations and checks for executable
fixture state before browsing.

The server must own its port (no reuse of another checkout's server) and is stopped
after testing. Do not run this and the default port-3217 suite simultaneously because
both use this checkout's Next development build directory. Authentication state and
reports are kept under `.local-data/route-auth/worktree/`; the original isolated-main
report is preserved. The original `test:routes:authenticated` command continues to
test the running isolated main service.


Verified fixed-worktree run: **52 authenticated checks passed** (34.1 seconds),
including all four Companies cases that fail against unchanged main. The 38 focused
unit/guard/API tests, TypeScript and scoped ESLint also pass. Postflight again found
the source snapshot unchanged and zero executable jobs/operations/enrolments in the
test workspace. This verifies the branch locally; it is not a main integration or
production release. Evidence: `.local-data/route-auth/worktree-run.log` and the
separate `worktree/` report.

Final broader regression: **80 signed-out/mock browser checks passed** (2.0 minutes).
Evidence: `.local-data/route-auth/worktree-baseline.log`.
