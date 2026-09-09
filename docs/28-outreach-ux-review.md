# Outreach UX review

Reviewed 9 September 2026. Scope: the Funeral industry mandate at `/outreach?mandateId=b0de19cc-3a17-482f-afc7-c444426058e5`, including buyer setup, company selection, contact research, preview, saved sequences, approval, error recovery, keyboard access and mobile layout.

## Finding

The page makes a technically valid workflow appear broken. It offers preview for an ineligible company, puts the rejection outside the user's attention area, and gives optional contact research more prominence than the company and draft task. The most valuable improvement is to make eligibility, the next action and the result visible together.

The live page initially selected **Wholesale Funeral Products Australia**, a parked company. Its preview button was enabled and the copy said “Preview now”. Clicking returned “Return this target to the active pipeline before drafting.” The alert appeared at the bottom of the research/sidebar column, outside the initial desktop viewport. This reproduces the reported failure. A separate live API preview for **Sydney Coffins**, an active company, returned seven drafts in 9.7 seconds without a contact or email. This establishes that email absence itself was not the blocker; it does not prove every provider request will succeed.

## Evidence and limits

- Inspected the authenticated production DOM and desktop screenshot, and reproduced the parked-company rejection in the browser.
- Inspected the live page at a 390 × 844 viewport. The preview control was about 2,840 CSS pixels below the viewport top at the observed scroll position; optional research occupied several screens. No horizontal overflow was detected in this state.
- Reviewed the page, buyer-profile form, research panel, queue, data loader, draft-generation endpoint and Gmail-approval endpoint.
- Tested modified components in a local browser harness using fictional data, the real queue/profile components, mocked navigation and generation responses. The research child was stubbed. This is not an end-to-end deployed-page test.
- Did not send email, create Gmail drafts, change pipeline decisions or run migrations. Code changes remain local pending deployment.
- Laws of UX are used as heuristic lenses, not as proof of specific conversion improvements. No user-study results, performance percentages, contrast certification or exhaustive accessibility conformance are claimed.

## Prioritised findings

| Priority | Finding and consequence | UX principle | Recommendation / current status |
| --- | --- | --- | --- |
| P1 | Parked default company looks preview-ready; the server rejects it. Users interpret a valid restriction as a failed feature. | Jakob's Law; Tesler's Law | **Fixed locally:** propagate pipeline stage into the view, label inactive choices, default to an active company, block ineligible previews and link to the worksheet. Preserve explicit company links and server restrictions. |
| P1 | Preview errors sit below research in a separate column. The visible controls still suggest readiness. | Law of Proximity; common region | **Fixed locally:** put request errors in the draft column next to its controls. Handle non-JSON server responses with a readable retry message. |
| P1 | Preview runs with a spinner on “Generate and save drafts”; the clicked preview button gives no matching progress indication. | Doherty Threshold; Law of Similarity | **Fixed locally:** independent preview state, spinner and label on the clicked action, immediate status text, and a clear completion count. Focus completed results. |
| P1 | Contact research and long search snippets precede both the company selector and buyer profile. On mobile, the core action is several screens away. | Hick's Law; Serial Position Effect; Proximity | **Improved locally:** put the company first and disclose public research under “Find a decision-maker”. Further work: group both research providers within one recipient step and place readiness immediately after company selection on mobile. |
| P1 | A saved buyer profile can still be unapproved, but the closed summary only says “Saved”. The required checkbox is difficult to discover. | Jakob's Law; recognition over recall | **Fixed locally:** summary distinguishes Approved / Needs approval / Required; profiles needing approval start expanded. The explicit approval checkbox remains required. |
| P1 | Introductory copy says a decision-maker is required for outreach while the page also offers preview without one. | Jakob's Law; Tesler's Law | **Fixed locally:** explain preview → recipient → saved sequence → Gmail draft. Clarify that preview requires neither recipient nor email, and Gmail approval does not send a message. |
| P1 | A user can edit a visible message and approve it while the server uses the older saved content. | Jakob's Law; error prevention | **Fixed locally:** disable approval for unsaved edits and label it “Save edits before approval”. Also respect local profile readiness and inactive-company status. |
| P1 | The contact selector can show a different contact from the one stored on an existing sequence; Gmail approval resolves the stored sequence contact. | Proximity; consistency of system state | **Remaining:** expose the actual sequence recipient beside each saved sequence. Treat changing that recipient as an explicit update, or clearly require regeneration before approval. Do not present the dropdown selection as proof of the saved recipient. Confirmed in code; no live Gmail action performed. |
| P2 | Seven expanded messages, evidence IDs, schedule dates and database-state labels compete with message review. | Miller's Law; Hick's Law | **Remaining:** a seven-step overview with one expanded editor, plain-language status and human-readable evidence links. Move IDs/technical details into disclosure. Seven messages are a business constraint, not a justification to show every detail at once. |
| P2 | Gmail connection is checked only after approval is attempted. Missing connection/scopes produce a late interruption. | Tesler's Law; Peak-End Rule | **Remaining:** a visible Gmail readiness check with a Settings link before approval, then a success state identifying the saved message and recipient. Do not remove the server-side check. |
| P2 | Preview completion asks users to generate the sequence again to save it; the next generation can differ from what they just reviewed. | Peak-End Rule; Jakob's Law | **Remaining:** allow a reviewed preview to become a saved sequence after recipient selection, with validation and an explicit freshness policy. Until supported, retain truthful “not saved” copy. This is a workflow change, not a cosmetic relabel. |
| P2 | Several small secondary controls and unlabelled draft fields make keyboard/touch use harder. | Fitts's Law | **Partly fixed locally:** 48px preview/save-generation and profile-save targets, larger profile/research summaries, accessible contact and message-field labels. Remaining: enlarge saved-message and secondary research controls and test the full keyboard journey. |
| P2 | Provider/runtime terminology is prominent: “Cloudflare”, AI-call budgets, “Human gate”, “DB state”. Users must translate implementation details into consequences. | Tesler's Law; aesthetic-usability effect | **Partly fixed locally:** replace the page's “Human gate” label and correct its task copy. Remaining: lead research with expected outcome, duration and cost implications; disclose detailed provider budgets and diagnostics separately. |
| P2 | Standalone navigation can lose unsaved profile/message changes; preview state can become stale when buyer/contact context changes. | Jakob's Law; Peak-End Rule | **Remaining:** clear/mark stale previews when their inputs change, and provide consistent dirty-state protection across navigation. Company switching is now blocked during queue requests to avoid displaying an in-flight result under another company; this does not cover every navigation path. |

