# Research architecture contracts

These are shared acceptance contracts. The fix register and scoped scenario specifications identify local implementation proof and remaining limitations; this document does not imply production rollout or exhaustive verification of every possible input.

| Boundary | Required invariant | Findings |
| --- | --- | --- |
| Facts | Values retain source, observation time, geographic/entity scope, units, currency, period and evidence type where applicable. Global and regional facts coexist. Missing values and provider sentinel strings never become valid zero values. | RC-01–04, RC-07 |
| Eligibility | A single evidence-aware interpretation feeds screening, worksheets and reports. Unknown scope/currency/activity requires review. Headquarters and operating footprint are separate facts. Estimates and manual review remain identifiable. | RC-01–06, RC-08–09 |
| Scheduling | Every dispatch path uses the same admission, lease, concurrency, priority, cap, retry and deadline policy. Recovery cannot bypass policy or duplicate work. | RC-09–10 |
| Lifecycle | Durable writes, terminal transitions and counters follow an explicit policy. Callback replay is idempotent. Final counts reconcile to persisted unique rows and separately recorded failed attempts. Error origin distinguishes provider from application. | RC-10–12 |
| Reporting | Reported, verified, estimated, reviewed, unavailable, unattempted, failed and not-applicable states have distinct meanings. Availability flags are separate from saved values. Every company/field has a status and missing-data reason. Sampling gaps are explicit. | RC-05–06, RC-13–14, RC-18 |
| Identity within facts | Legal identity verification requires evidence of the entity relationship. Operational read errors remain distinct from genuine multi-entity ambiguity. Substring matches and unrelated registry records cannot establish identity. | RC-15–17 |

Centralization means sharing the contract and interpretation across boundaries, with independent tests of each consumer. It does not require a new service or database schema. Choose implementation after inspecting existing modules.

## Completeness reconciliation

For each retained company, materialize every catalogue field or an explicit `not_applicable` result. A missing value must say whether the source lacks it, research was not attempted, an operation failed, or manual evidence is required. Estimates cannot increment observed-data counts. Unverified identity candidates cannot increment verified-ABN counts.

Aggregate results from those cells and reconcile contacts against durable unique rows. Record snapshot time and whether the run is still accepting writes. Compare API, worksheet, screening and exported report for the same snapshot and policy. Dynamically check saved fields and worksheet criteria against the catalogue so later schema additions cannot silently disappear from the audit.

Provider-missing ACN, founded year, company contact details and descriptions belong to the fallback/completeness contract even when no application defect is established. Baseline coverage in the catalogue is an observation, not a target or expected post-fix percentage.

The [background field acquisition contract](background-field-acquisition.md) documents the separately authorized missing-field reader, its bounded source retrieval, immutable provider input and independent background persistence verification.
