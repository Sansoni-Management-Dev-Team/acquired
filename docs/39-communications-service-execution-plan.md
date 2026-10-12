# Communications service and Unipile execution plan

Created: 2026-10-12. Status: implementation underway; contract/adapter/SDK, v1 social and dispatch/encryption foundations verified locally. V1 credentials/endpoint are verified and the three approved local database parity changes are applied. New storage schema approval, persistent integration, live channel capabilities and full runtime extraction remain outstanding. See the progress record for actual scope.

This is the implementation checklist for adding Unipile as an optional connection backend for email, WhatsApp, and LinkedIn, while preserving the working backends and extracting a reusable communications service. Current progress, decisions, approvals, and handoffs live in [progress.md](communications/progress.md). This document defines the work; that document records what actually happened.

## How to resume and avoid omissions

1. Read `AGENTS.md`, this plan, and the progress record. Check `git status` and the current revision before touching code. Preserve unrelated changes.
2. Confirm the user's current authorization. This plan does not start implementation or authorize database changes, live sends, deployment, or repository publication.
3. Reconcile the progress record with actual files and evidence. Historical test results are not proof of the current tree or production state.
4. Select the earliest unfinished task whose dependencies are satisfied. Record its ID and intended scope before implementation. Ordinary engineering decisions can proceed within the authorized scope; record consequential decisions.
5. Before writing Next.js code, read the relevant guides in `node_modules/next/dist/docs/`, as required by `AGENTS.md`.
6. Follow the TDD workflow below for a bounded slice, verify the relevant acceptance scenarios, and update its status with evidence. Do not mark an implementation complete because an interface or mock exists.
7. Before ending a session, update the current task, changed files, results, open questions, approvals, exact next action, and restart instructions in the progress record. Leave unfinished work explicitly unfinished.
8. At each phase boundary, review the coverage matrix and implementation inventory. Newly discovered entry points or failure modes must become tasks or scenarios, not implicit future work.

Use stable task IDs below. Track `not_started`, `in_progress`, `blocked`, `implemented`, and `verified` in the progress record. `verified` means the required scoped evidence exists. Release and live verification are separate records. An unavailable environment or skipped test is not a pass.

## Test-driven development workflow

TDD is the implementation method for new behavior and defect fixes in P1–P6. P0 establishes the existing baseline; planning, documentation, secret placement and operational rollout use appropriate direct verification instead of artificial failing tests.

For each behavior slice:

1. **Specify:** name the task and acceptance scenario, observable outcome, failure boundary and test layer. Assertions must describe behavior independently of the chosen implementation.
2. **Red:** write or extend the smallest meaningful test and run it before implementing the behavior. Confirm it fails for the intended missing behavior or defect, not an unrelated broken dependency, missing credential or unavailable database. Record the command, assertion and failure evidence without secrets.
3. **Green:** implement enough production behavior to satisfy the test, then run it and the affected existing regressions. Do not weaken assertions, bypass ownership/freshness checks, or hard-code fixture results to make it pass.
4. **Refactor:** improve boundaries and naming while those tests stay green. Run the scoped checks again after substantive changes; broad suites are required at integration boundaries rather than after every trivial edit.
5. **Record:** link red and green results to the task and acceptance IDs, record characterization or integration evidence where applicable, and state remaining provider/live limitations. At handoff record whether the current slice is at red, green or refactor, with the exact next command.

For behavior-preserving extraction, first add or reuse characterization tests at the existing public boundary and confirm they pass before moving code. Keep the same assertions passing afterward. Do not deliberately introduce a defect just to produce a red result. New adapter capabilities or a newly exposed bug still require red–green evidence.

Use shared adapter conformance tests for contracts, provider-shaped synthetic HTTP/webhook fixtures for normalization, and real isolated PostgreSQL/service/n8n boundaries for persistence, leases, concurrency and restart claims. A mock cannot prove transactional fencing or real provider compatibility. Keep live credentials out of fixtures, and never apply a migration to make a TDD test runnable without specific approval.

A task cannot become `verified` until its relevant tests and evidence are recorded. A justified exception must name its scope and direct verification in the progress record; missing red evidence must not be silently represented as TDD. Planning checklist checks are not application test evidence.

## Outcome and boundaries

Acquire will call a versioned communications SDK/API. The service supports Unipile and the current direct Gmail, Baileys WhatsApp, and browser LinkedIn backends. Backend selection is explicit per connection. Existing defaults and active work are preserved.

