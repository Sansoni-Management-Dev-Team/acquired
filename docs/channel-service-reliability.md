# Channel reliability and rollout

The campaign core owns schedules, recipient snapshots, suppression/reply holds, claims, transitions and audit events. `src/lib/channels/delivery-provider.ts` defines the delivery boundary; `delivery-registry.ts` registers independent email, WhatsApp and LinkedIn modules. Provider payloads and receipts stay behind their adapters.

All providers return `submitted`, `skipped`, `waiting`, `review` or `unknown`. A confirmed rejection cancels the unsent claim and preserves the scheduled step. A transport failure after submission is ambiguous: it is held and is never automatically resubmitted. Read transport failures, rate limits, connecting/sync states and lease contention are retryable. Changed identities, reconnects, invalid contracts and ambiguous replies require review.

Gmail does **not** promise provider idempotency. A stable RFC Message-ID allows reconciliation against `in:sent`; drafts cannot certify delivery. WhatsApp and LinkedIn have durable service journals keyed by enrolment and step. Their GET receipt routes cannot dispatch. Unknown attempts and claims older than ten minutes can be reconciled through these reads. Fresh required-channel coverage, unchanged contact details, suppression checks and reply holds must pass before restoring a schedule. Temporary recovery failures remain eligible for later checks; their safe diagnostic and retry time are audited.

## Gmail coverage

A v2 checkpoint separates the completed watermark from progress. The initial scoped scan pages through identities and each recipient's search results, without the previous 100-contact ceiling. It captures a Gmail history head before scanning. Later passes consume paginated `messageAdded` history and verify sender metadata against the registered scope. Expired history (404) explicitly invalidates coverage and restarts a scoped scan. Adding a contact or widening its required time range invalidates the checkpoint through the existing store. The five-minute freshness requirement is unchanged. Legacy conversation checks still fail closed if their bounded history cannot be verified.

The implementation follows Google's [synchronization guidance](https://developers.google.com/workspace/gmail/api/guides/sync) and [structured error guidance](https://developers.google.com/workspace/gmail/api/guides/handle-errors). OAuth invalid grants require reconnection; 403 user/rate quota errors and 429 waits are retryable. Ambiguous send responses are never retried automatically.

## WhatsApp service

Migration `drizzle/0018_whatsapp_delivery_journal.sql` creates an RLS-protected journal accessible only to the trusted service. It stores account identity, a keyed payload fingerprint, claim state and an encrypted provider receipt; it stores no message text. A lease-fenced transaction commits a claim before the socket is called. Replays, service restarts, lost responses and failed receipt commits cannot repeat that submission. Receipt identities must match the requested recipient, directly or through a verified LID mapping.

Campaigns use `/campaign`, not the manual `/message` route. `/capabilities` advertises contract version 1, idempotent submission and receipt lookup. The app checks this capability and `WHATSAPP_CAMPAIGNS_ENABLED=true` before claiming. The flag defaults off. Existing manual messages retain their explicit manual behavior; campaign quotas count durable campaign claims, including uncertain claims.

Default campaign limits are five per rolling hour, twenty per rolling day and sixty seconds between claims, across campaign workflows for the same account. Configure `WHATSAPP_CAMPAIGN_HOURLY_CAP`, `WHATSAPP_CAMPAIGN_DAILY_CAP` and `WHATSAPP_CAMPAIGN_SPACING_MS` deliberately. Raising limits or relaxing freshness is a product/capacity decision, not a timeout fix.

## Isolated local verification

Branch: `fix/channel-service-reliability`, worktree: `../project-acquire-channel-services`.
Compose project: `acquire-channel-services`, config: `ops/channel-services.compose.yml`.

| Component | Local port | Isolation |
| --- | --- | --- |
| Postgres | 5445 | `acquire_channels`, own volume |
| n8n 2.1.5 | 5685 | own volume and worker secret |
| App | 3025 | own worktree/build output |
| Mail sink | 18124 | no external delivery |
| WhatsApp fixture | 18125 | actual HTTP/session/store, synthetic socket |
| LinkedIn fixture | 18126 | own Chromium and encrypted vault; live switches off |

**AGENTS.md requires explicit approval for each migration before execution.** The prepared bootstrap is `.local-data/channel-services/bootstrap-reviewed.sql` (existing 0000–0017 plus new 0018). Initializing the new n8n database also runs its built-in migrations and requires the requested approval. Neither the harness nor the application applies migrations. No production data or credentials are copied.

After approval and initialization, start the reserved services, save a reserved n8n API key to `.local-data/channel-services/n8n-api-key.json` (mode 0600), then run `pnpm test:channels:local`. The harness checks the existing schema and ownership, runs real Postgres/RLS/lease/journal tests, email app/n8n/wait/restart tests, WhatsApp sends/replays/restart/reader/recovery tests and Chromium-backed LinkedIn CR tests. Its synthetic contacts use `example.invalid` and fictional provider identities. It removes its scoped fixtures/workflows. It cannot restart the shared n8n instance; an empty public execution list is not proof of idleness because n8n 2.1.5 omits waiting executions.

The user approved the isolated bootstrap and n8n initialization, and both were applied on 10 October 2026. `pnpm test:channels:local` passed against these services: four native WhatsApp database tests, 96 application/integration checks, n8n persisted Wait recovery after restart, email sink delivery and all-channel reply enforcement, WhatsApp durable replay/restart/reply-reader/unknown-result recovery, and the Chromium-backed LinkedIn CR flow. All fixture organisations and workflows were cleaned up. There were zero live provider sends.

The full application regression suite passed 2,245 tests (89 opt-in tests skipped); the separately enabled integration suite supplies the database coverage above. Eight deployment/smoke-script tests, provider service suites, TypeScript, lint and the production build also passed. The reusable harness restores only known Next-generated file changes, preserving unrelated edits. Regression tests cover accelerated local waits across all channels and audits for normalized waiting/review receipt responses. Evidence lives in the ignored `.local-data/channel-services/` directory, including `stack-validation.json`, `whatsapp-stack-validation.json` and `linkedin-stack-validation.json`. The owned compose services were stopped after verification; their isolated volumes remain available for reruns. The original checkout and shared services were not modified.

## Production rollout and rollback

1. Review and obtain separate approval for **production** migration 0018; local approval does not authorize production migration. Verify RLS, grants, schema and backup/rollback arrangements. Never roll back by dropping the delivery journal: it prevents duplicate sends.
2. Deploy the WhatsApp service with campaigns disabled, verify `/capabilities`, journal/schema health and GET receipt behavior, then enable its campaign gate with chosen limits. Deploy the LinkedIn receipt route before enabling automatic reconciliation. Deploy the application after compatible services are available.
3. Use the operator readiness endpoint. Required scope must have successful fresh coverage or an explicit waiting state for enforcement. Recovery additionally requires ready delivery gates and resolved attempts. Review durable audits by channel, category, coverage age, retry time and transition.
4. Validate scoped fixtures/canaries through the actual production stack under a separately authorized send test. Local provider fixtures do not prove live Gmail/WhatsApp session delivery.
5. For rollback, disable campaign delivery first and roll back application/service versions as appropriate. Retain journals, unknown claims and review holds. Never clear an unknown result to force another send.
