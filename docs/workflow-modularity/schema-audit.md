# WF-01 schema and ownership audit

Reviewed 2026-10-24 against database-release revision `f6f6b3d`. This is a source audit, not a live schema attestation. No database, simulator, migration runner or provider was called. The production proposal dump and local migrations are evidence of intended structure; production preflight must verify the actual catalog before approving/application.

## Finding

A new preset field alone is insufficient. Current delivery identity is immutable **per mandate**, while the requested behavior allows a prior real research mandate to start a simulated execution. Changing the old mode row would rewrite its meaning and violate a trigger. A small explicit workflow execution record is warranted; a generic workflow engine, duplicate job queue, or copying company/person rows is not.

`agent_runs` is a worker tick/lease record (`trigger_event_id`, lease owner/until, fence, model usage), not the business workflow. `agent_threads` is unique by organization/mandate/owner and can already exist before outreach. An assistant chat thread must not disqualify an otherwise unused research mandate.

## Existing schema and hard constraints

| Object | Existing contract | Implication |
|---|---|---|
| `mandates` | UUID ID, organization, creator user, brief/filter/provenance JSON | Reuse an owned row and its research references. Verify creator, not only organization membership. |
| `member` | Unique `(organization_id,user_id)` | Check current membership at start and resumed privileged mutations; revoked members must not retain authority. |
| `mandate_targets`, `targets`, `contacts` | Existing links and canonical company/person IDs | Research can be reused without duplicated company/person data. |
| `research_jobs` | Existing status/config and active execution slot uniqueness | Continue existing scheduling; workflow row references/results project this state rather than adding a second scheduler. |
| `agent_threads` | `UNIQUE(organization_id,mandate_id,owner_user_id)` plus scoped identity unique key | Do not remove this constraint merely to introduce presets. One current execution can use the existing thread; historical operations need immutable execution association before a later workflow can change routing. |
| `agent_mandate_execution_modes` | PK `mandate_id`; mode only `real/demo`; demo requires `demo_id=mandate_id`; update/delete trigger always raises | Preserve as legacy creation intent. An execution overlay cannot silently update/replace this row. |
| `agent_demo_mapping_requests` | Scoped FK `(mandate_id,organization_id,created_by,demo_id)` to legacy mode unique index | A new demo execution over an old real mandate cannot currently provision mappings. This is a genuine schema compatibility requirement. |
| `agent_demo_mapping_receipts`, `agent_demo_contact_mappings` | Immutable evidence chained to exact request/receipt; source revision/fingerprint and registry | Preserve old request/receipt rows and original simulator references. New execution-scoped mappings need their own provenance path. |
| `agent_demo_runs` | User/organization registry; run/integration/configuration IDs and three sender bindings; immutable evidence | This is simulator account registration, not acquisition workflow state. Reuse it; do not repurpose its ID as a job ID. |
| `agent_conversations` | Composite scope with thread, mandate, user, organization; immutable effect identity; driver/epoch/history | New conversations must be tied to their workflow once. Old conversations must continue using original delivery and recovery identity. |
| `agent_operations` and `communication_dispatch_intents` | Original source, account, digest, effect/recovery state | Never infer an old effect's mode from the most recently selected workflow; never retry uncertain sends under another backend. |

References: `src/db/schema.ts`; `src/lib/agent-native-create.ts`; migrations `0065`, `0066`, `0068`, `0070`, `0072`; `ops/agent-mode/production-proposals/001-native-agent-baseline-v3.proposed.sql`.

## Minimal schema direction

1. Add a narrow `acquisition_workflow_executions` table: immutable request UUID/digest, organization, owner, mandate, fixed preset, presentation choice, creation time; mutable bounded lifecycle/status/revision/terminal time. Use a text CHECK for three presets rather than independent booleans with invalid combinations. Preset implies research source and outreach policy. No arbitrary workflow graph, node JSON or provider configuration.
2. Add a narrow current/reserved mandate association keyed by mandate (or equivalent partial unique index on nonterminal executions), checked within the same transaction that accepts the request. Avoid a separate generic reservation service. A finished live-research-test can yield to a later demo; its execution remains immutable evidence. A completed/failed demo that created outreach is never automatically recycled. An unknown effect prevents release.
3. Associate new agent threads/conversations/operations with an execution using nullable scoped FKs or one immutable association table. Historical null rows retain existing behavior. Where a thread is reused after research-only completion, derive new effect identity from the associated conversation/operation, not an unqualified mutable thread pointer.
4. Preserve old demo evidence and its FK. Prefer a parallel execution-scoped mapping request/receipt association over weakening the old FK to accept arbitrary `demo_id`. Alternatively extend the evidence model with a strict legacy-vs-workflow scope constraint and verified scoped FK; this requires updating every insert/read guard and should not be presented as a one-column change.
5. Add the research-only prohibition at the actual DB admission boundaries, including direct manual/campaign routes. A UI-disabled button is not enough. Research-only executions must neither create outreach conversations nor approve/send effects. With a completed research test selected for a later demo, prohibit stale test events from inheriting the newer demo's authority.
6. New actor-visible tables require enabled and forced RLS, explicit revokes and grants, owner+organization+membership checks in USING and WITH CHECK, and scoped composite FKs. Worker discovery can use a narrow SECURITY DEFINER function consistent with existing patterns. Do not grant unrestricted table writes to the worker role.

