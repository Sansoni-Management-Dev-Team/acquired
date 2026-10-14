# P1.3 — Standalone SDK and injected HTTP service evidence

2026-10-12; repository baseline `fa544da5578375efd57af4ba680a403a1568769e`, current dirty communications implementation tree. This slice owns `communications/packages/sdk/**` and `communications/services/api/**`. It does not change Acquire routes, core/contracts, configuration, database schema, production accounts, or deployment. No migration or provider operation was performed.

## Scope and boundary

The SDK and native HTTP server expose versioned health, readiness, message/invitation submit, and read-only receipt lookup. Authentication, scoped connection storage, adapter selection and authoritative action journals are injected. The service accepts only the exact recorded application/tenant/owner/account/backend/generation binding; caller body claims cannot grant ownership and there is no default backend or fallback. Submit content is checked against the canonical operation-specific digest.

The server validates JSON request sizes/types/fields and response shapes. Submissions require current connection/capability admission; LinkedIn invitations require the LinkedIn binding and invitation capability. Original disconnected work can still use receipt lookup without readiness, connect or submit. Actual message receipts and journal action receipts retain distinct provenance. If an original message reference is supplied, its message ID must match the retrieved receipt.

The SDK captures configuration and clones request snapshots before awaiting fetch. It refuses redirects/retries, bounds fetch/body deadlines and response bytes, validates contract version and outcomes, and scrubs transport/error details. Arbitrary HTTP/proxy 4xx bodies are uncertain after possible submission. Only exact versioned known predispatch code/status rejections are thrown as sanitized errors. Provider acceptance followed by lost/invalid response remains `unknown`.

Relevant acceptance subsets: A05 (scope and ingress rejection), A06 (content snapshot conflict boundaries), A07 (one dispatch/lost response/read-only recovery), A08 (receipt/provenance matching), A15 (exact binding/no fallback), A19 (invitation routing capability), A22 (synthetic fixture and sanitized failures), A25 (independent compiled service/client boundary). These subsets are not full scenario completion: no distributed persistence, leases, membership revocation, provider history or live channel integration is certified.

## TDD evidence

Command used for red/green iterations:

```sh
pnpm exec vitest run communications/services/api/src/server.test.ts --reporter=dot
```

| Slice | Red evidence, local time | Green evidence |
| --- | --- | --- |
| Initial boundary behavior | 09:24:27: 11 failures from deliberate `Not implemented` API/SDK stubs. Request/auth/binding/lookup/lost-response behavior did not exist; no unavailable database or credential prerequisites. | 09:26:48: 11/11 passed |
| Invalid post-dispatch receipt preserves uncertainty | 09:27:21: 1 failed, 12 passed; invalid receipt was incorrectly thrown as known `receipt_mismatch` rejection after dispatch | 09:27:36: 13/13 passed; post-dispatch invalid receipt becomes unknown |
| Unexpected adapter fields/readiness codes fail closed | 09:28:03: 1 failed, 13 passed; arbitrary readiness code leaked as valid output | 09:28:58: 14/14 passed; runtime response validation rejects unexpected fields/code |
| Invitations, proxy 4xx uncertainty, snapshot capture and lookup message ID | 09:31:57: 5 failed, 14 passed; invitation rejected, proxy protocol error misclassified definite, caller mutation corrupted expected receipt, wrong lookup ID accepted | 09:33:00: 19/19 passed after operation/capability routing, trusted rejection checks, cloned snapshots and ID guards |
| Non-string response code is rejected without coercion | 09:33:55: 1 failed, 19 passed; array `['reconnect']` coerced to accepted code | 09:34:18: 20/20 passed |
| Historical immutable generation receipt recovery | 09:37:00: 15 failed, 6 passed after fixtures required explicit generation; server omitted it and could not resolve original receipt despite newer active backend | 09:37:26: 21/21 passed; repository is explicitly `get(scope,id,generation)`, exact old disconnected generation lookup succeeds and missing/foreign generation never falls back |
| Canonical recipient ingress and channel kinds | 09:52:12: 2 failed, 21 passed; uppercase/whitespace email and cross-channel recipient kinds reached submission and produced unknown | 09:52:37: 23/23 passed; noncanonical email and wrong channel recipient/correlation kinds receive 400 before adapter resolution/dispatch |

