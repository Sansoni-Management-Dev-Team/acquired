# Communications implementation progress and handoff

Plan: [39-communications-service-execution-plan.md](../39-communications-service-execution-plan.md).

Last updated: 2026-10-12.

## Current position

- Current scope: implement the communications plan with TDD and local OrbStack verification; establish parity with remote app/services/database first.
- Implementation authorization: user requested beginning the plan, authorized subagents, and required OrbStack testing with an up-to-date remote baseline. The user later explicitly approved the three exact local parity artifacts; those approvals do not extend to new communications storage, production migration or release.
- Current task: encrypted webhook capture/claim repository and service-only event normalization prepared on `codex/unipile-reply-detection`; actual PostgreSQL integration is blocked on exact schema approval. Final full-suite, independent-copy and native OrbStack checks are recorded below. The real database tests are prepared but not executed against the new schema.
- Implementation status: P1 contracts/wrappers/composition/SDK, v1 social transport and dispatch/codec foundation are implemented. This branch adds all-channel normalization/read-only enrichment, bounded HTTP ingress, webhook encryption, parameterized SQL capture/claim and required service event/outbox finish ports. The SQL protocol is locally unit-tested, not yet database-verified. Application routing/defaults, DigitalOcean services and UI remain preserved; terminal event/outbox repositories, concrete ownership/alias authority, complete coverage and campaign integration are outstanding.
- Credential: supplied, configured as `UNIPILE_API_KEY` in ignored root `.env.local` with mode 0600; private intake copy retained. Value equality and Git exclusion verified. The key authenticated successfully against the user-supplied v1 DSN; DSN, base URL and explicit `UNIPILE_API_VERSION=v1` are saved in the ignored environment files. No credential value belongs in this record.
- Database: all three specifically approved local parity artifacts applied after target/hash preflight and private backups. Shared application catalog/17-entry ledger and isolated application catalog now match remote, subject to documented platform/isolated-owner differences. New communications/app-binding schema artifacts remain unapproved/unapplied; no real credential/backfill or fabricated ledger rewrite occurred.
- Provider activity: two authorized read-only Unipile v2 account-list requests returned `401 api/invalid_credentials`, including the user-requested retest against `/v2/accounts/`; the subsequent account-list GET against the user-supplied v1 DSN returned HTTP 200 with an empty `AccountList`. No real provider writes. OrbStack tests used synthetic accounts/sockets/Chromium only. Remote app/service/catalog inspections were read-only.
- Verification: [verification.md](verification.md) records actual full-suite, build/type/lint, current-source OrbStack channel workflows, wrapper/journal integration and standalone compiled SDK/API evidence. [Feature parity audit](unipile-feature-parity.md) compares 17 existing behavior groups and nine optional additions against relevant official documentation and current source. Live channel capabilities, concrete persistent repositories and complete backend runtime extraction remain unverified; remaining platform/shared-runtime differences are explicit.

## Phase status

| Phase | Status | Remaining dependency |
| --- | --- | --- |
| P0 Baseline and decisions | in_progress | V1 selected contracts/access verified; live product/identity/sync capabilities pending. Application DB parity aligned; shared real-session runtime refresh remains separate |
| P1 Contracts and existing wrappers | in_progress | Verified delivery/draft/SDK slice; lifecycle/event/relationship implementations and full conformance remain |
| P2 Persistence and binding | in_progress | Static design/DDL reviewed; repositories, backfill design and specific migration approvals/database tests outstanding |
| P3 Unipile adapter | in_progress | V1 bounded transport, social adapter/normalizers and static webhook authentication verified in fixtures; live channels and persistent lifecycle/event/email normalization outstanding |
| P4 Acquire integration | not_started | P2 and P3 |
| P5 Recovery and rollback validation | not_started | P4 |
| P6 Repository extraction | in_progress | Foundation copy/build/tests verified; complete existing backend runtime/OAuth/auth-storage extraction and release still pending |
| P7 Rollout | not_started | P5/P6 and authorized release scope |

## Decisions and open questions

