# Local LinkedIn prototype

Start in the project root with OrbStack selected:

```sh
pnpm linkedin:local
pnpm dev
```

Open http://localhost:3010/settings, sign in to Acquire, and choose **Connect LinkedIn**. The embedded screen streams Chromium through noVNC; LinkedIn itself is not framed. Enter credentials and handle verification in that screen. Open Messaging after login, then choose **Read conversations via API**. **Save and pause browser** encrypts LinkedIn cookies and local storage, releases the worker, and revokes viewer links. Resume recreates a browser and restores the state. Disconnect removes that owner's encrypted local state and action journal.

The optional `node scripts/test-linkedin-app-local.mjs` checks the real app authentication and proxy using a synthetic local test user and organisation. It leaves that test workspace in the local database and records its login in ignored `.local-data/linkedin/app-test.json`; it never modifies real users or applies a migration.

For no-send testing, choose **Test with fictional account**, sign in as Test User, and read its inbox. Use `urn:li:fsd_profile:fictional-alex` for a fictional invitation or message. Review the exact draft before approving it. Pause before switching between real and fictional browsers. Connect LinkedIn always chooses real mode; the fictional button resumes fixture mode.

```sh
pnpm test:linkedin
pnpm test:linkedin:smoke
pnpm exec vitest run src/app/api/channels/linkedin/route.test.ts
```

The smoke test uses a real Chromium browser with fictional provider routes. It checks VNC streaming, API reads, approved fictional writes, replay protection, encrypted cookie/localStorage restore, viewer revocation, two isolated workers and bounded capacity. When a local model key exists it also runs Browser Use inspection on fictional content. It cleans up only the three dedicated smoke-test owners.

## Design and limits

- One OrbStack container, two isolated Chromium/Xvfb workers; 3 GiB container memory limit. This is a local capacity test, not a production sizing benchmark for hundreds of accounts.
- The Next route derives organisation/user ownership from the authenticated session and checks mutating request origins. The service listens only on localhost and requires a private bearer secret. Viewer grants expire after 15 minutes and are revoked on pause, disconnect and agent inspection.
- Keys and Fernet-encrypted state live in ignored `.local-data/linkedin/`; credentials are never returned to the app. Plaintext Chromium profiles exist temporarily inside the container and are removed on close or the next startup. Protect the service environment key: losing it prevents state recovery.
- Browser Use has only `done` and `read_current_page` tools. Inspection sends visible page content to the configured model provider and suspends the human viewer. A local OpenAI key, or OpenRouter key as fallback, is copied into the private service environment on first setup. No key is required for manual login/API reads.
- The frontend API adapter derives CSRF from Chromium cookies and captures Messaging's exact GET request (query ID, mailbox URN, variables and sync token when present). Payloads were informed by the user's Lattice extension. LinkedIn's private endpoints can change; live inbox payload compatibility and live writes still require account testing. Successful HTTP dispatch is called `submitted`, not delivery confirmation.
- Live sends are disabled by default and have no enabled UI send button. Invitation/DM execution is verified against fixtures only. No real outreach is performed by tests. An uncertain operation is recorded before dispatch and cannot be automatically retried, including after restart. Action records are bound to real/fixture mode.
- No residential proxy, background campaign scheduling, contact search, incremental database inbox sync, session lease across multiple service instances, or production deployment is included yet. Local testing uses the host's normal network connection.
- Sessions use encrypted local files. No Supabase/Postgres schema changes or migrations are applied. Database integration needs a separately reviewed, specifically approved migration.

Do not expose this local service to the internet. Production needs authenticated TLS viewer routing, persistent key management, durable account jobs and leases, provider rate-limit handling, monitoring, and per-account proxy configuration if chosen.

Session saving reads cookies and local storage from the existing LinkedIn page. It does not export third-party origins or IndexedDB, avoiding temporary visible tabs. Status polling does not trigger a session export; the background save runs every ten seconds.

### Activity settings and queue

The LinkedIn card now exposes limits, working hours/timezone, usage, an approved-action queue, cancellation, recovery, and recent activity. `GET/POST /settings` and `GET /queue` are authenticated by the same owner-scoped proxy as the connection. Defaults: 10 invitations/24h, 50/7d, 20 messages/24h, 100 profile reads/24h, 20 total logical requests/hour and 200/24h. Spacing defaults to a randomly selected 120–600 seconds. These are application settings, not verified LinkedIn allowances. Profile-read limits are ready for a future profile adapter; the current adapter supports inbox, invitations, and messages.

Reply-reader pages use 20–40-second spacing between consecutive reader requests, while still counting every page against those shared hourly/daily limits and respecting verification, provider cooldowns and spacing after other account activity. Other actions retain their configured spacing. A completed sweep waits until at least three minutes from its start before another begins. The previous sweep's conservative coverage timestamp remains available during that next sweep; Acquire still rejects coverage older than five minutes. Reaching account limits can therefore hold outreach even after a scan has completed.

