# Agent cleanup named-candidate inventory

Tracking: [L0D499CD9-177](https://plane.mlai.au/mlai/browse/L0D499CD9-177/), AC01/AC02. Audited 21 October 2026 in `project-acquire-agent-mode`, branch `codex/agent-mode-exploration`, original HEAD `dc89e00` plus the existing dirty tree. This consolidates the named review candidates, their dispositions and current consumers. Test execution evidence and remaining acceptance belong to the dated progress entries; this inventory does not claim release or complete removal of all unused symbols.

The tables below describe the reviewed **working tree**. Twelve independent cleanup commits now package the corresponding behavior from the committed branch base; see the [commit handoff](agent-cleanup-review-handoff.md). They preserve the base's 17-operation review family, version-1 research, human review attribution and original clocks. Richer operation, clock, causality and demo behavior in the working tree remains owned by the separate feature changes.

The `nextTestMandate` removal and required conversation renderer are still feature-dependent: the committed Home page calls the cycling API, and its committed controls panel still uses the original layout as its only renderer. Their current working-tree cleanup must land with those caller changes. Compatibility tests/harness fixes and the new bootstrap operator exception likewise need the feature base. These are recorded explicitly rather than staged through whole-file copies.

## Removed or relocated named candidates

| Original path / symbol | Disposition | Current behavior or consumer preserved |
| --- | --- | --- |
| `src/components/brief-criteria.tsx` / `BriefCriteria` | Removed unused component | Saved brief editing uses `src/components/mandate-brief-form.tsx`; the user-requested acquisition-criteria summary removal remains in place. |
| `src/components/geography-select.tsx` / `GeographySelect` | Removed unused component | Current brief fields are rendered by `mandate-brief-form.tsx`; no runtime/operator caller of the old selector remained. |
| `src/components/campaign-messages-editor.tsx` / `CampaignMessagesEditor` | Removed unused editor and direct test | `src/components/campaign-studio.tsx` uses `campaign-sequence-editor.tsx`. |
| `src/components/company-facts-panel.tsx` / `CompanyFactsPanel`, `CompanyEvidenceSummary` | Removed unused panel and direct test | Current company presentation uses `company-info-summary.tsx` and the active company evidence/background research paths. |
| `src/components/ebitda-estimate-panel.tsx` / `EbitdaEstimatePanel` | Removed unused panel, its direct test and `ebitda-revenue-display.test.tsx` | Financial value/unknown/provenance assertions were preserved at active `company-info-summary.test.tsx`; no financial inference helper was removed. |
| `src/components/candidate-research-cells.tsx` / `CandidateResearchCells` | Removed unused component and direct test | Current result/research presentation remains in `companies-workspace.tsx`, `company-pipeline-progress.tsx` and active evidence cells. |
| `src/components/mandate-workspace.tsx` / `CompanyDataAction` | Removed unused export | Existing workspace/navigation exports remain. Tests now characterize active workspace behavior rather than the dead button export. |
| `src/components/mandate-workspace.tsx` / `CoveragePanel` | Removed unused export | Current company results/progress remain in `companies-workspace.tsx`; the file itself remains active. |
| `src/adapters/apollo-client.ts` / `ApolloClient` | Removed obsolete company client and direct test | Current company discovery uses `provider-mode.ts`/Firmable/web search. Distinct active `apollo-people.ts` remains. |
| `src/adapters/firmable-people-sync.ts` / `syncAllFirmablePeople` | Removed obsolete batch wrapper and direct test | Durable profile execution/reuse/reconciliation remains in `src/lib/firmable-refresh.ts` and its tests. |
| `src/adapters/company-website-fallback.ts` / `createCompanyWebsiteFallback`, `researchCompanyWebsite` | Removed obsolete fallback and direct test | Active `company-missing-field-research.ts` and `company-background-research.ts` preserve sourced facts, bounded reads and explicit incomplete outcomes. Identity integration no longer mocks an unreachable fallback. |
| `src/lib/accreditation-contact-capture.ts` / `captureAccreditationContacts` | Removed obsolete wrapper and direct test | `accreditation-register.ts`, `src/db/accreditation-contacts.ts`, active background field capture and `scripts/capture-accreditation-contact.mts` remain. |
| `src/domain/conversation-decision.ts` / old decision schema and `validateConversationDecision` | Removed obsolete validator and direct test | Current native decision validation is in `src/lib/agent-conversation-engine.ts` and `agent-model-decision.ts`; evaluation remains retained. |
| `src/domain/merge-targets.ts` / `mergeRankedTargets` | Removed unused helper and direct test | No direct replacement needed. Current discovery merging and canonical company identity persistence keep their separate policies. |
| `src/domain/pipeline-board.ts` / `pipelineColumn`, `shortlistRequest` | Removed unused helper and three direct tests | Actual shortlist/version behavior remains covered by `src/app/api/mandates/mandates.test.ts` and `src/domain/acquisition.test.ts`. |
| `src/domain/mandate.ts` / `parseMandate`, `mandateConfirmation` | Relocated unchanged with its seven tests to `src/test/fixtures/legacy-mandate-parser.ts` | Three adapter test files and `src/domain/acquisition.test.ts` build characterization inputs from it. Application mandate creation uses brief/native-command flows. |
| `src/domain/email-message.ts` | Relocated mailbox types to `src/test/fixtures/email-message.ts` | `src/test/fixtures/campaign-mailbox.ts` is the sole direct consumer. The unused `SavedDraft` alias was subsequently removed; current communications contracts remain separate. |
| `src/domain/test-mandates.ts` / `nextTestMandate` browser cycle | Removed unused symbol and its exclusive cycle test | The thirty validated `testMandates` examples remain. `scripts/research-design-matrix.mjs:16` bundles that catalogue through a string-built esbuild entry; its fixed benchmark cases remain tested. |

No executable reference to the retired named symbols or old import paths remained in the inspected public source roots, scripts, workers, testing or operations files. Private source was inspected through filenames and matching structural imports/calls; historical snapshots and compiled evidence were not treated as current consumers or deleted.

## Retained exceptions and bounded refactors

| Path / area | Disposition and current consumer |
| --- | --- |
| `src/lib/agent-demo-account-bootstrap.ts` | Retained operator support: the two ignored private demo/testing bootstrap scripts call its exact setup/verification helpers. See the [retained-entrypoint inventory](agent-cleanup-retained-entrypoints.md). |
| `src/lib/agent-business-time-pool.ts` | Active completion-runtime infrastructure, imported by `testing/agent-completion/composition.ts`. |
| `src/domain/research-runner.ts` | Active Worker/domain runner, imported by `cloudflare/research/index.ts`, `provider-step.ts`, `control-cache.ts` and `src/domain/company-corpus.ts`. |
| `src/adapters/abn-identity-resolver.ts`, `src/domain/abn-resolution.mjs`, `src/domain/abn-public-lookup.mjs` | Active application/operator identity modules. Background/field/accreditation code and public ABN audit/probe scripts consume them; adjacent declarations do not make runtime implementations dead. |
| `src/lib/agent-conversation-evaluation.ts`, `agent-conversation-evaluation-cases.ts` | Intentional held-out evaluation harness consumed by unit and gated model-evaluation suites. |
| `src/domain/test-mandates.ts` | Retained benchmark catalogue; only its unconsumed browser cycling API was removed. |
| Historical SQL admission, ownership, reply/opt-out and unresolved-send paths | Retained safeguards. Code cleanup did not authorize historical data/schema cleanup or backend transfer. |
| `src/components/agent-controls-panel.tsx` | Removed the unreachable alternate layout. `AgentWorkspace` remains its active caller and supplies the required conversation renderer. |
| `src/domain/agent-operation-classifications.ts`, `src/db/agent-operation-sql.ts` | Shared explicitly named operation families replace repeated lists while preserving intentional review/edit/dispatch/invitation differences. |
| `src/db/agent-execution-progress.ts`, `agent-channel-decision-context.ts` | Extracted read projections on the caller's same transaction client; store wrappers preserve route loading/locks, clock selection and ordering. |
| `src/db/agent-review-context.ts`, `agent-sequence-review-context.ts` | Extracted explicit review types and ordered current-context reads; virtual feature validators and root transaction ownership remain. |
| `src/db/agent-review-ledger.ts`, `src/lib/agent-record-digest.ts` | Shared batch insertion/ordered decision persistence and exact persisted hash leaf. Root locks, exact manifests, replay/CAS and current-context/automatic-demo gates remain in `AgentStore`. |
| `src/domain/agent-native-proposal-review.ts` | Pure presentation validation extracted from `agent-native-proposal-details.tsx`; component export and existing permissive legacy presentation behavior remain. |

All eighteen store classes remain in the active inheritance chain. The [store map](agent-store-cleanup-map.md) records which collaborators were extracted and which composition boundaries remain. Formatting-only changes and behavior-preserving extraction have separate saved patches; a file-count reduction is not an acceptance criterion.

## Remaining test-only modules and historical references

Every path in the original remaining **28-module test-only inventory** has concrete direct/transitive consumers and a retention reason in [the machine-readable inventory](agent-cleanup-test-only-inventory.json). They comprise isolated/offline provider fixtures, genuine transaction/reply-clock test support, held-out evaluation, synthetic historical compatibility fixtures and shared target/parser inputs. One is also a real benchmark catalogue reached through a generated entry string. None is classified as an obsolete module merely because application imports do not reach it. Live and gated database test helpers being retained does not imply their tests were executed.

The syntax audit excludes private files, shell/Python entrypoints, generated strings and symbol-level liveness. Computed references remain manual-review items. Concurrent feature work can temporarily add unconnected modules while a caller is being saved; capture source scope and recheck rather than deleting that work.

These historical references intentionally retain the original source/evidence names: `docs/33-firmable-shared-history-execution-plan.md:53`; RC-07 `docs/research-correctness/acceptance-scenarios.json:190/200`, `fix-register.json:433/440`, and `verification/source-fingerprint.json:60/64`. Their historical hashes/logs were not rewritten. The dated cleanup progress entries and this current inventory supersede them for the cleaned source tree.

## Same-scope source census

The original ignored starting manifest hashes **2,023 paths** across its recorded repository scope. Of those original paths, **28 are now absent**, including relocated parser/email paths and obsolete-only tests. Restricting that exact original manifest and the current tracked/untracked non-ignored inventory to the same five source roots (`src`, `cloudflare`, `communications`, `scripts`, `testing`) and suffixes (`.ts`, `.tsx`, `.mjs`, `.mts`) gives **1755 files → 1758 files**, with **28 absent originals**, **31 new paths** and **72 changed existing paths** at this snapshot. These counts include concurrent feature work and declaration files under that suffix set; they do not attribute all tree changes to cleanup or make size reduction a success criterion. The per-path hashes and classification evidence remain in the ignored cleanup evidence, not copied private credentials or historical artifact contents.
