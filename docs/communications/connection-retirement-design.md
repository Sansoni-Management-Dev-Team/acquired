# P3.2 durable connection retirement — review and handoff

Status: repository/codec implemented and unit verified. SQL is **not approved/applied**. Actual PostgreSQL cases are prepared, skipped and unverified. No provider deletion, account setup, migration, container startup or app activation occurred.

## Exact proposed migration

| Artifact | Target | SHA-256 |
| --- | --- | --- |
| `ops/communications/standalone/003-connection-retirement.local.sql` | Existing owned OrbStack `127.0.0.1:5446/communications_fixture`, container `acquire-communications-standalone-postgres-1`, system identifier `7696118996713136162` | `2448ee14577f97a6d17e3c307fe376c4d44dfb204f0a94a83b652fb56a905dde` |

This is a new standalone service migration, distinct from previously approved Acquire/communications003 on5445 and from WhatsApp5447. Those approvals do not authorize this artifact. The original approved001/002/003 files are unchanged. Approval must name this exact artifact/hash/target before execution.

The draft requires the existing database/user/system identifier, no public application relations, two restricted NOLOGIN/NOBYPASSRLS/non-superuser service roles, and all16 expected baseline FORCE-RLS service tables. It rejects an already-present retirement table instead of rerunning or bootstrapping. It adds one FORCE-RLS table, scoped read policy, control-only INSERT/UPDATE, no DELETE, immutable original scope/context/ticket digest and irreversible terminal outcomes.

## Durable authority and cryptographic boundary

`createPostgresConnectionRetirement` in `communications/packages/storage-postgres/src/connection-retirement.ts` implements the core coordinator's two required durable methods. Construction pins the exact recorded binding/provider account/source/provider-owner key, integration and immutable configuration reference. Caller-supplied replacements, key collisions on another connection/backend/generation, changed ciphertext, forged tokens and mismatched identity proofs fail closed.

The required `verifyRecordedIdentity` callback is trusted server composition, not default permission or a boolean authority assertion. It must independently authenticate/decrypt the original generation's vault/provider account record and verify source/provider-owner evidence, then return the exact original record plus a verified canonical physical identity. The repository recomputes both provider-account and canonical-physical HMACs using their stored key versions and compares the stored digests under current generation, physical-account and grant locks. Provider evidence namespaces are not global canonical deduplication namespaces. Display names, email login usernames and opaque social IDs cannot invent canonical ownership. No concrete live owner bridge is supplied by this slice; tests use explicitly synthetic identity proofs.

`ConnectionRetirementCodec` uses a dedicated AES-256-GCM domain, distinct record/outcome purposes, scope/key-bound AAD and retained versioned HMAC fingerprints. It validates and canonicalizes known fields before encryption. Key roles cannot reuse the same retained key material. SQL stores encrypted owner/provider context and keyed fingerprints; raw ticket tokens never enter SQL, only their SHA-256 digest. A ticket is returned once, only after definite COMMIT. Rotation reads the original retained encryption/fingerprint versions without rewriting history.

## Transaction and state protocol

Transactions use a restricted control role, native statement/lock timeouts and one monotonic deadline/abort signal. Repository order is tenant reply mutex, physical account, exact original connection/generation, current grant and retirement row. Every caller must honor tenant/account-first ordering; a BEFORE row trigger cannot reverse a lock already acquired by an uncoordinated writer. Deadlock, timeout, connection loss or ambiguous COMMIT must fail boundedly before provider work. `release(error)` must physically terminate/discard the driver session, as `pg.PoolClient` does. Late connection/query/verification completion cannot start new SQL or return a ticket; active SQL never races a rollback on timeout.

Fresh preparation requires an active exact current service-authoritative v1 generation, verified original physical identity, current live grant and no other active account binding, account-wide claimed/dispatching/unknown journal, live physical-account lease or known in-flight setup. Identity verification remains inside the held lock/deadline budget. Naturally expiring grants are checked again after mutation/codec work, and the draft's deferred constraint trigger rechecks exact current retired generation and grant at the **precommit authorization linearization point**. This does not claim authorization after WAL flush or after the caller receives a response.

The insertion trigger atomically records the intent, marks the original service connection inactive/local-disconnected, invalidates account-wide coverage/initial-sync/cursor leases and advances the tenant fence. Local-disconnected means service retirement, not proof of provider unlink. The coordinator corroborates the provider owner after definite preparation and before DELETE. Preparation has no provider I/O or quota reset/charge.

| Existing state | Prepare same exact key | Finish |
| --- | --- | --- |
| None, eligible current connection | One fresh random ticket after COMMIT | Exact ticket token and authenticated original context required |
| `pending` | Review; never recover/reissue the raw ticket | One transition to `unknown`, `rejected` or `disconnected` |
| `unknown` / `rejected` | Review; physical account remains fenced | Exact same terminal result is read-only replay; different result is unknown |
| `disconnected` | Exact duplicate, no provider action | Exact same terminal result is read-only replay |