| ID | Decision/question | Status and basis |
| --- | --- | --- |
| D01 | Retain legacy connection methods and add Unipile modularly | User requirement |
| D02 | Extract communications for other projects | User requirement |
| D03 | Shared service/SDK; campaigns and contact policy remain in Acquire | Proposed approach; user said it makes sense; contract details remain engineering work |
| D04 | Preserve existing runtimes and wrap them before rewriting | Recommended implementation default; no runtime rewrite required |
| D05 | Connection-specific binding; no silent backend fallback | Required to preserve unresolved-send and sender ownership behavior |
| D06 | API version, base endpoint, SDK, key type/scope and verified capabilities | Supplied DSN/key authenticated with HTTP 200 on v1; empty account list. v2 tests returned 401. Implement an explicit v1 adapter for this configuration; preserve v2 as a separate fixture-only version. Raw injected HTTP selected; no fallback or activation |
| D07 | Service storage/authorization, physical-account deduplication and quota ownership | Proposed separate communications schema, scoped/control roles and exact immutable generations; single active physical-account binding until inventory/consolidation proven. Repository fencing/quota/event-commit semantics still need implementation/tests |
| D08 | Email launch platforms and operation parity | Open; [audit F02–F05](unipile-feature-parity.md) identifies draft update/revoke, original RFC recovery and platform-specific search/checkpoint gaps. Plan Google/Outlook/IMAP explicitly; enable only proven capabilities and retain direct Gmail for unsupported workflows |
| D09 | Repository name/location, package distribution and deployment targets | Unpublished private package under `communications/`, independent CommonJS build/aggregate exports and fresh dependency-installed foundation copy verified in OrbStack; complete backend runtime extraction and remote destination still open |
| D10 | Connection-change and active campaign transfer experience | Proposed: defaults affect new work; transfers require explicit bindings and unresolved-action checks |
| D11 | TDD for new behavior and defect fixes; characterization tests for behavior-preserving extraction | Explicit plan method following the user's TDD question; red/green evidence recorded per behavior slice |
| D12 | Local OrbStack parity before integration | Remote code baseline is fa544da. Shared services retain stale running source/real live sessions; rebuild/test isolated fixtures rather than restart shared real accounts. The three specifically approved parity artifacts are applied; shared application catalogs/ledger and isolated catalogs now match remote. Platform-specific differences and untouched shared real-session source drift remain explicit |
| D13 | Receipt provenance and historical recovery | Real message receipts and service action receipts are distinct. Repository resolves `(scope,connectionId,generation)`; historical disconnected records are lookup-only. Inaccessible old legacy receipts remain unknown/review |
| D14 | Canonical ingress and immutable asynchronous configuration | Service requires canonical email identities and channel-appropriate recipient kinds before dispatch; compute digest afterward. Snapshot/message and injected port callbacks captured before awaits to prevent changed-account/content races |
| D15 | Application-owned drafts for Unipile; ordinary send only at authorized dispatch | User-proposed feasible alternative to vendor draft update/revoke. Existing content/state already stored in Acquire. Proposed only: Gmail mailbox draft visibility changes, approval must bind immutable content, concurrent edit/revoke/send must be fenced, and lost-send recovery remains separate. Preserve existing Gmail synchronization; no code/schema change selected or applied |
| D16 | Separate service normalization and Acquire reply-policy transactions | Independent review corrected the colocated processor assumption. Service commits event/outbox/webhook; Acquire commits fingerprint receipt/identity decisions/holds/stops/audit, then acknowledges. No cross-database atomic transaction is claimed. Service processor has no person resolver |
| D17 | Undelivered work and review barrier covers the tenant's relevant channels/backends/owners | Release prerequisite: pending captures/outbox/reviews cannot allow another channel or shared-person owner to send. Scoped ingress routing or a conservative integration-wide barrier is required; complete cursors alone are insufficient |
| D18 | Acquire consumption needs additional immutable fingerprint/review storage and verified LinkedIn identity bridging | The two outstanding migration hashes remain unchanged. A subsequent explicitly approved additive artifact must handle replay fingerprints/review latches. Service profile URL and existing Acquire LinkedIn URN identities require verified mapping/registration; no names or URL parsing may invent aliases |

## Task status overrides

All checklist tasks default to `not_started`. Add rows when a task starts; keep stable IDs. `implemented` and `verified` are different states.

