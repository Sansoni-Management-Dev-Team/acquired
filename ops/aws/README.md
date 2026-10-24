# Acquire UAT deployment

This is the first **app-only UAT** slice. It prepares a standalone Next.js image, an additive Terraform module and a manual GitHub Actions build/publish/deploy workflow against the mapped `develop` environment. Research, communications and n8n scheduling are forced off; no production provider credentials are required. n8n migration, communications activation and production rollout follow separately.

The configuration is locally reviewable without AWS credentials. **No Terraform has been applied and no app has been launched on ECS.** A local image publication test succeeded on 2026-10-21; details follow below. The inventory is in [the UAT resource map](../../docs/41-aws-uat-resource-map.md).

## Ownership and current deployment blocker

The user clarified on 2026-10-21 that DevOps should manage infrastructure, with application deployment kept separate. The Terraform module here is a reviewable handoff for DevOps; its existence is not a request for the application operator to apply it or manage the company state. Infrastructure-repository access is not required for the application operator if DevOps supplies the reviewed deployment outputs.

On 2026-10-22 the user supplied `Sansoni-Management-Dev-Team/acquired`. GitHub API verification confirms it is a private, empty repository with admin/push access for the current identity. Its default immutable OIDC subject prefix is `repo:Sansoni-Management-Dev-Team@191077480/acquired@1429202297`, matching the company-owner wildcard in the October21 inspected `github-role` trust policy. This provides an eligible company application caller without transferring infrastructure ownership. No source/workflow was published, remote changed or Actions run triggered. Actual role assumption is still unverified; the October22 AWS read could not refresh the expired local SSO session. The local checkout's `origin` remains the personal repository. Future application publication should preserve the existing production workflow boundary and use the intended company deployment contract.

**October23 publication:** the user authorized publishing the codebase to the private company repository. Pushed the current committed source/history to its `main` branch and verified the first published head `9eea76b` through GitHub's commit API. Added the local remote `sansoni`, preserving `origin` and its tracking configuration. The DigitalOcean build/deploy jobs now require the original `callumholt/project-acquire` repository, preventing company-repository pushes from activating that production path. GitHub lists the manual `Acquire AWS UAT` workflow as active; no manual AWS operation was started. This publication does not provision infrastructure or initialize/deploy the application database. DevOps ownership and the remaining readiness requirements below are unchanged.

### Current GitHub execution and migration preparation

The user subsequently requested deployment through the company workflow, preferably including n8n and an isolated copy of `callumpholt@gmail.com`'s Supabase data, with Terraform for infrastructure. Dispatched `aws-uat.yml` operation `publish` at company main `3dd71eb`: [run39904884020](https://github.com/Sansoni-Management-Dev-Team/acquired/actions/runs/39904884020). GitHub rejected the hosted `checks` job before any step started because account payments or the spending limit require attention. Image/deploy jobs were skipped; no AWS authentication, image publication, Terraform execution or database operation occurred in this run. No self-hosted runner is available to this repository. An organization billing administrator must resolve that external execution blocker.

October23 follow-up: the renewed `acquire` SSO profile passed STS for account352329340196. Read-only AWS discovery located the existing Sydney Terraform backend: bucket `tg-state-develop-acquire-ap-southeast-2` (versioning enabled, KMS encryption) and active DynamoDB lock table `tg-locks-develop-acquire-ap-southeast-2` (`LockID`). It contains31 separate module state keys under `applications/modules/`, including existing security-group, ECS service and task-definition states. Selected state metadata confirms those resources already have Terraform ownership. Private evidence: `.local-data/aws-migration/terraform-backend-discovery-2026-10-23.json` and `terraform-state-ownership-2026-10-23.json`. The DevOps infrastructure repository still returns404, so the owner source/configuration and the exact integration path for additional app resources remain unresolved. Do not apply the app module over an existing module state or silently create competing ownership. No state was changed. The current checked-in module remains app-only; communications/n8n extensions must use the agreed ownership/state arrangement.

Separate read-only Supabase inspection found exactly one matching user, three owned workspaces (each with one member) and88 user-created mandates across those workspaces (83/2/3); the live source has98 public application tables. Catalog/FK metadata and account/workspace aggregates are private in `.local-data/aws-migration/supabase-tenant-copy-scope-2026-10-23.json`. No data export/import or source write occurred. Preparing a selected copy still requires a complete dependency/credential-isolation design and exact reviewed artifacts, not an email-only row filter or a whole-production clone. The configured local n8n endpoint is local-only; current production n8n API/runtime access was not established by this attempt, so the older Oracle baseline must not be treated as a fresh migration inventory. Starting n8n can apply schema changes and remains subject to exact migration approval.

