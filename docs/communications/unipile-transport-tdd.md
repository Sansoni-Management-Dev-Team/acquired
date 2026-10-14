# P3.1 — Provisional v2 transport and webhook authentication evidence

Date: 2026-10-12. Source baseline: `fa544da5578375efd57af4ba680a403a1568769e`, dirty tree with planning and independent contracts work. Scope: `communications/packages/adapter-unipile/**`; no application routing, credential/configuration, database schema, connection callback, service journal, or deployment changes.

This is a bounded P3.1 implementation plus the pure authentication portion of P3.4. It is not completion of P3.1/P3.4 or live provider verification. The user's endpoint/API-version clarification is pending. Tests use explicit synthetic keys and native Node HTTP listeners on `127.0.0.1`; they never load environment secrets or use live Unipile.

## Specify and red

Behavior: explicit v2 transport sends correctly scoped requests without redirects/retries, bounds response/time resources, and distinguishes known HTTP rejection from uncertain mutation outcome; exact raw-body webhook authentication rejects invalid timestamps/signatures/headers. Relevant coverage subsets: A05–A08, A11, A14 and A22. Durable ownership, operation-key deduplication, replay ingestion, and provider compatibility are outside these tests.

Tests were added before production implementation. Initial exports were deliberate `Not implemented` stubs establishing the missing API behavior; no pre-existing working implementation was altered to create failures.

Command:

```sh
pnpm exec vitest run communications/packages/adapter-unipile/src/http.test.ts communications/packages/adapter-unipile/src/webhook.test.ts --reporter=dot
```

RED at 09:17:26 local: **2 files failed; 35 tests failed, 1 passed**. Representative intended failures: account-list request cannot be issued; lost submission response cannot remain unknown; exact-body webhook signature cannot be authenticated. Failures originate from `Not implemented`, with no unavailable database, missing dependency, or live credential prerequisites. Local raw red output was saved to `/tmp/acquire-unipile-transport-red.log` and contains synthetic fixture data only; this temporary path is not a durable artifact dependency.

## Green and refactor

Implemented a framework-independent injected HTTP transport with private credential fields, explicit version/base URL validation, operation path validation, no redirects, no mutation retries, request cancellation, deadlines covering response reads, byte-limited JSON parsing, sanitized errors, and separate `unknown`/`unavailable` outcomes. Account list/get and text-only existing-chat send are the deliberately small verified request shapes. No account capability/tenancy claims are inferred from HTTP success.

Implemented a pure Node HMAC verifier using exact raw bytes, constant-time digest comparison, strict single versioned header pairs, safe-integer timestamp checks and bounded replay-age/future-clock policies. Verification is deliberately independent of JSON parsing and event storage.

GREEN at 09:18:55: **36/36 tests passed** after initial implementation. Added cancellation/hung-fetch/secret-enumeration/trailing-header checks; GREEN at 09:19:31: **39/39 tests passed**. No production behavior changed after that green result except the test's unused callback argument cleanup.

Native HTTP fixture evidence covers actual account/messaging path and JSON shapes, request key/cache headers, 401/403/404/422/429 classification, loss of response after the server consumes the submission, 503 read/write distinction, request timeout, redirected-server isolation, malformed/oversize response bodies, and exactly one submission request. Synthetic injected-fetch evidence also verifies hung-fetch bounds, already-canceled no-dispatch, in-flight cancellation uncertainty, and error scrubbing.

Webhook evidence covers exact bytes including invalid UTF-8, whitespace/body change, wrong secret, stale/future clock boundaries, malformed/duplicate/versioned signature headers, missing secrets, and the distinction between authentication and persistent replay deduplication.

Scoped source TypeScript compilation passed:

```sh
pnpm exec tsc --noEmit --target ES2022 --module nodenext --moduleResolution nodenext --strict --skipLibCheck communications/packages/adapter-unipile/src/http.ts communications/packages/adapter-unipile/src/webhook.ts
```

Targeted ESLint initially returned no errors and one unused synthetic callback argument warning; that argument was removed. Final clean lint and combined tests at 09:20:51:

```sh
pnpm exec vitest run communications/packages/adapter-unipile/src communications/packages/contracts/src --reporter=dot
pnpm exec eslint communications/packages/adapter-unipile/src
```

Combined result: **3 files, 94 tests passed** (39 transport/signature tests and 55 shared-contract tests), exit 0. Targeted lint: no warnings/errors, exit 0. Repeated scoped TypeScript source compilation: exit 0. These results cover the current adapter files and the concurrently developed shared contracts at that time, not the entire application.

## Limits and next action

- These checks run on the host using a real loopback HTTP boundary; they are **not OrbStack integration evidence**. The parent owns the container/app/database parity checks and can mount this same fixture suite in its reviewed OrbStack test environment.
- Real v2 credential rejection was recorded separately in [P0.3 research](unipile-contract-research.md); this module did not make another provider request.
- No full method response schema, durable v2 idempotency, error taxonomy by provider, account scopes, LinkedIn product/relationship logic, drafts, initial synchronization, coverage, webhook endpoint secret, or ingestion/reconciliation implementation is certified.
- Success response payloads remain `unknown`; later adapter operations must validate exact schemas. The transport's success means HTTP acceptance only. Integer `Retry-After` is supported; HTTP-date retry values remain unsupported.
- P3.4 must durably record verified events before acknowledgement, validate account/application/generation ownership, and deduplicate/replay asynchronously. A pure signature verifier cannot satisfy those requirements.

Next action: parent review the module and evidence, then execute the tests alongside shared contracts in the reviewed local fixture/container environment. Keep real Unipile operation activation disabled until explicit API version/configuration and operation-specific contracts are resolved. No migration is required for this slice.
