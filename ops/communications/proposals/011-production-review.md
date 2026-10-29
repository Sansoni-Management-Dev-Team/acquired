## Applied after exact user approval — 2026-10-24

Exact schema-only rehearsal bootstrap and011 passed both actual-role repository/proof and two-session race tests. Fresh production schema capture matched the reviewed baseline. Conditional production011 committed; postcheck boundary0rows, FORCE RLS enabled, no lock waits or idle transactions. No code deployed and no sends. Appauthenticatedreadiness200; servicecontainershealthy. A subsequent hosted simulator readiness sample had bindingsVerified=false and is being rechecked independently. Approval/application evidence in `rehearsal-011/manifest.json`; original proposal follows.

# Transport boundary: production proposal, not approved or applied

Read-only inventory on 2026-10-24 identified a **separate communications database**, not Acquire's Supabase database:

- DigitalOcean host `134.199.155.67`, container `acquire-communications-storage-postgres-1`.
- Database `acquire_communications`, system identifier `7696498816558297120`, database comment/marker NULL.
- Schema/table owner and administrative connection `communications_admin`.
- `communications_control` and `communications_scoped`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS.
- `communications.operation_journal`, `dispatch_admissions`, and `account_leases` contain the columns referenced by 011. `dispatch_transport_boundaries` is absent.
- Existing deployed service image: `acquire-communications:github-447e0b90b03d727262e9cd7f4fd08342d33d8763`; container healthy during inventory.

The proposed production file is `011-dispatch-transport-boundary.production.proposed.sql`, SHA-256 `4b7523eef65e35c6491a8de29489a264824234c3f3fcd23a105a40916d44f3ba`. Its body is identical to local 011 (`05f0f4b0fbe2ebc58c220a513a786c748b8314ab293f2c94c3092bef04233274`), except comments and the exact production target/owner/restricted-role guard. It creates a new table and its functions/triggers/policy/grants; it does not backfill old ambiguous operations or change quota reservations.

## Required before approval/application

The existing `acquire_hosted_demo_rehearsal` has no communications schema. Do not apply production 011 there or claim the local 5437 tests are a production-schema rehearsal.

Prepare a separate network-isolated service rehearsal target with a reviewed schema-only bootstrap derived from the current communications schema (no production rows or credentials). Review exact role grants, RLS, constraints and trigger definitions, then freeze bootstrap and target-specific 011 hashes for approval. After approval, apply only those exact files, run the synthetic actual-role concurrency/proof suite, and compare deployed prerequisite definitions again before conditionally applying the production file. Any bootstrap drift or different target requires a corrected review package.

Local synthetic race evidence and the 6995 Vitest / 210 Node suite complement this process; they do not authorize the production migration. Application deployment and service deployment remain separate release steps. New runtime safely retains legacy uncertain behavior when the table is absent.

Private inventory: `.local-data/workflow-modularity/production-next/service-{db-inventory,schema}.json`. The temporary owned SSH /32 rule was removed and verified after inventory. No service DDL, sends, or deployment were performed.

Bounded follow-up hosted health sample returned bindingsVerified=true, ready=true, authorityReady=true and liveSending=false. The previous false sample was transient; no repair or restart was performed between probes.