A fresh read-only AWS audit on 2026-10-21 completed 62/62 metadata checks. The shared VPC/subnets/NAT, Fargate cluster, ALB/certificate/hosted zone, Aurora, EFS and app ECR repository exist. The app image is published, but a local-to-ECS application deployment cannot yet proceed because the following app resources are absent:

| DevOps handoff | Required result for an app-only UAT test |
| --- | --- |
| App task/service | A reviewed base task definition and `acquire-app-develop` Fargate service in `acquire-acquire-develop`; initial count0, x86_64, proposed0.5vCPU/2GiB. Return the base task ARN and service name. |
| Public routing | App target group, HTTPS listener host rule and DNS for `app.acquire.pajamaprofits.net` using the existing ALB/certificate/zone. |
| Network permissions | App security group allowing ALB→app3000 and app→Aurora5432, with existing private-subnet outbound routing. |
| Runtime configuration access | Dedicated task/execution permissions and an isolated app secret, with its ARN/key contract returned. Existing shared secret metadata does not establish app configuration readiness; no values were read. |
| Container logging | An app log group and task logging configuration; proposed `/ecs/acquire-app-develop`,14-day retention. |
| Database preparation | October23 live catalog reads confirm `acquire` does not exist, and the only non-system login is the cluster master. DevOps must supply the isolated app database/login; review the exact schema initialization/restore and obtain specific approval before applying it. Private connectivity and verified TLS are established, not app schema/runtime readiness. |

The n8n-named Apache placeholder is not an app deployment target. Do not replace it to work around missing app infrastructure. Communications also has no ECS service/routing and remains a later migration slice; n8n's existing EFS volume is not mounted into its current container.

### October23 live database readiness check

The user authorized a read-only readiness inspection. The supplied temporary AWS credentials passed STS account/role validation and renewed the existing `acquire-session` profile; project configuration still references the renewable `acquire` SSO profile. The laptop cannot directly reach the private Aurora endpoint. Used the existing ECS task's Session Manager forwarding and existing database security-group permission without creating resources or changing network access. Verified the endpoint certificate/hostname with the official regional RDS CA and TLS1.3; authenticated using the cluster credential from the existing shared secret, held only in process memory.

Executed catalog SELECTs in `postgres` under `default_transaction_read_only=on` plus explicit `BEGIN READ ONLY`/`ROLLBACK`. Aurora reports PostgreSQL18.6; non-template databases are `rdsadmin`, `postgres` and `n8n`. There is no `acquire` database and no dedicated non-system app login. No application rows, password hashes or n8n schema/data were queried. Consequently app schema, grants/RLS and runtime-login readiness cannot pass yet. This administrator catalog inspection is not an app-role connection test or full PostgreSQL compatibility acceptance.

Two initial libpq connections timed out; a separate verified TLS probe and a connection with optional GSS encryption disabled then succeeded. The exact cause of the initial timeouts was not isolated. The temporary tunnel was terminated after verification. Private evidence/helper: `.local-data/aws-migration/database-readiness-2026-10-23.json` and `check-database-readiness.py`. The Session Manager plugin was downloaded from the official AWS distribution into ignored local tooling only. No database/user creation, migration/restore, grants, app/n8n startup or AWS infrastructure modification occurred. Next action is DevOps database/login provisioning and a specifically reviewed/approved schema preparation, followed by app-role, schema/RLS and application readiness checks.

After DevOps returns those resources/configuration and the specifically approved database preparation is complete, application deployment can be tested locally with profile `acquire`: publish/select the image, register the reviewed app task revision, update only the app service, and verify readiness/public sign-in. No Terraform apply is needed from the application deployment operator. A normal GitHub release additionally needs the caller repository's OIDC trust resolved; that does not block an otherwise-ready local deployment. The current workflow's commit-tag checks continue to exclude the earlier local-test tag.

## What each component owns

