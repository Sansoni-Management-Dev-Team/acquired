# Communications SDK v1 boundary

`CommunicationsClient` takes an explicit service URL, `contractVersion: "1"`, injected authentication key, and optional fetch/timeout/response-size policy. It never loads environment variables or application modules. HTTPS is required except explicitly enabled loopback HTTP for synthetic fixtures; embedded credentials, fragments and query strings are refused.

Typed methods cover health, readiness, message/invitation submission and receipt lookup. Requests and responses require the same explicit version; the client never switches versions, connections or backends. Redirects and retries are disabled. Transport/5xx/protocol failure after a submit yields `{status:"unknown"}`; only an exact versioned, allowlisted predispatch code/status response throws a sanitized `CommunicationsClientError`. Arbitrary proxy 4xx responses preserve uncertainty. Lookup sends correlation metadata only and cannot initiate a send. Responses are bounded and runtime validated, preserving actual provider message receipts separately from service journal action receipts. Caller submission/lookup snapshots are cloned before awaiting transport, and supplied original message IDs must match lookup receipts.

The SDK is a transport boundary, not a durable operation journal. Persist the operation key/binding/content snapshot before submit and resolve uncertainty through the original adapter's journal/receipt lookup. Never resubmit simply because a lookup returns null. Real tenant membership revocation, journal fencing, account quotas and provider coverage remain injected service/adapter responsibilities.

Canonicalize recipient identities before computing the snapshot digest: email values must be trimmed/lowercase; kinds must match the recorded channel (`email`, `phone` for WhatsApp, `linkedin_profile` for LinkedIn). The service enforces the same canonical boundary for lookup correlation and rejects invalid inputs before adapter invocation. The SDK does not mutate identities/digests or infer LinkedIn identifiers.

The API reuses this package's pure response validators; those validators import only shared contracts. Source imports are relative while repository extraction/package publication is pending. CommonJS compilation and the fixture-only server are documented in [API README](../../services/api/README.md).

Verification:

```sh
pnpm exec vitest run communications/services/api/src/server.test.ts
pnpm exec eslint communications/packages/sdk/src communications/services/api/src
```