| Task | Status | Changed files | Acceptance IDs | Evidence | Remaining work |
| --- | --- | --- | --- | --- | --- |
| P0.1 | verified | [Parity baseline](parity-baseline.md), plan inventory | A01–A03, A24 starting state | Source/image/catalog/script review | Do not confuse starting state with later release |
| P0.2 | verified | [Verification](verification.md) | Existing A01–A03, A20–A24 baseline | Actual local app/service/database/OrbStack logs | Opt-in skips and parity drift recorded |
| P0.3 | in_progress | [Unipile research](unipile-contract-research.md), [feature parity matrix](unipile-feature-parity.md) | A04, A07, A12, A17–A19 prerequisites | Official index/feature/limits/guides/reference review, source inventory, two v2 rejections and sanitized v1 HTTP 200 | Documentation coverage established for the reviewed feature surface; draft/RFC/history/identity/freshness gates remain. No connected accounts available for live product/identity/sync evidence |
| P0.4 | verified | Decision rows; [persistence design](persistence-design.md) | Shared architecture | Explicit engineering choices/limitations | API enablement and later rollout still separate |
| P0.5 | in_progress | [Parity follow-up](parity-baseline.md), three applied exact parity artifacts | A24 environment prerequisite | Target/hash/backup checks; post-alignment catalogs, 43 DB checks and isolated workflow harness passed | Application/isolated fixture baseline aligned; shared real-session runtime refresh and platform exceptions remain explicit |
| P1.1 | verified | `communications/packages/contracts/` | Pure A05–A08, A12–A15 guards | [Contract TDD](contracts-tdd.md) | Whole persistent/live scenarios remain partial |
| P1.2 | verified | Contract interfaces and receipt types | Interface A08/A17/A19 | Typecheck/contract regressions | Interfaces do not prove real relationship/history behavior |
| P1.3 | in_progress | Core/Gmail/legacy/SDK/API and Acquire composition | Scoped delivery/draft/transport A01/A05–A08/A15/A17 | [Verification](verification.md) + TDD docs | Lifecycle/events/relationships, OAuth/runtime extraction and durable service storage |
| P1.4 | in_progress | Shared conformance tests and real OrbStack wrapper test | Scoped existing adapters | New wrapper -> actual WhatsApp fixture journal; original channel stacks | Full adapter conformance for all operations outstanding |
| P2.1/P2.2 | implemented | Separate service/account/generation/app binding design | A13/A15/A16/A24 design | Static/peer review | Actual repository/RLS/concurrency tests pending |
| P2.3 | in_progress | [Prepared persistence SQL](persistence-design.md), dispatch core and journal codec | A21/A24 design; scoped dispatch/encryption | Static/peer review; pure red/green and OrbStack fixtures | Actual PostgreSQL admission/lease/quota/checkpoint repositories and backfill |
| P2.4 | not_started | Two exact isolated schema proposals | A24 | Target/hash/collision/backup preflight; separate approval question pending | Specific schema approval required; parity approval does not extend to these files |
| P3.1/P3.3 | in_progress | Explicit v1 transport/social adapter, separate provisional v2 | Scoped A07/A14/A22 | [V1 transport](unipile-v1-transport-tdd.md), [adapter](unipile-v1-adapter-tdd.md), native OrbStack SDK/service | V1 transport/social slice locally verified; live products, full email/draft/relationships/history and persistent integration pending |
| P3.4 | in_progress | Versioned authentication, all-channel normalizer, reply ingress/processor ports and separate native webhook listener | Scoped A05/A09–A13/A21/A22 | [Reply TDD](reply-detection-tdd.md), full regressions, isolated OrbStack native pipeline | Required ports only: actual encrypted ingress/worker/hold/outbox transactions, lifecycle/history coverage and campaign integration remain |
| P3.3/P3.5 prerequisites | in_progress | Read-only event enricher and scoped chat/message/attendee list transport | Scoped A05/A09–A13 | [Enrichment TDD](reply-enrichment-tdd.md), provider-shaped native HTTP/OrbStack pipeline | Physical-owner/alias repositories and full history/source freshness certification still required; list exhaustion is not coverage proof |
| P2.3/P3.4 storage prerequisite | in_progress | WebhookCodec, injected-driver PostgreSQL capture/claim, service event processor and opt-in DB tests | Scoped A05/A09/A11/A21/A22 | [Storage TDD](webhook-storage-tdd.md); 134 new unit assertions, actual native OrbStack encrypted composition | Actual PostgreSQL tests require exact schema approval. Terminal normalization/outbox and Acquire receipt/holds remain unfinished; scripted driver tests do not prove database transactions |

## TDD evidence

For each slice record the intended failing assertion and its actual red result before production changes, then the green command/result, regression checks and refactor state. Evidence below is scoped; a passing pure guard does not complete its entire acceptance scenario.

