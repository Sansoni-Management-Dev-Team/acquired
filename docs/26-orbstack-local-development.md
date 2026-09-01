# OrbStack local development database

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
