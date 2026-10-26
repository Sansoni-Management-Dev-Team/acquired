# Authenticated route testing: fixes and verification

Date: 26 October 2026  
Worktree: `project-acquire-route-coverage`  
Branch: `test/route-coverage`

## Status

The Companies recovery fix is implemented in this worktree and **all 52
authenticated browser checks pass** against this branch (34.1 seconds).
It has **not been applied to the running main checkout** served at
`https://acquire-isolated.orb.local`.

The earlier authenticated browser run against that service recorded **48 passed
and 4 failed** across 52 checks. All four failures expose the same recovery bug:
populated and empty Companies pages, on desktop and mobile Chromium.

## Application fix: Companies recovery returns HTTP 415

Opening `/mandates/[id]/companies` triggers an automatic recovery POST to
`/api/mandates/[id]/companies`. The page can render successfully even though this
background request fails.

The client sent the POST without a content type or JSON body. Next's proxy
presented the zero-byte POST as a body stream, so the browser mutation guard
rejected it with HTTP 415 because it required JSON.

In [companies-workspace.tsx](../src/components/companies-workspace.tsx), the
request helper now supplies these options when its method is POST:

```ts
headers: { 'Content-Type': 'application/json' },
body: '{}',
```

GET requests keep their existing behavior. The server's mutation guard remains
in place; the client now sends the format it requires.

### Regression evidence

[companies-workspace-polling.test.tsx](../src/components/companies-workspace-polling.test.tsx)
invokes the recovery callback and checks the request against the real
`guardBrowserMutation` implementation. It models the zero-byte POST body stream
seen by the proxy.

- Before the fix: the new regression failed with HTTP 415; 3 existing tests passed.
- After the fix: all 38 targeted polling, browser-mutation, proxy-security and
  Companies API tests passed across 4 files.
- A correctly encoded recovery request against the existing isolated service
  returned HTTP 200.
- All 52 authenticated browser checks pass against the worktree, including the
  four previously failing populated/empty Companies cases on desktop/mobile.
- All 80 existing signed-out/mock browser checks passed (2.0 minutes).
- TypeScript, scoped ESLint and diff whitespace checks passed.

The direct HTTP 200 verifies that the endpoint accepts the corrected request.
It does not establish that the running app has received the client fix.

## Test improvements

The opt-in suite uses a fresh real login and saved Playwright authentication
state, with 26 scenarios on each of desktop and mobile Chromium. It covers
mandates, redirects, workspace pickers, saved briefs, Companies, company details,
People, Sequences, agent setup, settings, audit and API ownership checks.

Browser exceptions and unexpected HTTP errors fail tests. Companies tests
explicitly await the automatic recovery response, preventing a fast page
assertion from finishing before the HTTP 415 is observed. Tests also verify
that the synthetic account cannot access the original source mandate or its
company records.

The suite is separate from the default mock/signed-out tests and is not enabled
in CI. Its configuration targets the existing isolated service, which mounts
main rather than this worktree.

## Fixture preparation

With the user's authorization, copied a sample from a local mandate owned by
`callumpholt@gmail.com` into the synthetic test account's separate workspace:

- One populated mandate containing 5 companies and 10 contacts, with new IDs.
- One empty mandate for empty-state coverage.

The source mandate, selected companies and contacts match their pre-copy hash.
Database identity and the `acquire-agent-mode-local-only` marker were verified.
No migrations were applied. No account/provider credentials, research jobs,
agent operations, enrolments, messages or send state were copied.

Normal Sequences page loading created a default draft. No research Start,
sequence publishing, enrolment or sends were invoked. Postflight checks found
zero research jobs, agent operations and campaign enrolments in the test workspace.

## Reproduce verification

From the test worktree, using its existing ignored local credentials and fixtures:

```sh
pnpm test:routes:authenticated:worktree

pnpm exec vitest run \
  src/components/companies-workspace-polling.test.tsx \
  src/lib/browser-mutation.test.ts \
  src/proxy.security.test.ts \
  'src/app/api/mandates/[id]/companies/route.test.ts'
```

The worktree command starts this checkout on `http://127.0.0.1:3218`, refreshes
the session and verifies workspace identity and the absence of executable fixture
state before running. It refuses dotenv files, uses only the marked local database,
and configures Agent feature flags with registered scope and a dedicated local
runtime identity, without provider credentials or worker processes.
Browser execution mutations remain blocked. Its server is stopped after the suite.

`pnpm test:routes:authenticated` still targets the existing isolated-main service.
Its four recovery failures remain until that checkout receives the fix. Worktree
results and authentication state are stored separately under
`.local-data/route-auth/worktree/`, preserving the original failing evidence.

Private evidence is retained under `.local-data/route-auth/`:
`authenticated-final.log`, `results.json`, browser traces/report,
`recovery-red.log`, `recovery-green.log`, `fixtures.json` and `postflight.json`.
These ignored artifacts can contain copied contact data or authentication state
and must not be committed or published.

See [the route testing README](../tests/routes/README.md) for the broader coverage
baseline and [communications progress](communications/progress.md) for the
scoped local-fixture handoff.

Worktree verification logs: `.local-data/route-auth/worktree-run.log`,
`worktree-unit.log`, `worktree-baseline.log`, `worktree-lint.log`, and
`worktree-types.log`.

## Readability and shared setup

Both browser modes now use `scripts/route-test-server.mjs`. The default mode runs
the credential-free smoke server; `--authenticated` verifies the local database
and enables the fixture-backed server. Environment filtering, dotenv refusal and
process lifecycle handling are shared in one place. The separate authenticated
launcher was removed; no launcher framework or additional dependency was added.

The Companies request helper uses an ordinary `if` to set its POST options, and
the regression test separates setup, response creation and assertions onto clear
lines. Request behavior and security checks are unchanged.

After this cleanup, all 52 authenticated and 80 signed-out/mock browser checks
passed, along with 38 focused tests, TypeScript and scoped ESLint. Private logs
are `.local-data/route-auth/polish-{authenticated,baseline,unit,types,lint}.log`.
