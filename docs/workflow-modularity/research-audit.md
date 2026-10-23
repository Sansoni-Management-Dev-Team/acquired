# WF-01: saved demo and live research audit

Audited 2026-10-24 against database-release worktree `f6f6b3d`. Read-only source review only: no database connection, simulator call, migration application or provider request. This document is a design input, not production verification.

## Main finding

The current demo already reuses canonical company/contact records. It copies the brief into a **new mandate**, then inserts memberships pointing at existing targets. The requested improvement is therefore removing the new mandate/membership initialization path and separating workflow execution identity from mandate identity. It is not eliminating copies of company or person data, because those copies do not currently occur.

A selector-only change cannot safely implement literal same-mandate reuse: existing immutable mode, simulator mapping and initial-research identities assume one creation/run per mandate. Preserve historical receipts and modes; do not update an old real mandate's mode to demo.

## Existing source selection and cost

`src/lib/cached-demo-research.ts`:

- `selectCachedDemoResearch` scopes to current organization, creator and current membership. It selects original sources with complete/partial research, excluding cached-demo creation receipts.
- It requires three companies and fifty people. Candidate selection performs lateral aggregate counts over memberships, companies and people; then queries up to ten candidates individually.
- It rotates sources by the actor's least recent cached-demo use. It **does not test absence of outreach conversations**, current source reservations or active source research.
- Companies require consistent Firmable IDs and no conflicting canonical claim. People require non-fictional Firmable identity and no `doNotContact`; web-only saved companies are currently excluded.
- A selection is bounded to twenty canonical companies and at most one thousand people. More than one thousand matching people rejects the source rather than selecting a smaller valid cohort.
- The frozen digest covers mandate, target and contact `xmin` revisions. Revision changes between selection and attachment fail closed.
- `attachCachedDemoResearch` rejects source ID equal to destination ID. It takes the policy writer advisory lock, organization send gate, member and source row share locks, rereads the complete manifest, and calls `AcquisitionRepository.attachMany`. Those writes are membership/projection work, not fresh provider research.

The replacement should retain identity/ownership/provenance checks, remove the arbitrary fifty-person admission requirement, and avoid repeated full candidate aggregates. First locate a small indexed candidate set; check bounded usable records; reserve the chosen mandate atomically and recheck its eligibility under the reservation lock. Do not claim a performance gain before measuring plans and real concurrent acceptance.

## Identity coupling that must change

| Code/schema | Current coupling | Required treatment |
| --- | --- | --- |
| `src/lib/create-cached-demo.ts` | `requestId` becomes new mandate ID; receipt read by that ID; selects before creation transaction | Shared start command must persist request ID -> existing mandate + immutable preset/selection atomically |
| `src/lib/agent-native-create.ts` | Receipt ID, entity ID and mandate ID equal; always inserts new mandate and immutable mode | Keep historical creation behavior; new execution command must not rewrite its receipt |
| `src/lib/agent-initial-research.ts` | `initialContext` joins creation audit `id=m.id`, research job `id=m.id`; intent request ID must equal mandate ID | New execution context loads immutable execution intent, optional research job ID and existing mandate separately; keep legacy reader fallback |
| `ops/agent-mode/migrations/0065-agent-mandate-execution-mode.sql` | Mode row keyed by mandate; UPDATE/DELETE rejected; demo ID must equal mandate ID | Leave old rows unchanged; execution-scoped mode/admission needs explicit new authority |
| `ops/agent-mode/migrations/0066-agent-demo-contact-projections.sql` | Mapping request FK references mandate mode; demo ID equals mandate ID; mapping unique per demo/contact | Execution-aware mapping scope and guard changes are required before same-mandate demo can work |
| `src/db/agent-demo-provisioning-store.ts` | Resolves demo through mandate mode | Resolve new execution immutably; preserve old demo mapping/receipt recovery |
| `ops/agent-mode/migrations/0001-agent-state.sql` | One assistant thread per organization/mandate/owner | Assistant chat is not outreach. Reuse does not need another thread; workflow entries must identify execution and prevent old events from being interpreted as current work |
| `src/db/agent-execution-store.ts` | Execution view resolves mandate mode; opens conversations under thread/responsibility | Pass/resolve saved execution, never a client-supplied mutable transport flag |

