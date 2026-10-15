# Background field-search HTTP 503 RCA

Investigated 2026-10-15 (Asia/Makassar); production evidence captured at 2026-10-14T23:22:35Z.
Mandate: `0ae75359-8f79-416e-9056-171225a01d47`.

## Finding

Background field searches omit the browser reservation required by the Worker's account-wide provider coordinator. The Worker rejects admission before issuing an upstream browser/search request. This is a protocol mismatch in Acquire's background research integration.

The production probe confirms HTTP **503**, category **browser_admission**. An offline reproduction using the actual Worker `/search` handler confirms that a missing reservation triggers this response without calling the coordinator's claim method or the upstream provider. A reserved control returns HTTP 200 and search results with a mocked browser response. The control demonstrates the correct protocol locally; it does not establish current live provider health.

## Final observed impact

| Measure | Result |
| --- | ---: |
| Saved companies / requested companies | 100 / 20 |
| Background jobs partial / failed / complete | 81 / 19 / 0 |
| Companies with recorded field-search attempts | 85 |
| Companies whose recorded searches all failed | 85 |
| Failed / successful field-search attempts | 340 / 0 |
| Companies with no recorded field-search attempts | 15 |
| Companies with background evidence written through other paths | 33 |

The 15 companies with no recorded searches must not be counted as confirmed search failures. Company-profile discovery succeeded; background page/registry reading has independent successes and failures. This admission defect does not explain every page/document failure or every missing field. Evidence counts represent observations, not verified acquisition fit.

The separate production tail ended at 23:20:14Z with no active work. It recorded 62 companies with headcount, 64 with revenue, 73 with ABNs, and one contact without email. These presence counts do not imply independently verified figures or identifiers.

## Failure chain

1. `src/adapters/company-missing-field-research.ts`: `researchCompanyMissingFields()` calls `cloudflareSearchResults()` with the background job ID, without reserving capacity or adding `x-research-browser-reservation`.
2. `src/adapters/cloudflare-web-search.ts`: `/search` receives a job ID, but no reservation header.
3. `cloudflare/research/index.ts`: the production `/search` handler requests `browser-permit` through `providerAction()` with a null token.
4. With `PROVIDER_COORDINATOR` configured, `providerAction()` accepts `browser-permit` only when a token exists; otherwise it throws `Invalid provider coordination action`. It does not use the older application callback fallback when the binding exists.
5. `cloudflare/research/browser-reader.ts`: the thrown permit error becomes `BrowserAdmissionDeferred`, HTTP 503, category `browser_admission`. No upstream request is issued.
6. The background adapter catches the search exception and records `Field-specific search unavailable`. It proceeds through its bounded query budget, then classifies unresolved fields as incomplete.
7. `src/lib/company-background-research.ts` persists `partial` when there is some evidence/read success, or `failed` when there is none.

Main hybrid discovery reserves and passes a token before searching. That explains why company discovery works while the independently executed field searches fail.

## Why the logs were initially ambiguous

`providerDiagnostics()` ignores the search Worker's returned `category` and falls back to `provider_error` for HTTP 503. The persisted background attempts also discard the typed exception category and keep only a generic reason. The live diagnostic reads the response category directly and emits only an allowlisted classification.

Existing replay coverage mocks admission callbacks and does not reproduce this exact unreserved background request against the coordinator-enabled Worker. The new diagnostic exercises the actual handler with a coordinator binding double, verifies no upstream call on rejection, and includes a reserved positive control.

## Reproduce

Run the offline diagnostic from the repository root:

```sh
node scripts/diagnose-field-search.mjs
pnpm exec vitest run scripts/diagnose-field-search.test.mjs
```

The first command now runs eight post-fix admission regressions with external networking blocked, including synchronous unreserved success, reserved success, capacity waits, deadline/expiry handling, rate limits and release on errors. It exits 0 when all pass. The pre-fix unreserved assertion failed (expected 200, actual 503), and the local repair made it pass.

Optional production check, supplying the existing runtime environment securely:

