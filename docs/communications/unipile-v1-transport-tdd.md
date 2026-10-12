# P3.1/P3.4 — Explicit v1 transport and webhook authentication

Implemented 12 October 2026 after the user's DSN/key authenticated for v1. Contract evidence is in [v1 investigation](unipile-v1-contracts.md). The existing explicit v2 module remains separate and fixture-only; no endpoint/version fallback exists. Neither transport reads environment files. Local configuration does not activate app routing.

## Red, green and refactor

- Characterization before shared I/O extraction: all existing v2 transport tests passed (`v2-before-core-extraction.log`). Version-specific v2 account IDs, offset pagination and JSON message payload stayed unchanged.
- V1 transport RED: 11 behavior tests against deliberate method stubs failed (`v1-transport-red.log`). Assertions require cursor pagination, opaque IDs, exact guarded chat/email paths, native multipart, email-only idempotency, separate draft/invitation paths, configuration validation, unsupported fields rejected before I/O, lost-response uncertainty and bounded redirects/body/cancellation.
- V1 transport GREEN: those tests and v2 characterization passed (`v1-transport-green.log`). Shared bounded HTTP I/O moved to `http-core.ts`; versions own request paths/payloads. No key/host/version inference or provider retry.
- Independent review RED exposed seven uncertain-write classifications: undocumented 408/418/425, provider-unreachable/action-already-performed/unknown 422 and malformed 422 (`unipile-v1-review-red.log`). V1 now returns unknown for those instead of asserting definite rejection.
- A second review RED exposed three missing/conflicting error-envelope statuses (`unipile-v1-error-envelope-red.log`). The known 409/422 allowlist now requires the body's numeric status to equal the HTTP status. Arbitrary titles, details and bodies are never returned in diagnostics.
- V1 webhook authentication RED: positive configured-header and replay-honesty tests failed against a false-only stub (`v1-webhook-red.log`); GREEN passed afterward (`v1-webhook-green.log`). Negative raw-header cases are passed as single array-valued test arguments, including identical duplicates, malformed pairs, wrong values and v2 signatures. Verification uses constant-time digest equality and exact configured secret comparison.
- Source formatting used the repository's existing TypeScript printer after green. Final verification commands/results are recorded in [verification](verification.md); historical logs are scoped to their run, not automatically evidence for subsequent edits.

All logs are private/ignored under `.local-data/communications/verification/`. Tests use synthetic keys and native loopback fixtures; no live credentials are loaded.

## Boundaries

`UnipileV1Transport` implements account reads, guarded chat lookup, exact message/email lookup, existing-chat text/quote submission, bounded email send with an explicit original idempotency key, draft creation, and LinkedIn invitation submission. V1 account IDs are opaque. Each chat send includes the recorded provider account ID. Structured multipart fields are JSON strings with native boundaries. The limited payload types reject unsupported fields rather than dropping them.

Email response tracking/provider/immutable IDs retain their namespaces. Successful HTTP responses are still unparsed data, not provider delivery or durable receipts. Draft creation does not claim update/delete or current approval/revoke parity. Provider email idempotency is memory-only, time-limited and not an authoritative service journal. Lost/slow/malformed or ambiguous write responses remain unknown; no automatic retry occurs.

`verifyUnipileV1Webhook` authenticates the separately configured static custom header, preserving duplicate occurrences through `request.rawHeaders`. It offers no body integrity signature, signed timestamp or replay protection. V2 HMAC verification is separate. No webhook HTTP route, registration, durable acknowledgement, event parser or deduplication is enabled by these helpers.

The OrbStack proof exercises compiled transport/normalizers and synthetic SDK/API paths plus email/draft formats. Its memory journal demonstrates test ordering/replay only; it does not prove database fencing, quotas, authorization, persistence or restart safety. Full persistent integration remains P2/P3 work under exact migration approval.
