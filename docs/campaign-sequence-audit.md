# Campaign sequence testing audit

This audit reviews sequence authoring, publication, enrolment, scheduling, n8n execution, delivery, reply monitoring, account services and owner isolation. The expanded tests catch malformed graphs, unusual input, state changes during preflight, duplicate callbacks and ambiguous provider responses. They do not establish exhaustive coverage or compatibility with every live provider response.

All newly executed delivery tests used mocks, dummy HTTP callbacks or the dedicated local test setup. No live Gmail, LinkedIn or WhatsApp messages were submitted. Database integration fixtures were rolled back. No migrations were applied, and production services were not changed.

## Defects fixed

| Trigger | Result after the fix | Regression evidence |
| --- | --- | --- |
| LinkedIn message omits the legacy optional action field | The same 4000-character limit applies as for an explicit message | `src/domain/campaign-adversarial.test.ts` |
| LinkedIn profile changes or becomes invalid between contact loading and claiming | The unsent claim is cancelled and the enrolment is held | `src/lib/campaign-runtime-adversarial.test.ts` |
| An ambiguous WhatsApp send is offered automatic preflight retry | The retry is rejected and manual review remains required | `src/lib/campaign-runtime-adversarial.test.ts` |
| Email or domain suppression appears after the send claim | The final eligibility check cancels the unsent claim before provider submission | `src/lib/campaign-runtime-adversarial.test.ts` |
| A title mimics a generated duplicate-title suffix | n8n nodes retain unique names and each wait keeps its intended successor | `src/lib/campaign-n8n-adversarial.test.ts`; actual local n8n execution |
| Provider write responds with a redirect | The app rejects redirects; the LinkedIn service does not mark a redirected response as submitted | `src/lib/campaign-provider-adversarial.test.ts`; `services/linkedin/test_campaign_adversarial.py` |
| LinkedIn returns an empty durable action ID or a negative timestamp | Response validation rejects the result | `src/lib/campaign-provider-adversarial.test.ts` |
| Worker authentication supplies the secret without a Bearer scheme | All four campaign worker endpoints reject it | `src/app/api/internal/campaigns/auth-adversarial.test.ts` |
| A send must be scheduled after a weekend or DST change | The minute search reuses a timezone formatter, preserving the same sending windows | `src/domain/campaign-adversarial.test.ts` |
| The documented direct Node n8n test imports application aliases | An explicit test-only resolution hook makes the script executable; the script can use an environment API key | `scripts/campaign-test-loader.mjs`; executed smoke test |

The preceding connection-request fix is also retained: queued invitations are skipped if the observed relationship is already connected, and the skipped journal record survives replay. Provider status must be known before an invitation or message is submitted. A relationship observation can be cached for five minutes; these tests do not make it an instantaneous provider check.

## Coverage by surface