This direction is **not a frozen SQL design**. Parent workflow audit must settle whether the initial release allows one lifetime outreach execution per mandate; this is the simplest fit for the user's unused-mandate requirement and greatly reduces mutable identity. Research-only executions may precede that one outreach execution. Do not support repeated demo runs on a used mandate by deleting history.

## Functions requiring explicit compatibility decisions

These cannot remain blindly mandate-mode-only when a real source mandate is reused for demo:

- `agent_is_demo_origin(uuid)` and `agent_mandate_identity_scope(uuid)`; the latter is used by canonical person conflicts and legacy sequence occupancy.
- `agent_effective_contact(uuid,uuid)` and `agent_delivery_candidate_projection(uuid,uuid)`; simulator aliases must come from the exact workflow mapping, never canonical real recipient data.
- `agent_load_mandate_execution_context(jsonb,text,text)`; binds an exact agent operation/target/campaign/draft origin and seals original context. Resolve workflow from that origin.
- `agent_demo_evidence_insert_guard()` and mapping-request scoped FK; current guard requires the legacy demo mode and exact creator.
- `agent_demo_execution_readiness(uuid)` and `AgentDemoProvisioningStore` mandate-mode read.
- `agent_mandate_outreach_mode_guard()`, `agent_intent_execution_context_guard()` and manual outreach assertion functions; research-only deny and immutable workflow context must be applied before permit/admission, including non-agent UI paths.
- `agent_recorded_reply_execution_scope(...)` and inbound demo joins; reply routing must resolve original mapping, not current mandate preset.

Do not replace old SECURITY DEFINER implementations from the baseline dump without comparing current installed function signatures/bodies: later migrations and the production reliability release may have newer implementations. A stable helper plus narrow changes to audited current functions is preferable to re-copying thousands of lines.

## Concurrency and ownership acceptance

- Same request ID/digest returns the original execution/source; another digest or actor conflicts.
- Two requests cannot reserve the same unused mandate. Lock candidate rows in bounded order; perform eligibility and reservation atomically.
- Current organization membership alone is insufficient: source mandate creator and execution owner must match actor; company/contact references also remain organization-scoped.
- Existing conversations, campaign/sequence sends, pending drafts/effects, claims and uncertain intent recovery prevent unsafe reuse. Do not equate no messages with no outreach state.
- A cancelled pre-outreach reservation may be released only after no effects/research worker remain active and no uncertain state exists. A lease timeout alone does not prove release safety.
- No transaction spans web/Firmable/model/simulator requests. Durable short acceptance precedes existing async research work.
- New tables are empty on schema expansion; old rows/policies and function behavior must remain unchanged when no workflow association exists.

## Migration ledger and review requirements

Production baseline creates `agent_production_schema_migrations(artifact PRIMARY KEY, installed_at, source_revision)`; this table does **not** have a hash column. Its existing artifact label is `native-agent-baseline-v1` even for the v3 prepared file, so filename/version is not sufficient proof of installed content. Hosted registration records `hosted-demo-registration-v1` separately.

The isolated runner uses `agent_local_migrations(name,sha256,applied_at)`, verifies the exact database marker, rejects altered applied hashes, and refuses an unapplied predecessor without specific approval. Do not reuse it against production or reinterpret its isolated standing permission for the new rehearsal target.

Prepare one ordered bundle with SHA-256 manifest, exact production project/database/system identifier, separately approved rehearsal identity/bootstrap, catalog preflight and expected schema signatures. Application evidence records exact file hash externally even if existing production ledger keeps its current shape. No ledger redesign is required solely for this feature.

