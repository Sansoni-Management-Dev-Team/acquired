# Mandate workspaces

The acquisition workspace is organised around reviewed mandates. Company profiles and
accreditations are shared within an organisation; criteria, assessments, next actions,
qualification, coverage history, valuations and outreach sequences belong to a mandate.

## User flow

1. Open Mandates and create a named brief. Natural-language extraction produces unconfirmed
   fields; review these and enter remaining requirements. Unknown and unrestricted are
   different states. Geography can be an explicitly confirmed testing assumption.
2. Complete the shared buyer profile and capital questions. Only explicitly approved public
   profile fields and mandate outreach positioning are passed to the drafting provider.
   Private brief text, mandate financial criteria and buyer capital details are excluded.
3. Build coverage from the configured register/directory index or import sourced records.
   Retain candidates without identifiers, classification or size. Enrich selected candidates
   separately, up to 20 attempts per operation. No discovery result cap follows that budget.
4. Review each target in the screening worksheet. Record evidence type, source, date,
   confidence, assessment and the next question. A modelled or inferred mismatch does not
   hard-exclude a target. Accreditation scope, site, currency and provenance are retained.
5. Shortlist with unknowns, approve outreach through the existing Gmail draft gate, and
   record contact and conversation progress. Qualification requires reviewed criteria,
   evidence for hard requirements, confirmed buyer capital and a reviewed deal structure.
6. Record valuation observations separately by asking/completed, earnings basis and period,
   property and contingent consideration. Simple price/earnings payback is indicative.

## Coverage boundaries

The configured local index is enumerated across alternative sub-sector terms; underlying
source provenance, overlap and contributions are reported. The source-wide population is
not assumed known. A searched index does not imply national market completeness.

Specialist register, web and paid-provider results can be imported with their source URLs
and source IDs. Live automated web crawling and paid discovery adapters are not claimed as
configured: their gaps appear in Coverage. The existing directory-index preparation tools
remain separate. Enrichment uses Firmable; fixture mode uses fictional discovery records.

The coverage funnel is sequential: discovered entities, supported sub-sector classification,
size present, named owner/principal role, reachable contact. Director/principal roles still
need ownership review. Raw source counts and the current mandate funnel are intentionally
separate.

## Storage and activation

`drizzle/0003_mandate_workspaces.sql` was explicitly approved and applied to the local
`project_acquire` database at `127.0.0.1:5434` on 8 September 2026. It is recorded in
the Drizzle migration ledger. Other databases require their own explicit approval.
All 3 existing target memberships were backfilled; existing target, mandate, contact
and message counts were unchanged, with no missing memberships or mismatched enrolments.

The migration:

- Creates `mandate_targets`, `coverage_runs` and `valuation_observations`.
- Adds `sequence_enrolments.mandate_id`.
- Backfills existing known target-to-mandate associations and enrolment mandate links.
- Does not delete companies, mandates, contacts or messages.

Historical associations already overwritten by the old one-mandate target model cannot be
reconstructed from the current target row. Legacy mandate text is retained and must be
reviewed before new discovery. Legacy outreach without a reviewed mandate must be regenerated
before approval; existing Gmail drafts can still be revoked.

The new routes require this migration before database-backed end-to-end use. No automatic
migration runs at startup. Assessment updates use optimistic versions to reject stale writes.
Every route scopes access to the authenticated active organisation.

## Validation

Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Tests cover unknown criteria,
range parsing, alternative sub-sectors, retention without identifiers, evidence provenance,
qualification gates, separate mandate assessments, disclosure allow-lists, sparse bankability
and authenticated API boundaries. Browser layout and interaction checks use fictional data.

After migration approval and application, verify database-backed create/edit/reload, a shared
company in two mandates, discovery/import and selective enrichment, stale assessment rejection,
accreditation persistence, valuation persistence and independently scoped outreach approvals.
No live outreach or third-party enrichment is needed for fixture verification.
