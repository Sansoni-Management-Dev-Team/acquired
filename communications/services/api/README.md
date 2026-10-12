# Injected communications API boundary

`createCommunicationsServer` creates a native Node HTTP server. It imports only communications contracts/core/SDK response validation and Node APIs. It reads no Acquire authentication, database, aliases, environment files, or provider credentials.

Inject three dependencies: an authentication function returning trusted application/tenant/owner scope, a scoped connection repository, and an adapter resolver for that exact connection. Body scope claims never grant access. All operations validate the immutable recorded binding; no default connection or backend fallback exists. Send snapshots must match the canonical content digest. Original disconnected bindings remain available for read-only receipt recovery.

The repository API is `get(scope, connectionId, generation)`: it must retrieve the exact immutable recorded generation, never substitute the current generation or default. Preserve historical records as `disconnected` (read-only) when a new account/generation becomes active. Their original adapter journal remains available for lookup, while disconnected generations cannot submit. A missing/foreign generation fails with no fallback. Marking older records read-only and preserving their credentials/journals are repository responsibilities; the HTTP service does not implement that persistence.

Canonical recipients are required at ingress: lowercase/trimmed email identities, `email` kind for email bindings, `phone` for WhatsApp, and `linkedin_profile` for LinkedIn. The same checks apply to lookup correlation. Callers must canonicalize identities **before constructing the content digest**; the service rejects noncanonical inputs before resolving/dispatching an adapter and never rewrites a digest after dispatch. It does not invent phone or LinkedIn ID formats. Direct Gmail adapter normalization compatibility remains separate from this canonical service boundary.

Endpoints:

| Method/path | Contract/body | Purpose |
| --- | --- | --- |
| GET `/health` | No body/auth required | Reports contract version only |
| POST `/v1/ready` | `{binding}` | Readiness of the recorded account |
| POST `/v1/submit` | `MessageSubmission` | Submit a message/invitation through the exact adapter |
| POST `/v1/lookup` | `ReceiptLookup` | Receipt lookup with no dispatch content |

POSTs require `X-Communications-Contract-Version: 1` and an authenticated caller. Authorization is defined by the injected function; the synthetic example uses a fixture bearer token. Bodies are bounded, JSON-only, strictly validated, and unknown fields rejected. Errors contain bounded codes only. Response shapes are validated and preserve message receipt versus service action receipt provenance. A failure or invalid receipt after adapter submission produces `unknown`.

Messaging endpoints accept `message` and `invitation` operation snapshots only; draft operations stay separate. Invitations require the original LinkedIn binding and advertised invitation capability, with an operation-specific digest. Receipt lookup can recover previously authorized invitations even when readiness/capabilities change; it requires receipt lookup support and never dispatches. When a caller supplies an original provider message reference, an actual matching message receipt is required—an action journal ID is insufficient.

This service has **no persistent operation journal**. The injected adapter remains the authoritative journal/session/quota boundary. It must enforce concurrency, durable idempotency, account access, and readiness; server checks do not establish distributed safety. The synthetic entry uses memory-only fixtures, advertises `durableIdempotency: false`, and never contacts a provider. It is not a production service.

`createReplyWebhookServer` is a separate listener with dedicated `POST /v1/webhook`. Inject a `ReplyIngress` from the required capture coordinator. It authenticates raw headers before reading bounded JSON bytes and awaits an authoritative accepted/duplicate capture result before HTTP 200. Default body/capture timeouts are 5/20 seconds; their configured sum must stay below 30 seconds. Timeout returns 503 without claiming storage failed: a late commit may still occur and must deduplicate a provider retry. No webhook is registered or installed in Acquire routes by constructing this module.

The reply processor requires atomic normalized-event/hold/outbox/terminal-receipt storage, exact generation/grant/lease fencing and authoritative person matching. Review outcomes must block affected coverage, and arrival/acknowledgement never certifies complete fresh history. Those required ports are not a PostgreSQL implementation. [Reply TDD and integration gates](../../../docs/communications/reply-detection-tdd.md) record the current scope.

Compile without application dependencies:

```sh
pnpm exec tsc --strict --skipLibCheck --target ES2022 --module commonjs --moduleResolution node --rootDir communications --outDir /tmp/acquire-communications-api communications/services/api/src/fixture-entry.ts communications/packages/sdk/src/index.ts
node /tmp/acquire-communications-api/services/api/src/fixture-entry.js --fixture --port 4044
```

For an OrbStack Node container mount the compiled output at `/fixture`, omit environment/credential mounts, publish only the local fixture port, and run:

```sh
node /fixture/services/api/src/fixture-entry.js --fixture --host 0.0.0.0 --port 4044
```

The explicit `--fixture` flag is mandatory. Its synthetic scope is `fixture-app` / `fixture-tenant` / `fixture-owner`, connection/account `fixture-connection` / `fixture-account`, generation 1, WhatsApp/Baileys. The sole allowed bearer token is `fixture-only-service-key`, a source-controlled **synthetic token**; never replace it with real credentials. Restarting the fixture loses its journal. No database or schema initialization occurs.