| Task / scenario | Behavior slice | Red or before-characterization evidence | Green or after-characterization evidence | Refactor / remaining checks |
| --- | --- | --- | --- | --- |
| P1.1/P1.2 | Exact binding/operation/coverage/receipt guards | [Contract red evidence](contracts-tdd.md) | Contract guards green; type/lint pass | Provider/persistence proof separate |
| P1.3 | Stable payload/draft digest and legacy delivery wrapper | `legacy-wrapper-red.log`: 23 failures on unimplemented behavior | `communications-green.log` | Subsequent mutation/provenance/ignored-field failures fixed; docs list exact red logs |
| P1.3 | Gmail send/lookup/draft adapter | [Gmail TDD](gmail-adapter-tdd.md) | Conversion, threading, RFC, recovery and config race tests green | No OAuth/journal/history extraction claimed |
| P1.3 | Acquire-only legacy composition | `acquire-bridge-red.log`: nine failing scenarios | `acquire-bridge-green.log`; actual OrbStack wrapper/journal test | Existing application routing unchanged |
| P1.3 | Scoped native SDK/API | [SDK/API TDD](service-sdk-tdd.md) | Native HTTP + compiled OrbStack fixture green | Persistent authorization/repositories unimplemented |
| P3.1/P3.4 | V2 HTTP and pure signature verifier | [Transport TDD](unipile-transport-tdd.md) | Host/native container tests green | V2 provisional; signature authentication is not durable ingestion |
| P0.5/A22 | Fixture env-file isolation | `fixture-env-red.log`: child loader revived synthetic credential | `fixture-env-green.log` | Harnesses now blank current/future communication credential names |
| P3.1/P3.3/P3.4 | Explicit v1 transport, normalization, social adapter and static-header authentication | [Transport](unipile-v1-transport-tdd.md), [normalization](unipile-v1-normalization-tdd.md), [adapter](unipile-v1-adapter-tdd.md): missing behavior and independent-review failures recorded | Host regressions, native OrbStack composition and fresh-copy package tests passed | Live capabilities, persistent lifecycle/events and email normalization remain |
| P1.3/P2.3 | Required journal/admission ports, conservative uncertainty and original historical recovery | [Dispatch TDD](dispatch-coordinator-tdd.md): ordering, ambiguous outcomes, provenance and Gmail/browser recovery failures | Pure and actual-wrapper characterization tests; native OrbStack composition passed | No PostgreSQL transaction/fencing proof yet |
| P2.3 | Scope/purpose/version-bound encrypted journal context and digests | [Codec TDD](journal-codec-tdd.md): missing behavior, cross-version key-role reuse and authenticated BOM failures | 60 codec/review tests passed; native OrbStack and fresh independent copy passed | Typed repository decoding and real vault/keyring configuration remain |
| P3.3/P3.4 | All-channel replies, capture/claim/atomic finish ordering and bounded webhook listener | [Reply TDD](reply-detection-tdd.md): intended missing behavior and independent semantic/provenance/HTTP deadline failures recorded | 154 new tests; full app 2,855 passes/91 skips; native isolated OrbStack pipeline passed | No persistent database or real campaign-stop proof; typed trusted enrichment and complete coverage still needed |
| P3.3/P3.5 prerequisite | Read-only evidence enrichment and actual full-email contract | [Enrichment TDD](reply-enrichment-tdd.md): missing reads, schema/provenance/deadline/config failures | 100 additional assertions; actual transport/enricher compose in native OrbStack | No real ownership/alias repository, persistence or complete/fresh coverage proof |
| P2.3/P3.4 prerequisite | Encrypted raw receipts, SQL capture/claim protocol and separate service normalization | [Storage TDD](webhook-storage-tdd.md): missing behavior, role/discard/envelope/expiry failures and native characterization | 134 new assertions; native encrypted/commit-before-ack memory composition; existing 16 DB reply-store regressions | Seven new real PostgreSQL tests prepared, not executed; migration approval and event/outbox/application repositories remain prerequisites |

## Acceptance evidence

No A01–A25 scenario is claimed complete across the whole proposed architecture. The rows below record scoped proof and its boundaries; remaining lifecycle/persistence/live dimensions are still required.

| Scenario | Evidence type | Tested revision/tree | Command or operation | Result/artifact | Limitation |
| --- | --- | --- | --- | --- | --- |
| A01–A03/A20 | Existing channel fixture workflows | fa544da + current checkout; rebuilt isolated images | `pnpm test:channels:local` | Passed; [verification](verification.md) | Preserves legacy behavior; not Unipile or generic connection activation |
| A05–A08/A12–A15/A17 | Pure guards/ports/native HTTP | Current communications tree, TDD logs | `pnpm test:communications` and targeted bridge tests | Passed scoped regressions | No database or live provider proof implied |
| A06–A08 | New wrapper -> real original journal | Current source + existing approved isolated schema | `pnpm test:communications:legacy-orbstack` | Two checks passed, one synthetic provider message | No generic persisted connection registration/account inventory |
| A05/A07/A22/A25 partial | Compiled independent SDK/API and real v1 adapter/coordinator/codec container | Source hashes/image recorded | `pnpm test:communications:orbstack` | Passed; standalone JSON manifest | Memory-only journal; full runtime extraction and durable PostgreSQL proof outstanding |
| A25 foundation | Fresh independent package copy | Independent install/lock and source fingerprints recorded | `pnpm test:communications:copy-orbstack` | Build, aggregate exports and 441 tests passed | Reusable foundation only; existing backend runtimes/OAuth/auth-storage are not fully extracted |
| A24 environment prerequisite | Three approved parity artifacts and post-alignment application catalogs | Exact approved hashes and isolated current-source fixtures | Catalog comparisons, 43 shared DB tests and full isolated channel harness | Scoped parity match and workflow checks passed | Platform/isolated-owner exceptions and untouched shared real-session runtime drift remain |
| A05/A09–A13/A21/A22 partial | All-channel native webhook/normalizer/processor composition | New reply worktree/base f66781e + foundation d8d0654 + reply source hashes | `node scripts/test-communications-replies-orbstack.mjs` | Passed; `reply-orbstack.json` records code/image/script hashes | Synthetic memory store/holds/outbox; no PostgreSQL durability, coverage advance, live calls or Acquire activation |
| A21/A24 design | SQL static/peer review | Exact proposed hashes in [design](persistence-design.md) | pglast parsing and FK/review inspection | No DDL execution | Transactional database/RLS/quota/event proof pending approval |

