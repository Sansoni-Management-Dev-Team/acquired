# Shared agent chat presentation

The chat uses one presentation layer for human/agent messages, lead milestones, saved conversation history, action reviews and automatic progress. Rendering does not approve work, refresh provider history or change a sealed action.

- `agent-chat-ui.tsx` and its CSS module define message, identity, surface, disclosure, action and working-status components. Extend these primitives for new chat features instead of adding another independent card style.
- `agent-contact-selection.tsx` shows names, company/role labels and channels in compact rows. Exact recipient/account routes and fit evidence stay available under Details. It reads display metadata separately from immutable proposal inputs.
- `agent-review-people.ts` loads display labels through the existing owned-target projection and permitted contact columns. An optional display failure rolls back its own savepoint and does not abort the review read. It never reads targets directly, grants database permissions or changes decision manifests.
- `agent-message-review-queue.tsx` separates eligible automatic demo batches from manual reviews. Automatic batches show named progress and planned steps. Editing, missing readiness, stale context and non-demo proposals retain normal manual checks. Turning Off stops later requests; already-started requests retain their original key and outcome.
- `agent-demo-auto-approval.ts` recognises reserved identities for the original demo and current `agent-deep-*` testing runs. Email/LinkedIn identity comparison includes the run as well as lead ID. Phone aliases remain opaque; server mapping/binding/history checks stay authoritative.
- `use-agent-demo-approval-preference.ts` retains the owner's saved choice during temporary readiness failures. Execution stops immediately while unavailable and restores the saved choice only when that same owner/mandate passes readiness again. Explicit Off and failed approval requests still disarm automation.
- `plainAgentStatusText` translates only proven system notices. Arbitrary user/model prose and original saved messages are preserved. Named lead milestones adapt draft wording to active automatic settings; old draft milestones no longer expose an outstanding Review draft action.

## Route audit — 21 October 2026

| Step | Checks and outcome |
| --- | --- |
| Create demo, either UI | Shared cached creation; immutable request/source selection; no live-research fallback. Existing source history is separate from each new demo's reserved aliases. |
| Start and recipients | Existing authenticated preparation command; one immutable simulator run, current source revisions, exact sender bindings and deterministic per-phase retry keys. |
| Contact selection | Saved selection/manifest unchanged; shared compact display. All automatically reviews eligible demo contacts, while current context/ownership/eligibility still controls allocation. |
| Model draft | A recorded route ID is now mandatory and enumerated in structured output when channels exist. Missing/foreign references record usage and fail before a draft is proposed. Legacy no-channel email schema and immutable cached model results remain unchanged. |
| Approval | Fixed the old-run-only address filter and a queue race when the next batch arrived before the previous approval refresh finished. Each automatic request uses the existing exact-manifest endpoint and automatic-demo attribution. |
| Dispatch | Original source, binding, provider journal, full current history, reply/opt-out and admission checks remain intact. No unknown outcome is resent by this UI change. |
| Replies | Normal service events/history are saved before native decisions. The observed demo automatically approved/sent a reply; the UI displayed the named incoming message. |
| Follow-ups/reminders | Existing saved events and due-time handlers remain authoritative; their tests are included in the route sweep. No seven-day wall-time run was performed. |
| Stops and review holds | Remain person-scoped. Invalid model output, unresolved transport results and opt-outs are not silently cleared by changing presentation. |

### Remaining rate-limit recovery issue

Actual demo `573cda70-104a-4151-8f0e-d04a5a08e3ce` has original service-journal outcomes `waiting/rate_limited` with retryAt06:38:10.929Z and06:50:16.246Z for operations29db565e-8eba-4f7f-9b5b-5976639098ff and a743a2ab-cefe-4b13-b147-671b98e79528. The app reconciled both as confirmed not submitted and put those conversations into the existing manual-resume hold. Read-only decoding used the existing JournalCodec and retained service key versions; no credentials or message content were logged.

This is separate from approval eligibility: All now approves eligible batches, but does not automatically clear these sending holds. Proper recovery must retain the original no-submission proof, persist the verified retry time, wake through the durable event scheduler, refresh all saved channel histories and check replies/opt-outs/ownership before proposing a fresh action. It must not replay the terminal blocked operation key, lower quotas, reset the simulator, reuse a previous approval or guess that an unknown outcome was unsent. No automatic wait-and-resume change was made in this presentation slice. Any required schema change needs the user's specific migration approval.

Actual local verification: existing browser All advanced five batches and an email initial/reply through the normal5991service; original receipts and events remain saved. Manual Off shows compact selected contacts and expandable exact routes. Cross-channel provider acceptance from earlier work remains historical; this slice did not send a new WhatsApp/LinkedIn test or claim production release.

Validation: meaningful failing regressions preceded the alias/queue, contact display, scoped metadata, exact model route, plain status copy and preference fixes. The final route-focused sweep passes 583 tests in 57 files; the preference follow-up separately passes 88 tests in three files. Fresh nonincremental TypeScript, scoped ESLint and whitespace checks pass. This is source/test coverage across the routes plus the observed local browser/service path, not a new live-provider or seven-day wall-time acceptance run. The full application suite was not rerun for this slice.


### Direct lead threads

`AgentConversationHistory` provides a `thread` presentation for explicit lead views: chronological messages, named participants and channel/time labels, with no nested disclosure. The default summary remains suitable for draft review. `AgentOutreachProgress` and `AgentLeadActivity` share the thread presentation; conversation controls are secondary to its messages. Loading still uses the original owned, read-only saved-history endpoint and context revision; this UI never performs provider refresh or approval. Focus requests open the correct row/page while allowing it to be closed afterward.
