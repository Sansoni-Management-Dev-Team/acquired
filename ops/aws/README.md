# Acquire UAT deployment

This is the first **app-only UAT** slice. It prepares a standalone Next.js image, an additive Terraform module and a manual GitHub Actions build/publish/deploy workflow against the mapped `develop` environment. Research, communications and n8n scheduling are forced off; no production provider credentials are required. n8n migration, communications activation and production rollout follow separately.

The configuration is locally reviewable without AWS credentials. **No Terraform has been applied and no app has been launched on ECS.** A local image publication test succeeded on 2026-10-21; details follow below. The inventory is in [the UAT resource map](../../docs/41-aws-uat-resource-map.md).

## Ownership and current deployment blocker

The user clarified on 2026-10-21 that DevOps should manage infrastructure, with application deployment kept separate. The Terraform module here is a reviewable handoff for DevOps; its existence is not a request for the application operator to apply it or manage the company state. Infrastructure-repository access is not required for the application operator if DevOps supplies the reviewed deployment outputs.

On 2026-10-22 the user supplied `Sansoni-Management-Dev-Team/acquired`. GitHub API verification confirms it is a private, empty repository with admin/push access for the current identity. Its default immutable OIDC subject prefix is `repo:Sansoni-Management-Dev-Team@191077480/acquired@1429202297`, matching the company-owner wildcard in the October21 inspected `github-role` trust policy. This provides an eligible company application caller without transferring infrastructure ownership. No source/workflow was published, remote changed or Actions run triggered. Actual role assumption is still unverified; the October22 AWS read could not refresh the expired local SSO session. The local checkout's `origin` remains the personal repository. Future application publication should preserve the existing production workflow boundary and use the intended company deployment contract.

A fresh read-only AWS audit on 2026-10-21 completed 62/62 metadata checks. The shared VPC/subnets/NAT, Fargate cluster, ALB/certificate/hosted zone, Aurora, EFS and app ECR repository exist. The app image is published, but a local-to-ECS application deployment cannot yet proceed because the following app resources are absent:

| DevOps handoff | Required result for an app-only UAT test |
| --- | --- |
| App task/service | A reviewed base task definition and `acquire-app-develop` Fargate service in `acquire-acquire-develop`; initial count0, x86_64, proposed0.5vCPU/2GiB. Return the base task ARN and service name. |
| Public routing | App target group, HTTPS listener host rule and DNS for `app.acquire.pajamaprofits.net` using the existing ALB/certificate/zone. |
| Network permissions | App security group allowing ALB→app3000 and app→Aurora5432, with existing private-subnet outbound routing. |
| Runtime configuration access | Dedicated task/execution permissions and an isolated app secret, with its ARN/key contract returned. Existing shared secret metadata does not establish app configuration readiness; no values were read. |
| Container logging | An app log group and task logging configuration; proposed `/ecs/acquire-app-develop`,14-day retention. |
| Database readiness confirmation | Confirm the isolated `acquire` logical database/login, TLS configuration and approved schema preparation. Aurora exists, but logical databases/users/schema were not queried and must not be labelled absent or ready on API metadata alone. Any migration/restore still needs specific user approval. |

The n8n-named Apache placeholder is not an app deployment target. Do not replace it to work around missing app infrastructure. Communications also has no ECS service/routing and remains a later migration slice; n8n's existing EFS volume is not mounted into its current container.

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

1. **Publish to the intended company caller repository.** The user supplied `Sansoni-Management-Dev-Team/acquired` on October22; access and its default immutable OIDC prefix are verified, and the prefix matches the inspected company trust pattern. It is still empty and no actual role assumption has run. The personal `callumholt/project-acquire` origin remains outside the inspected trust. Add the application workflow to the company repository and configure a protected GitHub environment named `aws-uat`. Do not copy local AWS session keys into GitHub. Preserve the existing DigitalOcean workflow until a separate release decision; merging to its main branch still triggers its existing production deployment.
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
