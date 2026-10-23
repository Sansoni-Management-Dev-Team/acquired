# AWS Fargate migration plan

Created: 2026-10-20. Status: planning; AWS access and a bounded Sydney infrastructure inventory are live-verified. Application migration, database compatibility and deployment are not verified.

**Current scope:** the user confirmed `develop` is UAT. Only UAT is provisioned; deploy and accept UAT first, then plan/provision production. The detailed [UAT resource map](41-aws-uat-resource-map.md) records the expanded live inspection, IAM/OIDC contract and deployment gaps.

**October 21 local preparation:** the first app-only UAT slice is implemented and locally verified in [ops/aws](../ops/aws/README.md): an additive Terraform module for missing app resources, a manual GitHub Actions build/publish/deploy workflow, full-task release rendering, and an AWS-only startup layer that checks the exact isolated target/minimum schema read-only. The app image builds; Terraform validation/mocked plans, workflow lint and scoped tests pass. The service starts at desired count0 in Terraform, and research/comms/n8n scheduling remain off. SSO was renewed and local-to-ECR publication succeeded with a verified digest. No Terraform was applied and no app was launched on ECS; original communications/n8n migration steps and full product acceptance remain unverified.

**October 21 ownership clarification and deployment request:** DevOps manages infrastructure; Callum's application deployment remains separate. The local Terraform package is a handoff for DevOps, not an instruction for Callum to apply or take over the company state. A refreshed62/62-check metadata audit confirms the shared infrastructure exists, but app ECS service/task, routing/DNS, app security group/logging and dedicated app roles/secret are not provisioned. Application database/user/schema readiness remains unverified without a database connection. The requested local deployment cannot launch a usable app until DevOps provides these prerequisites; do not repurpose the n8n-named placeholder. DevOps can return reviewed service/task/secret outputs without granting infrastructure-repository access to the application operator. Local application deployment can then use `acquire`; GitHub OIDC is a separate requirement for later automated releases. See the exact [DevOps handoff](../ops/aws/README.md#ownership-and-current-deployment-blocker).

