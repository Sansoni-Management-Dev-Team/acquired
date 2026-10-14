# Acquire communications production host

This packages the existing `scripts/communications-service-entry.ts` and trusted
Acquire composition as a separate Node process. It includes the reusable
communications packages plus Acquire membership, reply-consumer and send-admission
policy. It is not the framework-independent package by itself. The image uses
root-lockfile production dependencies, including dependencies shared with Acquire.

## Prepared artifacts

- `Dockerfile`: Node 22.23.1, pnpm 11.8.0, frozen lockfile, compiled service and
  configuration preflight, production dependencies, non-root runtime.
- `Dockerfile.dockerignore`: service-specific allowlist. Runtime environment files,
  private `.local-data`, tests, SQL and local dependencies are excluded.
- `compose.production.yml`: existing service image, host-loopback port 18099,
  read-only filesystem, dropped capabilities and bounded logs. It does not create
  a database, volume, role, schema or account.
- `env.production.example`: names only; operator must provision production values.
- `healthcheck.mjs`: actual `/health` response and contract version check.

## Required production decisions

An approved host, persistent PostgreSQL target and HTTPS service origin are needed.
The separate service database and application database must remain distinct. A
private PostgreSQL container or managed database must have durable storage and
appropriate backups; this compose file deliberately does not bootstrap it.
Database creation, roles and every SQL artifact require specific user approval for
that production target. Local approvals do not authorize production changes.

Provision new production encryption/digest, identity, scoped-auth, callback and
webhook keys privately. Preserve their versions and backups for recovery. Never
copy local vault keys, account generations or local connected accounts into
production by inference. The application and service must use matching production
scoped-auth/application keys and authoritative database bindings. The current app
also instantiates trusted Acquire composition for configured campaign work; this
service container does not remove its need for that configuration.

The operator must supply `DATABASE_URL` (application) and
`COMMUNICATIONS_DATABASE_URL` (communications), HTTPS `COMMUNICATIONS_SERVICE_URL`,
`COMMUNICATIONS_REDIRECT_ORIGIN` (application origin) and
`COMMUNICATIONS_SETUP_NOTIFY_URL` (service `/v1/setup/notify` URL without a query).
See `env.production.example` for the remaining required runtime names. The
application DB accepts `DATABASE_SSL_CA_BASE64`, strictly decoded by `runtime.mjs`
before importing the service (an existing explicit `DATABASE_SSL_CA` is also
supported, but both must not be supplied); the service pool currently receives its
TLS configuration through its connection string. Select and verify the production
DB transport before rollout; do not assume local loopback settings apply remotely.

Keep all four sending limits zero until owned-account checks, reply/history
coverage and explicit activation have been completed. Starting this service runs
its background worker, which renews membership authority and consumes retained
webhook/outbox work; startup is therefore an operational activation step, not an
inert packaging check.

## Build and verify without runtime activation

From the repository root, with an exact reviewed commit:

```sh
docker build --platform linux/amd64 \
  -f ops/communications/production/service/Dockerfile \
  --build-arg SOURCE_COMMIT=<reviewed-40-character-commit> \
  -t acquire-communications:<reviewed-release> .
node --test scripts/communications-production-package.test.mjs
```

The configuration preflight uses the actual runtime constructors with ports that
cannot connect to a database. It never loads an env file itself, opens a listener,
queries storage or calls a provider. With an explicitly prepared private runtime
file, it can be run using the image and `--entrypoint node`, passing
`runtime.mjs --check-config` so hosted CA decoding is included. An absent/invalid configuration produces only a
redacted error and a nonzero exit status. A pass does not verify database readiness,
credentials with the provider, account ownership or permission to send.

Before starting the approved release, separately review storage/schema readiness,
role grants, application/service compatibility and HTTPS routing. Existing startup
also calls the real store preflight before opening its listener. Container health
then proves process reachability and contract version only; it is not complete
send readiness or database-history completeness.

## Routing and release

The host port binds only `127.0.0.1:18099`. A reverse proxy must terminate TLS and
route the intended HTTPS service hostname to it. Preserve raw request bytes and
authentication headers for `/v1/webhook`; setup callbacks use
`/v1/setup/notify?...`. Other `/v1/*` routes require scoped service authentication.
Do not log callback query parameters, authorization headers or provider bodies.
Provider webhook registration is a separate reviewed operational change; merely
exposing this listener does not register webhooks.

Pin the verified image/revision in the operator's release configuration; retain
the prior image and compose/runtime configuration for rollback. Do not replace
private runtime configuration with example values during deployment. Stop the
candidate and restore the prior release on failed preflight, health or scoped
application integration checks. Rollback must preserve database records and
unresolved-send generations; no schema rollback or provider fallback is implied.
