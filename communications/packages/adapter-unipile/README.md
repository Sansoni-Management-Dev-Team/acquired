# Unipile transports and adapters

This standalone Node/TypeScript module has separate explicit v1 and v2 implementations. Acquire's existing routes do not consume it yet. Configuration and trusted account/recipient mappings are injected; it never reads environment files.

The user's DSN/key authenticated successfully for v1 (HTTP 200 with no connected accounts). V2 returned 401 and remains fixture-only. `UnipileV1Transport` requires `apiVersion: "v1"` and a base URL ending in `/api/v1`; `UnipileV2Transport` requires `apiVersion: "v2"` and `/v2`. HTTPS is required, with an explicit loopback HTTP exception for synthetic fixtures. There is no version, host or backend fallback.

## V1 implemented scope

- Opaque account IDs and cursor-based account reads; guarded chat and exact message/email reads.
- Existing-chat text/quote multipart submission with the recorded account field.
- Email multipart submission with an explicit original idempotency key; draft creation; JSON LinkedIn invitations.
- Account/source health and message/invitation receipt normalization. Null, mismatched or malformed references remain unknown.
- A social messaging adapter for WhatsApp and LinkedIn, with required trusted direct-chat recipient mapping and optional verified invitation profile mapping. Original conversation/account/generation and payload digests are checked before submission. Historical lookup is read-only.
- Static configured-header webhook authentication using `request.rawHeaders`, rejecting duplicate occurrences. This is separate from v2's HMAC verifier.
- All-channel incoming event normalization: verified direct-chat participants and canonical aliases for WhatsApp/LinkedIn, authenticated full-message/header enrichment for email, exact scoped generation/account/product and timestamp bounds. Outgoing/group/nonreply/system activity is excluded; contradictions and uncertain identities/folders require review. This pure function does not provide history or freshness coverage.

The social adapter requires an authoritative dispatch coordinator at composition. It supplies no journal, leases, quotas or authorization repository, and advertises no durable idempotency or event coverage. The coordinator's required storage port is not itself a durable implementation. Trusted mappings cannot be inferred from a caller's recipient or an unverified provider response.

Successful transport responses contain `unknown` data and require operation-specific validation. HTTP acceptance is distinct from delivery. Email tracking, provider and immutable IDs must not become fabricated Unipile message references. The email idempotency cache is memory-only, limited to email and lost on restart; service journaling remains necessary. Draft creation does not establish update/delete parity.

Writes are never retried. Lost, malformed, timed-out or ambiguous responses remain unknown. V1 definite 409/422 rejections require allowlisted error types with a matching numeric status; unsupported 4xx responses cannot certify an unsent operation. Diagnostics exclude arbitrary provider bodies/titles/details. Responses and request durations are bounded, and redirects are disabled.

## Remaining scope

Connect/reconnect/disconnect, persistent grants/ownership/mappings, durable event ingress/deduplication, event/history coverage, LinkedIn relationship/profile operations, start-chat/group/attachment support, full email/draft normalization and independent backend runtime extraction remain outstanding. No webhook endpoint has been registered. Static v1 header authentication supplies no payload signature, timestamp or replay protection; durable ingestion must handle those limits.

## Verification

```sh
pnpm exec vitest run communications/packages/adapter-unipile/src
pnpm exec eslint communications/packages/adapter-unipile/src
pnpm test:communications:orbstack
```

Tests use synthetic secrets and native loopback HTTP fixtures. The OrbStack SDK/service proof composes the actual v1 social adapter and dispatch coordinator with a synthetic memory storage port; it does not certify persistent database behavior. No live credentials are mounted. See [v1 contracts](../../../docs/communications/unipile-v1-contracts.md), [transport TDD](../../../docs/communications/unipile-v1-transport-tdd.md), [normalization TDD](../../../docs/communications/unipile-v1-normalization-tdd.md), [adapter TDD](../../../docs/communications/unipile-v1-adapter-tdd.md), and [verification](../../../docs/communications/verification.md).
