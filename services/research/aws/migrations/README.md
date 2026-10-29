# AWS UAT migration and verification records

All three specifically approved SQL artifacts are applied and verified on
30 October 2026. Historical proposal filenames, SQL bytes and original review
manifests are retained unchanged. Do not rerun the applied bootstrap files.
No SQL is invoked by runtime images or the development workflow; DBOS retains
`runMigrations:false`.

## Exact target and applied artifacts

Account `352329340196`, Sydney, Aurora cluster `acquire-acquire-develop`, resource
ID `cluster-LV2AZYJ33YRB6VBFKYXPCJFQ5I`, PostgreSQL system identifier
`7619074599616174976`. The canonical endpoint is in `review-manifest.json`.

| Artifact | Database | Resulting behavior | Application record |
| --- | --- | --- | --- |
| `000-create-database.proposed.sql` | `postgres` maintenance DB | Restricted research login, dedicated `acquire_research_uat`, administrator SET membership, no PUBLIC DB access | `research-application-record.json` |
| `001-checkpoints.proposed.sql` | `acquire_research_uat` | Coordinator storage, DBOS5.3.0 schema/ledger123 and identity marker `acquire-research-aws-uat-only` | `research-application-record.json` |
| `002-app-legacy-research-compatibility.proposed.sql` | `acquire` | Nullable UUID `research_jobs.workflow_execution_id` with validated NULL-only constraint | `app-compatibility-application-record.json` |

The user approved000/001 together, then separately approved the exact002 linked
from commitaafe501. The original `review-manifest.json` and
`app-compatibility-review-manifest.json` preserve the proposed targets/hashes;
application records contain the resulting status and verification. All applied
SQL hashes remain unchanged.

## Execution safeguards and results

AWS account/cluster ARN/resource ID, canonical hostname, regional CA/TLS, system
identifier, database and owner were checked immediately before application.
000/001 required absence/empty-state guards.002 verified the existing15-column
shape, table owner, zero research rows and disabled research/workflow/native
runtime flags. Credentials came from AWS Secrets Manager in memory/private
process environment, never source, command-line arguments or logs. Owned SSM
forwarding was terminated and temporary ports closed.

The default psql14 client initially stopped on unsupported `getenv` before any
role/database change. Read-only absence inspection preceded an unchanged retry
with psql18.3. Both000/001 then committed and passed restricted ownership,
identity marker, verified TLS, ledger123, public ACL and empty-state checks.
CREATE DATABASE is nontransactional; no partial failure was silently dropped,
rotated or blindly retried.001 is transactional.

002 committed unchanged as a transaction with3s lock/15s statement timeouts.
Postchecks verified nullable UUID, validated `CHECK (workflow_execution_id IS
NULL)`, zero research rows and absence of shared workflow tables. It updates no
existing app rows or grants, creates no agent/workflow tables/functions and
activates no new workflow authority. It supports legacy research only. A future
full shared-workflow upgrade must explicitly reconcile this compatibility
column/check rather than apply the existing production002 unchanged.

## Runtime connection and bounded acceptance

`runtime-verification.json` records the research release and private HTTP/auth,
real public-page reader and idle restart/persistence checks. Research task2
runs the worker, callback, reader and search containers. An owned coordinator
nonce survived stop-before-start task replacement and was cleaned afterward.
This is not proof of in-flight workflow recovery.

`app-runtime-verification.json` records app task10 connected to
`http://research.acquire.internal:8787` with the matching service secret. The app
injects `DATABASE_SSL_CA` from its existing AWS secret; authenticated database
readiness returns200. Existing secret fields/environment settings were
preserved. `taskdef.json` retains the CA secret reference for future releases;
existing execution-role permissions already cover it.

The synthetic app-backed canary completed one public Ark Industrial page, one
logical model call, two distinct supported findings,18 timing spans and a
completed DBOS workflow. Duplicate dispatch before/after completion repeated no
model work. Exact synthetic user/organization/mandate/research app rows were
removed after workflow settlement; SSM forwards closed. DBOS checkpoint history
remains in its dedicated database.

Shared workflow/native agent features and sending remain off. Production data
was not copied and n8n was not changed. This release used local ECR publication,
Terraform research infrastructure and direct ECS application release. Hosted
GitHub Actions billing failures happened before job steps; local acceptance does
not certify the GitHub CI/OIDC execution path.
