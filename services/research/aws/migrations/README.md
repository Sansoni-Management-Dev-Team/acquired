# AWS research initialization and application record

Status: **000 and001 applied and verified on30October2026**. The historical
proposal filenames, approved SQL bytes and original review manifest are retained.
See `research-application-record.json`. A separate002 app compatibility proposal
remains unapproved and unapplied. These SQL files are excluded from runtime images and are
not invoked by any workflow. DBOS startup retains `runMigrations:false`.

Target: account352329340196, Sydney, app Aurora cluster `acquire-acquire-develop`,
resource ID `cluster-LV2AZYJ33YRB6VBFKYXPCJFQ5I`, PostgreSQL system identifier
`7619074599616174976`. The endpoint and exact hashes are in `review-manifest.json`.
Read-only verified-TLS catalog inspection confirmed the role/database are absent.

1. `000-create-database.proposed.sql`: on maintenance database `postgres`, verify
   the cluster system identifier and absence of the role/database. Create restricted
   login `research`, grant the cluster administrator non-inheriting SET membership
   in that new role for PostgreSQL database ownership, then database `acquire_research_uat` owned by it; revoke public
   database access. The password is supplied through the private process environment
   from the pinned research secret version, never source or command-line arguments.
2. `001-checkpoints.proposed.sql`: connect as `research` to that new database on
   the same verified endpoint. Require the exact database/owner and empty database,
   then transactionally create coordinator state and DBOS5.3.0 checkpoint schema,
   ledger123 and identity marker `acquire-research-aws-uat-only`. The SDK schema is
   derived from the existing DigitalOcean artifact with only AWS target/identity
   guards changed. Its original hash is retained in the manifest.

`CREATE DATABASE` cannot run in a transaction. A partial000 failure requires
inspection; do not automatically drop, rotate or blindly retry.001 is transactional.
No application/n8n schema change, production data copy, workflow activation or
messaging is proposed.

After specific approval, verify account, cluster ARN/resource ID, endpoint and TLS
CA/hostname. Authenticate the existing cluster administrator in memory; check its
system identifier and role/database absence again before writes. Do not select a
server from an incidental shell environment or the app secret's host field.
Verify both SQL hashes and read the new password from the pinned secret version.
Use `psql -X` with stop-on-error and a private password environment. After000,
connect as the new owner on that same endpoint before applying unchanged001.
Read-only postchecks must verify the marker, ownership, ledger123 and public ACLs.
Close temporary forwarding sessions after verification.

Static verification: the PostgreSQL parser accepts both artifacts (8 and161
top-level statements). No SQL execution/rehearsal is claimed. A separate rehearsal
would also need specific approval under AGENTS.md.

## Approval receipt — 30 October 2026

The user specifically approved both artifacts and the exact app Aurora target in
the manifest by answering yes to the explicit execution request. Their hashes
and bytes remain unchanged. Execution is pending renewal of the expired acquire
AWS SSO session. Neither artifact has been applied. Do not confuse recorded
approval with successful application; application/postcheck evidence is still
required.

## Application verified — 30 October 2026

Both approved artifacts committed unchanged on the pinned app Aurora cluster.
Read-only postchecks verified research ownership/restricted login, verified TLS,
identity marker, DBOS ledger123, no PUBLIC database/schema grants and no
unexpected user schemas/tables. No existing application/n8n schema or data was
changed. Temporary forwarding closed. Raw credentials were never logged.
The original `review-manifest.json` remains the immutable proposal receipt; use
`research-application-record.json` for the resulting application status.

## Separate app compatibility proposal — approval required

The UAT app database `acquire` predates the shared workflow changes. Current
legacy research readers unconditionally select `research_jobs.workflow_execution_id`,
which is absent in its reviewed empty research table. New agent/shared-workflow
features remain disabled and their tables are absent.

`002-app-legacy-research-compatibility.proposed.sql` adds that single nullable UUID
column with a CHECK requiring NULL. Legacy jobs retain their existing ownership;
non-null workflow associations are explicitly rejected while the full shared
workflow schema is unavailable. It creates no agent/workflow tables, functions,
grants, data rows, outreach or feature activation. Exact target and SHA-256 are
in `app-compatibility-review-manifest.json`. Its application requires **new
specific approval**; the000/001 approval does not cover this app database change.

Live read-only prechecks verified the exact app cluster identity, existing table
owner, all15 prior columns, zero research rows, no shared workflow table and
research/workflow/durable/native flags off. PostgreSQL syntax parsing accepts
all9 statements; no execution/rehearsal is claimed. Lock timeout3s and statement
timeout15s bound application. A future full shared-workflow upgrade must
explicitly reconcile this temporary compatibility column/check rather than apply
the existing production002 unchanged. This prepares **legacy research only**,
not a full migration of the optional agent/shared-workflow feature set.

After specific approval, recheck flags, exact target and hash, apply once as the
existing owner, verify nullable UUID/validated NULL-only constraint and unchanged
row count/ACLs, then connect app secret/environment and run the bounded app-backed
research canary. Keep app research disabled if any check fails.
