import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { parseStandaloneEnv, validateStandaloneContainer } from '../../scripts/communications-standalone-fixture-guards.mjs';
import type { SqlPool } from '../../communications/packages/storage-postgres/src/webhook-repository';

/** Synthetic DML tests only. No schema/container startup, migration or provider activity.
 * Construction is inert: skipped suites must not read credentials or connect. */
export function createCommunicationsStandaloneFixture() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  let database: pg.Pool | undefined;
  let verified = false;
  function configuredPool(): pg.Pool {
    assert.equal(process.env.COMMUNICATIONS_STANDALONE_AUDIT, '1', 'Requires explicit standalone fixture opt-in');
    if (database) return database;
    const metadata = JSON.parse(execFileSync('docker', ['--context', 'orbstack', 'inspect', 'acquire-communications-standalone-postgres-1'], { encoding: 'utf8', timeout: 5000 }))[0];
    validateStandaloneContainer(metadata);
    const path = `${root}.local-data/communications/standalone.env`;
    const stat = lstatSync(path);
    const owner = process.getuid?.();
    assert.ok(owner !== undefined && stat.isFile() && !stat.isSymbolicLink() && stat.uid === owner && !(stat.mode & 0o077), 'Requires owned private fixture credentials');
    assert.equal(execFileSync('git', ['check-ignore', path], { cwd: root, encoding: 'utf8', timeout: 5000 }).trim(), path);
    const credentials = parseStandaloneEnv(readFileSync(path, 'utf8'));
    database = new pg.Pool({ host: '127.0.0.1', port: 5446, database: credentials.POSTGRES_DB, user: credentials.POSTGRES_USER,
      password: credentials.POSTGRES_PASSWORD, max: 8, connectionTimeoutMillis: 5000, idleTimeoutMillis: 5000 });
    return database;
  }
  function readyPool(): pg.Pool {
    assert.ok(verified, 'Preflight must establish the exact approved target and prerequisites before any test DML');
    return configuredPool();
  }
  const pool = {
    query<Row extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) { return readyPool().query<Row>(text, values); },
    connect() { return readyPool().connect(); },
  };
  const driver: SqlPool = { async connect() {
    const client = await pool.connect();
    return { async query<Row>(text: string, values?: unknown[]) {
      const result = await client.query(text, values);
      return { rows: result.rows as Row[], rowCount: result.rowCount };
    }, release(error?: Error) { client.release(error); } };
  } };
  async function preflight(requiredRelations: string[] = []) {
    verified = false;
    assert.ok(requiredRelations.every(name => /^communications\.[a-z][a-z0-9_]*$/.test(name)), 'Only explicitly named service prerequisites are accepted');
    const current = configuredPool();
    const { rows: [target] } = await current.query(`SELECT current_database() AS name, system_identifier::text AS identity,
      (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')) AS public_relations FROM pg_control_system()`);
    assert.equal(target.name, 'communications_fixture');
    assert.equal(target.identity, '7696118996713136162');
    assert.equal(target.public_relations, 0);
    const { rows } = await current.query('SELECT name,to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) AS name', [requiredRelations]);
    assert.equal(rows.length, requiredRelations.length);
    assert.ok(rows.every(row => row.present === true), 'Specifically approved schema prerequisite is absent; this helper never initializes or migrates a database');
    verified = true;
  }
  async function close() { verified = false; if (database) { const current = database; database = undefined; await current.end(); } }
  return { pool, driver, preflight, close };
}
