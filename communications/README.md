# Communications service foundation

This folder contains framework-independent contracts, explicit Unipile transports and a
v1 social adapter, an SDK, and an injected HTTP service. It builds without importing
Acquire, Next.js, Better Auth, n8n, or application database tables. Its runtime modules
depend only on Node built-ins and injected ports.

| Module | Implemented scope |
| --- | --- |
| `packages/contracts` | Connection/account/generation ownership, canonical identities, capabilities, coverage and receipt provenance |
| `packages/core` | Stable content/draft fingerprints, encrypted codecs, dispatch coordination and authoritative reply/setup/outbox ports |
| `packages/adapter-unipile` | V1 transport/social adapter, exact account/chat/receipt and all-channel reply normalization, hosted setup and version-specific webhook authentication; separate provisional v2 transport |
| `packages/storage-postgres` | Driver-injected encrypted webhook/event/outbox/auth-state repositories and tenant reply barriers; bounded durable send journal with dispatch deliberately disabled |
| `packages/sdk` | Versioned HTTP client; unknown outcome handling and original-generation recovery |
| `services/api` | Authenticated scoped server, separate bounded webhook listener and explicit synthetic fixtures |

Build from the Acquire feature worktree with
`node node_modules/typescript/bin/tsc -p communications/tsconfig.build.json`; run tests
with `node node_modules/vitest/vitest.mjs run communications`. The feature worktree
shares its dependency installation with the original checkout; do not invoke `pnpm exec`
there. `pnpm test:communications:orbstack` compiles and tests a dedicated synthetic
service/client in OrbStack without environment/credential mounts, real provider calls,
database initialization or migrations. Its storage is synthetic and does not advertise
durable idempotency.

For reply fixtures, use `node scripts/test-communications-replies-orbstack.mjs`. It
composes actual email/WhatsApp/LinkedIn normalization, encrypted capture/event processing,
outbox coordinator and webhook HTTP listener in an ephemeral network-isolated container.
Synthetic storage/application receipts do not prove PostgreSQL durability or real campaign
stops. No event arrival or webhook acknowledgement advances reply coverage. See
[reply TDD](../docs/communications/reply-detection-tdd.md).

To copy this foundation into a separate repository, retain this folder and install its
declared development dependencies before running `npm run build` / `npm test`. A fresh
independently installed copy builds/tests in a dedicated OrbStack Node 22 container
(`pnpm test:communications:copy-orbstack`). The harness uses integrity-verified npm 11.6.2
because bundled npm 10.9.9 has a reproducible optional-peer installer failure. Dependencies
are unchanged. The package boundary is one unpublished CommonJS package; distributions,
versioning and release remain separate work.

## Legacy extraction and removal

The user's 2026-10-13 scope change moves direct Gmail, Baileys WhatsApp and browser LinkedIn
into the independent `../legacy-channel-services` repository and removes their executable
connection methods from Acquire. The independent `packages/legacy-adapters` preserves
contracts, the Gmail/legacy injected wrappers, fingerprint/coordinator code and the full
legacy integration tests byte-for-byte, with a SHA-256 source manifest. Before removing
the duplicates here, that independently installed package passed 167 tests. Its runtime
services and standalone authorization/storage are maintained in that repository.

Acquire's core retains provider-neutral dispatch/recovery tests. Six adapter-specific
integration executions formerly in `core/src/dispatch.test.ts` remain in the preserved
independent full test file; they are not duplicated here with legacy adapter code. The
aggregate API no longer exports `createGmailAdapter` or `createLegacyMessagingAdapter`.
Historical backend discriminators, immutable recorded bindings and unknown-send outcomes
remain supported by contracts/storage. Code removal does not rebind, resend or delete
historical operations, sessions or database records, and does not decommission remote
services or deploy the change.

## Verification limits and next work

Durable reply/setup and the bounded journal have actual isolated PostgreSQL evidence.
The send journal intentionally denies `beginDispatch` with `delivery_disabled`; no real
provider admission or account/application quota transaction is enabled. Complete history,
relationship/connect features, production UI routing and live provider parity remain
outstanding. Consult the current [progress record](../docs/communications/progress.md)
for exact current-source results and separately approved database targets.

The local 001/002/003 artifacts were each specifically approved/applied only on isolated
OrbStack 5445. The approved service-only split and proof on 5446 are separate from the
legacy WhatsApp target proposed on 5447. Never reuse an approval for a new target or altered
artifact. Startup never auto-migrates; code extraction does not authorize historical data
cleanup. See the [execution plan](../docs/39-communications-service-execution-plan.md) and
[persistence design](../docs/communications/persistence-design.md).