- `terraform/` is a module to integrate into the company infrastructure root/state. It references the existing VPC, private subnets, ECS cluster, ALB/HTTPS listener, hosted zone, ECR and Aurora. It creates only missing **app** resources: service/task, roles, secret metadata, logging, security-group paths, target group, host rule and app DNS.
- Terraform initially creates the ECS service with **desired count 0**, so applying infrastructure does not start an application or access/initialize a database. It does not create or alter the Aurora database, n8n, EFS, GitHub OIDC trust, existing ALB defaults or secrets' values. The app secret/service have destruction protection. Review the real owning-state plan before applying; `example/` is an integration example, not a new independent state to apply.
- Terraform owns the reviewed base task configuration and infrastructure. GitHub releases own the service's current task revision and desired count, which Terraform ignores. After infrastructure changes the base task, refresh GitHub's release-config variable from the module output. A release preserves that complete base configuration and changes only the image digest.
- `uat/start.mjs` is a startup layer used only in the AWS image. It validates the exact UAT origin/database target, verified CA TLS and disabled automation before connecting. It inspects eight minimum application relations in `BEGIN READ ONLY`, rolls back and closes the client, then starts the existing app. Missing schema fails closed; it never runs SQL migrations or repairs. This is a minimum prerequisite check, not full schema/RLS/product acceptance.
- `.github/workflows/aws-uat.yml` uses the shared company OIDC and ECS rollout actions, pinned by commit. It registers a **full** task definition with AWS CLI because the shared registration action currently drops task-level volumes. This also avoids cementing that limitation into the later n8n release path. Current release validation accepts the app family only.

## Local checks and builds

```sh
node --test scripts/aws-uat-start.test.mjs scripts/aws-uat-release.test.mjs
terraform fmt -check -recursive ops/aws/terraform
terraform -chdir=ops/aws/terraform init -backend=false -input=false -lockfile=readonly
terraform -chdir=ops/aws/terraform validate
terraform -chdir=ops/aws/terraform test
node scripts/app-image-build.mjs https://app.acquire.pajamaprofits.net acquire-app:uat-base-local
docker build --platform linux/amd64 -f ops/aws/uat/Dockerfile --build-arg BASE_IMAGE=acquire-app:uat-base-local -t acquire-app:uat-local .
```

Terraform tests use a mocked provider and plan operations only. Init downloads providers but does not access a state backend or AWS. Do not substitute a real `terraform apply` or a database-backed test for these checks.

## Verified local image publication

On 2026-10-21, the verified `acquire-app:uat-local` linux/amd64 image was pushed directly from the laptop using the renewable `acquire` AWS SSO profile to the existing Sydney ECR repository `acquire-acquire-develop`, account `352329340196`:

```text
Tag: app-local-test-20261021T114343Z
Digest: sha256:998bd567daf4fc8aa97a2d9ce169062c790f6836346fdb9c7010ca75f18ab60e
```

The Docker push digest matches ECR's `describe-images` response. Registry authentication used a disposable private Docker config that was removed afterward. Private evidence is `.local-data/aws-migration/local-ecr-push-20261021T114343Z.json`. This proves local-to-ECR publication; it does not certify GitHub OIDC, ECS startup, database connectivity or product acceptance. No ECS service, Terraform state, IAM policy or database was changed. The local test tag is not eligible for the workflow's commit-matched release validation; publish through the workflow for a normal release.

Terraform is not needed to upload an image to an existing registry. GitHub Actions automates the build/publication/release steps; Terraform declares the infrastructure they use. Keep infrastructure changes in the agreed owning state even when testing locally.

## First UAT release sequence

1. **Configure the company caller environment.** Source and the AWS workflow were published to `Sansoni-Management-Dev-Team/acquired` on October23. Its verified immutable OIDC prefix matches the inspected company trust pattern, but no actual role assumption has run. Configure a protected GitHub environment named `aws-uat`. The personal `callumholt/project-acquire` origin remains outside the inspected AWS trust; its existing DigitalOcean workflow is repository-scoped so company pushes do not activate it. Do not copy local AWS session keys into GitHub. Production releases from the original repository remain a separate path.
2. Run manual operation **build** to prove the image build without AWS authentication. Run **publish** to push an immutable `app-<commit>-<run>-<attempt>` tag into the existing `acquire-acquire-develop` ECR repository. Capture the sha256 digest. This step does not start ECS tasks or touch a database.
3. Integrate `terraform/` into the existing DevOps state using the published digest as `initial_app_image`; review/apply through the company's process. Do not re-create/import existing infrastructure. The `terraform/example` call shows the account-restricted provider; no backend is guessed or provisioned by this package.
4. Prepare the exact UAT `acquire` database initialization/restore artifacts, roles/RLS, target and hashes for **specific user approval**. Existing `n8n` is not the app database. Apply/rehearse only those specifically approved operations. The workflow has no database migration step. Database version18.6 compatibility and the complete schema still need validation.
5. Populate the new isolated `acquire-app-develop` secret outside Terraform. Its JSON must contain `DATABASE_URL`, `DATABASE_SSL_CA_BASE64`, `BETTER_AUTH_SECRET`, `APP_READINESS_SECRET`. Use a dedicated UAT login/database at the inspected Aurora cluster, trusted RDS CA bundle encoded as canonical base64, and newly generated UAT auth/readiness keys. Do not copy source connected accounts or production auth keys. No provider secrets are required by this slice.
6. Set GitHub environment variables below from reviewed outputs. Manual operation **deploy**, selecting the matching source commit, published digest and approval reference, registers the candidate, deploys one task, waits for ECS/container readiness and checks the UAT liveness/sign-in pages. Failure restores the prior revision/count; that is an image/configuration rollback, not a database rollback. The first failed launch should return to count0.
7. Complete authenticated UAT product checks using isolated synthetic data. Record schema/RLS/auth results and restart/recovery evidence. Only then prepare the communications/n8n/research steps and later production.

