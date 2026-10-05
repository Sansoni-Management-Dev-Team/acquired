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

Budgets use trailing hour/24h/7d windows, count attempted logical provider operations before dispatch, and survive container restarts in encrypted files. They do not count every subresource request generated by a normal page load. A single service process serialises operations for each owner. Live sends remain gated by `LINKEDIN_ALLOW_LIVE_SENDS=false`; the UI cannot enable them. Successful POSTs mean submitted, not verified delivered. Approved actions expire after 24 hours; drafts after seven days. Uncertain outcomes never retry automatically. Known rejected actions require a new draft and approval. Browser pause preserves the queue and prevents automatic browser restart until explicitly resumed.

GET `/inbox` serves the saved inbox when present, including while the browser is paused. POST `/inbox` requests a budgeted refresh. Both report the sync timestamp and freshness; cache is encrypted with the session. Settings polling only reads service state. Provider 429 responses cause persistent, escalating cooldowns of at least 15 minutes. Authentication/challenge/999/redirect responses require user attention. Invitation-limit errors stop activity for seven days. Three other request failures trigger a one-hour circuit breaker. Recovery clears the verification flag only after the browser is connected, and retains cooldowns/usage.

### Optional session keep-alive

Enable **occasional read-only feed activity** in settings. It visits `/feed/` and performs one to three small scrolls, with variable intervals (45–180 minutes by default), on its own configured days (all seven days by default), within the configured timezone and daytime hours. Pausing outreach does not pause keep-alive. It has no like/comment/follow/message/invitation operations. It uses the same overall budget and cooldown checks, defers while a viewer is connected or actions are queued, and stops on verification. Off-hours visits are delayed with an additional variable offset. The worker saves session state every maintenance cycle. Enabled sessions can resume after a service restart unless the user explicitly paused the browser. This keeps a browser allocated and does not guarantee that LinkedIn will retain the session or refrain from detecting automation.

Persistence and locking are for this single-process test deployment. Do not horizontally replicate it against the same state directory. Separate Acquire owner connections are not yet consolidated if the same physical LinkedIn account is linked across workspaces; prevent that before a multi-workspace production rollout. Shared queue/quota storage and production app enablement remain separate work. No database migration or proxy settings are required for this test implementation.
