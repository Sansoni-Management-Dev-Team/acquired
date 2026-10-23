# Workflow modularity migration package — preparation

Status: WF-02 in progress. **Not an approval-ready migration bundle. No migration SQL has been applied.**

The catalog preflight is SELECT-only evidence collection, not a migration. It was executed on 2026-10-24 through the deployed Acquire container against the configured Supabase project `njasjqpztiteionfxxul`, in a read-only transaction, with one connection, a 5s server statement timeout and 8s client query timeout. Results: 31 tables, 408 columns, 313 constraints, 98 indexes, 67 policies, 64 triggers and 67 function definitions. All 31 named tables and 50 named function checks were present. PostgreSQL reports 17.6. The existing production ledger contains `native-agent-baseline-v1` and `hosted-demo-registration-v1`; these labels alone are not hash verification.

The initial catalog findings are recorded in `docs/workflow-modularity/schema-audit.md`. A follow-up inventory extended the SELECT to transitive helper functions, but its SSH connection timed out before database execution after the AI release removed its temporary access rule. The initial raw response was overwritten by the failed probe; the private probe has been corrected to preserve prior successful output on failures. A fresh complete catalog capture remains required before SQL freeze. Do not commit raw function definitions without review for embedded historical configuration. No production business rows, local database, simulator or provider were accessed by this inventory.

## Planned complete approval units

| Unit | Required content | Approval gate |
| --- | --- | --- |
| 001 expansion | Narrow workflow records, scoped execution/effect associations, execution-scoped mapping evidence, RLS and immutable identity constraints | Exact reviewed SQL/hash and approved rehearsal/production targets |
| 002 compatibility | All affected installed functions/guards resolve new explicit origins and preserve legacy receipts; research-only and manual-route admission; old workers fail closed on new rows | Must be fully drafted with unit 001, never treated as a later unapproved prerequisite |
| 003 admission | Atomic source reservation, same-request replay, bounded transition and discovery; no network or provider work in transactions | Same complete package approval |

Names above are planned application units, not files available for execution. Do not create an applied-ledger record or approve a hash for this README.

## Scope fixed by audit

- Reuse the original owned mandate and canonical research IDs. No duplicate company/person rows, no new mandate/membership initialization for saved demo, no clearing history.
- One lifetime outreach execution per mandate; completed research-only executions may precede it.
- Keep historical mode and sealed dispatch proofs unchanged. New effects resolve an immutable execution association, never whichever execution is current at retry time.
- Retain the existing worker/queue, research action and conversation handlers.
- Reserve against all competing research/outreach writers, not only other demo starts.
- No provider-specific AI fields, keys or retry logic in the schema.

## Remaining package work before requesting approval

1. Finalize scoped keys and FK design jointly with execution-aware mapping, so expansion does not strand new records behind legacy mode guards.
2. Draft exact compatibility functions from the installed definitions, inventorying direct TypeScript mode reads and callback joins as well as SQL guards.
3. Specify and prepare actual PostgreSQL race/RLS/legacy-recovery tests and the separate rehearsal bootstrap. No rehearsal DB has been created or approved for this package.
4. Review original-effect compatibility and hosted context schema before freezing wire/proof changes.
5. Produce ordered exact SQL, SHA-256 manifest, fixed target identities, timeout/lock behavior, expected catalog changes, rollback and recovery procedure. Any later changed file requires new approval.

Schema rollback should disable new starts while retaining rows and guards for recovery; it must not drop history or let an older worker reinterpret new work as real outreach. Feature activation stays off until application and database acceptance pass.

See `docs/workflow-modularity/` for the source/production audit and characterization evidence. No new feature test or migration rehearsal is claimed as passing by this preparation record.