## Migration and release approvals

The user explicitly approved all three local parity artifacts in the async question reply on 12 October. Parent verified exact targets/hashes, took private backups, and applied them sequentially. Execution/report evidence is in [parity follow-up](parity-baseline.md). No production release or new communications schema approval has been granted.

Approved and applied:

- Shared OrbStack `127.0.0.1:5434/project_acquire`: `drizzle/0018_whatsapp_delivery_journal.sql`, SHA256 `faee54818c8ef4008d5e9f004c0a10b567c78e12bc9d2ada32284806d7d12cbc`; and `ops/local-db-rls-parity.sql`, SHA256 `2f18f0c5f57e0d0ae8c2c43e32f59d4504ff04ba27df6aa6412aa74c0721eb8f`.
- Isolated OrbStack `127.0.0.1:5445/acquire_channels`: `ops/channel-db-rls-parity.sql`, SHA256 `1fa73750dc46e0d586621b697d978466fb29d7693103d9c0c306d2993a10bbfb`.

The separately reviewed communications schema artifacts are unapproved and **not included** in those parity approvals. A new schema-only approval question is pending for the two exact files below, targeting isolated OrbStack `127.0.0.1:5445/acquire_channels` after fresh backup/target/collision checks:

- `communications/migrations/001-service-storage.local.sql`, SHA256 `b2d673205ba759bb1126db90b719bf39d44d8f3977d1bbe2ab97aa48c00b308d`.
- `ops/communications/002-acquire-bindings.local.sql`, SHA256 `f25cba158289dde111e3aae6038be286b12f1dc4a64db9bf4c94f404259b14cf`.

No answer has arrived for that new question; neither artifact is applied. The earlier service hash `e417...` is superseded and cannot be executed under the new proposal. Their proposed target/hashes and unresolved execution prerequisites are in [persistence-design.md](persistence-design.md). A separate exact approval and reviewed test/repository slice are required before execution. No blanket approval is assumed.

For each migration record its exact path/content hash, target environment, purpose, user approval reference, execution result, and post-checks. A changed artifact or new environment requires its own approval. Never record raw database URLs or credentials.

For each release/live operation record the requested scope, revision, environment, authorized account/operation, result and recovery instructions. Keep recipient/message evidence private where needed. Do not infer live-send authorization from API credential access.

## Session log

### 2026-10-12 — Durable planning

- Created the phase checklist, repository inventory, dependencies, 25 acceptance scenarios, verification procedure and extraction/rollout criteria.
- Added scoped `AGENTS.md` instructions directing relevant work to the plan and this handoff record.
- Stored the supplied Unipile credential in git-ignored `.local-data/communications/unipile.env`; directory permissions 0700 and file permissions 0600. It has not been validated or used.
- No app/service implementation, database migration, application tests, live provider operation, deployment, or repository publication occurred.

### 2026-10-12 — Environment configuration and explicit TDD

- Configured the supplied credential as `UNIPILE_API_KEY` in root `.env.local`, which the local development launcher reads. Preserved unrelated settings and verified the stored value against the private intake copy without printing it. Verified Git exclusion and mode 0600.
- Made red–green–refactor explicit for new behavior and fixes; added passing before/after characterization requirements for pure extraction. Added evidence and handoff requirements here and in `AGENTS.md`.
- No API validation, server restart, application implementation, migration or live operation performed.

### 2026-10-12 — Initial implementation and OrbStack verification