Plane module: [AWS migration — infrastructure, preparation and cutover](https://plane.mlai.au/mlai/projects/049211e4-72a2-4ee3-9257-157a4f11822f/modules/11307b82-9448-4671-a673-88002617fcbf).

**October22 company application repository:** the user supplied `Sansoni-Management-Dev-Team/acquired`. GitHub API verification confirms private/admin/push access, an empty repository and immutable OIDC prefix `repo:Sansoni-Management-Dev-Team@191077480/acquired@1429202297`. That prefix matches the company-owner wildcard in the October21 inspected AWS trust policy, resolving the proposed caller location without taking over DevOps infrastructure. No code/workflow was pushed or run and no local remote was changed. Live AWS trust revalidation requires renewed local SSO; actual GitHub role assumption remains untested. Infrastructure/database readiness gaps remain as recorded above.

**October23 database readiness verified read-only:** fresh temporary credentials validated for the Acquire account and renewed `acquire-session`; the renewable `acquire` SSO configuration remains unchanged. Through a temporary Session Manager tunnel using the existing ECS task, authenticated with the existing cluster credential and verified RDS CA/hostname/TLS1.3. Catalog-only reads in an explicitly read-only `postgres` transaction found only `rdsadmin`, `postgres` and `n8n`, with no `acquire` logical database or dedicated non-system app login. This supersedes the earlier unknown database-existence status: the isolated app database is not ready because it has not been created. App schema/RLS/runtime-login acceptance remains untested. The tunnel was closed; no database/user/schema creation, migration, restore, grants, app launch or infrastructure change occurred. DevOps must supply database/login prerequisites; prepare exact schema operations for specific approval before applying them. See [live readiness evidence and limits](../ops/aws/README.md#october23-live-database-readiness-check).

## Access and current evidence

- Active local profile: `acquire`; SSO login and account/role were verified during the expanded inventory. Project `.env.local` references this profile and `ap-southeast-2`; credentials remain in AWS's standard local stores. No keys or session tokens belong in application images, Terraform variables/state, tickets or GitHub secrets for CI.
- IAM Identity Center is in `us-east-1`, independently of the Sydney workload region. Renew with `aws sso login --profile acquire`. The earlier `acquire-session` temporary credentials have expired and are not the active project profile.
- `sts get-caller-identity` confirmed the user-supplied account and its `AWSReservedSSO_AdministratorAccess` role. Relevant ECS, networking, database, ECR, EFS, load-balancing and CloudFormation reads succeeded. These checks do not prove unrestricted write permissions or exemption from organization policies.
- The shell inherits `sst/dev` from another context. Use an explicit `--profile acquire --region ap-southeast-2` for migration commands; AWS CLI does not automatically load the project dotenv file. No global default or unrelated profile was changed.
- Repository source baseline: local HEAD `1d8a8f5`, with existing unrelated worktree changes preserved. Production source runtimes were last checked on October 15–18; refresh their live versions and state before migration.

### Existing Sydney infrastructure: do not duplicate it

| Component | Read-only observation on October 20 | Planning consequence |
| --- | --- | --- |
| ECS | `acquire-acquire-develop`, one active service, one running task | User confirmed `develop` is UAT. |
| Service | `acquire-n8n-develop`, Fargate, 0.25 vCPU / 512 MiB | This is a starting allocation, not measured n8n sizing. |
| Task configuration | Container named `n8n` uses `httpd:latest`, port 3000, no environment/secrets or container mounts | This is a placeholder definition, not a verified n8n deployment. Running task count does not establish application readiness. |
| n8n deployment | Rolling configuration permits 200% maximum tasks, 100% minimum healthy | A replacement can overlap old and new instances. Plan a single-active transition before enabling workflows. |
| Database | Aurora PostgreSQL Serverless v2, engine reported as `18.6`, initial database `n8n`, private instance | Differs from the proposed RDS PostgreSQL 17 design. Confirm DevOps intent and test source/target compatibility before choosing migration artifacts. |
| Database settings | Seven-day retention, deletion protection, capacity 0–2 ACUs, auto-pause after 300 seconds | Validate wake-up latency and connection/retry behavior; agree production availability and capacity separately. |
| EFS | `acquire-n8n-develop`; task volume declares encrypted EFS, but container does not mount it | Add and verify the intended n8n data-directory mount and access-point/user permissions. |
| Other | Two VPCs, two ECR repositories, one active application load balancer | Review actual routes, target health, DNS/certificates, egress and ownership before reuse. Counts alone do not validate connectivity. |

The ECS cluster's `repo` tag points to [devops-infrastructure-acquire](https://github.com/Sansoni-Management-Dev-Team/devops-infrastructure-acquire). A GitHub API read from the current local identity returned 404; repository contents, Terraform definitions and the delivery pipeline are not yet verified. Obtain access or have DevOps supply the relevant configuration. Do not create a competing Terraform stack or import resources until ownership/state boundaries are established.

### Shared deployment actions reviewed on October 20

The user supplied [devops-github-workflows](https://github.com/Sansoni-Management-Dev-Team/devops-github-workflows). Its public `main` at `17bd7357c7a3dff1ae12fd0e3f56f90c21093bb3` contains composite actions for checkout, AWS OIDC role assumption, ECS task registration and ECS service update/stability waits. It provides suitable company deployment building blocks; intended Acquire integration still needs confirmation against the inaccessible infrastructure repository.

Prepare an Acquire-owned workflow that runs the existing checks/builds, assumes the scoped deployment role with `id-token: write`, pushes immutable ECR images, registers reviewed task revisions, updates the environment's ECS services and runs smoke/readiness checks. Confirm role ARNs, environment controls, service names, Terraform ownership and paired rollback. Use a reviewed commit reference for the shared actions. The local SSO/session credentials are not CI credentials.

The current `register-task-definition` action only submits container definitions plus basic task properties. It does not pass task-level `volumes`, so it cannot carry the n8n EFS configuration as written. Extend the company action or agree a full-task-definition registration path before deploying n8n; otherwise a container mount can refer to an undefined volume, or required storage can be omitted. The service-update action forces deployment and optionally waits for stability; it does not configure single-active n8n rollout, app-level acceptance or rollback. Preserve those requirements in the owning workflow/infrastructure configuration.

Expanded IAM inspection identified deployment role `arn:aws:iam::352329340196:role/github-role`, with `AdministratorAccess` attached and GitHub OIDC trust for the configured company repository owners. The current `callumholt/project-acquire` origin is not matched. Resolve the caller repository or a reviewed trust-policy change; the deployment role ARN is now known. The n8n endpoint currently serves the Apache placeholder over valid HTTPS; app DNS/routing and app/communications ECS services remain to be configured. See the resource map for exact observed bindings and evidence.

Private, ignored evidence: `.local-data/aws-migration/credential-verification.json`, `sydney-inventory.json`, `existing-acquire-infra.json`. Evidence excludes credential values and task environment values.

## Target and scope

Separate UAT and production environments, initially using three independently deployable ECS/Fargate services: Next.js (including its current API/backend), communications, and n8n. Use Linux x86_64 initially to match current image builds. Start with one active task per service until scheduler and process-local coordination behavior has been validated; this is not a high-availability commitment.

Use separate application, communications and n8n databases/users per environment. Confirm whether DevOps intends to share the existing Aurora cluster across those logical databases or provide another database arrangement. Production remains isolated from UAT. PostgreSQL 17 was a proposal; the discovered Aurora 18.6 configuration is not assumed compatible or silently changed.

n8n uses PostgreSQL for workflows, credentials and execution/wait state. EFS preserves required files, including the existing encryption-key configuration. Moving the database alone or exporting workflow JSON alone is insufficient. Inventory any binary data, custom/community nodes and other filesystem dependencies. Preserve the existing n8n version during the first move; image startup can itself perform database migrations and requires review before startup against a target.

Retain Cloudflare research, workflows, coordination and existing inference/provider integrations initially. Cloudflare replacement, backend consolidation and Bedrock/Vercel AI Gateway changes are separate workstreams. No application S3 bucket is required by the current initial scope; use the company Terraform state backend and approved archive/backup mechanisms rather than assuming there is no infrastructure-level S3 usage.

## Sequence and gates

The AWS01–AWS12 identifiers match the existing Plane checklist. Proposed ownership below must be agreed with Rodney/DevOps.

| Stage | Work | Exit evidence | Proposed owner |
| --- | --- | --- | --- |
| 1 — Reconcile baseline (AWS01–03) | `develop` = UAT is confirmed. Get infrastructure-repository access; agree caller repository/OIDC trust, Terraform state and release ownership. Validate the existing Aurora18.6 target, sizing, domains and UAT cost. Refresh source app/service/n8n versions and database inventory; production follows UAT acceptance. | Agreed UAT resource/change list, environment map, monthly Sydney estimate and source/destination inventory. | DevOps + Callum |
| 2 — Prepare deployment (AWS04–07) | Reuse existing Docker builds; prepare ECR publishing, ECS task/service definitions, secrets/IAM roles, service routing, health/logging and environment-specific builds. Adapt storage, TLS, shutdown and callbacks described below. | Reviewed configuration/diff and appropriate characterization or failing-test evidence; no deployment implied. | Application + DevOps |
| 3 — Isolated UAT rehearsal (AWS05/08/09) | Provision/adapt only the agreed UAT resources when implementation is authorized. Prepare exact database artifacts/targets for approval, then rehearse approved imports and n8n file/key preservation. Use synthetic/sanitized identities and isolated provider authority. | Restore/parity report, functional and restart tests, single scheduler, n8n decrypt/wait recovery, backups and rollback evidence. | Application + DevOps |
| 4 — Production readiness (AWS09/10) | Agree maintenance window, recovery targets, final backup/export, ingestion pause/buffering, callbacks, approval gates, observability and release digests. Review the production-specific migration operations and target. | Named operators, verified backups, rehearsed procedure and specific production migration approval. | Callum + DevOps |
| 5 — Controlled cutover (AWS10) | Stop source writers/dispatchers in the reviewed order; drain and reconcile in-flight work; import and validate approved artifacts; switch callbacks/traffic; enable only the intended active scheduler. | Data/permission parity, healthy routes and controlled end-to-end checks with recorded release/configuration. | Release operator |
| 6 — Observe and hand over (AWS11/12) | Monitor and compare performance/cost; record operating and recovery procedures. Retain source recovery options until agreed exit conditions. Scope later AWS-native work separately. | Accepted handoff and retention/retirement decisions; no automatic source deletion. | DevOps + Callum |

## Preparation work grounded in the current source

1. **CI/deployment:** `.github/workflows/digitalocean.yml` builds image archives and deploys through a DigitalOcean self-hosted runner. Preserve its readiness/regression and paired rollback behavior while introducing the company-owned AWS pipeline. Prefer scoped CI roles/OIDC; never use local administrator session credentials in CI. Confirm which repository owns ECS service updates versus image releases before changing either.
2. **Fargate storage:** current communications Compose uses `tmpfs`; Fargate does not support that parameter. Prepare a bounded writable ephemeral mount for `/tmp` while retaining the read-only root filesystem. Next.js currently mounts `.next/cache`; determine which cache writes are disposable and test task replacement. EFS is proposed for n8n persistent files, not for every container's cache.
3. **Shutdown and singleton behavior:** the communications entry clears its interval and exits after `service.close()` without explicitly tracking/draining its active background tick. Test interruption, controlled draining and unknown-send recovery before rolling releases. Set ingress drain and task termination timeouts together; Fargate's maximum container stop timeout is 120 seconds. A desired count of one alone does not prevent overlapping tasks during deployment. Keep one n8n scheduler active without editing private execution state.
4. **Database transport and privileges:** application/campaign pools support `DATABASE_SSL_CA`; the communications service pool relies on connection-string TLS. Verify trusted RDS certificates and hostname validation for every client, and add tested shared configuration if necessary. Rehearse RLS/FORCE RLS, role membership, grants, sequences and journals with RDS/Aurora privileges. Existing production bootstrap scripts are guarded for the old target; do not replay them against AWS.
5. **Origins and callbacks:** the app's public origin is embedded at build time and checked at startup. Build UAT with its own origin. Cloudflare research `APP_ORIGIN` currently points at production; either configure an isolated UAT Worker/workflow/coordinator and secrets or keep UAT research disabled. Production connected accounts, campaign identities and provider authority must not be activated in UAT.
6. **Ingress and service access:** plan HTTPS/DNS, authenticated webhook/tracking routes, private app-to-communications routing and restricted n8n editor access. Preserve raw authenticated webhook handling. Existing operations may last 90–105 seconds; configure and test load-balancer idle/drain timeouts. Confirm NAT/outbound access for provider APIs as well as ECR/secrets/log access.

## Database and n8n rehearsal requirements

- Refresh exact source engines, extensions, sizes, encoding/collation, application roles and migration ledgers. The October 15 n8n baseline was n8n 2.1.5 and PostgreSQL 15.15; do not treat that as a new live check.
- Decide the Aurora 18.6 compatibility strategy with DevOps. Test supported dump/restore tooling, extensions and application behavior before approving a target. Do not combine an unreviewed n8n upgrade with the move.
- Establish whether the Oracle instance's unrelated workflows also move. Preserve workflow/credential IDs, key material, waits, scheduler ownership and callbacks; do not silently reassign unrelated projects.
- Specify each restore/bootstrap artifact, hash, target and operation before requesting migration approval. A prior local-copy or other migration approval does not authorize AWS restores. Validate n8n startup migration behavior before first launch.
- Verify schema and row/aggregate parity, RLS/grants and credential decryption after an approved rehearsal. Keep production identities inert in UAT; use a documented sanitization/fixture plan rather than connecting copies to production providers.
- Rehearse backup restoration and task replacement. Keep unknown sends unknown until receipt reconciliation; never redispatch them merely because infrastructure changed. Preserve holds and original channel bindings.

## Acceptance and rollback

Exercise SSR/assets/auth/workspace isolation, research callbacks, settings and channel contracts, campaign timing, authenticated webhook replay, reply freshness/holds, n8n wait resumption, database reconnect and task replacement. Preserve communications acceptance A05/A06/A07/A09/A11/A12/A14/A15/A20/A21. Synthetic checks do not prove live-provider delivery; list deferred checks explicitly.

Before cutover, record release digests, secrets/configuration versions, origin/DNS/callback settings, source backups, restore duration and acceptable recovery loss/window. A pre-write failure can return to the unchanged source; after AWS receives writes, restoring traffic to the old database requires a reviewed data reconciliation/recovery procedure. DNS reversal alone is not database rollback. Control webhook ingestion and scheduler ownership throughout the transition.

Planning and read-only verification are authorized now. No Terraform apply, ECS service change, database import/schema operation, n8n launch/upgrade, production traffic switch, provider send or source retirement has been performed. Follow the exact-migration approval rule in `AGENTS.md` and the communications execution plan before implementation operations that affect a database.

## Immediate next action

Obtain read access to the tagged infrastructure repository and agree the GitHub deployment caller/trust and Terraform/task ownership. Use the inspected `develop` resources as the confirmed UAT baseline, prepare the concrete service/configuration changes, validate the Aurora18.6 target and prepare exact UAT rehearsal artifacts for review. Production preparation follows the successful UAT phase. No new stack is needed merely to begin planning.

## References

- [AWS SSO profile configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html).
- [Fargate task configuration and limitations](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html).
- [Fargate container stop timeout](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html).
- [EFS volumes for ECS](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/efs-volumes.html).
- [Reviewed shared deployment actions](https://github.com/Sansoni-Management-Dev-Team/devops-github-workflows/tree/17bd7357c7a3dff1ae12fd0e3f56f90c21093bb3).
- [n8n encryption-key behavior](https://docs.n8n.io/hosting/configuration/configuration-examples/encryption-key/).
- Local source: `ops/app/`, `ops/communications/production/service/`, `.github/workflows/digitalocean.yml`, `cloudflare/research/wrangler.jsonc`, `docs/39-communications-service-execution-plan.md`, `docs/communications/progress.md`.
