# Production release composition

The existing `acquire-app-01` host runs the Next application. This proposal adds a
separate communications API/worker and independent PostgreSQL database there.
The root GitHub workflow builds immutable app/service images from the same commit,
checks archive hashes and revision labels, validates configuration and both database
catalogs, deploys communications, then deploys the app. A failed app rollout restores
the previous app and any service release changed by that invocation. A retry of an
already-current service does not roll it back. Neither script executes migrations.

Production SQL and database initialization remain gated by the explicit approvals
in [the migration review](../../../docs/communications/production-migration-review.md).
Prepared files alone do not prove production initialization or a successful release.

## First release order

1. Verify the approved files/hashes and exact application target. Take and validate
   a fresh private application backup. Confirm the proposed service volume is absent
   and the existing host/network are the reviewed targets.
2. Only after specific approval, initialize the new named service volume/database
   using `database/compose.production.yml`. Capture its fresh system identifier,
   database/operator, marker and container/volume ownership. Take/validate its backup.
3. During a coordinated maintenance window, pause campaign dispatch and apply only
   the exact specifically approved service/application SQL in their reviewed order.
   Inspect partial or uncertain results; never automatically retry migration files.
   Preserve old bindings, holds, unresolved sends and history. A previous app image
   may not support the new writer fences: do not resume it blindly after DDL.
4. Provision private production environment files (mode0600), fresh distinct keys
   and immutable image configuration. Keep the existing authentication keys and DB
   CA. The shared Docker network resolves `acquire-communications-db`; PostgreSQL
   has no published host port. Do not import local account records or local vault keys.
5. Install the reviewed `Caddyfile` only when its service upstream is available;
   validate before reload. The existing approved origin serves `/v1/*` and the public `/health` contract probe to the
   communications listener and all other requests to Next. Do not enable logging of
   callback queries, authentication headers or provider bodies.
6. Merge the reviewed revision and let GitHub deploy both images. Verify exact
   current revision files, container health, authenticated app DB readiness, service
   schema/config readiness and HTTPS app/authentication/callback routing. Verify
   no unauthenticated private service access. Preserve rollback images/configuration.

The service and PostgreSQL limits are384/256MiB alongside the existing1400MiB app
limit on a2GiB host. These limits can be simultaneously overcommitted; inspect actual
usage and headroom during release and pause rollout if capacity is inadequate.
No peak-load or production soak result is asserted by these configuration files.

Sending quotas stay zero through initial rollout. Existing production accounts need
explicit owned-account setup/default selection and complete initial history/reply
coverage before sends are authorized. A healthy container alone does not prove any
of these conditions. Unchanged research/Cloudflare and n8n sources are not separate
new releases, and the independently preserved old services are not redeployed or
shut down by this rollout.