Acquire retains campaigns, contact assignments, approvals, suppressions, person holds, business sending windows, n8n scheduling, and audit decisions. The service owns account connections, credentials, provider operations, account quotas, session leases, action journals, normalized communication events, and transport reconciliation. Effective admission honors both application and account limits without double-counting one operation.

The extracted service must run without Acquire's Next.js, Better Auth, database membership tables, `@/` aliases, campaign entities, or n8n. The existing Python and Node runtimes can remain. The first release covers current operations and the requested Unipile integration; complete Unipile feature parity is outside this plan.

Proposed structure, subject to the contract decision:

```text
communications/
  packages/contracts/
  packages/core/
  packages/sdk/
  packages/adapter-unipile/
  packages/adapter-gmail/
  services/api/
  services/linkedin/
  services/whatsapp/
  examples/minimal-client/
```

Keep transport contracts free of framework and database imports. Separate channel (`email`, `whatsapp`, `linkedin`), platform (`gmail`, `outlook`, `imap`, `whatsapp`, `linkedin`), and backend (`direct`, `baileys`, `browser`, `unipile`). Do not add Unipile as a channel or pretend every adapter supports every operation.

## Behaviors that every phase must preserve

- Existing connections and their credentials remain usable. Changing a default does not change existing enrolments, drafts, attempts, or receipt recovery.
- An unresolved send is never automatically resubmitted or failed over to another backend. Reusing a key with different content or account identity is rejected.
- Submission, delivery, and reading are distinct facts. A successful HTTP response is not proof of delivery.
- Confirmed replies stop outreach across channels; ambiguous identities require review. Existing person holds survive connection changes and rollback, and are not automatically cleared.
- Incomplete, stale, disconnected, or unverified reply coverage cannot authorize a send. Preserve the existing five-minute policy unless the user explicitly changes it.
- Draft approval creates/updates drafts according to current behavior; introducing a new backend must not turn approval into sending.
- All account access remains scoped to the authorized application, tenant, and owner. Membership revocation must be enforced at the app/service boundary and during background processing.
- Shared physical accounts must not gain independent quotas or conflicting sessions merely by appearing in multiple workspaces or adapters. If safe consolidation is unavailable, reject duplicate active bindings.
- Credentials, raw authentication payloads, message content, and personal data are excluded from committed test evidence and diagnostic logs. Service secrets never reach browser responses.
- No database migration, schema push, auto-migration on startup, or equivalent schema change runs without explicit approval for that exact migration and environment, including local/test databases.

## Existing implementation inventory

Recheck this inventory at P0; it is based on repository inspection, not a certification of live deployment.

| Area | Starting points | Required treatment |
| --- | --- | --- |
| Delivery | `src/lib/channels/{delivery-provider,delivery-registry,email-delivery,whatsapp-delivery,linkedin-delivery}.ts`, `src/domain/channel-delivery.ts` | Preserve outcomes; select by connection and capabilities |
| Gmail | `src/adapters/mailbox.ts`, `src/lib/{gmail-connection,google-oauth,campaign-mailbox}.ts`, `src/domain/gmail-connection.ts` | Extract OAuth/token and mailbox operations; remove app-specific imports from shared code |
| Connections | `src/app/api/mailbox/google/{connect,callback}/route.ts`, `src/app/api/channels/{linkedin,whatsapp}/route.ts` | Preserve legacy flows; add generic connection flow and trusted ownership resolution |
| Settings and health | `src/app/settings/page.tsx`, `src/components/{channel-connections,linkedin-connection,whatsapp-connection,channel-health-button}.tsx`, `src/lib/channel-health.ts`, `src/app/api/channels/health/route.ts` | Provider selection, setup action types, capability-based readiness, accurate UI copy |
| Draft approval | `src/app/api/outreach/messages/[id]/approval/route.ts`, `src/domain/gmail-draft-approval.ts`, `src/db/outreach-view.ts` | Bind saved drafts to their connection; preserve approve/update/revoke behavior |
| Campaign lifecycle | `src/lib/campaign-service.ts`, `src/lib/{campaign-linkedin,campaign-whatsapp,campaign-reply-readiness}.ts`, `src/lib/campaign-n8n.ts` | Enrolment, preflight, first-conversation/manual-outbound checks, sends, acceptance branches, recovery, both legacy and n8n runtimes |
| Replies | `src/lib/{campaign-reply-monitor,campaign-reply-providers,campaign-reply-collector,campaign-reply-store}.ts`, `src/lib/channels/email-reply-reader.ts`, `src/domain/campaign-replies.ts` | Connection-bound monitors, canonical identities/aliases, normalized events and honest coverage |
| Persistence | `src/db/schema.ts`, `src/db/campaign-client.ts`, `drizzle/`, campaign ownership/RLS constraints | Additive model, backfill design, grants, ownership, compatibility and rollback |
| WhatsApp service | `services/whatsapp/{http,store,sessions,delivery,replies,history,routing,crypto}.mjs` | Replace direct Acquire membership dependency; retain leases, journals, history and sharding |
| LinkedIn service | `services/linkedin/{server,storage,adapter,campaign,policy,replies,diagnostics}.py` | Retain browser lifecycle, verification, queue, journal, quotas; resolve extraction and replication limits |
| Operations | `ops/channel-services.compose.yml`, service Docker/Compose files, `scripts/*channel*`, `scripts/*linkedin*`, campaign integration scripts | Standalone deployment/configuration, no inherited live credentials in fixtures, reviewed startup paths |
| Existing documentation | `docs/20-gmail-oauth.md`, `docs/24-architecture.md`, `docs/campaign-automation.md`, service READMEs | Reconcile historical rollout statements; document new boundaries and defaults |

