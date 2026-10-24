# Acquire and hosted simulator coordination

Tracked in [Plane: Acquire ↔ hosted simulator](https://plane.mlai.au/mlai/projects/049211e4-72a2-4ee3-9257-157a4f11822f/modules/bdfe0990-8a4e-4997-83b1-3a976ca67932), SC-01–SC-07 (issues255–261).

## Service boundaries

Acquire owns authenticated users and mandates, research, outreach decisions and approvals, dispatch intent, and the conversation history shown to its users. The simulator owns synthetic recipient personas, simulated transport behavior and generated replies. Its history supports recipient continuity; Acquire's saved history supports product state and send decisions. These are separate responsibilities, not a reason to merge databases or processes.

Keep simulator implementation and deployment independent. Acquire calls the same typed communications interface for simulated and live channels. The saved account binding determines its service lane; a failed simulator request must never fall back to a live account. Channels remain email, WhatsApp and LinkedIn, not backend names.

## Existing integration modules

| Responsibility | Source of truth |
| --- | --- |
| Shared payload and identity types | `communications/packages/contracts/src/` |
| Typed ready, submit, lookup and connection API | `communications/packages/sdk/src/` |
| Original-binding lane selection and scoped client construction | `src/lib/communications-client.ts`, `src/lib/communications-routing.ts` |
| Hosted-only history and proof-session RPC composition | `src/lib/hosted-demo-runtime.ts` |
| Native agent communications adapter | `src/lib/agent-communications-configured.ts` |
| App-side hosted callbacks | `src/app/api/agent/hosted-demo/{access,authority,events,recipient}/route.ts` |
| Workflow presets and normal start/status route | `src/app/api/acquisition-workflows/route.ts` |
| Normal execution, review and saved operation routes | `src/app/api/mandates/[id]/agent/{execution,reviews,operations}/route.ts` |

Extend these modules rather than introducing another simulator client or bypassing normal application commands. Shared types do not replace runtime response validation. Validate contract versions, scoped identities, receipt shapes, callback proofs and cancellation at the boundary. Never place service credentials in a browser, test fixture or release manifest.

## Revision and history contract

Preparation hints establish that exact recorded scopes have usable recent history. They are not final sending authority and need not have equal revisions across separate requests. Background simulator refreshes can advance the shared revision between those requests.

At submission the service holds its history turn, refreshes every sealed scope, then projects every scope at the resulting common revision before invoking the unchanged coordinator. Final admission checks the held revision and exact scope vector. Refreshing and projecting one account at a time invalidates earlier proofs; repeatedly trying to equalize advisory revisions outside the held turn cannot fix that race. Missing/stale proofs, cancellation, changed identity or callback failure must still prevent admission.

## Verification layers

1. Mock HTTP and unit contract tests cover all three channels, scoped authentication, malformed/incompatible responses, history and callback identity, and stale or missing final proofs. These establish code behavior, not a live reply.
2. Isolated database tests establish ownership and lifecycle behavior without modifying the user's running local simulator or shared database.
3. The reusable normal-route demo canary starts or resumes an owned demo, approves only an exact eligible manifest within its explicit limit, observes a submission receipt and then a later saved inbound reply. An HTTP200 or healthy service alone is not success. Channel coverage must be reported from evidence; an email reply must not be described as three-channel verification.
4. Release verification links exact app/source revisions, simulator artifacts, protocol compatibility and deployment evidence. A clean source baseline and reproducible artifact are required for future simulator releases; an emergency patch's pinned provenance is not a substitute for a normal clean release.

A request with an ambiguous write outcome is reconciled by its original identity before any retry. Do not generate a new request key to hide uncertainty or resend an unresolved operation. Test evidence belongs in ignored private files; publish only sanitized outcomes and artifact references.

## Current release provenance

The focused hosted revision-order correction is preserved in [`ops/agent-mode/hosted-simulator-patches/`](../../ops/agent-mode/hosted-simulator-patches/README.md). Its baseline was reproduced byte-for-byte before the patch was applied. This repository records that focused delta; it does not claim ownership of unrelated uncommitted simulator worktrees.

Use [`progress.md`](progress.md) for the exact distinction between implemented, locally verified, deployed and live-verified behavior. No migration is needed for the coordination upgrades. New migrations still require approval for the exact migration and target. DigitalOcean deployments are direct; the exhausted GitHub Actions build must remain disabled.
