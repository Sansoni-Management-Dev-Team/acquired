# WhatsApp linked accounts

A separate Node service runs Baileys in OrbStack. Settings → Channel connections
shows the QR code and connection state. The Next.js proxy derives organisation
and user from the authenticated session; the service checks current membership.
The HTTP listener binds only to localhost through Compose and requires a service
secret on every endpoint, including health. QR codes and credentials are never logged.

## Database approval

`drizzle/0014_whatsapp_channels.sql` was explicitly approved and applied to
local OrbStack Postgres on 1 October 2026. The separately approved
`drizzle/0015_whatsapp_shared_sessions.sql` was also applied locally on that date;
it adds an RLS-enabled lease table with a cascading connection foreign key and
expiry index. Both migrations were then explicitly approved and applied to the cloud Supabase
database on 1 October 2026. Cloud HTTPS health now returns 200.
It adds `whatsapp_connections` and `whatsapp_auth_keys`, with foreign keys,
owner uniqueness, status constraints and RLS enabled without browser policies.
It does not change Gmail or other existing tables. Obtain explicit approval for
this exact migration and database before applying it. Neither startup nor tests
create schema. Use a trusted server Postgres connection when hosted on Supabase;
ordinary Supabase browser roles have no access. Keep the encryption key outside
the database as a service secret.

## Local startup

After the migration has been approved and applied to local Postgres:

```sh
pnpm whatsapp:local
pnpm dev
```

The first command generates ignored mode-600 secrets under
`.local-data/whatsapp/service.env` and builds/starts the container at port 18095.
`pnpm dev` reads only these local WhatsApp settings, overriding any production
WhatsApp endpoint. Restart the app if it was already running. The WhatsApp
container is opt-in, so normal development works before the schema is installed.
Do not delete the encryption key while retaining encrypted sessions.

Connect in Settings, then scan using WhatsApp → Linked Devices → Link a Device.
After connecting, restart the container and verify it reconnects without a QR:

```sh
docker --context orbstack compose -f compose.local.yml restart whatsapp
```

Disconnect deletes stored credentials and keys and attempts to unlink the device.
If WhatsApp is unreachable, also remove Acquire from Linked Devices on the phone.
Credentials persist on changes; Signal key writes commit before returning.
Renewable Postgres leases prevent concurrent owners of the same session. Each
operation borrows a pooled connection briefly and checks ownership under a row
lock. Lease expiry permits takeover after a crash; a stale owner cannot write
credentials or release its successor's lease. Renewal failure closes the socket
without logging out the account. This requires migration `0015`, which was explicitly approved and applied
to local OrbStack Postgres. The cloud Supabase application of `0014` and `0015` was separately approved
and completed on 1 October 2026.
The default service cap is 32 accounts per container, configurable after measuring
real workload capacity. A process RSS admission threshold also bounds new sessions. Shutdown preserves
sessions, while logout clears them and requires a new scan. Each account has a bounded in-memory cache (by default 1,000 messages, 5,000 contacts
and a combined 2 MiB serialized-data budget);
message bodies are not saved in Postgres. Authenticated /history GET supports
contact-name filtering and /history POST requests a limited phone history sync
(30 days / 20 MB) or 100 older messages for a known chat. History availability
depends on the phone and is not a guarantee of a complete conversation.
Authenticated `/group` GET accepts `groupId` and returns participants with phone
numbers where group metadata or the stored LID mapping supplies them. Messages
also expose `participantAlt` and `remoteJidAlt` when supplied by WhatsApp. A LID
without a known mapping cannot be converted to a phone number by arbitrary lookup.
Authenticated `/message` POST accepts JSON `{ "recipient": "<direct JID>", "text": "..." }`
and submits one direct text message. Confirm the recipient's identity before using
it; a successful response reports submission, not delivery or reading.
This change does not enable campaign sends or reply automation.

## Verification

```sh
pnpm test:whatsapp
pnpm exec vitest run src/app/api/channels/whatsapp/route.test.ts
pnpm typecheck
```

After the approved local schema is installed, test the real encrypted Postgres
adapter (temporary test organisation/user are removed afterward; no schema changes):

```sh
DATABASE_URL=postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire WHATSAPP_DB_TEST=true pnpm test:whatsapp
```

To repeat manual lifecycle checks, pair and observe Connected, then restart and
verify Connected without rescanning. A deliberate disconnect should remove the
linked device; do not disconnect a working account just to rerun tests. The
automated tests do not send messages to real WhatsApp contacts.

## Current verification

The OrbStack image builds successfully. All nineteen service tests pass in OrbStack, including seventeen unit tests and
two real-Postgres integration tests; three app proxy
checks, TypeScript and targeted ESLint checks passed during initial implementation. A live unpaired
Baileys socket in OrbStack received a real WhatsApp pairing QR; the test discarded
it without displaying or saving it. The original local Postgres integration test passed after the approved `0014`
migration. The new lease and 100-account/two-connection integration tests passed after the
explicitly approved local `0015` migration. They verified takeover fencing,
transaction rollback, RLS, healthy leases and pooled connection availability. Actual phone pairing and restart restored
the connected account without rescanning. The shared-service update also restored the account without rescanning.
Group metadata lookup returned participant phone numbers using the existing linked account.

To repeat the live transport check without linking an account:

```sh
npm run test:qr:live --prefix services/whatsapp
```

## Shared-service configuration

`WHATSAPP_MAX_SESSIONS` defaults to 32, `WHATSAPP_DB_POOL_SIZE` to 12,
`WHATSAPP_MAX_RSS_MB` to 768, `WHATSAPP_LEASE_MS` to 60,000,
`WHATSAPP_RESTORE_INTERVAL_MS` to 30,000 and `WHATSAPP_CONNECT_SPACING_MS` to 500.
Renewal runs every one-third of the lease TTL. New connections and reconnects are
paced; reconnect retries also use jitter. Recovery checks the schema and retries
assigned stored accounts periodically, including after transient DB failures.
`WHATSAPP_HISTORY_MESSAGES`, `WHATSAPP_HISTORY_CONTACTS` and
`WHATSAPP_HISTORY_BYTES` set per-account serialized-cache budgets. This budget
bounds retained cache data, not total process RSS or Baileys' internal allocations.
Oversized entries are omitted from the cache; full history is not guaranteed.

`WHATSAPP_SHARD_ID` defaults to `primary`. `WHATSAPP_SHARDS` optionally specifies a
JSON map of fixed shard IDs to HTTP(S) origins. Assignment uses rendezvous hashing;
startup restores only assigned accounts. Any entry service forwards requests once
to the owning shard. Mutation timeouts are never automatically retried.
Authenticated `/metrics` reports session count, cap, shard ID and process RSS;
`/health` checks the required database schema, without creating it.

See [hosting decision and rollout instructions](../../ops/whatsapp/README.md).

## Production later

No Cloudflare deployment/configuration is included yet. The same service accepts
DATABASE_URL, optional DATABASE_SSL_CA, WHATSAPP_ENCRYPTION_KEY and
WHATSAPP_SERVICE_SECRET. The app accepts WHATSAPP_SERVICE_URL and
WHATSAPP_SERVICE_SECRET. Cloudflare will need authenticated Worker routing,
container lifecycle/restart management and account routing. Use separate local
and production sessions and keys. Review resource cost and lifecycle behavior
before deploying persistent sockets.