| Surface | Executed checks | Remaining practical limit |
| --- | --- | --- |
| Definition validation | Alternate message/wait order, duration bounds, total size, unique IDs, split anchors, acceptance conditions, channel lengths, strict fields, invalid positions | Valid definitions are bounded structured graphs; arbitrary cyclic graphs are rejected rather than executed |
| Graph traversal | Forty generated mixed-channel graphs across multiple routing keys; termination, monotonic indices, branch isolation and shared continuation | This samples many graphs, not every valid graph |
| Editor and history | Copy/paste ID isolation, rejected reconnections, bounded undo history, divergent redo, callback behaviour, escaped hostile content | Component rendering and callbacks were tested; a complete browser interaction session was not executed in this audit |
| Templates and time | Literal placeholder values, unsupported placeholders, exact acceptance deadline, leap day, weekends, both Melbourne DST changes and sending-window boundaries | Providers may have additional formatting or Unicode limits |
| User APIs | Create, list, save, publish, enrolment and action authentication, owner derivation, malformed IDs/JSON, strict input and service failures | Database authorisation is additionally checked below; mocks do not simulate every HTTP deployment condition |
| Worker APIs | Bearer authentication, missing secrets, invalid callback indices, existing step/tick/sync/reply route tests | Worker secrets remain privileged credentials |
| Publication and sync | Immutable snapshots, concurrent edit/publish/delete conflicts, lost sync races, orphan cleanup, cleanup failure and malformed stored definitions | Cleanup after a provider/API outage can still leave an orphan requiring operational recovery |
| Enrolment | Duplicate IDs, normalized email collisions, missing recipients/mailbox/version, foreign contacts, fictionalised contacts, suppression, existing outreach, another sender's assignment and prior conversations | Full app plus database plus n8n enrolment was not rerun in this audit |
| Sending and replay | Every channel completes once; pause/stop/hold races, stale reply health after claim, changed recipients, unresolved attempts, provider acceptance followed by failed commit | No database transaction can recall a provider request already submitted; actual distributed races require integration/load tests |
| Caps and spacing | Exact daily-cap boundary and the milliseconds immediately before, at and after 60 seconds | Provider-specific quotas remain additional controls |
| Scheduler | Empty ticks, failed webhook dispatch, dispatch-marker ordering, owner-derived jobs, isolated job/scan/reconciliation failures | A webhook accepted before a lost marker commit may create duplicate executions; send claims remain the delivery guard |
| Reply collection | Cross-channel stop matrix, ambiguous identities, historical events, replay, missing/stale monitors, changed accounts, failed commits, lease fencing, cursor cycles, future timestamps and bounded pages | The new reply-monitor schema is absent locally; transaction-level receipt/hold/checkpoint integration remains unverified |
| LinkedIn service | Existing and newly established connections, unknown relationship evidence, same-key content binding, denied messages, throttles, live gates, uncertain writes and blocked redirects | Live response shapes, actual delivery and pending invitations on an unconnected profile need controlled provider validation |
| WhatsApp service | Mock sessions, incoming/history replies, LID resolution and conflicts, bounded paging, session restart, capacity/lease behaviour, authentication, malformed and oversized HTTP payloads | The optional PostgreSQL credential/lease tests remain skipped without their explicit integration configuration |
| Local PostgreSQL | Real restricted-role checks, same-org cross-owner isolation, cross-org version isolation, immutable versions, version uniqueness and mailbox lock contention | Tests use the existing schema and rollback-only synthetic fixtures; the new reply tables are not present |
| Actual local n8n | Webhook, retry wait, sequence wait, mixed channels, colliding titles, both acceptance branches, four subscription splits and terminal callbacks | Callbacks are dummy HTTP handlers; a persisted wait across an n8n process restart was not executed in this audit |

The existing app suite also exercises the separate draft-only outreach APIs and approvals, default-sequence creation, provider connection routes, message editing, status projection and reply-store contracts. Those tests were included in the full-suite run; the added tests focus on the campaign sequence pipeline.

## Verification results

Results were captured on 6 October 2026. The app baseline was 1526 passing tests, with 26 skipped. The final app run passed 1814 tests across 250 files, with 32 tests skipped across 11 files. Six of those skips are the opt-in local database tests, which were also executed separately and passed. Passing test totals are not a measured line or branch coverage percentage.

- Full app test suite: 1814 passed, 32 skipped; baseline 1526 passed, 26 skipped.
- Local campaign database integration: 6 passed, using existing tables and rolled-back fixtures.
- LinkedIn service: 65 passed in a scratch directory inside the existing Python container. The running service was not replaced or restarted.
- WhatsApp service: 37 passed, 2 optional PostgreSQL tests skipped.
- Real local n8n: the original no-send smoke test and all 8 adversarial scenarios passed. Test workflows were deleted afterward.
- TypeScript type checking and linting of the changed app/test/harness files passed.

Run the app tests and type checks with:

```sh
pnpm test
pnpm typecheck
```

Run the rollback-only core database tests against the dedicated local database with:

```sh
CAMPAIGN_AUDIT_LOCAL_DB=1 pnpm exec vitest run src/db/campaign-local.integration.test.ts
```

Run the actual n8n tests with a configured local API key, or the ignored key file expected by the scripts:

```sh
node --env-file=.env.local --experimental-strip-types scripts/test-campaign-n8n-workflow-local.mjs
node --env-file=.env.local --experimental-strip-types scripts/test-campaign-n8n-adversarial-local.mjs
```

Both scripts target loopback n8n on port 5679 and dummy callbacks on ports 3011/3012. They do not load recipient mailboxes or contact delivery providers. The optional `CAMPAIGN_N8N_PERSIST_WAIT=1` mode of the original script restarts the existing local n8n container; use it only when that instance can be interrupted.

## Work still requiring integration evidence

The missing local reply-monitor tables prevent a real test of event deduplication, receipt/hold/checkpoint atomicity, cross-owner identity propagation and monitor lease takeover with PostgreSQL. The pending migrations must receive explicit approval for the particular migration and environment before they can be applied. Mocked SQL checks must not be presented as proof that those database transactions work.

A complete confidence check also needs a browser session covering save/publish/enrolment confirmation, a persisted n8n wait across restart, full Acquire-to-n8n-to-local-sink executions with reply enforcement enabled, and controlled live channel validation. Jody's profile can exercise the existing-connection and messaging paths when message content is specified; it cannot establish invitation submission or acceptance coverage.

