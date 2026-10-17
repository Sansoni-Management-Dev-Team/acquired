# Agent workspace layout review

17 October 2026. User requested an Apple-inspired review and implementation for
mandate56cb6d9e-e530-46a0-a98b-294193049536, specifically the oversized controls
between the transcript and composer. Applied the Laws of UX skill as design
guidance: progressive disclosure, proximity, familiar controls and visual hierarchy.
No new component library, font, backend permission or execution mode was introduced.

## Review and changes

The conversation was competing with an introductory banner, another chat heading,
an expanded contact setup form, three large settings disclosures, three always-on
suggestion buttons and a permanent research sidebar. The transcript had its own
scroll limit, while controls below it pushed the composer further down the page.

- The primary area is now the conversation and its composer. The page header is
  shorter, the repeated introduction is removed, and messages use fewer nested
  borders with a readable line width and spacing.
- A compact agent toolbar replaces the large supervision block. Status and the
  current start/pause action remain visible. “Agent settings” opens a native
  dialog inspector containing contact selection, ownership, sending permissions,
  optional sequences and budgets. These forms remain mounted, preserving edits
  when closed. Native focus trapping/restoration, Escape, close button and
  backdrop handling are retained.
- Human handoffs remain in the primary area; approval cards stay above the
  composer. Settings disclosure does not conceal those required decisions.
- Research state and saved guidance are under an explicit Context toggle, closed
  initially. The panel stays mounted. Choosing “Use as guidance” opens it with
  the selected text; merely opening either panel starts no model/provider work.
- Suggestions are a small disclosure instead of a permanent row of buttons.
  The composer is separated from the scrollable transcript and stays at the
  bottom of the conversation area. Responsive Context uses a split area on
  narrow screens and a side column on desktop.
- Original UI/sequence routes and all action handlers, current revision checks,
  default human review and bounded automatic-send rules remain available.

## Verification and limits

47 relevant tests across8 files pass: workspace context/draft interactions,
native settings dialog state and nested draft retention, existing ownership,
sequences, budgets, handoffs, connection labels and service history maintenance.
The2 workspace tests were verification after implementation, not claimed as
behavioural RED. Their first run exposed missing browser globals in Next Link's
test renderer; mocking that unrelated navigation boundary resolved the fixture
failure. Inspector and history-maintenance changes have separately recorded
meaningful RED/GREEN evidence. TypeScript, scoped ESLint, diff checks and the final production build pass (`agent-workspace-compact-build.log`).

The before-layout screenshot is
`output/opendots-architecture-review/agent-workspace-layout-before.png`.
Browser control disconnected during implementation. User asked to retry; a fresh
session still reported no browsers and the in-app browser was also unavailable.
Final rendered desktop/mobile screenshots, keyboard/focus visual UAT and viewport
measurements are pending restored browser access. Do not describe these as passed.

No migration, runtime activation, model call or outbound message is required by
this UI change. Separately authorised owned-mailbox transport testing is recorded
in communications progress; it is not proof of an agent approval/send journey.
