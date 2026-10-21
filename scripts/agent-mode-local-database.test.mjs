import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentDatabaseConfig, assertAgentDatabaseIdentity, pilotTableNames, sanitisePilotRow } from './agent-mode-local-database.mjs';

test('dedicated local database is the only accepted target', () => {
  assert.equal(agentDatabaseConfig('host').port, 5437);
  assert.match(agentDatabaseConfig('container').url, /@postgres:5432\/acquire_agent_mode$/);
  assert.doesNotThrow(() => assertAgentDatabaseIdentity({ database: 'acquire_agent_mode', marker: 'acquire-agent-mode-local-only' }));
  for (const database of ['project_acquire', 'production', 'postgres']) assert.throws(() => assertAgentDatabaseIdentity({ database, marker: 'acquire-agent-mode-local-only' }));
  assert.throws(() => assertAgentDatabaseIdentity({ database: 'acquire_agent_mode', marker: null }));
});
test('pilot allowlist never imports sessions, provider credentials, sends or executable enrolments', () => {
  for (const table of ['session', 'account', 'mailbox_connections', 'whatsapp_connections', 'whatsapp_auth_keys', 'campaign_enrolments', 'campaign_send_attempts', 'communication_bindings', 'communication_dispatch_intents']) assert.equal(pilotTableNames.includes(table), false, table);
  for (const table of ['mandates', 'targets', 'contacts', 'research_jobs', 'research_findings', 'campaign_sequences']) assert.ok(pilotTableNames.includes(table));
});
test('imported research is observable but cannot auto-resume and workflows are not linked', () => {
  const row = { status: 'queued', config: { automaticDeadline: 9999999999999, query: 'maintenance' }, message: 'Queued' };
  const imported = sanitisePilotRow('research_jobs', row);
  assert.equal(row.status, 'queued');
  assert.equal(imported.status, 'cancelled');
  assert.equal(imported.config.automaticDeadline, 0);
  assert.equal(imported.config.agentPilotSourceStatus, 'queued');
  assert.equal(sanitisePilotRow('research_jobs', { ...row, status: 'complete' }).status, 'complete');
  assert.equal(sanitisePilotRow('campaign_sequence_versions', { n8n_workflow_id: 'live-workflow' }).n8n_workflow_id, null);
});
test('local credential accounts retain sign-in but never import OAuth secrets', () => {
  assert.throws(() => sanitisePilotRow('account', { provider_id: 'google', access_token: 'secret' }), /credential/);
  const account = sanitisePilotRow('account', { provider_id: 'credential', password: 'local-hash', access_token: 'unexpected', refresh_token: 'unexpected', id_token: 'unexpected' });
  assert.equal(account.password, 'local-hash');
  assert.equal(account.access_token, null);
  assert.equal(account.refresh_token, null);
  assert.equal(account.id_token, null);
});
