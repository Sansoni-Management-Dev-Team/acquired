# Bounded durable dispatch journal verification

Task scope: P2.3/P4.1 persistence prerequisites; partial A05, A08, A14, A16, A21 and A24. This slice implements durable claim/read/preflight results, not outbound admission or a complete send repository. All evidence is local and synthetic. The old DigitalOcean-backed paths remain available and application routing is unchanged.

## Implemented boundary

`createPostgresDispatchJournal` accepts a fixed connection binding, provider configuration, encrypted journal codec, independently keyed recipient digest and injected PostgreSQL driver. New claims lock the tenant first, then validate the current connection, generation, access grant and database-clock physical-account lease. Scoped operation keys cannot be reused with different recipients, approved snapshots or original connection metadata. New legacy-port claims are disabled; historical legacy records remain lookup-only.

Existing claimed, unknown and completed records return their original encrypted context and outcome. Historical submitted records retain their learned receipt identifiers while replay compares the original claim metadata. A retry does not acquire a replacement claim, renew a lease, charge quota or dispatch. Historical lookup retains current grant authorization while reading the recorded generation after reconnect/disconnect.

Preflight completion supports waiting, review, rejected, skipped and unknown outcomes with original worker token, fence, claim/lease expiry and exact terminal replay checks. `beginDispatch` deliberately returns `review/delivery_disabled`; submitted completion and reconciliation remain fail closed. A clear pending-reply gate does not establish application readiness, fresh reply coverage, approved content or send permission.

Transactions use bounded monotonic connection/callback/SQL deadlines and database statement/lock limits. Lost COMMIT responses and connection errors retire the physical session. Timeout handling does not issue competing rollback SQL. Configuration and callbacks are captured before awaits; malformed getters/proxies, asynchronous codecs and mutated decoded values are rejected conservatively.

## Red and green evidence

Private logs live in the feature worktree's ignored `.local-data/communications/verification/`; no credentials or message content are committed here.

| Behavior | Genuine RED | GREEN and scope |
| --- | --- | --- |
| Durable claims and preflight outcomes | `dispatch-journal-postgres-red.log`: 24 missing-behavior failures against a typed stub after approved-schema and fixture checks | `dispatch-journal-postgres-green.log`; 32 actual PostgreSQL cases, including all channels, competing claims, field conflicts, expiry, lease takeover, retained crypto/digest keys, ciphertext corruption and lost claim/complete COMMIT responses |
| Historical submitted-key replay | `dispatch-journal-submitted-replay-red.log`: original claim incorrectly conflicted with receipt identifiers learned after submission | Final actual PostgreSQL suite; original metadata replays before and after reconnect/disconnect/expired lease, with no new quota or claim |
| Input/configuration lifecycle | `dispatch-journal-independent-*-red.log`: getters/proxies, mutable context, SQL network-session reuse, client/decoded Date values, rejected Promise ports and a repeated method-getter read | 27 owned unit checks plus 16 independent checks; strict native rejected-Promise characterization and deadline/session checks included |
| Hosted creation link single use | `hosted-auth-single-use-red.log`: five request-body assertions failed before adding `single_use: true` | `hosted-auth-single-use-green.log`: 103 scoped transport/core/review cases. Reconnect payloads unchanged; no live hosted link or account binding tested |

Standalone-proof guard RED/GREEN records are separate: `standalone-proof-guards-{red,green}.log`. Syntax, lint and default opt-in rejection pass. Missing schema/startup or network prerequisites are not behavior REDs. The standalone proof has not executed against its proposed new database; exact startup/migration approval is required first.

## Final frozen-source checks

- `node scripts/test-communications-postgres-local.mjs`: **183 actual PostgreSQL cases, 13 files, zero skips**, exact approved isolated OrbStack `127.0.0.1:5445/acquire_channels`. Report requires every selected test to execute and pre/post source/test fingerprints to match.
- `node node_modules/vitest/vitest.mjs run`: **3,542 passed/258 opt-in skipped**, 354 files passed/35 skipped. The 183 database cases above are separately executed; skipped tests are not passes.
- Fresh independent package install/build/aggregate exports: **1,199 passed/46 files** in OrbStack without Acquire/Next modules, host credentials or database mounts. Public registry DNS failures and a package-download connection reset interrupted copy attempts. A fresh rerun with four package sockets passed; only successful reports count as verification.
- Native network-none OrbStack all-channel provider-shaped reply/enrichment/encryption/outbox proof passes. Its storage and application authority are memory fixtures; actual PostgreSQL journal and application-policy evidence comes from the separate database suites.
- Root typecheck, package build, changed-source/script lint and diff checks pass. Private logs `dispatch-journal-capture-final-{full,native,postgres,copy}.log; dispatch-journal-port-capture-{red,green,typecheck,build,lint}.log`, `communications-postgres-local.{log,json}`, `independent-copy.json` and `reply-orbstack.json` identify tested source hashes.

## Remaining work

Implement the application authorization protocol, admission and exactly-once quota transaction, submitted completion/reconciliation and complete fresh history/checkpoint coverage before enabling provider dispatch. Runtime authenticated hosted notifications and verified owner/alias mappings remain required. Application-owned drafts, both campaign runtimes, method selection/status UI, actual legacy runtime extraction and owned live-account tests are still open.

The proposed service-only database split and copied-package proof are reviewable under `ops/communications/standalone/`. They neither initialize a database nor apply SQL automatically. The existing approved 001/002/003 files remain byte-for-byte unchanged; approval for isolated5445 does not authorize the proposed `127.0.0.1:5446/communications_fixture` target.
