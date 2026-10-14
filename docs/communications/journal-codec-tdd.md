# P2 — Journal encryption codec TDD

12 October 2026. Bounded building block for P2.1–P2.3 original operation context, receipt and typed outcome encryption. Acceptance constraints A05 (scope), A08 (content identity), A15 (immutable generation), A21/A22 (encrypted journal metadata). This does not prove PostgreSQL persistence, RLS, admission fencing or durable operation recovery. No database, environment, vault, credential configuration or provider access occurred. Only synthetic deterministic test keys were used; production keys must come from an explicitly configured secret store.

## API and format

`JournalCodec` in `communications/packages/core/src/journal-codec.ts` takes an explicit active version and retained keyring: `{activeVersion, keys:[{version,encryptionKey,digestKey}], maxPlaintextBytes?}`. Encryption and digest keys are independent 32-byte Uint8Arrays, copied into private fields at construction. Duplicate/missing versions, wrong key sizes and encryption/digest key reuse anywhere across the retained keyring are rejected. Input keyring changes cannot alter captured keys. No key generation or environment loading occurs.

- `encode(snapshot,purpose,value)` returns `{format:"communications-journal-v1",keyVersion,nonce,ciphertext,tag}`.
- `decode(snapshot,purpose,envelope)` returns an unknown JSON value; repositories must validate the context/receipt/outcome shape before treating it as a typed record.
- `digest(snapshot,purpose,value,keyVersion?)` returns lowercase HMAC-SHA256 hex; default is the captured active version. The `keyVersion` getter supplies the version to persist with the digest. Explicit old-version digest computation supports retained-key comparisons without fallback.

Purposes are `context`, `receipt`, `outcome`. AEAD is AES-256-GCM with random 12-byte nonce and 16-byte tag. Deterministic canonical AAD includes a domain, format, key version, purpose and **full** validated operation snapshot (scope, connection/account/generation, channel/platform/backend, operation key/type and payload digest). HMAC uses an additional digest domain and the separate digest key, incorporating the same metadata and canonical value. Neither version selection nor purpose/account binding can silently change on decode.

Envelope base64 uses standard padded canonical encoding; byte lengths, padding bits, unknown keys, key versions and format are strictly validated. Plaintext defaults to at most 1 MiB, configurable from 1 byte to 5 MiB; JSON trees are also bounded to 10,000 nodes and depth 32. Version identifiers are bounded ASCII tokens; keyring maximum is 32 versions. Canonical JSON sorts dictionary keys and preserves array ordering. Values must be ordinary JSON records/arrays/scalars: undefined (including fields), nonfinite numbers, negative zero, BigInt, functions, custom prototypes, sparse arrays, accessors, hidden/symbol keys, cycles and proxies are rejected. Optional repository fields must be **omitted**, not set to undefined.

Every failure exposes only `Invalid journal data`; raw plaintext, key material, parser errors and underlying authentication errors are excluded. Returned envelopes and decoded values are detached. Ciphertext confidentiality does not protect application authorization: repositories still enforce trusted scope and exact ownership.

## Red–green evidence

First wrote 49 behavioral tests against a missing-behavior stub, then ran `pnpm exec vitest run communications/packages/core/src/journal-codec.test.ts`: **49 failures**, all due to `Journal codec not implemented`. Private sanitized log: `.local-data/communications/verification/journal-codec-red.log`.

Implemented the codec; baseline **49 tests passed**. Added a counterfeit-value test before fixing a discovered gap: proxy input executed traps and was accepted. The new assertion failed in `journal-codec-counterfeit-red.log`; the serializer now rejects Node-detected proxies before touching descriptors and rejects custom array prototypes. Final baseline: **50 tests passed**, `journal-codec-green.log`.

Independent review added ten tests using a separate Node AES-GCM producer with explicitly reconstructed v1 AAD. It exposed two defects with separate red logs: cross-role key reuse across retained versions (`journal-codec-review-red.log`) and silently stripped leading UTF-8 BOM in authenticated plaintext (`journal-codec-review-bom-red.log`). Fixed the whole-keyring cross-role check and preserved BOM during fatal UTF-8 decoding so strict parsing rejects it. Review also verifies valid external canonical ciphertext, malformed UTF-8, duplicate JSON keys, valid alternate binding tuples and HMAC framing. Combined **60 tests passed** in `journal-codec-review-green.log`.

Coverage includes authenticated roundtrips, nonce uniqueness, ciphertext secrecy, wrong purpose/scope/generation/operation/key/digest, body/tag/nonce tampering, strict envelope/base64 limits, old-key rotation, wrong-key-version rejection, caller key mutation, deterministic/domain-separated HMAC, strict malformed JSON and sanitized errors. Standalone communications TypeScript build and targeted ESLint pass. Root `pnpm typecheck` also passed after adjusting test syntax for its lower compile target (BigInt constructor and ordinary subclass array population; assertions unchanged), evidence `journal-codec-root-typecheck.log`. Core regression: **124 tests / five files passed** in `journal-codec-core-green.log`. Parent will record final integrated regression evidence separately.

## Handoff

Baseline and independent adversarial review are green/refactor. Parent owns exports and future repository composition. Persist envelope plus its exact key version; retain old key bundles while corresponding journal data remains. Key loss remains a fail-closed recovery condition, never permission to regenerate context, substitute current sender or retry an unknown send. Digest-key rotation needs an explicit retained-version compatibility process. Production cryptographic key provisioning, encrypted provider configuration, lifecycle credentials and actual database transaction/RLS/concurrency tests remain outstanding and require separate scope/evidence.
