# Encrypted webhook storage and separate event transactions

Continuation on `codex/unipile-reply-detection`, 12 October 2026. P2.3/P3.4; scoped A05/A09/A11/A21/A22 evidence. No schema was applied in this continuation.

## Implemented code

- `WebhookCodec` preserves exact bytes in a versioned AES-256-GCM envelope. Authentication includes the exact binding, receipt key, version and webhook purpose. A separate HMAC key supplies scoped payload digests; copied retained keys support decryption and duplicate comparison during rotation. Strict descriptors, encoding and known metadata prevent authenticated malformed payloads from becoming valid captures. Errors exclude payloads.
- `createPostgresWebhookRepository` implements parameterized SQL capture and claim. It checks the actual restricted role, locks current connection/generation/grant authority, compares encrypted duplicates under their original key version, and commits before acceptance. Claims use database-clock expiry, row locking and random tokens. Unknown commit outcomes or broken rollback/session connections are discarded. There is no schema creation, driver dependency, provider call, implicit fallback or application hold in this module.
- `createWebhookEventProcessor` uses the existing strict normalization/semantic-key guards while deliberately resolving no application people. Its required finish port represents one service transaction for event, subscriber outbox and terminal webhook state; review must also invalidate coverage. `createReplyProcessor` remains an application/colocated policy coordinator, with its transaction requirement clarified.

## Actual TDD and characterization

Private logs are under `.local-data/communications/verification/`, mode0600.

| Behavior | Red / characterization | Green |
| --- | --- | --- |
| Webhook encryption | `webhook-codec-red.log`: 41 failures, 11 guard passes | 65 owned codec tests; 125 with existing journal regressions |
| Service event processing without app policy | `webhook-events-red.log`: 23 failures on missing behavior | 23 new tests; 62 with existing processor regressions |
| SQL capture/claim protocol | `webhook-postgres-red.log`: 23 failures, seven guards passed | Scripted-driver suite, not a real database proof |
| Effective-role and failed-session handling | `webhook-postgres-role-red.log` | Restricted-role checks and discard on ambiguous commit/failed rollback |
| Envelope/scope review | `webhook-postgres-guard-red.log` | Unknown ciphertext envelope fields and overlong binding identifiers rejected |
| Expired unresolved duplicate review | `webhook-storage-independent-red.log`: three failures, four characterizations passed | Pending/processing expired receipts and dead letters cannot be acknowledged as processed duplicates |
| Native composition | Previous OrbStack fixture passed before edits; new encrypted-envelope assertion failed on that old composition | Actual encryption, HTTP/enricher/service processor and separate synthetic application commit/ack composition |

Fresh native OrbStack execution passed. It records encrypted round trips for 11 captures, three crashes between synthetic application commit and service acknowledgement, three changed-fingerprint replay reviews and correct duplicate replays. Storage and transactions in this proof are explicitly **memory fixtures**. No database durability, complete coverage or production campaign integration is implied.

The existing real PostgreSQL reply-store tests also ran on the unchanged isolated OrbStack schema: 16 passed, all synthetic fixtures rolled back. They demonstrate the existing cross-channel hold behavior, not the new communications repository.

## Pending real database verification

`src/db/communications-webhook-local.integration.test.ts` prepares seven real PostgreSQL cases: all three channel ciphertext round trips and committed receipt visibility, concurrent capture dedupe, claim/reclaim expiry, grant revocation and wrong-scope/altered-byte rejection. It has not run against the new schema. Missing schema is a prerequisite failure, never a passing test or TDD red.

After exact migration approval, target/hash verification, backup, application and catalog/RLS checks:

```sh
COMMUNICATIONS_AUDIT_LOCAL_DB=1 CAMPAIGN_ISOLATED_CHANNEL_STACK=1 \
  node node_modules/vitest/vitest.mjs run src/db/communications-webhook-local.integration.test.ts
```

The test permits only loopback5445 `acquire_channels` with the recorded isolated system identifier. It performs no DDL or role provisioning. Its committed synthetic immutable history is retained and fixture grants/accounts are retired. Additional crash, fencing and revocation races must be tested on actual PostgreSQL before calling storage verified.

## Transaction boundary correction and release gates

The service and Acquire have separate databases. Service event/outbox/webhook completion is one transaction; Acquire receipt/fingerprint/identity decisions, cross-channel holds, enrolment stops and audit are another. A service acknowledgement follows the Acquire commit. Replaying a lost acknowledgement must compare complete fingerprints. A transaction spanning both databases is not claimed.

The proposed app receipt schema lacks that fingerprint and a durable review latch. Plan an additional specifically approved artifact after the two existing prerequisites; do not silently alter their outstanding approval hashes. Service ingress routing also needs explicit scoped metadata, or a conservative integration-wide pending-work barrier. The barrier must cover all channels/backends and shared people across owners in an application tenant, so an undelivered email reply cannot allow a WhatsApp send.

Original-generation accepted events must be delivered under the recorded binding or explicitly quarantined; reconnect cannot rebind them or clear holds. Current membership and identity/cutoff reads must serialize with revocation and mapping changes in the application transaction. LinkedIn canonical profile URLs from the service need verified mapping/registration into Acquire's existing URN reply identities; names or URL parsing cannot invent that mapping.

Terminal SQL normalization, encrypted event codecs, scoped outbox delivery/acknowledgement, Acquire consumption, current owner/alias authority, historical reconciliation, complete fresh coverage and mixed-backend send gating remain unfinished. Existing connection routing/UI and DigitalOcean services are preserved. The package is not activated or released.