P1 means a task blocker or misleading action/result relationship. P2 means significant friction or an unresolved recovery/clarity issue. These priorities reflect this workflow, not measured user incidence.

## What already works

- Familiar mandate tabs, a native company selector and consistent card styling support recognition. Preserve these patterns.
- Private funding details are separate from public profile fields; drafting uses an explicit public-field allow-list.
- The server rejects inactive companies, do-not-contact recipients and unapproved public profiles. Explain these restrictions where the user acts rather than removing them.
- Research results show sources and warn about unverified roles/emails. Keep this provenance while reducing its initial prominence.
- Preview is explicitly unsaved, and Gmail approval is separate from sending. Keep those distinctions clear in every state.
- Regeneration warns that saved drafts will be replaced. Maintain this control when simplifying the editor.

## Recommended next layout

1. **Company and eligibility:** selected company, pipeline stage, concise evidence readiness, worksheet link where needed.
2. **Buyer profile:** a compact approved summary, expanding when incomplete or edited.
3. **Preview:** one prominent action when a recipient is absent, adjacent progress/errors, a clear result count and message review area.
4. **Recipient:** optional for preview; public research and Firmable grouped together with source-review context and cost implications.
5. **Save and Gmail review:** actual saved recipient, visible mailbox readiness, save-edits protection, then per-message approval with a concrete success state.

On desktop these groups can use two columns, but company context must remain obvious alongside messages. On mobile, readiness and preview should appear before long optional research. Do not use a rigid wizard that prevents an experienced user from revisiting evidence or editing the profile.

## Validation

- Live reproduction: parked-company preview rejected; active-company contactless API preview returned seven messages.
- Focused automated tests: 11 passing across draft preview and drafting-provider suites, including parked/excluded rejection without provider calls, approval requirement, no writes on preview, and readable provider-initialisation failure.
- Local browser: active default, parked blocker, missing-evidence blocker, immediate preview loading state, locked company selection while pending, seven-result success, result focus, non-JSON HTTP 504 message and retry availability.
- Local saved-draft browser case: editing the body disables Gmail approval and enables Save edits. No Gmail operation invoked.
- Local mobile: 390px viewport, no horizontal overflow in tested state, both generation controls measured 48px high.
- TypeScript and targeted ESLint checks passed. Deployment, actual Gmail sync, complete research interactions and assistive-technology testing remain outside this validation.

## Basis for recommendations

The invoked `laws-of-ux` skill provided the heuristic framework. Primary explanatory references from Laws of UX support reducing competing choices ([Hick's Law](https://lawsofux.com/hicks-law/)), keeping related controls and feedback together ([Law of Proximity](https://lawsofux.com/law-of-proximity/)), prompt progress feedback ([Doherty Threshold](https://lawsofux.com/doherty-threshold/)), and appropriately sized/reachable controls ([Fitts's Law](https://lawsofux.com/fittss-law/)). The specific design recommendations above are this review's application of those principles to observed page behaviour.