Lost preparation COMMIT may leave a pending intent but never returns deletion authority. Lost result COMMIT returns unknown; the retained exact state remains authoritative. Unknown/rejected outcomes are deliberately irreversible through this port. They require a future explicitly reviewed reconciliation/resolution path; there is no automatic timeout, reopen, status upgrade, lease renewal or resubmission. A confirmed disconnected outcome releases the physical intent fence for explicit new setup, while the retired original generation permanently cannot reactivate/reconnect or establish fresh coverage/aliases. Existing events/aliases/receipts/holds remain intact and readable under their normal authority.

## SQL writer fences and remaining inventory limits

The draft guards connection activation/rebinding, generation insertion, leases, quota writes, journal claim/admission, authentication, cursor freshness/leases and new aliases. Pending/unknown/rejected intents fence the physical account across owners/backends. Scoped auth/cursor mutations and alias insertion are revoked; current concrete repositories already use the control role, which can see global physical fences. Scoped history reads remain available.

Fresh authentication states for another owner do not yet identify a physical account. Known reconnect states and same-owner/channel setups can be blocked, and subsequent account/generation binding is fenced. The database cannot identify an unknown remote hosted-auth session before its provider account is known. Concrete setup/binder composition must prevent shared-account/provider reuse, and service inventory cannot certify absence of sessions created outside the service. This migration does not claim fencing untracked remote sessions or shutting down another provider runtime.

## TDD evidence and prepared PostgreSQL cases

Acceptance IDs: A04 lifecycle/replay; A05 ownership/current grant; A07/A15 unresolved action and original binding preservation; A13 generation/coverage invalidation; A16 shared physical account boundary; A22 encryption/sanitized diagnostics. This slice is locally unit verified, not live verified/released.

Private0600 logs under `.local-data/communications/verification/`:

- `connection-retirement-red.log`: 17 genuine failures on missing repository/codec behavior.
- `connection-retirement-green.log`: initial17 green after implementation.
- `connection-retirement-signal-red.log`: one genuine failure /22 passes for a forged abort getter leaking its exception; corrected before green.
- `connection-retirement-review-red.log`: two independent peer regressions for a grant expiring after INSERT or terminal UPDATE, before COMMIT; corrected final/deferred grant checks.
- `connection-retirement-replay-review-red.log`: two independent successful replay regressions for expiry during retained evidence decoding; corrected final grant checks before duplicate/recorded outcomes.
- `connection-retirement-final-green.log`: 27 unit/peer cases passed; 15 actual PostgreSQL cases skipped. Scripted driver cases do not prove real database durability or trigger permissions.

Prepared actual suite: `src/db/communications-connection-retirement-local.integration.test.ts`. It uses the independently guarded existing5446 helper; skipped construction reads no credentials/connects to no database. After exact approval/application only:

```sh
COMMUNICATIONS_STANDALONE_AUDIT=1 COMMUNICATIONS_RETIREMENT_AUDIT=1 \
node node_modules/vitest/vitest.mjs run \
src/db/communications-connection-retirement-local.integration.test.ts
```

The draft was independently parsed as38 SQL statements and11 PL/pgSQL units without execution. Package build, root TypeScript, scoped four-file ESLint and diff checks passed; storage regressions passed292 tests across16 files.

The15 prepared cases cover atomic intent/invalidation, concurrent one-ticket preparation, immutable pending/unknown/rejected/success replay, reactivation/new-generation/auth/cursor/lease fences, in-flight setup and journal blockers, canonical identity/current grant, lost actual COMMIT, forged ticket, RLS/ACL and deferred natural-expiry rollback. Synthetic histories are retained and grants revoked afterward; no DELETE or provider operations occur. They have not run against missing/unapproved schema and are not claimed as RED/green database evidence.

## Approval and execution runbook

1. Obtain explicit approval for the exact file/hash/5446 target above. If SQL changes during review, regenerate the hash and approval scope; do not apply an older approval to new bytes.
2. Confirm the existing labelled/pinned-image container, private ignored credentials, existing nonempty PG17 data volume, loopback5446 binding and internal/external system identifier. Do not create/init/bootstrap another cluster or target5445/5434/5447.
3. Rehash the exact file and original approved artifacts. Take a fresh PG17 custom-format backup of this current database and validate/hash its restore list before applying the new SQL. Keep all operational logs/backups private0600; never print credential values.
4. Apply the unchanged artifact once with `psql -X -v ON_ERROR_STOP=1` against the verified existing target. Startup must not invoke it. Capture the exact execution/backup/catalog evidence.
5. Verify17 service tables FORCE RLS, new function INVOKER/ACL, no PUBLIC EXECUTE/no DELETE/scoped mutation rights, unchanged historical rows and no public/Acquire objects. Existing baseline-only proof inventories must be updated by their owner before rerunning against the intentionally enlarged catalog.
6. Run the15 prepared actual cases, resolve real failures with captured RED evidence, then reverify independent copied-package tests and the current service/SDK proof. Do not mark readiness from unit mocks or skipped tests.

Next: finish independent SQL/source review and exact hash freeze; request specific migration approval; only after application establish actual PostgreSQL evidence, review the live canonical owner bridge and authenticated lifecycle composition. No app route/UI or live dispatch/disconnect activation is authorized by this design artifact.
