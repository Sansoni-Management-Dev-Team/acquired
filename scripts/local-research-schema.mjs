// Read-only preflight. Schema creation/upgrades always require separate approval.
export async function checkLocalResearchSchema(db) {
  const { rows: [state] } = await db.query(`SELECT
    to_regclass('public.research_jobs') IS NOT NULL AS jobs,
    to_regclass('public.research_findings') IS NOT NULL AS findings,
    EXISTS (SELECT 1 FROM pg_index WHERE indexrelid = to_regclass('public.research_jobs_active_slot_idx') AND indisvalid AND indisunique) AS slots,
    to_regclass('public.research_jobs_active_org_idx') IS NULL AS old_index_removed`);
  if (!state.jobs || !state.findings) throw new Error("Local research tables are missing (0004_research_jobs). A specific migration needs approval; the launcher never runs migrations.");
  if (!state.slots || !state.old_index_removed) throw new Error("Local research concurrency index is missing or outdated (0005_research_concurrency). A specific migration needs approval; the launcher never runs migrations.");
}
