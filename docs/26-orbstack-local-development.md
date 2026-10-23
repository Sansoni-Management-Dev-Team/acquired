# OrbStack local development database

## Full app at acquire.orb.local

From this checkout, run `pnpm dev:orbstack` to start the Next.js app and local
research worker at **https://acquire.orb.local**, with
**http://localhost:3020** as the direct localhost transport. Use the HTTPS
OrbStack address in the browser so secure-context APIs such as
`crypto.randomUUID()` are available. This is separate from the agent-mode
worktree at `acquire-agent.orb.local`. Source edits appear through Next.js hot reload.

The launcher combines `compose.local.yml` with `ops/local/compose.yml`. It uses
this project's existing PostgreSQL database, Crawl4AI and OpenSERP services.
PostgreSQL must already be running (`pnpm db:local:start`); startup performs the
existing read-only research schema preflight and never applies migrations.
An `OPENROUTER_API_KEY` in `.env.local` is required, as with `pnpm dev`.

Dependencies, Next.js output and local workflow state use dedicated Docker
volumes. The checkout is mounted read-only except for an ignored generated
`next-env.d.ts`. Runtime configuration and generated local secrets are private
files in `.local-data/orbstack/`. Container dotenv mounts mask the host `.env`
and `.env.local`; the local runtime receives only explicitly selected provider
settings and always uses local PostgreSQL. The research worker retains the
existing loopback-only service policy through fixed internal TCP relays.

`TARGET_DATA_PROVIDER=live` enables sourced company discovery rather than fixture
companies. A bounded authenticated smoke run has verified the demo's mandate
creation and research-launch APIs and saved 21 companies. It was cancelled once
results appeared; full enrichment and completion were not certified. Firmable
session/API enrichment is not configured by this launcher.

Communications activation and campaign scheduling are disabled in this local
runtime. Live messaging, existing n8n workflows, and OAuth provider redirect
registration are not configured by this command. Email/password sign-in uses
the existing local database; Google sign-in needs its new callback origin
registered separately with the provider.

```bash
pnpm dev:orbstack          # build development image, install, start and wait
pnpm dev:orbstack status
pnpm dev:orbstack logs
pnpm dev:orbstack stop     # stop app/worker/relays; retain data and dependencies
```

When changing dependency manifests, rerun `pnpm dev:orbstack`. To replace the
network namespace owner, stop `app`, `research` and `local-transports` first,
then recreate those services together with `local-network` through the same
Compose overlay. Do not use `--remove-orphans` or `down -v`: the project also
contains historical services and persistent database volumes.

### Remote data snapshot (2026-10-18)

The local database now contains a consistent, data-only snapshot of all 62
remote `public` application tables: 82,904 rows, including 98 mandates,
4,883 companies, 3,444 contacts and 11 users. Row fingerprints for every table
and all 140 foreign keys passed verification before the local transaction
committed. The matching existing schema and 17-entry migration ledger were
retained; no migration was applied and the remote database was read only.
Supabase-managed service schemas are outside this application-data snapshot.

The previous local database backup and remote data archive are private files
under `.local-data/orbstack/remote-copy/2026-10-18T12-34-46-475Z/`; see
`snapshot.json` there for scope, hashes and verification evidence. Sign in again
after the copy. Provider activation and credentials are not enabled by copying
historical connection data. The old `project-acquire-whatsapp` container was
stopped before import and remains stopped so copied sessions are not activated.

## Database setup

Local development uses a dedicated PostgreSQL container. Deployed environments continue to use
Neon through its HTTP driver.

## Safety boundary

Starting this container creates PostgreSQL's empty `project_acquire` database and its development
user. It does not create application or Better Auth tables, seed data, or run Drizzle Kit.

Never run or apply a database migration without explicit user approval for the specific migration
files and target database. In particular, do not apply the existing `drizzle/0000_initial.sql`,
`drizzle/0001_opportunity_qualification.sql`, or
`drizzle/0002_auth_issuer_compatibility.sql` to this local database until that approval is given.

## Local database identity

| Setting | Value |
| --- | --- |
| Container | `project-acquire-postgres` |
| Volume | `project-acquire-postgres-data` |
| Image | `postgres:17-alpine` |
| Database | `project_acquire` |
| User | `project_acquire` |
| Address | `127.0.0.1:5434` |

The port is bound only to localhost. The Compose project does not join or alter any network from
another project.

## Setup

OrbStack must be running with its Docker compatibility enabled. Copy the example environment file
only when creating your local configuration; never overwrite an existing `.env.local`:

```bash
cp .env.example .env.local
```

The local database settings in that file are:

```dotenv
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire
```

Fill in the other provider and authentication settings needed for the workflow you are testing.
Then manage the empty database with:

```bash
pnpm db:local:start
pnpm db:local:status
pnpm db:local:logs
pnpm db:local:stop
```

`db:local:stop` stops the container without deleting the named volume. There is deliberately no
reset or delete-volume script. None of these commands runs migrations or starts Next.js.

After the application's migrations have been separately approved and applied to this exact target,
run `pnpm dev`. Until then, database-backed registration and application workflows will fail because
the empty database has no application or Better Auth tables.

`pnpm dev` serves the app at `http://localhost:3010`. Set `APP_URL` and
`NEXT_PUBLIC_APP_URL` to that address in `.env.local`. For Google OAuth, register
`http://localhost:3010/api/auth/callback/google` and
`http://localhost:3010/api/mailbox/google/callback` as authorized redirect URIs,
and set `GOOGLE_GMAIL_REDIRECT_URI` to the mailbox callback URL.

## Driver selection

`DATABASE_DRIVER` is mandatory whenever `DATABASE_URL` is set. Selection never depends on
`NODE_ENV` and there is no URL-based fallback:

- `DATABASE_DRIVER=postgres` uses `pg.Pool` with `drizzle-orm/node-postgres` for a normal TCP URL.
- `DATABASE_DRIVER=neon` uses `@neondatabase/serverless` with `drizzle-orm/neon-http`.

Local PostgreSQL pools are cached across Next.js hot reloads. Connection strings and credentials are
not logged. An invalid or missing driver fails with an explicit configuration error. Production also
fails closed when `DATABASE_URL` is absent.

For a deployed Neon environment, configure both server-only variables in the deployment platform:

```dotenv
DATABASE_DRIVER=neon
DATABASE_URL=postgresql://...the-deployment-neon-url...
```

Neither variable has the `NEXT_PUBLIC_` prefix, so it must not be referenced from client code.
`drizzle.config.ts` continues to accept either local PostgreSQL or Neon through `DATABASE_URL`, but
running Drizzle Kit still requires the migration approval described above.
