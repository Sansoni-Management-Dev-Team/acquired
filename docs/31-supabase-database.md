# Supabase database

Production uses Supabase project `njasjqpztiteionfxxul` with the existing Drizzle
Postgres adapter and Better Auth. Supabase Auth and the client Data API are not
used by the application.

## Configuration

Set these server-only Vercel production variables together and redeploy:

- `DATABASE_DRIVER=postgres`
- `DATABASE_URL`: the Supabase session pooler connection string, with its database password.
- `DATABASE_SSL_CA`: the Supabase root CA certificate in PEM format. The Postgres
  pool verifies the certificate and hostname, and uses at most five connections
  per process. Do not add conflicting SSL query options to the connection URL.

The local `.env` also preserves `SUPABASE_DATABASE_URL` and
`SUPABASE_DIRECT_DATABASE_URL`. The direct endpoint needs IPv6; the session
pooler supports IPv4. `pnpm dev` keeps using the local Docker database and clears
`DATABASE_SSL_CA` so production TLS settings do not affect localhost.

Supabase API keys are not Postgres passwords. Neither the service-role key nor
the database password should use a `NEXT_PUBLIC_` prefix.

## Migration, 16 September 2026

The user approved copying Neon into this Supabase project and switching the app
and Vercel configuration. The migration takes a fresh Postgres 18 custom-format
backup while holding SHARE locks on the source tables, then restores schema and
data in a single transaction without copying Neon role ownership or ACLs.

It preserves all 35 tables across `public`, `drizzle`, and `neon_auth`, including
authentication records and migration history. The imported `neon_auth` schema is
retained data; it does not enable Neon's hosted authentication service in Supabase.
Supabase's managed `auth`, `storage`, `realtime`, and `vault` tables are untouched.
Imported tables and sequences have no grants to PUBLIC, anon, or authenticated;
application access goes through the server database connection.

Validation compares row counts and sorted row-content hashes for every imported
table before cutover. Private backups and validation reports are under
`.local-data/backups/` and are not committed. Source writes remain blocked during
the cutover; Neon is retained afterwards for recovery.

Before reverting to Neon, account for any writes made to Supabase after cutover.
Reverting only the URL would lose visibility of those new records. Restore the
prior driver, URL, and TLS settings together if a rollback is needed. Never run
another database migration without approval for that specific migration.