Do not weaken the old mode trigger or remove mapping foreign keys simply to admit the new path. New rows need an auditable execution binding, and all direct/manual/worker admission paths must check it. The communications audit owns the exact full guard inventory.

## Minimal reservation and eligibility semantics

Use the proposed workflow execution record itself as the reservation if possible, avoiding a second source catalog or scheduler. Persist actor, mandate, immutable preset, request identity/digest, initial selection IDs/digest and state. An active/consumed demo reservation must have uniqueness at the database level; app-side SELECT followed by INSERT is insufficient.

Define eligibility as:

1. Mandate created by the current user in their current organization, with current membership.
2. Valid brief, usable saved company and person records, and no active research modifying this mandate. A completed live-research-test can become eligible.
3. No outreach conversations for the mandate, across owners/states, including complete/held conversations. An empty assistant thread or old research chat does not disqualify it.
4. No incompatible campaign outreach/enrolment or unresolved send effects. Canonical contacts can be shared with other mandates: selection must not clear their holds/claims; exclude conflicting selected contacts or reject the source if none remain.
5. No other active demo reservation and no already consumed reservation. Replays of the same immutable request return the same execution, not a newly selected source.

A reservation cannot expire and be reassigned merely because the HTTP request times out. Release only through explicit cancel/failure reconciliation proving no provisioning/outreach effects; preserve the execution receipt and original selection for retries. Once a conversation exists, the mandate stays ineligible for a fresh demo. Never delete history to make it eligible.

The atomic reservation must fence against concurrent conversation creation and research admission, not just another demo selector. Row locking alone is ineffective if those other writers do not take the same lock/check the saved reservation. This needs a shared admission rule/trigger or coordinated existing gate, with concurrency tests.

## Shared live research path

`src/lib/start-mandate-research.ts` is already a shared action for GUI and agent. It generates brief scope, applies ordinary organization limits and pipeline selection, creates an idempotent research job and asks the existing worker to run it. Normal Firmable-capable pipelines retrieve company people through saved bounded config. Preserve this path, its budget rules and ordinary continuations.

`ensureInitialMandateResearch` currently starts/loads an assistant responsibility and launches that action, while cached mode attaches records and marks ready. A small shared research port can return the same result for saved/live sources. Saved execution loads canonical IDs and saved provenance; live execution calls the existing action with an execution-owned research request ID. Do not fabricate a completed research job for saved mode.

`ResearchRepository.hasOtherActive` checks nonterminal roots on a mandate. The new start/reservation path must preserve that exclusion. A live research test can create or reuse an unused mandate, but should not reuse an already completed request ID to imply a fresh paid run.

Research-only completion must stop before agent outreach preparation, simulator recipient provisioning, allocations, drafts and conversations. A UI toggle is insufficient; immutable preset needs checking at server and direct outbound boundaries. Existing `startMandateResearch` itself is not an outreach call, so it should remain reusable.

## Proposed acceptance cases

Before extraction, run existing characterization tests without integration flags: `src/lib/{cached-demo-research,create-cached-demo,agent-initial-research}.test.ts`. Existing assertions intentionally codify old minimum-size and rotation behavior; preserve those as legacy-path expectations and add new-command behavior tests rather than silently rewriting history.

New tests should prove:

- One saved company/person source can be admitted; no provider/model/worker call and no new mandate/target/contact/membership rows.
- Existing assistant chat is allowed, any outreach conversation is excluded, and canonical-contact ownership conflicts remain effective.
- Same-user ownership is enforced inside a shared organization; forged source IDs fail closed.
- Two starts race for the same source: exactly one reservation, second chooses another or reports none. Race with conversation insertion/research admission is fenced.
- Lost response and process restart replay the same execution/selection; conflicting request payload fails; no transaction encloses provider HTTP calls.
- Source revision changes before admission reject/reselect before committing; later changes never silently replace immutable selection or routing.
- Missing saved source produces a useful empty result and zero live fallback.
- Saved/demo and live research share downstream result shape, with original provenance/age; existing live jobs continue on their original pipeline.
- Live-research-test completion makes zero provisioning/outreach writes; direct start, worker restart and late completion cannot bypass the restriction.
- Legacy request reconciliation, immutable mode rows and demo mappings continue to work after additive migration.

Actual reservation/race/foreign-key/RLS assertions require the separately approved rehearsal database. None were run in this audit. No access to the user's occupied local simulator database is needed for unit/characterization tests.
