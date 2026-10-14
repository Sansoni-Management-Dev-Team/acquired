# Durable replies and setup authorization evidence

Scope: P2.3/P2.4, P3.2/P3.4 and P4.2 prerequisites on `codex/unipile-reply-detection`, separate worktree. This extends the earlier [webhook storage evidence](webhook-storage-tdd.md); historical tests remain historical. All logs below are private under the worktree's ignored `.local-data/communications/verification/`, with no committed credentials or message content.

## Approved schema execution

Only the two specifically approved files were applied to isolated OrbStack `127.0.0.1:5445/acquire_channels`, system ID `7694812678792806433`:

- `communications/migrations/001-service-storage.local.sql`, SHA-256 `b2d673205ba759bb1126db90b719bf39d44d8f3977d1bbe2ab97aa48c00b308d`.
- `ops/communications/002-acquire-bindings.local.sql`, SHA-256 `f25cba158289dde111e3aae6038be286b12f1dc4a64db9bf4c94f404259b14cf`.

Fresh target/hash/system-ID/collision checks and a private custom-format PostgreSQL backup/list validation preceded execution. Post-checks found 13 service/seven app tables, FORCE RLS, restricted roles, and unchanged eight legacy table row counts. `communications-approved-schema-execution.json` records exact execution. SQL review headers remain unchanged to preserve approved bytes.

Prepared `ops/communications/003-reply-consumption.local.sql`, SHA-256 `4f79939442b22109fed2bee069059d8701126170202fa902e9aa6655b039fefd`, is a separate unapproved/unapplied artifact. Static parser/peer review is not PostgreSQL execution. It adds app fingerprints/reviews and tenant routing/fences; its prepared tests must remain unexecuted until specific approval.

## Behavioral evidence

| Slice | Actual red or characterization | Green and boundary |
| --- | --- | --- |
| Typed encrypted event codec | `event-codec-red.log`: 28 intended failures/15 passing initial characterizations | 58 owned assertions; source scope, purpose, type, key retention, canonical plaintext and mutation guards. Codec alone does not prove a DB commit. |
| Terminal webhook transaction | `webhook-terminal-postgres-red.log`: nine actual missing-behavior failures | 14 actual PostgreSQL cases; event/outbox/inbox atomicity, dedupe/conflicts, generation/grant/lease fencing, rollback and lost response. Twelve scripted unit cases also pass. |
| Independent timestamp integrity review | `webhook-terminal-independent-red.log`: two actual PostgreSQL failures | Both now reject contradictory row/plaintext time or original-review receipt time. Capture/terminal/review combined: 23 actual DB passes. |
| Scoped subscriber outbox | `outbox-postgres-red.log`: 12 actual stub failures; later receipt-status and binding-order failures | Twenty actual DB and 18 scripted checks pass, including independent lease/grant expiry during ACK and unchanged terminal replay; those three additions are passing characterizations, not manufactured REDs. No send or person-policy callback is involved. |
| Outbox coordinator | `outbox-worker-red.log`: 21 intended failures | 23 coordinator unit checks pass for exact scope/receipt, commit-before-ACK, deadlines, mutation, late commits and retries. |
| Native deadline failure | `outbox-worker-native-deadline-red.log`: real callback synchronous overrun followed by rejected promise caused unhandled rejection in the pre-fix compiled artifact | Native proof passes after observing the already-rejected promise before deadline exit. The similarly named unit deadline RED log actually passed and is characterization evidence, not a reproduced defect. |
| V1 hosted-auth transport | `hosted-auth-red.log`: 33 intended failures | Thirty-three initial plus six independent checks pass. Independent RED captured four primitive/date-coercion or post-response-expiry defects; no real provider POST occurred. Provider-shaped POST fixtures only; no real hosted-auth link created. |
| Persistent setup authorization | `auth-state-postgres-red.log`: 12 actual DB stub failures; later transaction-escape, nonce-correlation and recovered-address failures | Initial 18 actual PostgreSQL/31 unit passes. Independent REDs then reproduced persistent pooled-session contamination, timer starvation and competing rollback during active callback SQL. A separate native process reproduced an unobserved callback-client promise after safe session disposal; Final 22 actual PG and 48 unit/native checks pass, including session retirement, serialized reconnect, stalled/synchronous-overrun deadlines, active-query disposal/drain and exact returned-promise observation. A required trusted provider owner/binder port remains a prerequisite. |
| Acquire reply consumer | 33 initial unit failures; later review replay/conflict assertions | 35 consumer unit checks plus eight existing reply-store regressions. Fourteen actual PG cases prepared but UNEXECUTED pending 003; no actual campaign-stop claim for this consumer yet. |
| Recorded identity bridge | `recorded-identity-red.log`: 21 intended failures | Twenty-one unit and nine actual approved-002 PostgreSQL cases pass. Independent seven-case RED reproduced `42501` from locking immutable bindings without UPDATE privilege; retaining only the mutable identity-row SHARE lock fixes it without new grants. Uses exact recorded sender identity, with conflicting/missing LinkedIn evidence reviewed. Existing policy handles shared contacts. |
| Service/app delivery bridge | `reply-delivery-bridge-red.log`: eight intended failures | Eight unit passes compose the actual core coordinator with the app consumer boundary. Exact service fingerprint ACK follows app commit; failed/lost/late commits do not ACK. Real app transaction tests still require 003. |

