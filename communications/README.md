# Communications service foundation

This folder contains framework-independent contracts, existing-backend wrappers, explicit Unipile transports and a v1 social adapter, an SDK, and an injected HTTP service. It builds without importing Acquire, Next.js, Better Auth, n8n, or database tables. Runtime code currently depends only on Node built-ins.

| Module | Implemented scope |
| --- | --- |
| `packages/contracts` | Connection/account/generation ownership, canonical identities, truthful capabilities, coverage and receipt provenance |
| `packages/core` | Stable content/draft fingerprints, journal codec, dispatch coordination, and reply receipt/processing through required authoritative storage ports |
| `packages/adapter-gmail` | Injected mailbox/draft port; send, read-only recovery, draft CRUD, threading and RFC correlation |
| `packages/adapter-legacy` | Injected existing WhatsApp/LinkedIn delivery port; original binding, readiness, no retry/fallback |
| `packages/adapter-unipile` | V1 transport/social adapter, exact account/chat/receipt and all-channel reply normalization, version-specific webhook authentication; separate provisional v2 transport |
| `packages/sdk` | Versioned HTTP client; unknown outcome handling and original-generation recovery |
| `services/api` | Authenticated scoped server, separate bounded webhook listener and explicit synthetic fixtures |

Build from the Acquire checkout with `pnpm exec tsc -p communications/tsconfig.build.json`; run contracts/adapters/native HTTP tests with `pnpm test:communications`. `pnpm test:communications:orbstack` compiles and tests a dedicated local synthetic service/client in OrbStack, without environment/credential mounts, real provider calls, database initialization or migrations. The v1 proof uses actual adapter/coordinator modules with synthetic HTTP and storage ports. The fixture is memory-only and does not advertise durable idempotency.

For the reply branch/worktree, use `node scripts/test-communications-replies-orbstack.mjs`. It composes actual email/WhatsApp/LinkedIn reply normalization, capture/processor ports and the webhook HTTP listener in an ephemeral network-isolated container. Synthetic storage/holds do not prove PostgreSQL durability or real campaign stops. No event arrival or webhook acknowledgement advances reply coverage. See [reply TDD](../docs/communications/reply-detection-tdd.md).

With the existing isolated channel stack running, `pnpm test:communications:legacy-orbstack` exercises the new Acquire wrapper through the actual WhatsApp HTTP/session/PostgreSQL journal and its synthetic socket. It creates and removes only its uniquely scoped test owner; it never migrates or contacts a real WhatsApp account. The wider legacy workflow check remains `pnpm test:channels:local`.

To copy this foundation into a separate repository, retain this folder and install its declared development dependencies before running `npm run build` / `npm test`. A fresh independently installed copy builds/tests in a dedicated OrbStack Node 22 container (`pnpm test:communications:copy-orbstack`). The harness uses integrity-verified pinned npm 11.6.2 because bundled npm 10.9.9 has a reproducible optional-peer installer failure; package dependencies are unchanged. This verifies the foundation package rather than the complete existing backend runtimes. The current module package boundary is one unpublished CommonJS package; splitting distributions and versioned releases remains planned work.

Acquire's composition root is `src/lib/channels/communications-adapters.ts` outside this folder. It injects the current owner-scoped implementations; existing application routes/defaults have not switched to this service. The Python LinkedIn and Node WhatsApp runtimes remain in the parent repository's `services/` and still need their persistence/authentication coupling extracted. Existing direct Gmail OAuth/credential handling also remains app-owned until the approved transition.

This is not a production-ready service. Persistent repositories, durable webhook ingestion, quota/lease transactions, complete history/relationship/connect operations, UI routing and independent runtime extraction are outstanding. Prepared migrations are review artifacts only: never execute them or auto-migrate during startup without explicit user approval for their exact target and hash. See the [execution plan](../docs/39-communications-service-execution-plan.md), [progress](../docs/communications/progress.md), and [persistence design](../docs/communications/persistence-design.md).
