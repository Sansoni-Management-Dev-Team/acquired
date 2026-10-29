# Standalone research on AWS UAT

The Sansoni development branch is `test/deployment`. Its `dev.yml` now builds the
Next.js app, standalone Node/DBOS research worker and Crawl4AI reader. The search
sidecar uses the existing digest-pinned OpenSERP image. No Cloudflare Worker
deployment is required for this research orchestration. The separate existing
Firmable/company-data transport remains an independent integration.

On a pull request, `lint` installs/builds/tests the standalone service and runs
repository lint; `pr-images` builds all three Linux amd64 images. These jobs have
read-only repository permissions and no OIDC permission, AWS credentials, secret
retrieval, image publication, service update or database access. The existing
manual `migration.yml` is unchanged and is never dispatched by `dev.yml`.

After merging into `test/deployment`, the same build script publishes immutable
commit tags `app-<sha>`, `research-<sha>` and `reader-<sha>` to the existing Sydney
ECR repository `acquire-acquire-develop`. The existing app deployment uses its new
app tag. The research release resolves its two tags to digests before registering
a complete copy of the owning task definition; it preserves roles, volumes,
logging, secrets and sidecar configuration. A failed rollout restores the prior
task revision/count and waits for it to stabilize. This is application release
configuration, not Terraform provisioning.

## DevOps prerequisites

The local AWS SSO session was expired during preparation. Current provisioning
has not been re-audited, and this PR makes no AWS infrastructure changes.

Provision these through the existing DevOps infrastructure repository/state:

- A dedicated `acquire-research-develop` Fargate service in cluster
  `acquire-acquire-develop`, initially desired count zero. Use one worker,
  deployment minimum healthy percent zero and maximum percent 100, ECS rolling
  deployments, no autoscaling, and Linux x86_64. Stop-before-start deliberately
  permits downtime; multi-replica/in-flight restart acceptance is not established.
- Four essential containers in one `awsvpc` task: `research`, `callback`, `reader`
  and `search`. Start from `task-definition.example.json`, replace its image/role/
  secret placeholders, and preserve the health checks and worker dependencies.
  The example proposes 2 vCPU/8 GiB; DevOps must review capacity/cost. It is an
  example for the owning IaC, not a task to register or start unchanged.
- Private service discovery such as `research.acquire.internal:8787`, ingress
  only from the app service on8787, outbound access for search/providers/HTTPS
  callbacks, and research-to-Aurora5432. Do not expose the worker, relay, reader,
  search or database publicly. The relay listens on loopback3100; research uses
  loopback18083/7000 for the reader/search in the same task network.
- Dedicated logs, execution/task roles and ECS Secrets Manager permissions.
  The research secret contains `RESEARCH_DATABASE_URL`, `RESEARCH_SERVICE_SECRET`
  and `OPENAI_API_KEY`. The callback container receives only the same service
  secret. The worker does not receive the Acquire application database login.
- A dedicated PostgreSQL database `acquire_research_uat` and login `research` on
  the existing Sydney Aurora endpoint pinned in `services/research/src/config.mjs`.
  Its expected identity marker is `acquire-research-aws-uat-only`. Schema/DBOS
  initialization requires a separately prepared, reviewed and specifically
  approved artifact for that exact AWS target. The approved local/DigitalOcean
  SQL and identities do **not** authorize AWS initialization. No schema migration is applied
  by this workflow, Docker build, worker startup or these checks. `runMigrations`
  remains false. Startup requires the existing marker before launching DBOS.

The AWS profile accepts only this dedicated database/host/login and a loopback
callback relay. All worker, ownership-lock and DBOS connections use one URL with
`sslmode=verify-full` and `/app/rds-ca.pem`. The public regional CA bundle is from
[AWS RDS's Sydney trust store](https://truststore.pki.rds.amazonaws.com/ap-southeast-2/ap-southeast-2-bundle.pem),
committed into the AWS image layer; no private key or environment file is copied.
The underlying standalone image and DigitalOcean/local configuration remain intact.

Fargate does not support Compose `shm_size`, task `sharedMemorySize` or `tmpfs`.
The example omits these. Browser/search behavior with Fargate's actual available
shared memory and capacity must pass a bounded UAT canary before enabling app
research; a successful Docker build is not that acceptance.
[AWS Fargate task differences](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-tasks-services.html),
[deployment configuration](https://docs.aws.amazon.com/AmazonECS/latest/APIReference/API_DeploymentConfiguration.html).

## Release and enablement

1. Review/merge the PR to build and publish all images. PR jobs do not deploy.
2. Finish owner infrastructure and specifically approved database preparation.
   Keep app research disabled. Register the reviewed base task/service at zero
   replicas, using published images and the dedicated secrets.
3. Drain dispatch and confirm no queued/running/waiting DBOS workflows. Configure
   required reviewers on GitHub environment `aws-uat-research`. Set the repository
   variable `ACQUIRE_RESEARCH_APPROVED_COMMIT` to the **exact merged commit SHA**,
   then rerun its workflow. That job must still pass environment review and the
   runtime helper's account/repository/branch/service/task checks. This variable
   is a per-release DevOps sign-off for readiness/drain, not database migration
   approval. Future commits do not inherit this release approval.
4. Verify ECS readiness and a scoped app-backed UAT canary, including restart and
   provider behavior. Do not enable sending or connect production credentials to
   force a pass. No live canary was performed by this PR.
5. Copy the matching UAT `RESEARCH_SERVICE_SECRET` into the existing app secret
   `acquire-secrets-develop`. Set repository variables `ACQUIRE_RESEARCH_ENABLED`
   to `true` and `ACQUIRE_RESEARCH_WORKER_URL` to the private `.internal:8787`
   endpoint. Re-run the release to regenerate the app environment and restart the
   app. The environment writer defaults to disabled and refuses Cloudflare,
   DigitalOcean, public or malformed endpoints when research is enabled.

The app environment is uploaded only to its existing exact S3 object, rather than
syncing/deleting sibling objects. Values stay in private temporary files removed
after upload. Existing outbound fixture defaults remain. The worker relay pins
callbacks to `https://app.acquire.pajamaprofits.net`; it rejects production and
foreign origins, arbitrary paths, wrong credentials and redirects.

## Validation

```sh
npm --prefix services/research ci --ignore-scripts
npm --prefix services/research run build
npm --prefix services/research test
node --test scripts/aws-dev-environment.test.mjs scripts/aws-research-release.test.mjs
pnpm lint
actionlint .github/workflows/dev.yml
```

Two meaningful pre-change failures showed unsupported AWS deployment and rejected
UAT callback origin; both are now green, with existing local/production callback
cases retained. Release tests cover configuration preservation, digest scope,
secrets/sidecar requirements and refusal of overlapping/wrong services. A
network-disabled image probe verifies the non-root user, relay artifact, bundled
RDS CA and pg TLS configuration without connecting to any database. No migration,
live provider request, runtime deployment or production configuration change is
part of this verification.