The reader verifies the observed base64 `DESCENDING&<activity timestamp>&<tie breaker>` continuation against the page's descending `lastActivityAt` values. It stops a folder once that verified boundary precedes the subscription scope, while still collecting recent threads on that page and scanning all four folders. Old dates, short pages, unknown cursor formats and mismatched timestamps do not establish completion. Protocol-v1 partial scans restart under protocol v2 with the current owner subscription scope. Removing an old subscription can narrow the requested date instead of preserving a retired broad history request forever. Durable inbound events and account-bound app checkpoints are retained.

Budgets use trailing hour/24h/7d windows, count attempted logical provider operations before dispatch, and survive container restarts in encrypted files. They do not count every subresource request generated by a normal page load. A single service process serialises operations for each owner. Live sends remain gated by `LINKEDIN_ALLOW_LIVE_SENDS=false`; the UI cannot enable them. Successful POSTs mean submitted, not verified delivered. Approved actions expire after 24 hours; drafts after seven days. Uncertain outcomes never retry automatically. Known rejected actions require a new draft and approval. Browser pause preserves the queue and prevents automatic browser restart until explicitly resumed.

GET `/inbox` serves the saved inbox when present, including while the browser is paused. POST `/inbox` requests a budgeted refresh. Both report the sync timestamp and freshness; cache is encrypted with the session. Settings polling only reads service state. Provider 429 responses cause persistent, escalating cooldowns of at least 15 minutes. Authentication/challenge/999/redirect responses require user attention. Invitation-limit errors stop activity for seven days. Three other request failures trigger a one-hour circuit breaker. Recovery clears the verification flag only after the browser is connected, and retains cooldowns/usage.

### Optional session keep-alive

Enable **occasional read-only feed activity** in settings. It visits `/feed/` and performs one to three small scrolls, with variable intervals (45–180 minutes by default), on its own configured days (all seven days by default), within the configured timezone and daytime hours. Pausing outreach does not pause keep-alive. It has no like/comment/follow/message/invitation operations. It uses the same overall budget and cooldown checks, defers while a viewer is connected or actions are queued, and stops on verification. Off-hours visits are delayed with an additional variable offset. The worker saves session state every maintenance cycle. Enabled sessions can resume after a service restart unless the user explicitly paused the browser. This keeps a browser allocated and does not guarantee that LinkedIn will retain the session or refrain from detecting automation.

Persistence and locking are for this single-process test deployment. Do not horizontally replicate it against the same state directory. Separate Acquire owner connections are not yet consolidated if the same physical LinkedIn account is linked across workspaces; prevent that before a multi-workspace production rollout. Shared queue/quota storage and production app enablement remain separate work. No database migration or proxy settings are required for this test implementation.

### Sequence actions and acceptance branches

The sequence editor distinguishes **Send connection request** (an optional note,
limited to 200 characters after personalisation), **Send message** (confirmed
connections only), and **Wait for acceptance**. The last action adds a condition
branch after a main-sequence connection request: path A when connected, path B
when still unconnected at the configured 1–30 day timeout. Each path's wait starts
when its outcome is recorded. Unknown relationship data holds for review and does
not count as a rejection. Existing LinkedIn nodes remain messages. A/B allocation
is separate and retains its stable routing.

The app worker now calls the private owner-scoped `/campaign` endpoint with a
stable enrolment/step key. The encrypted service journal prevents replay after a
submitted or uncertain request and rejects changed content under the same key.
Already-connected invitation recipients are skipped. Campaign queues run only
when the app calls for an eligible enrolment; background maintenance never sends
them, so stopping/pausing an enrolment cannot leave an independently running queue.
As with email, an operation already dispatched can finish after a concurrent pause.
Branch decisions use existing audit-event JSON; **no database migration is needed**.

Implementation references reviewed locally:
- Lattice `extension/src/classes/LinkedInClient.ts`: invitation/message payloads,
  `fetchProfileNetworkInfo` and `TopCardSupplementary-142` relationship reads.
- Bella `bella/app/chrome_plugin/src/classes/LinkedIn.ts`: DM attributed body,
  recipient URN, conversation creation, and origin-token fields.

This integration is disabled by default. `CAMPAIGN_LINKEDIN_ENABLED=true` on the
app permits publishing/running LinkedIn sequences when service credentials are
configured. Real accounts additionally require `LINKEDIN_ALLOW_CAMPAIGNS=true`
and the existing `LINKEDIN_ALLOW_LIVE_SENDS=true` on the service. These gates are
not enabled by this change. The live profile response and private write endpoints
still need account-specific verification; tests use synthetic provider responses.
A 2xx write means **submitted**, not delivery confirmed. Gmail and an email address
remain required by the existing enrolment system. LinkedIn DM reply monitoring is
not implemented: only email replies stop a sequence automatically. Do not enable
unattended real campaigns until that operational limitation is acceptable and live
compatibility has been verified. WhatsApp publication remains blocked.