## Phase checklist and exit criteria

### P0 — Baseline and decisions

- [x] P0.1 Recheck all entry points, current runtime assumptions, schema/roles, scripts, service storage, and existing tests. Add omissions to the inventory.
- [x] P0.2 Record a baseline from relevant existing tests on the current revision. Inspect any test/setup script for schema changes and live operations before running it. Record pre-existing failures and skipped checks.
- [ ] P0.3 Verify the actual Unipile API version, credentials scope, endpoint, SDK choice, account/products support, idempotency semantics, receipts, and history freshness/completeness. Use official docs and authorized read-only validation; record unknowns separately.
- [x] P0.4 Record contract, tenancy, persistence, connection selection, quota ownership, email platform rollout, and extraction decisions. Capture legacy/live feature gates without changing them.
- [ ] P0.5 Align shared/isolated OrbStack startup with remote source and approved database schema. Inspect actual images, catalogs, roles, migration history and built-in n8n migrations before startup; apply only specifically approved parity artifacts. Preserve real shared sessions; use rebuilt isolated fixtures for baseline tests. Record platform-specific and unresolved differences honestly.

Exit: implementation inventory and unknowns are explicit; baseline evidence is recorded. A capability that cannot be verified is disabled or held for review, rather than assumed supported.

Track feature parity against [the source/documentation audit](communications/unipile-feature-parity.md), F01–F17. Draft update/revocation, original RFC recovery, WhatsApp history/identity and complete fresh reply coverage are unresolved gates; core API coverage is not a whole-architecture parity pass. X01–X09 are optional additional capability candidates, not automatically part of this release.

### P1 — Provider-neutral contracts and existing backend wrappers

Contract work depends on the P0 inventory/baseline/decision evidence. Independent provider-neutral packages can proceed while P0.3 live configuration and P0.5 migration approvals remain pending; those pending checks block activation/parity certification, not fixture-only contract work.

- [x] P1.1 Define versioned contracts for connections, setup actions, capabilities, normalized identities, paginated events/coverage, delivery outcomes, errors, and receipts.
- [x] P1.2 Define messaging, optional email drafts/threading, and LinkedIn relationship/invitation interfaces. Preserve receipt lookup as a read-only operation.
- [ ] P1.3 Introduce SDK/service boundaries and dependency-injected repositories/credential access. Wrap existing Gmail, WhatsApp, and LinkedIn behavior before moving runtime implementations.
- [ ] P1.4 Exercise shared contracts against the existing adapters; verify legacy-only operation without Unipile credentials. Document which leases/journals remain authoritative during transition.

Exit: existing behavior passes through reusable contracts; shared packages have no Acquire imports. No connection is switched or credential moved.

### P2 — Additive persistence and binding

Depends on P1. Migration application is a separate, specifically approved action.

- [ ] P2.1 Specify generic connection/account/grant records, backend references, connection generations, defaults, canonical identity aliases, and status/capability snapshots. Model service ownership independently of app membership tables.
- [ ] P2.2 Specify enrolment/channel bindings, draft bindings, send-attempt connection/backend snapshots, and connection-bound event/checkpoint/lease keys. Freeze bindings before dispatch; recovery uses the recorded original connection.
- [ ] P2.3 Prepare exact migration/backfill artifacts with RLS/grants, ownership constraints, legacy read compatibility, duplicate-account policy, resumability, backups, and rollback/forward-recovery procedure. Do not apply them yet.
- [ ] P2.4 After explicit approval for each artifact/environment, apply only that approved migration, verify schema and ownership parity, and verify existing credentials/enrolments/drafts/holds/unknown attempts remain intact.

