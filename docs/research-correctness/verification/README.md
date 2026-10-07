# Local verification and limits

The register records local verification of 18 fixes against 54 **scoped scenario specifications**. The specifications describe actual assertions and name their boundary. They replace broader initial specifications that included dimensions not yet proved. A shared test can prove more than one finding; 54 scenario records do not mean 54 separate tests or 54 production replays.

No RCA change has been deployed. The recorded revision identifies an uncommitted working tree based on the named commit, and the reviewer is an agent evidence review, not an independent human approval. The evidence validator checks metadata, references and dependencies; it does not execute tests or authorize rollout.

## Final results

| Check | Result | Evidence |
| --- | --- | --- |
| `pnpm test` | 1969 passed, 64 skipped; 269 files passed, 16 skipped |[Unit log](unit-suite.log) |
| Explicit local PostgreSQL four-file suite | 19 passed, 1 legacy migration case skipped |[Database log](db-suite.log) |
| `pnpm test:workflows` | 29 passed |[Workflow log](workflows.log) |
| `pnpm test:coordinator` | 6 passed |[Coordinator log](coordinator.log) |
| `pnpm test:research:e2e` | 9 checks passed |[E2E log](research-e2e-final.log) |
| `pnpm test:research:live` | 2 local public-source checks passed |[Smoke log](research-live.log) |
| `pnpm typecheck` |Exit 0 |[Typecheck log](typecheck.log) |
| `pnpm lint` |Exit 0; 2 existing unused-variable warnings |[Lint log](lint.log) |
| `pnpm build` |Exit 0 |[Build log](build.log) |
| Evidence validator and Node selftests |Gate passed; 6 selftests passed |[Gate log](evidence-gate.log) |

[Source fingerprint](source-fingerprint.json) records hashes of changed code files, including unrelated existing changes; [artifact manifest](artifact-manifest.json) records sanitized evidence hashes. The database suite emits an existing concurrent `pg` client-query deprecation warning; it passes today, but that harness pattern needs review before a future `pg@9` upgrade. Skipped opt-in database cases in the generic unit suite are executed separately against explicit localhost; the migration case remains skipped.

## Evidence boundaries

- Scoped facts/activity/financial/worksheet tests cross provider mapping, JSON/schema serialization, ranking, membership, report generation and server-rendered summaries. A serialization fixture is not a PostgreSQL write. A separate actual PostgreSQL scoped-diligence fixture reloads retained provider JSON through AcquisitionRepository.memberships, and saves/reloads provisional and reviewed owner/finance answers through saveAssessment with rollback verification. The register identifies the exact test used.
- Company identity fixtures call the real research handler with controlled network/provider inputs and fake persistence, then the real target mapper and rendered UI. The generic local research E2E separately crosses the actual application, Worker, Chromium and PostgreSQL chain; it does not replay every identity fixture against a paid provider.
- Company-people and contact integration tests use actual local PostgreSQL. They cover five-profile admission with 100 observed candidates, historical counters independent of current selection caps, materialization failures, orphan responses, late admitted writes, terminal state, 12 concurrent counter writers and 12 competing manual claims. Manual concurrency is per organization; automatic concurrency is per root.
- Callback tests deliberately inject application 502/503, sanitize diagnostics and prove bounded workflow retry. These faults explain stderr in passing workflow logs. The full workflow suite includes a real 130-second wait; long runtime is intentional.
- The live research smoke uses the local application/worker harness and public source retrieval. It is not a production deployment or a paid Firmable replay.
- Monitoring tests distinguish unavailable samples from observed backend state and use real compact read-only PostgreSQL polling for reconnection.

## Investigations and completeness reports

The read-only A9 audit and the original 67-company mandate show shared defects in scope, admission, deadlines, counters and identity evidence. See [sanitized intake audit](intake-audit.json). A9 has 92 companies and 4876 cells; the other mandate has 67 companies and 3551 cells. Each report has 53 cells per company, including contact/run coverage, source/provenance and missing reasons. Projection corrects retained evidence for review; it does not rewrite production records.

- [A9 company and datapoint report](../../../output/research-correctness/mandate-a9fb0c38-completeness.html)
- [B8 company and datapoint report](../../../output/research-correctness/mandate-b8e35133-completeness.html)
- [Reusable offline report renderer](../../../scripts/render-research-completeness-report.mjs)

The initial screenshot shows discovery at 20% but no attributable run ID or error response. Its specific Firmable error remains unknown. Historical downstream callback 502 is observed, but its underlying application failure is unproven because response/log detail is absent. Intake closure records completion of this bounded investigation, not resolution of that uncertainty.

## Local database test incident and restoration

An earlier legacy integration test unintentionally executed the backfill portion of `drizzle/0006_firmable_history.sql` without specific migration approval. A nested repository COMMIT escaped the test's outer transaction. No CREATE/ALTER DDL was executed by that slice. This was a local OrbStack database action; production was not touched.

Exactly 1376 newly created backfill company-response IDs were attributed by request source, logical call ID, exact transaction timestamp and transaction ID. Full rows were backed up privately with mode 0600. Authorized restoration deleted only those exact IDs with matching guards, and verification found zero remaining exact IDs. Associated identity/link/person/contact row versions predated the migration transactions; no additional persisted effects from those transactions were found. This supports restoration of the identified effects, without guessing or overwriting prior links. A separate timed-out synthetic fixture was backed up and removed by its exact identity; recent test fixture users and organizations were both zero after cleanup. See [sanitized safety audit](local-database-safety.json). Private backups and payloads are deliberately absent from these docs.

The harness now uses nested SAVEPOINT isolation and AsyncLocalStorage for independent database contexts. The legacy migration case is skipped in all ordinary suites, requires two exact opt-ins and a local-host guard, and still requires explicit approval for that specific migration before either opt-in can be used. Subsequent verification ran with the migration case skipped. The pooled concurrency test has a bounded 20-second test timeout and 5-second database request/lock timeouts.

## Remaining dimensions

Evidence freshness/cross-date conflict policies and configurable HQ-only criteria are not implemented. D-01 selects sourced operating footprint. Lexical activity screening is conservative rather than a complete semantic classifier. Financial observations, manual credit diligence, undisclosed subsidiary relationships and missing upstream contact values remain unavailable or review. Phone unlock is disabled automatically and was not paid/live-tested. Per-finding limitations and exact test boundaries are in the register; production performance, rollout, canary and rollback observation remain separate work.

## Current asynchronous enrichment extension

These original logs describe the earlier RCA verification snapshot. The subsequent generalized, nonblocking enrichment release and its new tests are recorded in [nonblocking enrichment](../nonblocking-enrichment.md). Do not treat the original source fingerprint as a fingerprint of that extension.