Additional no-send tests: `pytest -q test_campaign.py`. These cover target-bound
relationship parsing, invitation skips, unknown/nonconnected recipients, note
limits, queue isolation, idempotent submission, and live feature gating.

### Existing-conversation message contract (local update)

The message adapter now uses `voyagerMessagingDashMessengerMessages?action=createMessage`,
matching the successful manual browser capture reviewed on 2026-10-07. It sends a
UUID origin token, separate 16-character tracking ID, mailbox URN, conversation
URN, and the observed JSON/text headers using the current browser session's CSRF
cookie. No HAR credentials are copied into code or fixtures.

Before sending, the service requires exactly one complete non-group conversation
whose participants are the current mailbox and intended recipient. It uses the
account's recent inbox response, refreshing through the captured read request
when stale and respecting request spacing before the write. Cache freshness
covers the configured spacing window. This lookup does not paginate or create a
new conversation: a recipient absent from the captured inbox requires a Messaging
refresh and a fresh draft. The service never guesses the target from the open chat.

A successful message response must contain a matching `value.entityUrn`, origin
token, conversation and body. Missing confirmation or a timeout remains uncertain
and cannot be automatically retried. The encrypted action journal records the
endpoint, HTTP status, redirect flag, numeric provider error codes, target thread,
origin token and confirmed message ID; raw error bodies and authentication headers
are excluded. Fixture coverage checks the modern wire contract and session restore.
A user-approved existing-conversation message sent through the local OrbStack
service on 2026-10-07 returned HTTP 200 with a matching receipt and appeared once
in the live browser. Live sends were disabled again afterward. Other accounts,
new conversations and unattended campaign sending remain unverified.

### Request tracing

Local app proxy calls emit JSON `linkedin.service_request.start/end/error` lines
in `.local-data/dev-start.log`. The service emits JSON diagnostics to stdout;
inspect them with `docker logs --since 10m project-acquire-linkedin`. Each app
request passes a validated `X-LinkedIn-Trace-Id`, returned on the response and
shared by service HTTP, account-lock, browser and provider events. Dispatched
actions also retain `traceId` in the encrypted journal; background dispatches
allocate their own trace. Viewer URLs and query variables are excluded.

Each span logs `.start` before awaiting work, then `.end` or `.error` with elapsed
milliseconds. Browser events distinguish process launch, CDP connection, saved
context restoration, page setup, login versus Messaging navigation, renderer
checks, recovery and shutdown. Provider events include endpoint/method, status,
redirect/retry metadata, numeric error codes and receipt presence. Action events
show recipient/thread verification using hashed identifiers and the final state.
An unmatched start event shows work still pending or a process interrupted during
that phase. Exceptions log their class only; message content, request/response
bodies, cookies, authentication headers and raw exception text are never logged.
The local Compose service also persists diagnostics under
`.local-data/linkedin/state/diagnostics.jsonl`, with two rotated backups and a
2 MiB limit per file. Files are mode 600 and survive container recreation.
Set `LINKEDIN_DIAGNOSTICS_PATH` to a writable persistent path to enable this
additional sink in another environment; stdout logging remains enabled.

### Connection-request contract (local validation)

The local invitation adapter follows the successful browser HAR reviewed on
2026-10-07: `verifyQuotaAndCreateV2`, the
`InvitationCreationResultWithInvitee-2` decoration, and
`invitee.inviteeUnion.memberProfile`. It uses the observed normalized JSON headers
and current session CSRF cookie. A confirmed submission requires matching
`data.value.invitationUrn`, `*invitation` and an included invitation entity.
An unconfirmed response stays uncertain and cannot be automatically retried.
The capture covers requests without a note; unverified invitation notes are
rejected before provider requests.

Connection checks also resolve the target profile's stateful-action references
to its MemberRelationship and Connection, requiring the connected member to match
the target. Unrelated included connections and ambiguous evidence cannot establish
the relationship. Existing distance-based parsing remains supported. Confirmed
existing connections skip invitations; unknown status holds for review. This
checks accepted connection status; it does not independently verify whether an
outstanding invitation is still pending or has been withdrawn.

Tracing covers relationship cache hits/misses, read budgeting, provider reads,
parsing, skips/rejections, account locks, write budgeting, payload construction,
durable attempt persistence, provider writes and the final action state. These
local changes have fixture coverage and a real existing-connection read check.
On 2026-10-07, one user-approved invitation without a note sent through the local
OrbStack service returned HTTP 200 with a matching invitation receipt; the
intended recipient's live profile then showed Pending. Live sends were disabled
again and the original outreach hours restored. This verifies submission of that
request, not recipient acceptance or broader account compatibility.

A second local test on 2026-10-07 sent exactly one approved request without a
note and returned HTTP 200 with a matching invitation receipt. All 39 correlated
send events survived container recreation. The profile subsequently showed a
first-degree connection, and a fresh API relationship check returned connected.
The hosted Compose overlay enables the same bounded persistent diagnostic sink
in the existing encrypted-state volume; message bodies and credentials remain
excluded. Live sends remain disabled by default.