Native loopback tests cross SDK → HTTP server → scoped repository → synthetic adapter. They cover public health/version, readiness, submit/lookup, bad authentication, forged application/tenant/owner, stale generation/account/backend, malformed/oversized/unknown-field JSON, contract mismatch, content-digest mismatch, disconnected lookup, dispatch content rejected on lookup, wrong receipt/account/message IDs, action receipt distinction, adapter exceptions, and lost reply after exactly one adapter dispatch. A native dropping proxy consumes the upstream submit response then closes the client socket; later lookup confirms the original receipt without another submit. Injected hung-fetch and versioned malformed/proxy responses exercise deadline/protocol uncertainty without external connections.

Scoped lint and **root typecheck including tests** both passed at 09:34:18, exit 0; final historical-generation update reran the 21-test native boundary suite and clean scoped lint at 09:37:26, with root typecheck again passing, exit 0:

```sh
pnpm exec eslint communications/packages/sdk/src communications/services/api/src
pnpm typecheck
```

Final canonical-ingress update at 09:52:37: **23 native SDK/API boundary tests pass**, root `pnpm typecheck` including tests passes, and scoped lint is clean; all commands exit 0. Callers must canonicalize identities before computing content digests. Direct Gmail normalization was left unchanged; only the service's canonical request/lookup boundary now rejects uppercase/whitespace emails and recipient kinds inconsistent with the recorded channel. No provider-specific phone/LinkedIn format was invented.

Earlier standalone source compilation also passed. Root typecheck caught two test-only typing issues (invalid-config fixture literal narrowing and mock fetch-call tuple); both were fixed before the final root pass. Source-only compilation was not substituted for test typechecking.

## Independent compiled fixture

Compile/start using repository TypeScript and only the communications dependency tree:

```sh
pnpm exec tsc --strict --skipLibCheck --target ES2022 --module commonjs --moduleResolution node --rootDir communications --outDir /tmp/acquire-communications-api communications/services/api/src/fixture-entry.ts communications/packages/sdk/src/index.ts
node /tmp/acquire-communications-api/services/api/src/fixture-entry.js --fixture --port 4044
```

A compiled child-process smoke passed health, readiness, submit, identical replay, lookup, and changed-content operation conflict. It used the fixed synthetic account/token described in [API README](../../communications/services/api/README.md), computed digests using the compiled communications core, and shut down the child after verification. No Next.js/Acquire runtime, database, environment credentials, provider, n8n, or external HTTP endpoint was required.

For OrbStack, mount only the compiled directory at `/fixture`, use a reviewed Node image without environment/secret mounts, bind the published port to local loopback, and run:

```sh
node /fixture/services/api/src/fixture-entry.js --fixture --host 0.0.0.0 --port 4044
```

This agent did not start a container. Parent-led OrbStack parity and integration evidence is recorded separately. Host-native and compiled child-process checks must not be labeled container or live provider verification.

## Limits and handoff

- The API has no durable journal/storage/session leasing. Injected adapters retain that authority; the fixture uses memory and advertises `durableIdempotency: false`. Its restart loses all journal state. It is a synthetic transport example, not production standalone send infrastructure.
- Submitted outcomes and operation-specific errors still rely on correct adapter behavior. The HTTP boundary does not certify provider idempotency, reconciliation, quotas, five-minute coverage, or reply stops.
- Only message/invitation snapshots use messaging endpoints; drafts, connection lifecycle, events/webhooks, caller provisioning and persisted tenancy are unfinished.
- The public service health response intentionally reports contract version only. Production authentication/authorization implementations must be injected and enforce current membership; no default production credentials exist here.
- Independent clean checkout, versioned package distribution and durable storage extraction remain P6 work. This fixture proves the current relative-import communications modules compile and run without Acquire runtime dependencies.
- The injected repository must retrieve the exact immutable generation and preserve prior records as disconnected/read-only. No generation repository or migration is implemented here; retaining old journals/credential access and marking older generations read-only remain storage/adapter responsibilities.

Next action: parent review/compile the final SDK/API source tree and execute the fixture in the reviewed OrbStack environment; integrate recorded bindings and authoritative legacy wrappers before touching application routing. Continue migration/provider activation gates independently. Current TDD stage: green; root typecheck and scoped lint pass.
