import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import pg from 'pg';
import { agentDatabaseConfig, assertAgentDatabaseIdentity, pilotTableNames, sanitisePilotRow } from './agent-mode-local-database.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const config = agentDatabaseConfig();
function docker(args, input) {
  const r = spawnSync('docker', ['--context', 'orbstack', ...args], { cwd: root, input, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`Local database preparation failed: ${r.stderr.slice(0, 1000)}`);
  return r.stdout;
}
if (!process.argv.includes('--initialise-isolated-local')) throw new Error('Use --initialise-isolated-local only for the approved agent-worktree OrbStack database');
docker(['compose', '-f', 'ops/agent-mode/compose.local.yml', 'up', '-d', '--wait', 'postgres']);
const target = new pg.Client({ connectionString: config.url });
// Source address is fixed local, and its transaction explicitly forbids writes.
const source = new pg.Client({ connectionString: 'postgresql://project_acquire:project_acquire@127.0.0.1:5434/project_acquire' });
await target.connect(); await source.connect();
try {
  const tables = await target.query("SELECT count(*)::int n FROM pg_tables WHERE schemaname='public'");
  if (tables.rows[0].n !== 0 && !process.argv.includes('--seed-existing-empty')) throw new Error('Existing database: explicitly select --seed-existing-empty to resume an empty approved target');
  const database = (await target.query('SELECT current_database() AS database')).rows[0].database;
  if (database !== config.database) throw new Error('Wrong local database');
  if (tables.rows[0].n === 0) await target.query("COMMENT ON DATABASE acquire_agent_mode IS 'acquire-agent-mode-local-only'");
  assertAgentDatabaseIdentity((await target.query("SELECT current_database() AS database, shobj_description(oid,'pg_database') AS marker FROM pg_database WHERE datname=current_database()")).rows[0]);
  if (tables.rows[0].n === 0) {
  for (const role of ['acquire_campaign_user', 'acquire_campaign_worker', 'acquire_communications_writer']) await target.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
  const schema = docker(['exec', 'project-acquire-postgres', 'pg_dump', '-U', 'project_acquire', '-d', 'project_acquire', '--schema-only', '--no-owner']);
  // pg_dump includes session directives that psql understands; do not execute
  // through the driver, and never write/copy source provider data into a dump.
  docker(['exec', '-i', 'project-acquire-agent-postgres', 'psql', '-U', 'project_acquire', '-d', config.database, '-v', 'ON_ERROR_STOP=1'], schema);
  }
  for (const table of [...pilotTableNames, 'account']) {
    if ((await target.query(`SELECT count(*)::int n FROM "${table}"`)).rows[0].n !== 0) throw new Error('Refusing to overwrite populated pilot tables');
  }
  const counts = {};
  await source.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await target.query('BEGIN');
  // Isolated, empty bootstrap only: preserve the source data without replaying
  // live membership/send-gate triggers. Validate all foreign keys before commit.
  await target.query("SET LOCAL session_replication_role = 'replica'");
  for (const table of [...pilotTableNames, 'account']) {
    const query = table === 'account'
      ? "SELECT id,account_id,provider_id,issuer,user_id,password,created_at,updated_at FROM account WHERE provider_id='credential'"
      : `SELECT * FROM "${table}"`;
    const rows = (await source.query(query)).rows.map(row => sanitisePilotRow(table, row));
    for (let offset = 0; offset < rows.length; offset += 100) {
      await target.query(`INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(NULL::"${table}",$1::jsonb)`, [JSON.stringify(rows.slice(offset, offset + 100))]);
    }
    counts[table] = rows.length;
  }
  await target.query("SET LOCAL session_replication_role = 'origin'");
  const keys = (await target.query(`SELECT c.conrelid::regclass::text child,c.confrelid::regclass::text parent,
    array_agg(a.attname::text ORDER BY k.n) cols,array_agg(b.attname::text ORDER BY k.n) refs
    FROM pg_constraint c CROSS JOIN LATERAL unnest(c.conkey,c.confkey) WITH ORDINALITY k(ca,pa,n)
    JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.ca
    JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=k.pa
    WHERE c.contype='f' AND c.connamespace='public'::regnamespace GROUP BY c.oid`)).rows;
  const quote = value => '"' + value.replaceAll('"','""') + '"';
  for (const key of keys) {
    const result = await target.query(`SELECT count(*)::int n FROM ${key.child} c WHERE ${key.cols.map(c => `c.${quote(c)} IS NOT NULL`).join(' AND ')} AND NOT EXISTS (SELECT 1 FROM ${key.parent} p WHERE ${key.cols.map((c,i) => `c.${quote(c)}=p.${quote(key.refs[i])}`).join(' AND ')})`);
    if (result.rows[0].n) throw new Error('Pilot foreign-key validation failed');
  }
  await target.query('COMMIT'); await source.query('COMMIT');
  const omitted = (await target.query('SELECT (SELECT count(*) FROM mailbox_connections)::int providers, (SELECT count(*) FROM campaign_enrolments)::int enrolments, (SELECT count(*) FROM session)::int sessions')).rows[0];
  if (Object.values(omitted).some(n => n !== 0)) throw new Error('Unexpected executable state in pilot database');
  const dir = resolve(root, '.local-data/agent-mode-orbstack'); mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(resolve(dir, 'database-preparation.json'), JSON.stringify({ database: config.database, marker: config.marker, counts, omitted, preparedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ database: config.database, counts, omitted }));
} finally { await target.end(); await source.end(); }