These gaps are recorded separately from passing checks so future work can close them without treating the current suite as complete coverage.

## Integration implementation and run order

The follow-up integration work found that the five reply-monitor tables are now present in the dedicated local database. No migration was applied by this harness. The earlier missing-schema observations above describe the original audit, not the current local database.

The implementation adds a single runner, `scripts/test-campaign-integration-local.mjs`, with this order:

| Stage | What the harness verifies | Isolation |
| --- | --- | --- |
| Preflight | Existing reply tables, local n8n health and API authentication | Fixed PostgreSQL on 5434 and n8n on 5679; no schema creation or migration |
| PostgreSQL | Core constraints, reply receipt/hold/stop/audit replay, page rollback, cross-owner ambiguity, duplicate contacts, observe-to-enforce rollout, simultaneous scans, expired leases, stale scanner fencing, partial checkpoints and failure recovery | Real restricted roles and pooled transactions; rollback-only reply fixtures and explicitly cleaned committed monitor fixtures |
| Provider HTTP | Account scope/authentication, connected-invitation skip result, LinkedIn/WhatsApp writes, Unicode text, cursor encoding, redirects and socket loss after write receipt | An ephemeral loopback HTTP server; no provider SDK, credentials or forwarding; synthetic recipients only |
| n8n | Original retry/sequence wait plus eight mixed-channel, branch and terminal-callback scenarios | Dummy callback handlers; synthetic workflows deleted on exit |
| App end to end (`--e2e`) | Authenticated signup, publication, enrolment, actual n8n dispatch, two sink deliveries across a compressed wait, completion, all three reply ingresses and late callback replay | Harness-owned Next app on 3013, separate build directory, pinned sink and database, enforced reply monitoring, live LinkedIn/WhatsApp services disabled |
| Browser (`--browser`) | Save and reload a hostile literal subject, render the flow editor, publish another immutable version, cancel and confirm subscription, pause and stop | Separate synthetic Playwright session against the owned app; screenshot under `output/playwright/`; no delivery for the browser contact |
| Restart (`--persist-wait`) | Durable n8n wait and exactly-once callback order across process restart | Explicit opt-in; refuses restart if other workflows are active or other executions are pending, or if pagination prevents proving isolation |

The database integration exposed a production defect: PostgreSQL inferred the freshness checkpoint's `CASE` parameter as text. `campaign-reply-monitor.ts` now casts that parameter to `timestamptz`, allowing successful and partial inbox pages to commit. The real database tests reproduce this failure without mocking SQL.

Run the suites with:

```sh
# PostgreSQL, real provider HTTP adapters and actual n8n callbacks
pnpm test:campaign:integration

# Add the harness-owned app and actual sink deliveries
pnpm test:campaign:integration --e2e

# Add the real browser workflow as well
pnpm test:campaign:integration --browser

# Only in a reserved/idle local n8n instance; this restarts its container
pnpm test:campaign:integration --persist-wait
```

The runner reads only the n8n API key and worker secret from `.env.local`; it pins the app's database, ports, auth origin, sink, provider switches and test timing itself. It never runs `pnpm dev`, starts containers, invokes a migration, resets the shared sink or kills an existing dev server. The test app refuses an occupied port. Full app tests require an idle local campaign database because tick processes subscriptions globally. Known Next-generated configuration changes are restored after shutdown while unrelated edits are preserved. Database and n8n cleanup are constrained to the run's synthetic organisation and workflows; cleanup failures fail the suite.

Executed follow-up evidence: 29 real database tests passed, 9 real provider HTTP tests passed, the original n8n scenario and eight adversarial scenarios passed, and the complete app/n8n/sink path passed with email, LinkedIn and WhatsApp reply enforcement. The real browser workflow passed save/reload, flow rendering, publication, cancellation, subscription confirmation, pause and permanent stop. Cleanup verification found zero synthetic database fixtures and zero test workflows remaining. LinkedIn/WhatsApp replies were synthetic HTTP ingestion events; their message delivery adapters were exercised against the loopback HTTP double, not live providers. Restart validation remains pending because the shared local n8n contains other active workflows. The guard was exercised and refused the restart.

The final follow-up app suite passed 1844 tests with 55 skipped; 29 of those skips are the opt-in database tests, all of which passed separately. The combined database, provider HTTP and harness isolation run passed 56 checks. Type checking, linting of the changed code and diff whitespace checks passed.

Remaining provider validation uses an explicit test recipient and specified message content. Jody's existing connection can validate invitation skipping and messaging; an unconnected test account is needed for invitation submission and acceptance. Those live checks, provider-side quota behaviour and outages outside the local doubles remain separate from this no-send suite.