```sh
node scripts/diagnose-field-search.mjs --live \
  --mandate 0ae75359-8f79-416e-9056-171225a01d47 \
  --output .local-data/mandate-review/field-search-probe.json
```

`--live` makes exactly one unreserved request with a synthetic job ID and a fixed public test query. It does not create a workflow or supply a client-side reservation. Once the repaired Worker is deployed, the Worker can reserve capacity and perform one public search for this request. The optional mandate query uses `BEGIN READ ONLY`, a 10-second statement timeout and rollback. Credentials, raw error bodies and company/person identities are excluded from output. Exit 2 means admission rejection reproduced; exit 1 means the diagnostic failed; exit 0 means the request did not reproduce admission rejection (inspect status/category, as other errors can still occur).

The probe was run inside the existing production app container using its environment through SSH stdin. No credentials were copied out. The synthetic job ID is sufficient for this failure because the missing-token branch rejects before accessing a job; this is not a test of real-job eligibility or provider health.

## Validation and evidence

- Script tests: red before the new script existed, then green (2 tests).
- Worker reproduction: unreserved case passed immediately; the reserved control initially failed because the synthetic Markdown lacked the search parser's required `##` heading. Correcting that fixture made both cases pass. No production code was changed to obtain a passing control.
- Targeted ESLint, full TypeScript checking, and whitespace checks passed.
- Live probe: HTTP 503 / `browser_admission`, 124 ms, confirmed on the production Worker.
- Sanitized production snapshot: [field-search-503-production-evidence.json](field-search-503-production-evidence.json).
- Private raw logs and test execution logs: `.local-data/mandate-review/` (ignored).

## Recommended repair and acceptance

Use one consistent reservation lifecycle for background searches: reserve a token against the account-wide coordinator, wait within the background deadline, pass it to `/search`, and release it on every success/failure path. Reservation rejection should defer/retry within the budget rather than spend four field queries on immediate admission failures. An alternative is supporting unreserved synchronous callers in `providerAction()` by reserving and claiming through the same coordinator; do not fall back to a separate queue and bypass account-wide limits.

Protect that repair with an integration test starting from the real missing-field search adapter through the coordinator-enabled Worker. Test success, busy admission, expiry, cancellation/deadline, provider errors, and slot release. Preserve safe typed categories in diagnostics and persisted attempt outcomes so admission rejection remains distinguishable from provider outage.

After a repair is released, run one bounded live field search on an eligible diagnostic job before considering recovery of affected companies. Retain existing evidence and use controlled background-job requeue/recovery; do not rerun the whole mandate or overwrite terminal history blindly.

The fixed discovery cap of 100 rather than the requested 20, and the sector-screening/contact-admission behavior, are separate findings and require separate acceptance criteria.

## Handoff

Local repair implemented after the RCA, at the user's request:

- Synchronous production `/search` requests reserve a unique token, claim through the existing account-wide coordinator, and release the token on success, provider failure, expiry or admission failure. Explicit Workflow reservations remain supported without double-booking.
- Background searches send their execution deadline. The Worker caps synchronous execution at 45 seconds and bounds browser admission, waits and provider fetches to the remaining deadline.
- A remaining `browser_admission` failure is retained as a safe typed category in logs and persisted field attempts; further field queries in that background execution stop instead of repeating the same admission failure.
- Regression coverage includes the real Durable Object coordinator, both request paths, capacity waits, expired reservations, elapsed deadlines, rate-limit cooldown, transport/provider errors, and adapter deadline/evidence propagation.

Production failure and original final mandate impact remain live verified. The repair is local only: no deployment, migration, production recovery or resend. Local validation passed: 59 targeted adapter/browser/diagnostic tests, 41 Workflow tests (including the eight admission regressions), seven Durable Object integration tests, TypeScript checking, targeted ESLint, and whitespace checks. Private red/green and regression logs are in `.local-data/mandate-review/field-admission-*`. The new success regression first failed with expected HTTP 200 / actual HTTP 503, then passed after the repair.

Next action: review/release the app and Worker changes together, run a bounded live field-search check, and then separately decide how to recover the affected jobs.