- User authorized implementation/subagents and required local OrbStack parity/testing. Three agents handled parity/persistence design, contracts/Gmail/independent review, and Unipile research/transport/SDK/API.
- Verified remote revision/image/source baseline and documented shared/isolated schema drift. Rebuilt isolated service fixtures; preserved real shared sessions and their existing live gates. No new migration ran.
- Implemented reusable pure packages, private build/package boundary and aggregate exports, original-backend delivery/draft wrappers, scoped SDK/API and an Acquire composition root. Existing app routes/defaults have not been switched.
- Independent reviews and TDD caught/fixed changed-content/configuration races, wrong receipt references, unsupported operation/field dispatch, action-ID provenance, missing historical-generation recovery and noncanonical recipient ingress.
- Tested full app suite, current source/service tests, existing OrbStack channel workflows, new wrapper against actual synthetic WhatsApp service/journal, and compiled standalone API/SDK + container-local Unipile/signature fixtures. [Verification](verification.md) lists actual results/limitations and reproducible scripts.
- Prepared and peer-reviewed provisional persistence SQL only. Database fencing/quota/checkpoint implementation, backfill, live configuration and complete extraction remain open.
- One read-only v2 credential test returned 401; dashboard DSN/version requested. No auth link, real connection, webhook registration, live message/invitation, production deployment, remote repository publication or data copy occurred.

### 2026-10-12 — V1 implementation, approved alignment and independent-copy proof

- The supplied v1 DSN/key authenticated with HTTP 200 and an empty account list. Stored explicit v1 endpoint/version in ignored environment files. Account inventory does not provide live channel capability evidence.
- Implemented v1 transport, exact account/receipt normalizers, static-header verifier and bounded social adapter using recorded red–green tests. Shared native transport extraction retained passing v2 characterization. Independent review tightened ambiguous HTTP failure handling, identity/provenance and calendar validation.
- Added the required claim/readiness/admission/completion coordinator and conservative historical recovery. Actual Gmail/browser adapters characterize original RFC/action recovery; lost-ID Unipile work remains unknown without search or resend. Required journal ports are not a persistence implementation.
- Added versioned AES-GCM/HMAC journal codec with scope/purpose binding, bounded canonical serialization and retained-key support. Independent red tests caught cross-version key-role reuse and authenticated noncanonical UTF-8. All 60 codec/review tests pass.
- Applied only the three user-approved exact parity artifacts after loopback target/system-ID/hash checks and private backups. Shared application catalogs and 17-entry ledger, and isolated application catalogs/campaign privileges, now match remote. Documented platform/isolated-owner differences remain; shared real-session containers were preserved.
- Final checks: full app suite 2,701 Vitest passes/91 opt-in skips plus eight deployment/smoke checks; typecheck, scoped lint and production build passed. Post-parity 43 shared DB tests and the full isolated channel harness passed. Native OrbStack v1/coordinator/codec fixtures passed. Fresh independent dependency-installed package copy built and passed 441 tests/aggregate exports without Acquire modules, credentials or DB.
- Revised service schema to persist immutable API/config references, encrypted original operation context/outcomes and conservative quota/unknown-state rules. Independent static review/parser checks completed; neither new schema file was executed. A separate exact approval question remains pending for the isolated storage/app-binding prerequisites.
- Changes remain local/uncommitted. No real provider write, credential backfill, production deployment or remote repository publication occurred.

### 2026-10-12 — Feature parity documentation audit

- User asked whether Unipile matches/exceeds the DigitalOcean-hosted implementation. Reviewed the official documentation index and relevant v1 feature/auth/lifecycle/message/history/email/draft/webhook/limits/LinkedIn/calendar references, with separate source and LinkedIn reviews.
- Recorded 17 required behavior groups and nine optional additional capability groups in [feature parity](unipile-feature-parity.md). DigitalOcean is hosting; browser/Baileys/Gmail are the existing transport methods. Provider feature listings do not replace our journal, owner fencing, campaign approval/policy or complete fresh reply guarantees.
- Made material gaps explicit: draft update/revocation, caller RFC Message-ID and recovery equivalence, WhatsApp history/phone-LID mapping, LinkedIn first-chat implementation and delayed acceptance, product/folder-aware fresh reply completeness. Invitation notes are an addition because the current browser path rejects notes.
- Optional candidates include InMail/search/post interactions, social media/actions, Outlook/IMAP, email tracking and calendars. These are documented vendor capabilities, not newly implemented/live-verified features or automatic release scope.
- Updated plan gates and progress; documentation/link/hash/diff checks only. Existing test results remain the preceding code verification, not fresh application test runs. New storage approvals remain pending; no migration or live operation occurred in this audit.

### 2026-10-12 — Application-owned draft proposal