Use installed binaries directly; `pnpm exec` may replace the shared ignored dependency symlink in this worktree. Actual DB command (no automatic migrations):

```sh
COMMUNICATIONS_AUDIT_LOCAL_DB=1 CAMPAIGN_ISOLATED_CHANNEL_STACK=1 node node_modules/vitest/vitest.mjs run src/db/communications-webhook-local.integration.test.ts src/db/communications-events-local.integration.test.ts src/db/communications-finish-review-local.integration.test.ts src/db/communications-outbox-local.integration.test.ts src/db/communications-auth-state-local.integration.test.ts
```

The actual native callback cleanup proof is `node scripts/communications-auth-session-proof.mjs` after package compilation: it checks exact-once discard, no competing rollback/late commit and no unhandled rejection. Its RED used the actual pre-fix compiled module, not a manufactured defect. Callback SQL is trusted and must be awaited sequentially; the wrapper is not a SQL security sandbox.

Fresh final suite/type/lint/package/copy/native results are recorded in [verification](verification.md) and [progress](progress.md); do not infer them from initial slice counts.

## Activation limits

These repositories run against approved local schema with synthetic data. No real account was linked, webhook registered, live send/invitation made, production schema changed, UI/routing activated, credentials backfilled, branch pushed or repository published. Existing DigitalOcean Gmail/Baileys/browser paths remain available. The service's transaction and Acquire's transaction are separate; no distributed atomic commit is claimed.

Before activation, execute specifically approved 003 and its real membership/holds/stops/review/fence tests, implement tenant-first routing/normalization/admission and concrete provider ownership/alias proof, validate lifecycle and complete fresh history, connect both campaign runtimes/drafts and UI, then perform authorized account-specific live verification. Independent package copy proves the reusable foundation, not extraction of all legacy backend runtimes.

## Frozen-tree final verification

Full suite: 3,357 passed/179 explicit opt-in skips (347 files passed/30 skipped); eight deployment/smoke checks passed. Real isolated PostgreSQL: 90 passed across seven files, comprising 74 new communications/setup/recorded-identity cases and 16 existing reply-policy regressions. The 14 new Acquire consumer cases remain unexecuted pending 003. Root typecheck, scoped source/script lint and independent package compilation passed.

Fresh dependency-installed OrbStack copy built and passed 1,033 tests/39 files and all new aggregate exports without Acquire, Next, pg, credentials or database mounts. Native network-none all-channel EventCodec/coordinator fixture and both native rejection/deadline scripts passed. All recorded production-source and fixture-script hashes match the final tree. Logs use `durable-replies-final-*`, with sanitized private summary `durable-replies-final-summary.json`. No new Next production build or whole-backend runtime extraction is claimed.
