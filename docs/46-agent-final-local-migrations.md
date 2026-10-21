# Specific local migration approval request:0027,0028,0030,0031

Status: **specifically approved and applied unchanged** to the isolated local target on17 October2026. The user answered “Approve these four additional local migrations” for these exact artifacts/hashes. Apply receipts are retained privately as0027/0028/0030/0031-approved-apply.json.0029 is unused. Future artifacts still require their own specific approval.

Only target: `acquire_agent_mode`, loopback5437, marker `acquire-agent-mode-local-only`. Apply in the order below, each in its own transaction with immutable predecessor verification. No main/shared/production migration, live sending, native flag enablement or deployment. Post-application people/pipeline/worker/journey12PG cases and communications/ownership24PG cases pass with zero skips. Sequence tests exposed a separate audit privilege gap, fixed by specifically approved/applied0032 in docs/47-agent-sequence-audit-migration.md. Draft/audit/publication/enrolment/guidance now pass20 scoped PG cases; the earlier prerequisite failures were not counted as passes. Existing applied migration files stay unchanged.

- [0027-agent-sequence-publication.sql](../ops/agent-mode/migrations/0027-agent-sequence-publication.sql) — Register the scoped native writer for reviewed contacts and sequence tables under the existing held organisation gate/current membership; add owned immutable sequence-version publication privileges and mandate/org fences. Fixes the bridge discovered by approved0023/0026 tests. No direct contact write privilege.

  SHA256 `5af0d501bb6dfbb0bbda5dd53184058628e35f6c76e392d4dd511782ce84caa6`

- [0028-agent-no-submission-reconciliation.sql](../ops/agent-mode/migrations/0028-agent-no-submission-reconciliation.sql) — Close an original email only with authenticated no-submission journal proof, or strict expired/unprepared/no-intent/fenced lookup proof. Settle sending reservations at zero once, keep grant counters monotonic, retain human hold and invalidate stale reviews. No resending.

  SHA256 `e3016b18329f79b312ebfc1873af1598429e6bae39578168f685c04bff4c7251`

- [0030-agent-sequence-enrolment.sql](../ops/agent-mode/migrations/0030-agent-sequence-enrolment.sql) — Create only exact reviewed email enrolments at the original published version and recorded account, with canonical holds/source checks and initial needs_review state. No sends or direct campaign update privilege.

  SHA256 `38ab9aed40110daf7c3b2f595b05ca087e5342a20819edba478911928ed1cc6d`

- [0031-agent-safe-event-eligibility.sql](../ops/agent-mode/migrations/0031-agent-safe-event-eligibility.sql) — Allow internal human reminders, original receipt reconciliation and history/review notices while supervision is paused/human-owned/complete; refuse forward model/research/send work in those states. Use the same scoped membership/owner predicate in enumeration and claiming.

  SHA256 `8a2a570819e870632295e32220dc23fc4bcbeab8c318c77b02b5085289a38eab`

After application: rerun people/contact physical pipeline, draft/publication/enrolment, no-submission/recovery, paused-event eligibility, role/isolation and combined regressions. If a changed artifact is needed it must be disclosed and specifically approved.