- User asked whether storing drafts in the DB and using normal email send at dispatch would solve the vendor draft gap. Reviewed the actual approval/domain/mailbox paths and current official send contract. Acquire already persists content/state; provider draft synchronization is an additional step.
- Recorded D15 and the F04 alternative: app-only edit/revoke is feasible; preserve separate approval/send, approved content versions, original connection and journal/admission safeguards. Existing Gmail synchronization remains available; Gmail Drafts visibility/manual editing would not be provided by an app-only draft.
- This is feasibility/design evidence, not implementation approval or a completed parity scenario. No code/schema changes, migration or provider writes occurred. Exact next persistence action remains unchanged.

### 2026-10-12 — Separate reply branch/worktree implementation

- User explicitly requested beginning all-channel reply detection on a separate branch/worktree. Fetched remote main and verified base `f66781e`; created `codex/unipile-reply-detection` at `/Users/callum/Documents/Development/project-acquire-unipile-replies`. Saved only the owned prior communications foundation as local commit `d8d0654`; original main checkout/unrelated work and private credentials were preserved.
- Added pure v1 email/WhatsApp/LinkedIn reply normalization, provider-neutral receipt/claim/atomic-finish coordination and a separate bounded native webhook listener. Required repository ports enforce the future durability boundary; no in-memory storage fallback exists in production modules. The inbox-only email classifier reviews other received folders and requires full authenticated header enrichment.
- TDD plus independent review fixed chat-scoped ID collisions, equivalent timestamp fingerprints, raw/enriched contradictions, metadata leakage, malformed stored bytes/direction, invented products and duplicate Content-Type. Capture deadline yields 503 on uncertain/pending commit; a late commit cannot fabricate a later 200. [Reply evidence](reply-detection-tdd.md) links actual red/green records.
- Final current-tree full suite: 2,855 Vitest tests passed/91 skipped, including 154 new reply assertions. Root typecheck, package compilation and scoped source lint passed. Actual native all-channel pipeline passed in an ephemeral read-only/network-none OrbStack container; inherited original-fixture baselines are not claimed rerun.
- Fresh independent package install/build/exports passed in OrbStack with 595 tests across 24 files. No Acquire/Next modules, credentials or database mounted. Source/script hashes in the native reply evidence match the final production tree; proposed migration hashes remain unchanged. No additional standalone runtime extraction is implied.
- No new schema was applied, webhook registered, real account connected, live send performed or app route switched. Branch remains local/unpushed. Real PostgreSQL persistence, identity enrichment/reconciliation, coverage and campaign stops remain next-stage work.
- Saved reply implementation/evidence documentation as local commit `cd9b0e3`, following foundation `d8d0654`. Continue on this branch/worktree; remaining handoff-only documentation is committed separately. Native evidence content hashes match the implementation commit even though the runner recorded its pre-commit HEAD plus dirty source hashes.

### 2026-10-12 — Read-only reply enrichment continuation

- User requested continuing on the reply worktree. Reconfirmed the two new schema files remain unapproved; renewed the precise isolated local approval question with unchanged service/app hashes, target and backup precondition. Code work continued without applying any schema.
- Added account-scoped chat listing and exact-chat guarded attendee/message list reads. Vendor attendee pagination/query scope is under-specified; nonterminal attendee cursors require review. No GET sync endpoint was called because those start synchronization work.
- Added actual read-only all-channel enrichment: current account/source plus required recorded-owner verification; exact chat/complete participants/message corroboration; required verified alias provenance; exact full email/header and reference checks. Owner inputs/configuration are detached; no PN/LID/profile-name guessing. Monotonic deadlines span callbacks and provider reads.
- Corrected a genuine vendor-contract mismatch: full email `2_full` can omit `is_complete`. Required full-fetch context supports that variant without manufacturing a provider flag; incomplete/contradictory variants remain review. LinkedIn invitation/InMail action subtypes no longer become human replies in this pipeline.
- Added 100 assertions using red–green tests and independent review. Final full suite: 2,955 passes/91 skips, root typecheck and scoped lint clean, package builds passed. Native network-isolated OrbStack now composes the actual transport/enricher with provider-shaped GET endpoints for all three channels. Fresh independent copy: 695 tests/27 files plus build/exports passed.
- Current-owner/alias grants, encrypted persistent receipts, fenced workers, actual campaign holds/outbox and complete fresh history remain integration gates. Synthetic ports do not prove those. No migration, live provider operation, app routing/UI change, push or deployment occurred.

### 2026-10-12 — Durable webhook preparation and transaction review