## GitHub environment variables

`ACQUIRE_UAT_RELEASE_CONFIG` is the module's `release_config` JSON output. It contains metadata only: account, region, cluster/service, origin, repository, reviewed base task ARN and app secret ARN. Do not invent revision/secret suffixes; collect actual outputs after the owning state applies.

`ACQUIRE_UAT_DATABASE_REVIEW` records the **already specifically approved and rehearsed** artifact/target, for example:

```json
{
  "accountId": "352329340196",
  "cluster": "acquire-n8n-develop",
  "database": "acquire",
  "artifactSha256": "<actual approved artifact SHA-256>",
  "approvalReference": "<actual user approval/rehearsal record>"
}
```

This record does not grant migration authority itself. Set it only after the exact operation/target has received user approval. The deployment workflow never applies the artifact. Finally set `ACQUIRE_UAT_DEPLOYMENT_ENABLED=true` after the database and environment controls are ready. Leaving these variables unset prevents deployment. The manual `approval_reference` must match the recorded reference.

The app is reachable only through the existing ALB, has private task networking, gets a dedicated database access rule, and starts with one task/stop-before-start deployment. Initial sizing is0.5vCPU/2GiB, to be measured in UAT. ALB idle timeout remains the existing60seconds; research/callback workloads requiring longer operations are outside this initial disabled-automation slice.

## Current limits

Infrastructure ownership requires resolution before applying; GitHub caller/trust requires resolution before publishing through Actions. Local-to-ECR publication is verified above. Secret values and database preparation are intentionally absent. The module is additive; it does not reconstruct the company's complete Terraform stack. Runtime guards prevent the first app image from targeting the original source DB or enabling research/messaging/scheduling. It does not provision communications services, move n8n executions, replace Cloudflare, transfer the repository or enable provider sending. These are explicit later slices, not verified deployment capabilities.


### October23 current-source local publication

After the user renewed SSO, built the app at source commit `3dd71ebf321b64c4cf16a7df4e35ae28faa5c04c` for `https://app.acquire.pajamaprofits.net`, including the AWS startup wrapper. The standalone build and TypeScript check passed; the eight AWS Node tests passed. Network-disabled container probes verified linux/amd64, non-root execution, the baked public origin, required files/pg dependency, absent top-level env/AWS/git files and refusal of an unconfigured startup. Earlier private probe assertions expected a different refusal message and included Docker's host-platform warning; corrected the helper to the actual contract and explicit linux/amd64, then repeated successfully. No application code was changed to obtain these results.

Published directly from the laptop to the existing `acquire-acquire-develop` ECR repository with profile `acquire` and an explicit account/region guard:

```text
Tag: app-3dd71ebf321b64c4cf16a7df4e35ae28faa5c04c-local-20261023T054226Z
Digest: sha256:d9520ca853570e81857572e39d9291860d3418462ef99e06b80046a356d33f70
```

The Docker push digest matches ECR readback. Disposable registry credentials were removed. Private evidence: `.local-data/aws-migration/uat-preparation-verification-2026-10-23.json` and `local-ecr-push-20261023T054226Z.json`. This is current-source image publication, not ECS/product acceptance or GitHub OIDC validation. A fresh service listing still shows only `acquire-n8n-develop`; no app service exists. No Terraform apply, state change, task/service update, database operation, n8n startup or provider send occurred.

Next: integrate missing app resources through the DevOps-owned Terraform configuration, then prepare the exact isolated database/schema/copy artifacts for specific approval. The existing missing app database/login and production n8n inventory remain separate prerequisites. GitHub billing remains a blocker for hosted Actions execution, but is not needed for local image publication.
