# P3.3 — V1 existing-chat social adapter TDD

12 October 2026. Scope: reusable `createUnipileV1MessagingAdapter` in `communications/packages/adapter-unipile/src/v1-adapter.ts`, with a minimal injected transport and trusted recipient-mapping ports. No environment, database, Acquire or framework imports; no live provider calls or account activation. Existing application defaults/routes remain unchanged. Parent owns aggregate exports and composition.

Acceptance constraints exercised: A05 scoped owner/account/generation, A06 unresolved-send preservation, A07 original-backend receipt recovery, A08 operation identity, A12 truthful readiness/capabilities, A14 unsupported behavior, A15 immutable bindings, A19 invitation actions. These are scoped local proofs, not complete architecture acceptance scenarios.

## Red and green

The behavior tests were written before implementation; a typed missing-behavior stub threw `v1 messaging adapter not implemented`. `pnpm exec vitest run communications/packages/adapter-unipile/src/v1-adapter.test.ts` produced **28 failures / one constructor-rejection pass**, confirming missing submit/readiness/lookup/invitation behavior. Sanitized evidence: `.local-data/communications/verification/unipile-v1-adapter-red.log`.

Implemented the adapter and retained assertions. One initial green attempt exposed a test fixture sharing a deliberately mutated caller binding with the authoritative mapping; the fixture was corrected to retain its own immutable trusted record. The adapter correctly rejected the changed authoritative mapping. Final baseline plus added defensive regression assertions: **41 tests passed** in `unipile-v1-adapter-green.log`. Additional defensive assertions are regression coverage; no separate red evidence is claimed for those already-satisfied cases.

`pnpm exec vitest run communications/packages/adapter-unipile`: **174 tests / eight files passed**, log `unipile-v1-adapter-regression.log`. `pnpm exec tsc -p communications/tsconfig.build.json --noEmit` passed, and targeted ESLint passed after unused import cleanup. Root `pnpm typecheck` at this handoff reported only the parallel dispatch coordinator's test typing errors; no adapter errors. Parent will rerun integrated checks after all slices finish.

## Implemented behavior

- Detached connection, input and callback snapshots protect account/content provenance across awaits. Exact binding, valid operation key/digest and canonical phone/LinkedIn identity validation precede provider I/O; full `messageDigest` includes the recorded conversation.
- Social `subject`, `replyTo`, `rfcMessageId` and unknown message fields are unsupported, never dropped silently. Missing conversation cannot trigger a start-chat. Invitations reject conversations and notes over 300 characters before I/O.
- Readiness resolves the exact configured account/platform/source using the pure v1 normalizer. Existing-chat send additionally requires a trusted immutable account/chat/recipient mapping and provider `Chat` with exact Unipile ID/account, direct `type:0` and writable `read_only:0`.
- Message success uses the provider Unipile message ID and original chat; sparse/null IDs remain unknown. A thrown write or uncertain transport response remains unknown, with no retry. Definite transport rejections map to explicit waiting/review/rejection. Predispatch read/mapping exceptions wait without dispatch.
- Lookup requires original message ID and recorded canonical recipient. The trusted port must recover the original chat from the snapshot/message record; a provider-returned attendee or matching text is not an identity authority. Lookup performs only `getMessage`, validates original account/chat/message/outgoing provenance, and works with a historical disconnected connection. It never calls readiness, sends or opens a conversation.
- LinkedIn invitation dispatch requires a trusted canonical profile-to-provider-user mapping. Its result uses `ActionReceipt.operation`, never a message ID. Invitation lookup, relationships, profile resolution, events, coverage, email and drafts remain unsupported by this adapter.

## Required composition and limits

This raw adapter exposes `durableIdempotency:false`. It has no operation journal, lease, quota, admission gate or operation-key replay map. **Production application composition must wrap it with an authoritative durable dispatch coordinator** before exposing dispatch. The injected mapping ports must enforce original scope/key/content/account/generation against persisted immutable records; a permissive synthetic mapper is suitable only for fixtures.

Existing-chat send must not accept a provider chat alias as if it were the recorded Unipile chat. No chat/recipient/account mapping is discovered or stored here. Source health does not establish fresh exhaustive reply coverage. No real account is connected, so even transport compatibility remains live-unverified beyond account-list authentication. Generic service persistence and webhook ingestion depend on separately approved SQL and repository work.

Handoff: this slice is green/refactor with no deliberately failing test pending. Next: parent reviews and composes the standalone exports with the dispatch coordinator, then runs integrated contract/adapter/API tests and synthetic OrbStack transport evidence. Persistent registration/mapping and live channel validation remain separate work; do not apply migrations or send live messages implicitly to prove them.
