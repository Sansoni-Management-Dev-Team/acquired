# OrbStack local development database — agent handoff

## Objective

Give Project Acquire an isolated PostgreSQL database running in OrbStack for local development,
while retaining Neon Postgres for deployed environments.

Local `pnpm dev` must no longer write test organisations, target searches, contacts, signals,
outreach drafts, or audit events into the configured remote Neon database.

## Non-negotiable migration safety rule

**Do not run or apply any database migration without explicit user approval for that specific
migration and target database.**

This includes applying the existing migrations to a newly created local OrbStack database.
Creating the container and implementing the driver/configuration switch are allowed, but stop and
ask the user before executing any of:

- `drizzle-kit migrate`
- `drizzle-kit push`
- `psql -f drizzle/*.sql`
- Supabase migration/reset commands
- any equivalent schema-creating or schema-changing command

The migrations currently present are:

- `drizzle/0000_initial.sql`
- `drizzle/0001_opportunity_qualification.sql`
- `drizzle/0002_auth_issuer_compatibility.sql`

They were previously approved and applied to the configured Neon database on 26 August 2026.
That approval does **not** imply approval to apply them to a new local database.

## Current state

- Local `.env` currently points `DATABASE_URL` at remote cloud Postgres.
- `src/db/client.ts` always uses:
  - `@neondatabase/serverless`
  - `drizzle-orm/neon-http`
- `pg` is already a production dependency.
- There is no Docker Compose file or Project Acquire-specific database container.
- Other OrbStack/Supabase/Postgres containers are running for unrelated projects. Do not reuse,
  stop, rename, modify, or delete them.
- Authentication uses Better Auth with the same database connection, so the local database must
  contain both product and auth tables before the app is usable.
- The repository may contain unrelated uncommitted and untracked user changes. Preserve them.

## Recommended topology

Create one dedicated container and volume, with explicit project-scoped names:

```text
container: project-acquire-postgres
volume:    project-acquire-postgres-data
database:  project_acquire
user:      project_acquire
host:      127.0.0.1
port:      choose an unused port, preferably 5434 after verifying availability
image:     postgres:17-alpine (or another explicitly documented supported version)
```

Bind only to `127.0.0.1`, not all interfaces.

Do not rely on a broad or pre-existing Docker network owned by another project.

## Implementation requirements

### 1. Container configuration

Add a clearly named local-only Compose file, for example:

```text
compose.local.yml
```

It should contain:

- the dedicated PostgreSQL service;
- a named persistent volume;
- a health check using `pg_isready`;
- an explicit localhost-only port binding;
- development-only credentials that are safe to document in `.env.example`;
- no automatic migration or schema mutation on startup.

Starting the container must create only the empty PostgreSQL database/user supplied by the image's
normal initialization. It must not apply application migrations.

### 2. Environment-aware Drizzle driver

Refactor `src/db/client.ts` so:

- remote Neon URLs use `drizzle-orm/neon-http` with `@neondatabase/serverless`;
- local TCP URLs use `drizzle-orm/node-postgres` with a `pg.Pool`;
- both expose the same schema-aware Drizzle database interface to the rest of the app;
- production still fails closed when `DATABASE_URL` is absent;
- pools are reused across Next.js hot reloads rather than creating a new pool per module reload;
- no credentials or connection strings are logged.

Do not infer the driver only from `NODE_ENV`: a developer may intentionally point a local build at
Neon. Prefer an explicit environment option such as:

```text
DATABASE_DRIVER=postgres | neon
```

If a safe URL-based fallback is added, document its exact precedence and test it.

### 3. Drizzle Kit configuration

Keep `drizzle.config.ts` compatible with both local PostgreSQL and Neon through `DATABASE_URL`.
Do not run Drizzle Kit against either database during implementation without the required approval.

### 4. Local environment documentation

Document non-secret example settings similar to:

```dotenv
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire
```

Do not overwrite the user's ignored `.env` automatically. Provide an explicit copy/edit step.

The current main-agent work is also editing `README.md` and `.env.example`. To reduce conflicts,
prefer putting detailed OrbStack instructions in a new dedicated document and make only minimal,
carefully reviewed edits to shared files.

### 5. Commands/scripts

Provide convenient non-destructive commands, either in `package.json` or documentation, for:

```text
start local database
stop local database without deleting its volume
show database health/status
tail database logs
```

Do not add a reset/delete-volume command unless it has a conspicuous confirmation boundary.

Do not make `pnpm dev` automatically start, migrate, reset, or seed PostgreSQL.

## Testing requirements

Tests must not require a live database unless they are explicitly opt-in integration tests.

Add unit coverage for database-driver selection where practical:

- explicit `DATABASE_DRIVER=postgres` selects `node-postgres`;
- explicit `DATABASE_DRIVER=neon` selects Neon HTTP;
- missing/invalid driver fails with a useful message;
- production without a URL still fails closed;
- secrets are not printed.

Run the normal non-mutating verification suite:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Starting an empty PostgreSQL container and checking its health is allowed. Connecting read-only to
confirm server/version/database identity is allowed. Do not create application tables before the
approval gate.

## Required approval checkpoint

Once the empty OrbStack database is healthy and the code/configuration work passes verification,
stop and ask the user a question equivalent to:

> Do you approve applying `drizzle/0000_initial.sql`,
> `drizzle/0001_opportunity_qualification.sql`, and
> `drizzle/0002_auth_issuer_compatibility.sql` to the local OrbStack database
> `project_acquire` at `127.0.0.1:<chosen-port>`?

Do not proceed until the user explicitly approves those migrations for that exact local target.

## Acceptance criteria after approval and migration

After approval is received and the migrations are applied to the local database:

1. `pnpm dev` starts with the local `DATABASE_URL`.
2. Registration and organisation creation write only to the OrbStack database.
3. A target search persists its mandate, enriched targets, signals, and audit events locally.
4. `/outreach` reads the locally persisted targets.
5. Restarting Next.js retains data through the named volume.
6. The remote Neon row counts remain unchanged during the local verification.
7. Production configuration continues selecting Neon HTTP.
8. No database credential appears in browser bundles, application logs, or Git-tracked secret files.

## Suggested handback

Report:

- files added or changed;
- chosen container, volume, database, and port names;
- driver-selection behavior;
- tests/build results;
- whether the migration approval checkpoint is still pending;
- if migrations were approved and applied, the exact approved target and migration files;
- evidence that local writes stayed local and Neon remained untouched.
