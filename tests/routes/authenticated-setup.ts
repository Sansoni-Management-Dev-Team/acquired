import { createRequire } from 'node:module';
import pg from 'pg';
import { request, type FullConfig } from '@playwright/test';
import { chmodSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export default async function setup(config: FullConfig) {
  const directory = '.local-data/route-auth';
  const credentials = JSON.parse(readFileSync(`${directory}/credentials.json`, 'utf8'));
  const fixtures = JSON.parse(readFileSync(`${directory}/fixtures.json`, 'utf8'));
  const baseURL = config.projects[0].use.baseURL;
  const storageState = config.projects[0].use.storageState;
  const expectedState = baseURL === 'http://127.0.0.1:3218' ? `${directory}/worktree/storage-state.json` : `${directory}/storage-state.json`;
  if (!baseURL || !['https://acquire-isolated.orb.local', 'http://127.0.0.1:3218'].includes(baseURL) || storageState !== expectedState) throw Error('Unexpected authenticated route target or session path');
  if (credentials.baseURL !== 'https://acquire-isolated.orb.local' || fixtures.destinationOrganizationId !== credentials.organizationId || fixtures.identity.database !== 'acquire_agent_mode' || fixtures.identity.marker !== 'acquire-agent-mode-local-only') {
    throw Error('Authenticated route fixtures do not match the isolated test account');
  }
  const { agentDatabaseConfig, assertAgentDatabaseIdentity } = createRequire(`${process.cwd()}/package.json`)('./scripts/agent-mode-local-database.mjs');
  const database = new pg.Client({ connectionString: agentDatabaseConfig().url });
  await database.connect();
  try {
    await database.query('BEGIN READ ONLY');
    await database.query("SET LOCAL statement_timeout='10s'");
    assertAgentDatabaseIdentity((await database.query("SELECT current_database() AS database,shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]);
    for (const table of ['research_jobs', 'agent_operations', 'campaign_enrolments']) {
      const result = await database.query(`SELECT count(*)::int AS count FROM ${table} WHERE organization_id=$1`, [credentials.organizationId]);
      if (result.rows[0].count !== 0) throw Error(`Test workspace contains executable state in ${table}; do not run automatic page recovery`);
    }
    await database.query('ROLLBACK');
  } finally { await database.end(); }
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  mkdirSync(dirname(storageState), { recursive: true, mode: 0o700 });
  const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true, extraHTTPHeaders: { Origin: baseURL } });
  try {
    const login = await api.post('/api/auth/sign-in/email', { data: { email: credentials.email, password: credentials.password } });
    if (!login.ok() || (await login.json()).user?.id !== credentials.userId) throw Error(`Test-account login failed (${login.status()})`);
    const activation = await api.post('/api/auth/organization/set-active', { data: { organizationId: credentials.organizationId } });
    if (!activation.ok()) throw Error(`Test workspace activation failed (${activation.status()})`);
    const sessionResponse = await api.get('/api/auth/get-session');
    const session = await sessionResponse.json();
    if (!sessionResponse.ok() || session.user?.id !== credentials.userId || session.session?.activeOrganizationId !== credentials.organizationId) throw Error('Unexpected authenticated identity');
    const mandatesResponse = await api.get('/api/mandates');
    if (!mandatesResponse.ok()) throw Error(`Cannot load fixture workspace (${mandatesResponse.status()})`);
    const { mandates } = await mandatesResponse.json();
    for (const id of [fixtures.mandateId, fixtures.emptyMandateId]) if (!mandates.some((m: { id: string }) => m.id === id)) throw Error('Prepared mandate is missing from the test workspace');
    await api.storageState({ path: storageState });
    chmodSync(storageState, 0o600);
  } finally { await api.dispose(); }
}