Exit: legacy data maps deterministically to stable connections and all new access paths remain tenant/owner scoped. A rollback never resets unknown attempts or person holds. Destructive schema cleanup is deferred.

### P3 — Unipile adapter and connection lifecycle

Depends on P1; persistent account/event processing depends on P2.

- [ ] P3.1 Implement the verified API version, bounded HTTP client, explicit error classification, operation-specific idempotency, secret access, and account capabilities. Fixtures must not load or inherit live credentials.
- [ ] P3.2 Implement connect/reconnect/disconnect/status/health with single-use expiring auth state, allowed redirects, account verification, owner binding, and typed setup actions. Handle canceled, expired, duplicate, concurrent, and mismatched callbacks.
- [ ] P3.3 Implement normalized email/message reads, sends, optional drafts, profile resolution, relationships/invitations, and receipt lookup. Verify provider-specific IDs, threading, RFC Message-ID behavior, pagination, and payload constraints rather than assuming parity.
- [ ] P3.4 Implement authenticated webhook ingestion with durable receipt before acknowledgement, deduplication, asynchronous processing, retry/dead-letter/replay, out-of-order account events, and reconnect handling. Distinguish outgoing messages, folder moves, bounces, delivery receipts and genuine inbound replies.
- [ ] P3.5 Implement backfill/reconciliation, initial sync gating, source timestamps, cache control, history completeness and coverage invalidation. Webhook silence or a cached/non-exhaustive search is not proof of fresh complete coverage.

Exit: all requested channels can use the adapter in fixtures. Real capability claims are bounded by recorded validation; unsupported operations remain explicit. Legacy adapters remain available.

Before activation, reconcile each required F row with executable evidence: first conversation sends are writes, relationship acceptance events can be delayed, source/product sync and pagination must support conservative coverage, and provider keys/webhook retries do not replace our durable journal. P4.3 must preserve approve/update/revoke semantics; P4.4 must expose only proven backend capabilities. Documentation-reviewed, fixture-verified, live-verified and released states remain separate.

### P4 — Acquire integration and coexistence

Depends on P2 and P3. Local refactoring of existing wrappers may proceed earlier under P1.

- [ ] P4.1 Replace fixed channel factories and direct backend calls with connection resolution. Integrate enrolment/publishing, both campaign runtimes, preflight, sends, readiness, acceptance branches, and receipt recovery.
- [ ] P4.2 Integrate connection-bound reply monitoring with existing cross-channel holds, replay, identity ambiguity, membership checks, optional channels, and freshness enforcement. Account changes invalidate coverage without clearing holds.
- [ ] P4.3 Integrate email draft approval/update/revoke and outreach views using recorded connections. Preserve first-conversation and unrecorded manual-outbound checks.
- [ ] P4.4 Update settings, health tests, connection methods, defaults, capability/readiness statuses, notices, and accurate channel descriptions. Existing connection experiences stay available.
- [ ] P4.5 Exercise mixed backends and switching rules. Defaults affect new work only; explicit transfers of active work require reviewed bindings, fresh coverage, and resolution of pending attempts. Never silently fail over.

Exit: no application operation bypasses connection resolution; existing campaigns retain their backend. Every affected application surface has acceptance evidence.

### P5 — Integration, recovery, and rollback validation

Depends on P4. Tests are added with the implementation, not postponed until this phase.

- [ ] P5.1 Complete the acceptance matrix below with executable references and results. Test meaningful failure boundaries and concurrency, not just mocked happy paths.
- [ ] P5.2 Run the applicable existing app, service, isolated database and n8n/Chromium fixture checks against an already approved schema. Add Unipile fixtures to the same end-to-end path.
- [ ] P5.3 Verify crash recovery at claim, provider acceptance, journal persistence, webhook persistence, and checkpoint commit; verify connection switching and mixed-backend reply stops under concurrent callbacks.
- [ ] P5.4 Rehearse disabling Unipile and reverting app/service versions. Existing legacy accounts still work; Unipile-bound work pauses or continues only on its original backend. Queues, receipts, holds, and unresolved actions survive.

Exit: required local scenarios pass on the tested tree; limitations and live-only checks are explicit. Production activation is not implied by a passing suite.

### P6 — Independent repository extraction

