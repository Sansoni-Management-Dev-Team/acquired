# Local continuation reader: exact review

Status: **applied and locally verified on 19 October 2026**, following the user’s explicit approval of this exact migration. Native continuation reuses the existing pipeline and review actions. Actual persisted continuation GUI/provider acceptance remains a separate gate.

- Artifact: `ops/agent-mode/migrations/0088-agent-company-continuation-reader.sql`.
- SHA256: `0f21b2f4ac09def1d49413547b7be5c14a71022f0e3cba9338a748ea4255c49c`.
- Sole target: `acquire_agent_mode` at `127.0.0.1:5437`, marker `acquire-agent-mode-local-only`.
- Required predecessor: immutable0087 and all earlier recorded artifacts in the local migration registry.

The reader is necessary because the existing restricted agent role deliberately cannot SELECT `research_jobs`. It adds one bounded SECURITY DEFINER function, `agent_company_continuation_sources(uuid,uuid)`, with a fixed search path and PUBLIC execution revoked. Only the existing scoped agent role may call it, with current member/owned-thread identity and the already-held organization gate.

It returns owned original partial V4 source evidence, exact candidate claims and relevant child identities. Only the source fields needed for digest reconstruction are returned; unrelated runtime/private configuration is excluded. No table access grant, table, column, scheduler, job, provider request or sending authority is added. Original receipts, failed/unknown effects and monetary holds remain intact. Exact lookups fail if ineligible; oversized evidence fails instead of truncating effect summaries. Options use an explicit newest-ten-source window.

Read-only preflight on19October confirmed the exact local marker and installed0087 guard; the reader is absent and the frozen artifact hash matches. Receipt: ignored `continuation-reader-preapproval.private.json`. No migration was applied by that preflight.

## Verification of authorized application

Retain a verified local backup, verify marker and every applied predecessor hash, apply the single frozen artifact once with the existing local runner, then verify installed function/grants and immutable file hash. Do not apply DDL as part of a test.

```sh
RUN_AGENT_EXECUTION_LOCAL_INTEGRATION=true pnpm exec vitest run src/db/agent-company-continuation-local.integration.test.ts src/db/agent-company-continuation-reader-local.integration.test.ts src/db/agent-company-continuation-store-local.integration.test.ts --maxWorkers=1
```

The suites cover existing fences36, new reader16 and store/persistence10 cases. They use disposable owned fixtures on the marked local database and no Firmable, communications provider or model calls. All 62 cases pass with zero skips: 36 existing eligibility fences, 16 scoped-reader cases and 10 actual store/persistence/access cases. The first actual store run exposed a historical stale review aborting the read transaction (9 pass, 1 fail). The shared review-list projection now isolates its context check with a savepoint; the same case passes while retaining stale=true for the rejected history and stale=false for its valid replacement. Approval/execution checks still reject stale authority. Full TypeScript and scoped lint pass.

After those pass, verify the existing Settings control with a genuine eligible saved source and the new ordered count selection. The old zero-candidate c30ba38a source has no work to continue. Firmable remains disabled during offline verification; no provider success is inferred.

Current plan and evidence: [parallel build guide](61-agent-parallel-build-handoff.md). Apply only under the user's current applicable migration permission; production, other databases and live sending remain outside this local scope.

Application evidence: all 85 predecessor hashes and the exact marked5437 database/cluster identity were verified. A 73,409,599-byte full backup passed archive-list verification (SHA256 `d665b1e5be7b6b34f7b7e65fbcc0f28c6623156022c21a6517775b0de27c6822`). The frozen0088 artifact was applied once using the existing local runner. Independent catalog verification matches its body/hash, fixed search path, restricted EXECUTE grant and continued denial of direct `research_jobs` SELECT. Ignored evidence: `company-continuation-0088/` and `continuation-store-savepoint-green.private.json`. No Firmable/provider request, live send or production change occurred. Applied SQL remains immutable.

Additional shared-review verification:14/14 actual PostgreSQL cases pass with zero skips (review-list2, current-context3, durable-review9). One older expectation was corrected to the pre-existing explicit resume invalidation: original proposal identity/input/digest/revision remain, operation becomes failed/context_changed and review invalidated. Stale and approval-denial assertions remain. No product behavior was weakened. Receipt: ignored `review-savepoint-postgres-regression-green.private.json`.