Rehearsal must include legacy app operations with no execution rows, all three presets, same-org foreign-user denial, revoked membership, reservation race, stale test event after later demo, original-effect recovery, and mapper/reply joins. These are unexecuted acceptance requirements, not passing tests. No migration was applied during this audit.

## Recommended bundle split and compatibility boundary

Use **one lifetime outreach execution per mandate** for the first implementation, with any completed research-only executions preceding it. This follows selection of unused mandates and avoids needing two concurrent delivery identities on one mandate. It does not authorize changing legacy mode rows: completed research results have no outreach identity to recover, but their old creation mode remains historical evidence.

The complete approval bundle should be reviewed together, but has three separately hashed application units:

1. **Expansion:** execution/current-association structures, scoped immutable effect associations, execution-aware mapping evidence structures, RLS/privileges and bounded uniqueness constraints. No old table row rewritten; nullable associations mean old app paths are unaffected. Creating the new helper functions is safe, but old callers do not call them yet.
2. **Compatibility and guards:** modify the current exact functions/triggers inventoried above to resolve the new association when present and fall back to legacy mode when absent. Add enforced research-only deny on conversations/operations/manual and campaign admissions. Add insert-time association validation/immutability. This package is old-app-compatible only if no workflow rows exist; old workers encountering new rows must fail closed rather than downgrade them to legacy real delivery. Add a durable activation/capability check if the existing runtime registration cannot distinguish versions. The new app must not write workflow rows until all guards are installed.
3. **Start/reservation/admission entry points:** narrow functions to atomically select/reserve an unused owned mandate, persist idempotent request, validate transition from research-only to the single outreach execution, and expose bounded worker discovery. No scheduler duplication. Grants should be limited to the existing actor/worker roles as appropriate. These entry points must create no traffic themselves and require the immutable preset. They remain unused until app activation.

Split 2 is the largest risk and must be fully drafted before bundle approval, not promised as a future patch after expansion approval. A migration-only production release leaves no executions and keeps feature activation off. The rollback plan is disable new starts and retain new rows/guards for recovery; do not drop schema or run old workers blindly against new work.

Exact-origin resolution: at creation of each new conversation/effect, store its workflow association once. Worker events carry the execution identity and must match current permitted phase. For existing historical rows with no association, use existing legacy functions unmodified in meaning. For new real/demo contexts, preserve the existing sealed execution wire shape where possible; ensure its identity scope and demo mapping cannot collide with the original mandate's legacy source. If a new wire field/version is required, treat simulator SDK/hosted validation compatibility as an acceptance dependency before drafting an activation migration. Do not change an existing sealed dispatch intent's context or payload digest.

**Inventory completeness gate:** search the whole repository and deployed/current schema for all direct reads of `agent_mandate_execution_modes`, use of demo/mandate IDs in mapping and inbound routes, creation of conversations/operations/enrolments/drafts/intents/permits, and direct mode choices in TypeScript. The function list above is a high-risk starting inventory, not a claim every production override has been enumerated. No exact SQL bundle is ready for approval on this source audit alone.

## Production catalog reconciliation (2026-10-24)

The parent ran the prepared inventory through one read-only production connection with a five-second statement timeout. I reviewed the saved private output at `.local-data/workflow-modularity/catalog.private.json`; I did not open another database connection. The response reports PostgreSQL 17.6, `transaction_read_only=on`, and `statement_timeout=5s`.

All 31 requested tables and all 50 named functions are present. The inventory contains 408 columns, 313 constraints (including incoming FKs from outside the selected tables), 98 indexes, 67 policies, 64 noninternal triggers and 67 function definitions. These are catalog counts, not application workload or correctness results.

The catalog confirms the hard constraints above: one immutable legacy mode per mandate, demo ID equal to mandate ID, mapping request FK into that mode, and one agent thread per owner/mandate/organization. Constraint names are sometimes PostgreSQL-truncated; migration code must use the actual catalog names rather than assuming the longer source names survived.

The production ledger contains `native-agent-baseline-v1` and `hosted-demo-registration-v1`, both source revision `c6e228c`, installed 2026-10-21. That ledger does not prove later function bodies equal the baseline. Whitespace-normalized body comparison found four changes among baseline-matched inventoried functions:

- `agent_demo_run_bindings_match` and `agent_demo_runtime_ready` now dispatch hosted runs through the hosted registration matcher, with preserved `*_before_hosted` fallback functions. The baseline intentionally returned false. Replacing them from that old baseline would disable the hosted simulator.
- `agent_channel_operation_before_invitations` and `agent_invitation_before_company_projection` now also accept the hosted-demo send-window exemption. Preserve that condition alongside the existing admission rules.
- The additional `agent_hosted_demo_send_window_exempt` function itself joins legacy `agent_mandate_execution_modes` and `agent_demo_contact_mappings`; execution-aware compatibility must include this function.

The current inventory is not transitively complete: `agent_hosted_demo_bindings_match` and the `*_before_hosted` fallback definitions are called by inventoried functions but were not selected by the initial direct-reference query. Include them in the next read-only inventory before editing their caller contracts. Existing communications guard functions absent from the agent baseline are also present; absence from that baseline means they belong to another schema source, not that they are missing from production.

## Concrete minimal 001 execution table contract

The first additive migration should introduce **one execution table**, not separate workflow, reservation, task, graph and checkpoint systems. Proposed `public.acquisition_workflow_executions` fields:

| Column | Type / contract |
|---|---|
| `id` | UUID primary key; use the start request UUID directly as execution identity. |
| `organization_id` | text, not null. |
| `owner_user_id` | text, not null, FK to `user(id)`; creator/member checks occur in the admission function. |
| `mandate_id` | UUID, not null; composite FK `(mandate_id,organization_id)` to existing mandate scoped unique index. |
| `input_digest` | text, not null, lowercase 64-hex CHECK; protects replay with changed input. |
| `preset` | text, not null, CHECK `demo`, `live-research-test`, `live`; immutable. |
| `presentation` | text, not null, CHECK `agent`, `workspace`; immutable. |
| `state` | text, not null, bounded CHECK `accepted`, `researching`, `ready`, `outreach`, `complete`, `failed`, `cancelled`, `uncertain`. `ready` means waiting for user Start; it is nonterminal. |
| `revision` | positive integer, starts at 1; mutations use expected-revision comparison. |
| `error_code` | nullable text, bounded machine identifier (no error stack, credentials or lead content). |
| `created_at`, `updated_at` | timestamptz, not null, real-time clock defaults. |
| `finished_at` | nullable timestamptz; present exactly for `complete`, `failed`, `cancelled`; never set for uncertain work. |

No duplicate `request_id`, source/delivery booleans, provider model fields, raw research result JSON, broad workflow config, new lease fields or AI usage columns. Fixed preset determines research/delivery policy in the small shared domain contract. Research results remain on the same mandate/canonical target/contact structures; existing research jobs/events retain work scheduling. `input_digest` protects the selected source/brief semantics. If requested-source information is needed for troubleshooting, add it to the normal immutable audit receipt rather than another data copy.

Required constraints/indexes:

- Scoped unique key `(id,organization_id,mandate_id,owner_user_id)` for future associations.
- Partial unique index `(mandate_id)` where `preset IN ('demo','live')`: **one lifetime outreach execution**, including failed/cancelled executions. Retrying resumes that same execution. This deliberately avoids silently changing a failed execution to another transport.
- Partial unique index `(mandate_id)` where `state NOT IN ('complete','failed','cancelled')`: one active reservation across research/demo/live; `uncertain` remains reserved. A terminal state does not itself prove candidate eligibility: admission must check active jobs/events/effects before reuse.
- CHECK `preset <> 'live-research-test' OR state <> 'outreach'`. Additional effect guards are required in migration 002; this state constraint alone cannot prevent actual sending.
- CHECK terminal state/`finished_at` consistency and chronological timestamps.
- Immutable identity/preset/input trigger; no delete grant. Controlled mutation function applies status transitions, revision and timestamp updates. A generic mutable JSON checkpoint is not needed.
- Enable and force RLS; actor read policy matches organization+owner+current membership. No direct actor/worker INSERT/UPDATE/DELETE grant. Narrow SECURITY DEFINER entry points must independently check scope and mandate creator; owner policy allows only the function owner's intended access under forced RLS. New security-definer functions revoke PUBLIC execution.

An acquisition execution may complete research-only, then a later execution may reserve the same mandate for its single outreach lifetime. Once that outreach execution exists, no later research execution can be admitted on that mandate; enforce this in the common admission function under the mandate row lock. Assistant chat history does not consume the outreach lifetime.

The expansion can initially contain only this table, indexes and privilege/immutability support. Execution-aware mapping and effect associations belong to the fully reviewed compatibility unit; their exact column contract must be agreed with the communications audit rather than speculative duplication in 001. This is a contract proposal, not applied SQL or a claim the complete migration package is ready.