Depends on P5 for extraction of the proven implementation; dependency removal starts in P1.

- [ ] P6.1 Move shared packages/services into the chosen repository with preserved licenses, documented runtimes, independent storage/authorization, migrations, and versioned SDK/API compatibility. Do not publish or push without user authorization.
- [ ] P6.2 Add minimal client example, private configuration instructions, container startup, service health, diagnostics, credential rotation/export/restore, and backup/recovery procedures. Startup must not auto-apply migrations.
- [ ] P6.3 Verify a clean checkout and independent synthetic client can connect, send to fixtures, receive/replay events, and recover receipts with no Acquire database, aliases, credentials, Next.js, Better Auth, or n8n.
- [ ] P6.4 Make Acquire consume the versioned SDK/service and repeat affected integration checks. Transfer this plan, progress/evidence record, and agent resume instructions into the extracted repository.

Exit: reuse is demonstrated by a second independent client and clean checkout, not merely by copying folders. Acquire remains an ordinary service consumer.

### P7 — Controlled rollout and completion

Depends on P5 and P6. Record user-authorized environment/actions and preserve current gates.

- [ ] P7.1 Prepare concrete release artifacts, private configuration, schema compatibility checks, backup/recovery steps, capability limitations, and account/channel activation order. Resolve outstanding release blockers.
- [ ] P7.2 Under authorized scope, validate credentials and account metadata read-only. Any live test send/invitation must have an explicitly agreed account, recipient, operation, and content; use fixture/mock accounts where possible.
- [ ] P7.3 Deploy/activate only the authorized changes, initially for controlled accounts. Verify webhook ingress, account status, queue processing, reply stops, receipt recovery, error rates and fresh coverage without enabling unrelated gates.
- [ ] P7.4 Record released revisions/configuration, evidence, operational ownership, remaining limitations, and rollback result. Reconcile every task/scenario; update architecture/service docs. Keep legacy methods in place unless removal is separately requested.

Exit: implemented, locally verified, independently reusable, and released scopes are explicitly distinguished. Do not claim completion of a wider rollout than the evidence supports.

## Acceptance coverage matrix

Link each ID to executable tests and scoped evidence in the progress record. Add platform-specific rows when Google, Outlook, and IMAP have different semantics. Fixture coverage does not establish live provider behavior.

| ID | Scenario and required result | Tasks |
| --- | --- | --- |
| A01 | Direct Gmail compose/read, token renewal/reconnect, connection health remain compatible | P1.3, P1.4, P4.4 |
| A02 | Existing WhatsApp QR/reconnect/history/sharding, encrypted keys and lease fencing survive restart | P1.3, P1.4, P6.1 |
| A03 | Existing LinkedIn browser pause/resume/verification, queue, quota, inbox and encrypted journal remain compatible | P1.3, P1.4, P6.1 |
| A04 | Unipile connect/reconnect/disconnect for each requested platform; canceled/expired/concurrent/mismatched/replayed callbacks cannot bind an unauthorized account | P3.2 |
| A05 | Forbidden tenant/owner access, revoked membership, forged webhook and leaked client credential are rejected | P2.3, P3.2, P3.4, P4.2 |
| A06 | Same operation key deduplicates; changed account/content under that key is rejected, including concurrent requests | P1.4, P3.3, P5.3 |
| A07 | Timeout or crash after possible acceptance remains unknown; lookup/replay never dispatches again or changes backend | P2.2, P3.3, P5.3 |
| A08 | Submitted, delivered, read, rejected and unknown outcomes retain distinct semantics; receipt matches intended account/recipient | P1.1, P3.3, P3.4 |
| A09 | Genuine inbound reply stops the person across channels/backends; ambiguous identity holds for review; replay survives restart | P3.4, P4.2, P5.3 |
| A10 | Outgoing/self/group messages, email folder moves, bounces and receipt events do not falsely become person replies | P3.4, P4.2 |
| A11 | Duplicate/out-of-order webhooks, lost acknowledgement and missed deliveries reconcile without losing an event or regressing account status | P3.4, P3.5, P5.3 |
| A12 | Initial sync, stale cache, incomplete/non-exhaustive searches, expired cursors and history gaps cannot certify five-minute coverage | P3.5, P4.2 |
| A13 | Account identity/generation changes invalidate aliases/cursors/coverage; previous holds and receipts remain intact | P2.1, P3.5, P4.2 |
| A14 | Rate limits, Retry-After, verification, quota exhaustion and provider outages produce correct waiting/review outcomes without unsafe send retries | P1.1, P3.1, P4.1 |
| A15 | New defaults do not rebind old enrolments/drafts/attempts; explicit transfer blocks unresolved sends and never silently falls back | P2.2, P4.5, P5.4 |
| A16 | Same physical account across workspaces/backends has shared effective limits and safe session ownership, or conflicting binding is rejected | P0.4, P2.3, P4.5 |
| A17 | Draft approve/update/revoke stays draft-only, uses its original connection, and preserves threading/header behavior | P3.3, P4.3 |
| A18 | First-conversation/manual-outbound checks remain conservative; personalized content and provider length constraints are enforced | P3.3, P4.1, P4.3 |
| A19 | LinkedIn profile/alias resolution, already-connected/pending invitations, DM eligibility, and acceptance timeout branches are accurate under delayed events | P1.2, P3.3, P4.1 |
| A20 | Both legacy and n8n runtimes preserve pause/stop/wait/branch, callback replay, immutable sequence version and sender ownership | P4.1, P5.2 |
| A21 | Service replication/lease loss, queue cancellation, crash and checkpoint transaction rollback cannot dispatch twice or certify partial coverage | P1.4, P5.3, P6.1 |
| A22 | Local fixtures have no live credentials; diagnostics/client responses and source control contain no authentication secrets | P3.1, P3.2, P5.2, P6.2 |
| A23 | UI method/default/status/health accurately represents actual capabilities and preserves legacy paths; social-only sequences have no accidental Gmail requirement | P4.1, P4.4 |
| A24 | Additive schema/backfill is resumable and ownership/RLS remains correct; disabling Unipile/rollback preserves credentials, unknown attempts, receipts, holds and original bindings | P2.3, P2.4, P5.4 |
| A25 | Clean independent checkout/client works without Acquire-specific dependencies; Acquire interoperates with the released contract version | P6.3, P6.4 |

