# Communications contracts v1

`src/index.ts` is a framework-free, dependency-free transport boundary. It is intentionally usable through relative imports before package publication. It does not load environment variables, credentials, databases or Acquire modules.

Channel, platform and backend have separate meanings. A Gmail mailbox can use either `direct` or `unipile` as its backend; neither changes its `email` channel. A valid binding does not establish that an adapter, account or product supports the requested operation. Consumers must inspect capabilities and readiness separately.

Persist a `ConnectionBinding` before dispatch and keep it on the enrolment, draft, operation journal, provider reference and event checkpoint. `accountId` is a stable service-owned account identity; `generation` changes when account identity/authorization changes. Provider account IDs are optional metadata on `ConnectionRecord`, not substitutes for this binding. Account aliases and event cursors are generation-scoped. Physical-account consolidation and generation persistence are repository responsibilities that this package cannot prove.

`resolveRecordedConnection` only resolves the recorded binding within the authorized application/tenant/owner. It has no default or fallback parameter. Disconnected original connections remain resolvable so read-only receipt recovery can run; messaging readiness must still block new sends. A current default belongs to selection for new work, not recovery of existing work.

`OperationSnapshot` freezes key, account/backend/generation, operation and payload digest. The core must compute the digest from every material content field, recipient, header, threading reference and option, and persist it transactionally. `assertOperationMatches` rejects changed snapshots; it does not provide a durable journal or prove two separately generated digests correspond to the same payload.

Message submission is distinct from delivery and reading. A submitted outcome carries a namespaced message receipt; timestamps are absent when unknown. A skipped relationship action carries an operation reference and reason rather than a fabricated message ID. Waiting, review, rejected and unknown remain different outcomes. Missing lookup results never authorize resubmission. The messaging adapter lookup receives correlation metadata only and must perform no dispatch.

When only an accepted service action is known, a submitted outcome carries `ActionReceipt` with an `operation` reference rather than `MessageReceipt` with a `message` reference. `SubmissionReceipt` is this explicit union. Actions have no delivery/read fields. `assertSubmissionReceiptMatches` validates either shape and rejects ambiguous action/message claims; message event receipts remain real `MessageReceipt` values.

`assertReceiptMatches` requires the recorded binding, canonical recipient and conversation binding to match the receipt. Identity canonicalization and verified alias resolution belong to adapters/core: this guard does not compare display names, rewrite LinkedIn IDs, or merge email aliases.

`coverageReady` checks exact binding, generation, query scope, historical interval, completion, initial sync and invalidation. The provider-covered time and observation time must both be within five minutes, with no future timestamps. A fresh HTTP request cannot substitute for a provider-covered timestamp. App-specific reply identity/hold decisions remain outside this package. `ready` describes account/product readiness, independently of historical coverage.

Messaging, events, email drafts and LinkedIn relationships have separate interfaces. Draft operations return draft records and have no implicit send operation. Setup actions explicitly describe redirect, QR, browser, verification or completion steps without exposing service credentials.

Local verification:

```sh
pnpm exec vitest run communications/packages/contracts/src/guards.test.ts
pnpm exec tsc --noEmit --strict --skipLibCheck --target ES2017 --module esnext --moduleResolution bundler communications/packages/contracts/src/index.ts communications/packages/contracts/src/guards.test.ts
pnpm exec eslint communications/packages/contracts/src
```

Runtime ingress schemas, distributed journal fencing, connection persistence, hosted-auth state handling and real provider normalization belong to later adapters/core/API work. Interfaces and pure guard tests alone do not establish those capabilities.