- User requested continuing until done. Continued on the separate branch, with three agents implementing/reviewing disjoint files. Fetched remote main again: no divergence from branch base `f66781e`. Verified all 84 original owned foundation files still match snapshot `d8d0654`; original checkout/legacy services remain untouched.
- Implemented scope/purpose/version-authenticated webhook encryption and retained-key HMAC duplicate checks. Added concrete parameterized PostgreSQL capture/claim with restricted-role attestation, current connection/generation/grant locks, commit-before-acceptance, database-clock lease tokens and poisoned-session discard. Independent review reproduced/fixed expired pending/processing and dead-letter duplicate acknowledgement defects.
- Corrected the separate-database architecture: new service event processor does not resolve application people. One service event/outbox/webhook transaction precedes one Acquire receipt/fingerprint/holds/stops/audit transaction and subscriber acknowledgement. Documented the additional fingerprint/review/routing/barrier and LinkedIn identity-bridge release prerequisites; existing migration approval hashes were preserved.
- Final full suite: 3,089 passes/98 skips (336 files passed/24 skipped), including 134 new assertions. Seven added opt-in database tests are skipped until schema approval; they are not passes. Root typecheck, package compilation and source/script lint passed. Fresh independent OrbStack copy: 829 tests/31 files, build and all new exports passed without Acquire/Next/pg/provider dependencies.
- Actual native OrbStack proof composes encryption, provider-shaped GET enrichment, service event normalization and separate synthetic application commit/ack. Three crash replays and three fingerprint-conflict reviews passed. Its storage/transactions remain memory fixtures. Separately reran the unchanged-schema isolated PostgreSQL reply-store suite: all 16 passed with fixture rollback.
- Read-only isolated catalog/system-ID check reconfirmed both new schemas absent. Renewed the exact two-file/hash/target approval question, with fresh backup/preflight requirement; no answer received. No migration, live account/write, routing/UI activation, production change or push occurred. [Storage evidence](webhook-storage-tdd.md) records reproducible commands and boundaries.

## Exact next action

Current work: encrypted webhook codec, prepared SQL capture/claim and service-only event processing are green on `codex/unipile-reply-detection` in `/Users/callum/Documents/Development/project-acquire-unipile-replies`; continue there, not in the original main checkout. Full app/type/package-build/source/script-lint, actual native encrypted GET/enrichment/event pipeline and fresh independent copy checks passed. No failing edit remains. Existing isolated PostgreSQL reply-store regressions were rerun; other legacy/parity checks remain inherited evidence. No new service/app-binding schema is applied and the full build is not complete.

Pending dependency: the separate schema-only approval question above for the exact isolated service/app artifacts. Do not infer approval from the earlier parity answer or from silence. If granted, recheck current hashes, OrbStack binding/database/system ID and backup, apply only the authorized subset, record exact execution and verify catalogs/RLS before repository TDD. Schema approval is not live-send, backfill or production authorization.

Next engineering step: after exact schema approval/application and catalog/RLS post-checks, run `COMMUNICATIONS_AUDIT_LOCAL_DB=1 CAMPAIGN_ISOLATED_CHANNEL_STACK=1 node node_modules/vitest/vitest.mjs run src/db/communications-webhook-local.integration.test.ts`. Treat missing schema as a prerequisite failure, not TDD red. Verify real encrypted capture/concurrency/claim/grant behavior and add actual revocation/crash races. Then use real PostgreSQL red–green for terminal encrypted event/scoped-outbox/inbox transactions. Separately prepare the reviewed additional app fingerprint/review artifact for specific approval, implement Acquire receipt/holds/stops/audit and commit-before-service-ack consumption, and gate mixed-backend sends behind undelivered work/review across the tenant. Bind the enricher to concrete recorded-owner/verified-alias repositories; add lifecycle/historical reconciliation, complete fresh coverage, connection selection/UI, remaining draft/send/journal/recovery and standalone runtime extraction. No lost-ID Unipile resend. See `webhook-storage-tdd.md`, the enrichment/reply TDD documents, `persistence-design.md` and `persistence-review.md`.

The original isolated channel services remain on 5445/5685/18124/18125/18126; original standalone memory fixture is at 18444. The new reply runner publishes no host ports, replaces no existing container and exits after verification. Reproduce reply checks using direct Node Vitest/TypeScript commands in `reply-detection-tdd.md`, `node scripts/test-communications-replies-orbstack.mjs` and `node scripts/test-communications-copy-orbstack.mjs`. Fixture scripts never provision missing schema or enable real sends. Commits/dirty state are recorded in the handoff; unrelated original-checkout work remains untouched.

At every stop replace this section with the precise next task, command/prerequisites, unfinished edits, known failures and TDD state. Preserve the session log/evidence rather than overwriting history.