## Verification and evidence procedure

For each completed task record: source revision and dirty-tree scope; exact redacted command or operation; environment and prerequisites; acceptance IDs covered; result; artifact/test references; skips and limitations. A fixture pass, live read-only check, live write verification, and deployed verification are separate evidence types.

Use existing checks where applicable, after reviewing their current implementation:

- App contracts/domain/adapters/routes: targeted `pnpm exec vitest run <reviewed test files>`, followed by relevant regression suites, `pnpm typecheck`, targeted lint, and `pnpm build` when integration changes justify them.
- WhatsApp: `pnpm test:whatsapp`; database variants only with an isolated, already approved schema.
- LinkedIn: `pnpm test:linkedin` and `pnpm test:linkedin:smoke` only after confirming the selected local container, synthetic owners and disabled live gates.
- Cross-channel/n8n integration: `pnpm test:channels:local` with its dedicated fixture stack, idle isolated database and existing schema. The current harness checks prerequisites and states it runs no migrations; inspect invoked scripts again before use. Do not auto-bootstrap missing schema.
- New service: adapter contract tests, webhook replay/reconciliation tests, operation journal concurrency/crash tests, and standalone synthetic-client integration. Record exact commands once those packages exist.

A passing documentation/checklist review is only traceability evidence. It does not execute application tests, validate the supplied credential, or prove deployment. Avoid testing unrelated components repeatedly after relevant checks pass.

## Unipile reference and credential handling

Reference material from the initial investigation; revalidate the selected API version at P0.3:

- [Hosted authentication](https://developer.unipile.com/v2.0/docs/authenticate-with-hosted-auth)
- [Account/product lifecycle](https://developer.unipile.com/v2.0/docs/status-lifecycle)
- [Webhook authentication and acknowledgement](https://developer.unipile.com/v2.0/docs/configure-a-webhook)
- [Event types](https://developer.unipile.com/v2.0/reference/event-types-1)
- [Initial sync](https://developer.unipile.com/v2.0/docs/initial-sync)
- [Cache behavior](https://developer.unipile.com/v2.0/docs/caching)
- [Email search/pagination](https://developer.unipile.com/v2.0/reference/getemailslist)
- [Email send/header contract](https://developer.unipile.com/v2.0/reference/sendemail)

The supplied credential is configured as `UNIPILE_API_KEY` in ignored root `.env.local`, with a private intake copy in `.local-data/communications/unipile.env`. Both files have private permissions. Its type, scope, API version, validity and account permissions have not been verified. Do not print it, commit it, load either file into fixture environments, or copy it into the extracted repository. A shared local path is not a production secrets strategy; configure service secrets independently per environment.
