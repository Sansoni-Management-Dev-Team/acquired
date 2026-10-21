# Fresh mandate research and enrichment verification

18 October 2026. This records the normal local GUI at http://acquire-agent.orb.local after the user clarified that Run demo supplies an example acquisition brief and must run real research and enrichment. It does not mean fictional company results or a manually seeded outreach demonstration. Source verification, actual provider evidence and production release remain distinct.

## Current local behavior

- Run demo with Agent mode off uses an example brief, creates the mandate normally and dispatches the ordinary research endpoint. Company results persist to the same mandate memberships used by the Companies tab.
- Local discovery and enrichment now use real Firmable session transport. New normal research roots select hybrid F; existing jobs retain their saved pipeline. Manual enrichment uses the live provider and real contact retention. Model drafting uses the configured AI provider.
- Agent mode uses the same saved data and production research tools, with separate research and people approvals. A provisional brief produces an actionable review notice. The saved Brief now exposes explicit criteria review and CAS save without generating another brief or launching research. Returning to an active agent with a newer saved brief offers Resume with reviewed brief; nothing resumes or approves automatically.
- Communications remain on the explicitly selected simulated profile. Real research does not select or approve a real sender. Historical bindings, receipts, budgets and conversations remain intact.

## Defects corrected

1. Known unconfirmed research criteria no longer become a generic interrupted/provider-uncertainty notice. The original failed run remains historical evidence; manual cached contacts remain usable without falsely confirming research assumptions.
2. Missing sender selection now correctly asks the user to choose an account rather than claiming no saved account exists.
3. Saved criteria were not editable through the actual Brief page. The existing editor is now connected to the normal revision-checked save, preserving narrative and financial data unless explicitly edited.
4. `/mandates/new` now passes the same native feature flags as `/`, preserving the native approval workflow from both entry points.
5. A stopped parallel search can expose its genuinely saved company results even when the root has zero pages. Unrelated old results and merely queued targets do not count as saved results.
6. The isolated launcher omitted Firmable configuration and forced fixture-based manual enrichment. It now uses the approved ignored local credential file, keeps raw browser credentials inside the research Worker, selects the real transport and preserves simulated communications separately. Missing credentials disable research instead of silently returning fixture enrichment.
7. An expired optional browser JWT was sent during renewal despite a valid cookie. Actual identical-context checks returned401 with that expired hint and200 without it. Renewal now omits expired, malformed or foreign hints; returned-token validation and sticky reconnect requirements remain intact. The ordinary successful reconnect cleared the local rejection latch.
8. Manual Load people/enrichment incorrectly demanded a legacy API key even when the selected session service was configured. Readiness now follows the selected transport; incomplete session configuration cannot fall back to an inherited direct key.
9. Controlled activation of the merged namespace owner needed to release the old app's host ports first. Ownership and native-idle checks now precede that exact app stop and any mounted configuration write. Persisted workflow volumes are retained.

## Actual GUI and provider evidence

| Scenario | Observed result |
| --- | --- |
| Existing user demo `09d6f8d3-7f9f-4ac8-8a6a-51722ccec90d` | Nine real companies verified in both the normal API and rendered Companies table. Original search/failure history retained. |
| First new Run demo, mandate `014e30f9-c487-4f22-bf53-d426287bfa5a`, root `33c82dfb-0131-471a-a406-bcae1279b4d2` | Normal GUI201 creation/202 dispatch, correct hybrid flags, but twelve company requests failed on the expired-token authentication problem. Preserved as a failed acceptance attempt. |
| Explicit reviewed-brief save and Find companies retry on that same mandate | Normal GUI200 criteria CAS save, unchanged narrative, no generation or research before the separate Find companies action; new root `60a772bf-c0cb-4a1b-9c16-a7db36eaa060` returned202. |
| Retried real discovery | Root completed:100 saved companies,94 genuine Firmable matches, six honestly unmatched web companies, zero company retrieval failures. |
| Automatic people admission | Zero admitted: all100 activity assessments remain `sector: review`; the existing policy requires supported activity and geography. No qualification or screening was changed to manufacture a pass. |
| Existing demo manual Contacts → Load people | F.A. Laser Cutting run `91447079-3a36-4c21-a92b-2dc1b66adf7e` completed through genuine company/search200 responses with zero decision-makers. An honest empty result, not positive contact coverage. |
| Fresh demo manual Contacts → Load people | Aquatec Maxcon run `05c4e817-d530-46d6-b73d-7951d948bf17` completed:94 available profiles, four selected real contacts saved, four email addresses, zero failures, zero phones. All four profile requests explicitly excluded phones. Provider observations, response hashes and exact mandate membership were independently verified. |
| Fresh native GUI | Mandate `dd32e2bf-0c83-4d95-8c35-3d7bfa87f08f`: Agent mode → Run demo → normal idempotent creation/start → Review brief → explicit CAS save → Return to agent → Resume with reviewed brief → one current research proposal awaiting approval. Research and outreach were not approved in this continuity test. |

The discovery root being complete does not mean every company is qualified or every background public-field job succeeded. Independent public-field enrichment includes ongoing/partial jobs. The zero automatic-contact outcome above is an admission boundary, not an authentication or transport failure. Manual contact retrieval was separately verified through its ordinary human-requested path.

## Runtime and test evidence

Controlled local activation completed at01:37:21UTC. All eight app/network/sidecar containers share the independent namespace owner; the original `acquire-agent-mode_agent-research-state` volume remains mounted. Before activation native running operations/runs were zero. Ordinary research had59 persisted running workflow instances; these were recorded and retained, not described as globally idle, reset or silently moved to a different pipeline. No database migration or production deployment was performed.

Latest complete application command:4,916 Vitest tests passed,670 gated tests skipped, then111 Node tests passed. TypeScript and changed-source lint passed. An unrelated5ms native-Node deadline characterization first failed under full-suite contention; its test-only monotonic fixture now deterministically exercises both pre-provider expiry and a late callback under strict unhandled-rejection handling. Production timeouts were unchanged. Earlier overlapping checkpoints are retained separately, not added to these totals. The earlier two actual PostgreSQL research-precondition cases remain separate evidence. The final testing CLI default suite passes465 tests across63 files with zero skips; changed bridge/test lint and diff checks pass.

Independent final GUI verification confirmed the100-company API total and25 rendered page-one rows, four actual Contacts rows with emails, and exactly one current native research proposal awaiting approval. No browser runtime/hydration errors were observed; the independent audit issued no commands and closed only its own tabs.

Private actual receipts and snapshots live under `.local-data/agent-mode-orbstack/evidence/fresh-ui-real-demo/`, with browser screenshots under ignored `output/playwright/`. They include configuration backup hashes, namespace/volume observations, upstream status-only authentication comparisons, normal GUI requests, original failed and successful research outcomes, and body-free contact provenance. Credentials and contact details are not included in this document.

## Remaining release boundaries

AG20 remains In Progress. Local real discovery/manual contact enrichment and the native review-continuation flow are verified. This does not certify live-owned-account sends/replies, execution against the real manual/n8n runtime, all background-field completeness, or production migration/deployment. Existing recorded sender selection and human approval remain required. Production rollout uses its own reviewed provider/runtime configuration; it does not copy the local simulator profile or private browser credentials into application source.
