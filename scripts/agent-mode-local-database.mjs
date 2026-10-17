/** Fixed local-only target: never accepts a production/shared database override. */
export function agentDatabaseConfig(surface = 'host') {
  if (!['host', 'container'].includes(surface)) throw new Error('Unknown database surface');
  const host = surface === 'host' ? '127.0.0.1:5437' : 'postgres:5432';
  return { port: 5437, database: 'acquire_agent_mode', marker: 'acquire-agent-mode-local-only', url: `postgresql://project_acquire:agent-local-only@${host}/acquire_agent_mode` };
}
export function assertAgentDatabaseIdentity(identity) {
  const expected = agentDatabaseConfig();
  if (identity.database !== expected.database || identity.marker !== expected.marker) throw new Error('Refusing a database outside the isolated agent worktree');
}
// Identity/memberships and existing business evidence only. No local login session,
// OAuth/mailbox/provider secret, send journal or executable enrolment is copied.
export const pilotTableNames = ['user', 'organization', 'member', 'mandates', 'firmable_companies', 'firmable_people', 'targets', 'contacts', 'mandate_targets', 'coverage_runs', 'valuation_observations', 'research_jobs', 'research_findings', 'campaign_sequences', 'campaign_sequence_versions', 'signals', 'suppressions'];
export function sanitisePilotRow(table, source) {
  const row = structuredClone(source);
  if (table === 'account') {
    if (row.provider_id !== 'credential') throw new Error('Only local credential accounts may be imported');
    row.access_token = null; row.refresh_token = null; row.id_token = null;
    row.access_token_expires_at = null; row.refresh_token_expires_at = null; row.scope = null;
  }
  if (table === 'research_jobs') {
    row.config = { ...row.config, automaticDeadline: 0, agentPilotSourceStatus: row.status };
    if (!['complete', 'partial', 'failed', 'cancelled'].includes(row.status)) {
      row.status = 'cancelled'; row.message = 'Imported local test snapshot; original active work was not resumed.';
    }
  }
  if (table === 'campaign_sequence_versions') row.n8n_workflow_id = null;
  return row;
}
